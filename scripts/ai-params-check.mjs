#!/usr/bin/env node
/* ============================================================
   дибитишка · проверка «живого» чата против подставного OpenAI
   ------------------------------------------------------------
   Запуск:  node scripts/ai-params-check.mjs     (или npm run ai-test)

   Зачем. Есть класс поломки, который снаружи выглядит как
   «ии чат не реагирует», а внутри это отказ API на 100% предсказуемый:
   свежим моделям (gpt-5*, o*) нельзя `max_tokens` и `temperature` —
   они отвечают 400 Unsupported parameter. Бот обязан это пережить:
   повторить запрос в режиме max_completion_tokens и запомнить режим.
   Плюс: 429 insufficient_quota — это «кончились деньги», а не
   «меня слишком много спрашивают», и путать их нельзя.

   Тест поднимает локальный http-сервер, который ведёт себя как OpenAI
   с капризной моделью, и прогоняет через него bot/src/ai.js.
   В сеть не ходит, ключей не требует.
   ============================================================ */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (m) => { results.push(true); console.log('  ✓ ' + m); };
const bad = (m, hint = '') => { results.push(false); console.log('  ✗ ' + m + (hint ? `\n      ↳ ${hint}` : '')); };

/* ---------- подставной OpenAI ---------- */
const calls = [];
let mode = 'capricious'; // capricious → первый запрос с max_tokens ловит 400
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const sent = JSON.parse(body || '{}');
    calls.push(sent);
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (mode === 'quota') return json(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details', type: 'insufficient_quota', code: 'insufficient_quota' } });
    if (mode === 'auth') return json(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } });
    if (mode === 'model') return json(404, { error: { message: "The model 'gpt-9-turbo' does not exist", type: 'invalid_request_error', code: 'model_not_found' } });
    if (mode === 'capricious' && (sent.max_tokens !== undefined || sent.temperature !== undefined)) {
      return json(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error' } });
    }
    if (mode === 'long' && calls.length === 1) {
      return json(400, { error: { message: 'This model\'s maximum context length is 8 tokens. Please shorten the conversation.', type: 'invalid_request_error' } });
    }
    return json(200, {
      id: 'chatcmpl-test', object: 'chat.completion',
      model: sent.model || 'gpt-test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Я тут 💧' }, finish_reason: 'stop' }]
    });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
// имя модели «старое» — бот по имени угадать не может, лечится только ответом API
process.env.OPENAI_MODEL = 'gpt-4o-mini';
const ai = await import(pathToFileURL(path.join(ROOT, 'bot', 'src', 'ai.js')).href);

console.log('\n1) 400 Unsupported parameter → повтор в правильном режиме');
let r = await ai.complete({ userText: 'привет', history: [], userContext: {} });
if (r.error) bad('первый же запрос упал: ' + r.error + ' ' + (r.detail || ''), 'нужен автоматический повтор');
else ok('ответ получен, несмотря на 400 на первом заходе');
if (calls.length >= 2 && calls[0].max_tokens !== undefined && calls[1].max_completion_tokens !== undefined) ok('повтор ушёл с max_completion_tokens');
else bad('не видно повтора с max_completion_tokens', `звонков: ${calls.length}, тела: ${JSON.stringify(calls.map(c => Object.keys(c)))}`);
if (calls[1] && calls[1].temperature === undefined) ok('для reasoning-режима temperature не отправляется');
else bad('temperature всё ещё уезжает в moderne-режиме');
if (ai.aiDiagnostics().param_mode === 'modern') ok('режим запомнен: aiDiagnostics().param_mode = modern');
else bad('режим не запомнен: следующий запрос снова соберёт 400');
const before = calls.length;
r = await ai.complete({ userText: 'ещё раз', history: [], userContext: {} });
if (!r.error && calls.length === before + 1 && calls[before].max_completion_tokens !== undefined) ok('второй запрос сразу идёт в рабочем режиме (без повтора)');
else bad('режим не переиспользуется', `новых звонков: ${calls.length - before}`);

console.log('\n1b) имя модели подсказывает режим сразу (gpt-5* — без повторов)');
calls.length = 0;
process.env.OPENAI_MODEL = 'gpt-5-mini';
const ai2 = await import(pathToFileURL(path.join(ROOT, 'bot', 'src', 'ai.js')).href + '?fresh=1');
r = await ai2.complete({ userText: 'привет', history: [], userContext: {} });
if (!r.error && calls.length === 1 && calls[0].max_completion_tokens !== undefined) ok('сразу max_completion_tokens, одного звонка хватило');
else bad('для gpt-5* первый звонок не в moderne-режиме', `звонков: ${calls.length}, keys: ${JSON.stringify(calls.map(c => Object.keys(c)))}`);
process.env.OPENAI_MODEL = 'gpt-4o-mini';

console.log('\n2) коды ошибок: деньги ≠ перегрузка');
mode = 'quota';
r = await ai.complete({ userText: 'привет', history: [], userContext: {} });
if (r.error === 'no_quota') ok('insufficient_quota → no_quota (а не rate_limit)');
else bad('ошибка классифицирована как ' + r.error, 'insufficient_quota должен читаться как «нет средств»');
if (/пополни|средства|баланс/i.test(ai.errorHint('no_quota'))) ok('подсказка владельцу говорит про баланс');
else bad('подсказка для no_quota не говорит про деньги');
if (!/OPENAI_API_KEY/.test(ai.fallbackLine('no_quota'))) ok('человеку не показывают внутренности ключа');
else bad('в fallback для гостя лезут переменные окружения');

console.log('\n3) остальные частые причины');
mode = 'auth';
r = await ai.complete({ userText: 'привет', history: [], userContext: {} });
r.error === 'bad_key' ? ok('401 → bad_key') : bad('401 дал ' + r.error);
mode = 'model';
r = await ai.complete({ userText: 'привет', history: [], userContext: {} });
r.error === 'bad_model' ? ok('404 → bad_model') : bad('404 дал ' + r.error);
mode = 'long'; calls.length = 0;
r = await ai.complete({
  userText: 'привет',
  history: Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'реплика ' + i })),
  userContext: {}
});
if (!r.error && calls.length === 2) ok('context overflow → история укорочена и запрос прошёл');
else bad('too_long не лечится: ' + r.error + `, звонков ${calls.length}`);

console.log('\n4) диагностика для /health и /diag');
const d = ai.aiDiagnostics();
d.calls > 0 && d.fails > 0 ? ok(`счётчики ведутся: calls=${d.calls}, fails=${d.fails}`) : bad('счётчики запросов не ведутся');
d.last_error ? ok('последняя ошибка видна снаружи: ' + d.last_error) : bad('нет last_error — владельцу не на что смотреть');
typeof ai.selfTest === 'function' ? ok('selfTest() есть (/diag и ai-check зовут его)') : bad('нет selfTest()');

server.close();
const failed = results.filter((x) => !x).length;
console.log('');
if (failed) { console.log(`проверка живого чата: ${failed} провал(ов) из ${results.length}`); process.exit(1); }
console.log(`проверка живого чата: всё чисто (${results.length} проверок)`);
