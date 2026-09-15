#!/usr/bin/env node
/* ============================================================
   дибитишка · «почему ии-чат молчит» — одна команда
   ------------------------------------------------------------
   Сценарий, из-за которого появился этот скрипт: в вебе и в Telegram
   чат отвечает шаблонами, владелец клянёт OpenAI, а причина оказалась
   в polling (409: сообщения собирала старая копия бота) — HTTP API при
   этом был живой и выглядел как «всё хорошо».

   Запуск с бот-хоста (там же, где переменные окружения):
     node scripts/ai-check.mjs
     node scripts/ai-check.mjs --env-file .env    # если переменные в файле

   Запуск откуда угодно — против публичного адреса бота:
     node scripts/ai-check.mjs --url https://bot-xxxx.bothost.tech

   Что проверяет:
     · OPENAI_API_KEY / OPENAI_MODEL — реальный тестовый запрос к модели
       (теми же параметрами, что и бот: max_tokens vs max_completion_tokens);
     · TG_TOKEN — getMe: какой именно бот отвечает этим токеном;
     · /health, /chat/status, POST /chat у запущенного бота — polling,
       порт, база, последняя ошибка модели;
     · «пользователей 0 при живом HTTP» — признак, что Telegram читает
       другая копия (или данные не переживают рестарт).
   Ничего не пишет и не чинит — только читает и объясняет.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const flags = new Set(args.filter((a) => a.startsWith('--') && !['--url', '--env-file'].includes(a)));

const ok = (msg) => console.log('  ✅ ' + msg);
const warn = (msg) => console.log('  ⚠️  ' + msg);
const bad = (msg) => console.log('  ❌ ' + msg);
const head = (msg) => console.log('\n' + msg);
const fix = (msg) => console.log('     → ' + msg);

/* ---------- .env, если попросили (иначе — только окружение процесса) ---------- */
const envFile = argOf('--env-file') || (fs.existsSync(path.join(ROOT, '.env')) && !flags.has('--no-env') ? '.env' : null);
if (envFile) {
  const p = path.resolve(ROOT, envFile);
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m) continue;
      let v = m[2].trim().replace(/^["']|["']$/g, '');
      if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    console.log(`читаю переменные из ${envFile} (только те, чего нет в окружении)`);
  } else {
    console.log(`нет файла ${envFile} — беру окружение процесса`);
  }
}
const mask = (s) => (s ? `${String(s).slice(0, 3)}…${String(s).slice(-4)} (${String(s).length} симв.)` : 'не задан');
const looksLikeUrl = (s) => /^https?:\/\//i.test(String(s || ''));
let baseUrl = argOf('--url') || (looksLikeUrl(args[0]) ? args[0] : '') || (process.env.BOT_URL || '').trim();
if (baseUrl) baseUrl = baseUrl.replace(/\/+$/, '');
const timeout = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`таймаут ${ms} мс`)), ms))]);
const getJson = (url, opts) => timeout(20000, fetch(url, { cache: 'no-cache', ...opts }).then(async (r) => {
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: r.status, body };
}).catch((e) => ({ status: 0, body: { error: String(e?.message || e) } })));

const problems = [];
console.log('\nдибитишка · проверка живого чата');

/* ---------- 1. ключ OpenAI: реальный запрос к модели ---------- */
head('1) OpenAI — тот ли ключ, та ли модель');
const key = (process.env.OPENAI_API_KEY || '').trim();
if (!key) {
  bad('OPENAI_API_KEY не задан');
  fix('на бот-хосте: впиши OPENAI_API_KEY в .env и перезапусти бота — без ключа чат честно работает шаблонами');
  problems.push('нет OPENAI_API_KEY');
} else if (key.length < 20) {
  bad(`OPENAI_API_KEY подозрительно короткий: ${mask(key)}`);
  fix('похоже на обрезанный/вставленный с пробелом ключ; возьми полный ключ из platform.openai.com → API keys');
  problems.push('короткий ключ');
} else {
  ok(`ключ есть: ${mask(key)}`);
  if (/[^A-Za-z0-9_\-.\s]/.test(key)) warn('в ключе есть небезопасные символы/пробелы — так бывает при копировании с кавычками');
  const aiPath = path.join(ROOT, 'bot', 'src', 'ai.js');
  try {
    const ai = await import(pathToFileURL(aiPath).href);
    console.log(`  модель: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'} · API: ${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}`);
    console.log('  делаю один тестовый запрос (≈24 токена)…');
    const t = await ai.selfTest();
    if (t.ok) ok(`модель отвечает: «${t.answer}» (${t.ms} мс, ${t.model})`);
    else {
      bad('модель НЕ ответила: ' + t.error + (t.detail ? ` — ${String(t.detail).slice(0, 160)}` : ''));
      fix(t.hint || 'смотри текст ошибки выше');
      problems.push('OpenAI: ' + t.error);
    }
  } catch (e) {
    bad('не удалось проверить напрямую: ' + (e?.message || e));
    fix('запусти скрипт из корня репозитория (bot/src/ai.js должен быть на месте)');
  }
}

/* ---------- 2. TG_TOKEN: какой бот вообще отвечает ---------- */
head('2) Telegram — токен про того бота, которому ты пишешь');
const tgToken = (process.env.TG_TOKEN || '').trim();
if (!tgToken) {
  warn('TG_TOKEN не задан — проверить нечем (на бот-хосте он обязан быть)');
  fix('если пишешь боту в Telegram, а он молчит: сверь @username бота с тем, кому ты пишешь');
} else {
  const r = await getJson(`https://api.telegram.org/bot${tgToken}/getMe`);
  if (r.body?.ok) {
    const u = r.body.result;
    ok(`токен принадлежит @${u.username} (id ${u.id})`);
    console.log(`     если в чате другой адресат — вот и причина молчания: пиши @${u.username}`);
  } else {
    bad('Telegram не принял TG_TOKEN: ' + JSON.stringify(r.body?.description || r.body).slice(0, 160));
    fix('перевыпусти токен в @BotFather (/revoke) и обнови на хосте');
    problems.push('TG_TOKEN не проходит');
  }
}
const admins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!admins.length) warn('ADMIN_IDS пуст — команды /ai, /diag и /users никто не увидит');
else ok(`админов: ${admins.length} (${admins.slice(0, 3).join(', ')})`);

/* ---------- 3. запущенный бот: HTTP + polling ---------- */
if (!baseUrl) {
  head('3) Запущенный бот — пропускаю');
  console.log('  (нет адреса: добавь --url https://<адрес-бота> или впиши BOT_URL;\n   тогда проверю polling, порт и /chat вживую)');
} else {
  head(`3) Запущенный бот: ${baseUrl}`);
  const health = await getJson(`${baseUrl}/health`);
  if (!health.status) {
    bad('бот не отвечает: ' + health.body.error);
    fix('хостинг отдал другой адрес/порт? проверь, что PROCESS слушает PORT, а прокси смотрит на него; ' +
        'и что контейнер не лёг (docker ps / docker logs)');
    problems.push('HTTP API недоступен');
  } else if (health.status !== 200) {
    bad(`/health → ${health.status}`);
    fix('адрес ведёт не на бота (или бот не поднялся)');
    problems.push('/health ' + health.status);
  } else {
    const h = health.body;
    ok(`/health отвечает ${health.status} · приложение: ${h.app || '?'}`);
    const t = h.telegram || {};
    console.log(`  telegram: ${t.as || 'не знаю, кто я'} · polling: ${t.polling || '?'} · апдейтов: ${t.updates ?? '?'} · последний: ${t.last_update_age_s ?? 'никогда'}`);
    if (t.poll_error) {
      bad('polling сломан: ' + t.poll_error + (t.poll_error_text ? ` — ${t.poll_error_text}` : ''));
      if (t.poll_error === 'conflict') fix('другая копия бота держит polling: найди её (docker ps; pgrep -af "bot/src/index.js") и останови, затем перезапусти эту');
      else if (t.poll_error === 'auth') fix('токен не тот/просрочен — обнови TG_TOKEN');
      else fix('смотри лог контейнера; HTTP при этом может работать, а Telegram — молчать');
      problems.push('polling: ' + t.poll_error);
    } else if (t.polling && t.polling !== 'running') {
      warn('polling не в состоянии running (' + t.polling + ') — сообщения из Telegram не обрабатываются');
      fix('проверь NO_POLLING на хосте (=1 выключает Telegram совсем) и статус в логе');
      problems.push('polling: ' + t.polling);
    } else if (t.polling === 'running' && (t.updates === 0 || t.updates == null)) {
      warn('polling работает, но не видел ни одного сообщения');
      fix('убедись, что пишешь тому боту, чей TG_TOKEN здесь (см. строку «telegram:» выше)');
    } else if (t.polling === 'running') ok('polling принимает сообщения ✅');

    const a = h.ai_health || {};
    if (h.ai === false) { bad('у бота нет OPENAI_API_KEY (чат шаблонами)'); fix('впиши ключ на хосте и перезапусти'); problems.push('бот: нет ключа'); }
    else if (a.last_error && !a.last_ok_at) {
      bad(`бот ни разу не получил ответ модели: ${a.last_error} — ${a.last_error_detail || a.model}`);
      fix(h.ai_hint || 'поправь ключ/модель, затем /diag в Telegram');
      problems.push('бот: ' + a.last_error);
    } else if (a.last_ok_at) ok(`бот успешно говорил с моделью ${a.last_ok_age_s} с назад (${a.model})`);
    else ok('ключ у бота есть, успешных ответов пока не было — напиши ему и повтори проверку');

    console.log(`  база: пользователей ${h.users ?? '?'}, из них говорили ${h.db?.users_talked ?? '?'}`);
    if (h.users === 0) {
      warn('пользователей 0');
      fix('либо это свежий том (данные не переживают рестарт: в Docker нужен том на /data), ' +
          'либо Telegram читает другая копия бота — тогда чат «молчит» при живом HTTP');
    }
    for (const p of h.problems || []) console.log('  · проблема с точки зрения бота: ' + p);
    if (h.db?.file?.includes('tmp')) warn('база лежит в /tmp — при рестарте контейнера память чата обнуляется: ' + h.db.file);
  }

  /* POST /chat — тот же путь, по которому ходит веб-версия */
  console.log('  спрашиваю у бота «привет» через POST /chat…');
  const chat = await timeout(60000, fetch(`${baseUrl}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'привет', history: [], context: {} })
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))).catch((e) => ({ status: 0, body: { error: String(e?.message || e) } }));
  if (!chat.status) bad('POST /chat не дошёл: ' + (chat.body?.error || '?'));
  else if (chat.body?.ok && chat.body.text) ok(`живой ответ бота (${String(chat.body.text).length} симв.): ${String(chat.body.text).split('\n')[0].slice(0, 90)}`);
  else if (chat.body?.local) warn('бот ответил локальным шаблоном (ошибка API): ' + (chat.body.error || '?') + (chat.body.hint ? ` — ${chat.body.hint}` : ''));
  else warn('POST /chat вернул ' + JSON.stringify(chat.body).slice(0, 160));
  console.log('     (для подробностей на хосте: /diag в Telegram, или GET ' + baseUrl + '/chat/status)');
}

/* ---------- итог ---------- */
console.log('\n' + '─'.repeat(52));
if (!problems.length) {
  console.log('всё честно: живой чат работает. Если в приложении всё ещё шаблоны —\n' +
    'смотрят не туда: веб ходит в bot_public_url из app/config.js, сверь его с этим адресом.');
} else {
  console.log('найдено помех: ' + problems.length);
  problems.forEach((p) => console.log('  · ' + p));
  console.log('\nпосле исправлений: перезапусти бота, затем повтори эту команду\nи напиши боту /diag — там будет тот же разбор по пунктам.');
}
process.exit(problems.length ? 1 : 0);
