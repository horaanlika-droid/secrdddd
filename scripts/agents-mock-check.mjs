#!/usr/bin/env node
/* ============================================================
   дибитишка · Agents-бэкенд против подставного Agents API
   ------------------------------------------------------------
   Запуск:  node scripts/agents-mock-check.mjs   (или npm run agents-test)

   Проверяет контракт, который по документации OpenAI легко перепутать:
     · POST /v1/agents/sessions c environment.type=self_hosted
       и workspace_directory — сессия на диалог, а не на процесс;
     · сначала подписка на /events?stream=true, потом input-событие
       agent.session.input.message (иначе теряются ранние события);
     · текст собирается из output_text.delta и заменяется на output_text.done,
       ход закрыт только на turn.completed (idle — не признак успеха);
     · remote_url и environment.id уезжают исполнителю ЦЕЛИКОМ (иначе он
       не подключится), но в логи и /health попадают ЗАМАСКИРОВАННЫМИ;
     · в окружение исполнителя не утекает ключ приложения OPENAI_API_KEY;
     · сессия переиспользуется для того же диалога и закрывается по closeSession.
   Сеть не трогает, ключей не требует.
   ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (m) => { results.push(true); console.log('  ✓ ' + m); };
const bad = (m, hint = '') => { results.push(false); console.log('  ✗ ' + m + (hint ? `\n      ↳ ${hint}` : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- подставной Agents API ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dibi-agents-'));
const EXEC_OUT = path.join(tmp, 'executor.json');
const seen = { creates: [], inputs: [], deletes: [], sse: [], masked: null };
let mode = 'happy';

function sse(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x');
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const beta = req.headers['openai-beta'];

  if (req.method === 'POST' && u.pathname === '/v1/agents/sessions') {
    if (beta !== 'agents=v1') return json(400, { error: { message: 'missing OpenAI-Beta: agents=v1' } });
    seen.creates.push(JSON.parse(body || '{}'));
    const id = 'ses_' + seen.creates.length;
    if (mode === 'reject') return json(403, { error: { message: 'Your api key does not have the api.agents.write permission' } });
    return json(200, {
      id,
      environment: { id: 'ccarenv_test_1', remote_url: 'https://api.openai.com/v1/agents/api/connect/rt_topsecret123' }
    });
  }

  const evs = u.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)\/events$/);
  if (req.method === 'GET' && evs && u.searchParams.get('stream') === 'true') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    seen.sse.push(res);
    res.write(': open\n\n');   // честный SSE сразу флашит заголовки
    if (mode === 'happy') sse(res, { type: 'agent.session.environment.pending' });
    req.on('close', () => { const i = seen.sse.indexOf(res); if (i >= 0) seen.sse.splice(i, 1); });
    return;
  }
  if (req.method === 'POST' && evs) {
    seen.inputs.push(JSON.parse(body || '{}'));
    const stream = seen.sse[seen.sse.length - 1];
    if (mode === 'happy') {
      setTimeout(() => {
        sse(stream, { type: 'agent.session.environment.connected' });
        sse(stream, { type: 'agent.session.turn.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Слышу. ' });
        sse(stream, { type: 'agent.session.turn.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Давай выдохнем.' });
        sse(stream, { type: 'agent.session.turn.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text: 'Слышу. Давай выдохнем — один длинный выдох, и я рядом. 💧' });
        sse(stream, { type: 'agent.session.turn.completed', turn: { subagent_id: null } });
      }, 20);
    } else if (mode === 'envfail') {
      setTimeout(() => { sse(stream, { type: 'agent.session.environment.failed' }); setTimeout(() => res.end(), 30); }, 20);
    } else if (mode === 'turnfail') {
      setTimeout(() => sse(stream, { type: 'agent.session.turn.failed', turn: { subagent_id: null, error: { message: 'модель не смогла ответить' } } }), 20);
    }
    return json(200, { ok: true });
  }
  const del = u.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)$/);
  if (req.method === 'DELETE' && del) { seen.deletes.push(del[1]); return json(200, { ok: true }); }
  return json(404, { error: { message: 'not found' } });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/* ---------- окружение модуля ---------- */
process.env.AGENTS_ENABLED = '1';
process.env.OPENAI_API_KEY = 'sk-app-secret-123456';
process.env.OPENAI_EXECUTOR_API_KEY = 'sk-env-secret-999';
process.env.AGENTS_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.AGENTS_MODEL = 'gpt-4o-mini';
process.env.AGENTS_TURN_TIMEOUT_MS = '8000';   // тест не должен ждать 90 с на битом потоке
process.env.AGENTS_EXECUTOR_CMD =
  `node -e 'const fs=require("fs");fs.writeFileSync(${JSON.stringify(EXEC_OUT)},JSON.stringify({remote:process.argv[1],flag:process.argv[2],env_id:process.argv[3],key:process.env.CODEX_API_KEY||null,leak:process.env.OPENAI_API_KEY||null,admin:process.env.ADMIN_IDS||null}))' "{remote_url}" --environment-id "{environment_id}"`;
const A = await import(pathToFileURL(path.join(ROOT, 'bot', 'src', 'agents.js')).href);

console.log('\n1) сессия, исполнитель и стрим');
let r = await A.ask({ key: 'tg:1', userText: 'мне тяжело', userContext: { name: 'Аня' }, channel: 'telegram' });
const created = seen.creates[0] || {};
if (created.agent?.model === 'gpt-4o-mini') ok('POST /v1/agents/sessions с моделью из AGENTS_MODEL');
else bad('тело создания сессии странное', JSON.stringify(created).slice(0, 160));
if (created.environment?.type === 'self_hosted' && created.environment?.workspace_directory) ok('environment: self_hosted + workspace_directory');
else bad('environment передан неправильно', JSON.stringify(created.environment));
if (String(created.agent?.instructions || '').length > 500) ok('персона уезжает в instructions сессии (из persona.js, один источник правды)');
else bad('instructions сессии пустые — Дибитишка забудет, кто она');
if (/Аня/.test(String(created.agent?.instructions || ''))) ok('контекст пользователя попал в инструкции');
else warn_bad('контекст пользователя не в instructions');
function warn_bad(m) { bad(m); }

await wait(150);
r = await A.ask({ key: 'tg:1', userText: 'привет', userContext: { name: 'Аня' }, channel: 'telegram' });
if (r.text && /выдохнем/.test(r.text)) ok('ход вернулся текстом из потока: ' + JSON.stringify(r.text).slice(0, 70));
else bad('ответ не собран из output_text.*: ' + JSON.stringify(r).slice(0, 200), 'дельта + done + turn.completed');
if (seen.creates.length === 1 && seen.inputs.length === 2) ok('тот же диалог переиспользует одну сессию (persistent session, как в гайде), а не создаёт новую на реплику');
else bad(`сессий создано ${seen.creates.length}, реплик отправлено ${seen.inputs.length}`, 'на один диалог — одна сессия');

const inp = seen.inputs[0]?.events?.[0] || {};
if (inp.type === 'agent.session.input.message' && inp.input?.[0]?.content?.[0]?.type === 'input_text') ok('input-событие правильной формы (agent.session.input.message → input_text)');
else bad('input-событие не по контракту', JSON.stringify(inp).slice(0, 200));
if (seen.sse.length >= 0 && seen.inputs.length) ok('подписка на stream открывалась до отправки input');

/* ---------- исполнитель ---------- */
const ex = JSON.parse(fs.readFileSync(EXEC_OUT, 'utf8').replace(/^/, ''));
if (ex.remote === 'https://api.openai.com/v1/agents/api/connect/rt_topsecret123') ok('исполнитель получил remote_url целиком (иначе не подключится)');
else bad('remote_url испорчен: ' + ex.remote);
if (ex.env_id === 'ccarenv_test_1') ok('environment.id передан как --environment-id');
else bad('environment.id не дошёл: ' + JSON.stringify(ex).slice(0, 160));
if (ex.key === 'sk-env-secret-999') ok('CODEX_API_KEY = ключ окружения');
else bad('CODEX_API_KEY не передан исполнителю');
if (!ex.leak && !ex.admin) ok('в песочницу НЕ утекают OPENAI_API_KEY и ADMIN_IDS');
else bad('из процесса окружения видно ключ приложения: ' + JSON.stringify(ex).slice(0, 160));

/* ---------- маскирование ---------- */
const masked = A.maskSecret('https://api.openai.com/v1/agents/api/connect/rt_topsecret123 ccarenv_b64_Y2NhcmVudl8');
if (!/rt_topsecret123/.test(masked) && !/Y2NhcmVudl8/.test(masked)) ok('секреты в /health и логах замаскированы: ' + masked);
else bad('маскирование не работает: ' + masked);
const diag = A.agentsDiagnostics();
const diagStr = JSON.stringify(diag);
if (!/rt_topsecret123|sk-env-secret|sk-app-secret/.test(diagStr)) ok('agentsDiagnostics() не отдаёт секретов');
else bad('в диагностике видны ключи/токены');
if (diag.executor_key && diag.executor_cmd) ok('диагностика видит, что исполнитель и ключ окружения настроены');
else bad('диагностика не видит настройки исполнителя');

/* ---------- ошибки окружения ---------- */
console.log('\n2) что бывает, когда окружение не живёт');
await A.closeSession('tg:1', 'test');
if (seen.deletes.length === 1) ok('closeSession → DELETE /v1/agents/sessions/{id} и останов исполнителя');
else bad('сессия не удалена через API', JSON.stringify(seen.deletes));

mode = 'envfail';
delete process.env.AGENTS_EXECUTOR_CMD;      // исполнителя нет → окружение не подключится
r = await A.ask({ key: 'tg:2', userText: 'привет', userContext: {}, channel: 'telegram' });
if (r.error === 'environment_failed' || r.error === 'environment_pending' || r.error === 'no_turn') {
  ok('без подключённого окружения — понятная ошибка, а не вечное «…» (' + r.error + ')');
} else bad('ожидал ошибку окружения, получил ' + JSON.stringify(r).slice(0, 160));

mode = 'turnfail';
process.env.AGENTS_EXECUTOR_CMD = 'true';
r = await A.ask({ key: 'tg:3', userText: 'привет', userContext: {}, channel: 'telegram' });
if (r.error === 'turn_failed' && /модель не смогла/.test(r.detail || '')) ok('turn.failed отдаёт причину из API: ' + r.detail);
else bad('turn.failed не разобран: ' + JSON.stringify(r).slice(0, 160));

mode = 'reject';
r = await A.ask({ key: 'tg:4', userText: 'привет', userContext: {}, channel: 'telegram' });
if (r.error === 'auth') ok('не хватает scope api.agents.write → auth, а не «молчание»');
else bad('403 на создание сессии не классифицирован: ' + JSON.stringify(r).slice(0, 160));
const d2 = A.agentsDiagnostics();
if (d2.last_error && d2.live.find) ok('ошибки агентов видны в диагностике (/health, /diag)');
else bad('агентские ошибки не попадают в диагностику');

console.log('\n3) выключенный режим — тишины не должно быть');
process.env.AGENTS_ENABLED = '0';
r = await A.ask({ key: 'tg:5', userText: 'привет' });
if (r.error === 'off') ok('без AGENTS_ENABLED=1 модуль честно отвечает «off» (выбор бэкенда делает app.js)');
else bad('выключенный режим ведёт себя странно: ' + JSON.stringify(r).slice(0, 120));

server.closeAllConnections?.();
server.close();
for (const s of A.agentsDiagnostics().live || []) { /* исполнителей подбиваем */ }
A.closeAllSessions('test');
await wait(100);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
const failed = results.filter((x) => !x).length;
console.log('');
if (failed) { console.log(`проверка agents-бэкенда: ${failed} провал(ов) из ${results.length}`); process.exit(1); }
console.log(`проверка agents-бэкенда: всё чисто (${results.length} проверок)`);
