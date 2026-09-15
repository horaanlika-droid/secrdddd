#!/usr/bin/env node
/* ============================================================
   дибитишка · держатель codex exec-server (статическая сессия)
   ------------------------------------------------------------
   Та самая строка из гайда OpenAI — но как процесс, который живёт
   вместе с бот-хостом и перезапускается, а не как однострочник,
   который после первого падения оставляет чат висеть до таймаута:

     CODEX_API_KEY="$OPENAI_ENVIRONMENT_KEY" \\
       codex exec-server \\
         --remote "$AGENTS_REMOTE_URL" \\
         --environment-id "$AGENTS_ENVIRONMENT_ID"

   Запуск на бот-хосте (переменные — из .env рядом или из окружения):
     node scripts/exec-server.mjs            # то же самое + авто-рестарт
     node scripts/exec-server.mjs --check    # только проверить конфиг и показать команду
     npm run exec-server -- --check

   Переменные:
     AGENTS_REMOTE_URL      (или AGENTS_EXEC_REMOTE_URL)   — session.environment.remote_url
     AGENTS_ENVIRONMENT_ID  (или AGENTS_ENV_ID)            — session.environment.id
     OPENAI_ENVIRONMENT_KEY (или OPENAI_EXECUTOR_API_KEY / CODEX_API_KEY) — ключ окружения
     AGENTS_CODEX_BIN       — путь к codex (по умолчанию `codex` в PATH)
     AGENTS_EXECUTOR_CMD    — своя команда целиком ({remote_url} {environment_id})
     AGENTS_EXECUTOR_ENV    — дополнительные переменные, проброшенные в окружение
                              исполнителя, через запятую (по умолчанию — ничего:
                              ключ приложения и ADMIN_IDS в песочницу не уходят)
     AGENTS_EXEC_RESTART_MAX— сколько раз поднимать после падений (20)

   Важно про смысл: remote_url и environment.id — от ОДНОЙ конкретной сессии,
   их выдаёт POST /v1/agents/sessions. У каждой новой сессии своё окружение и
   свой исполнитель, поэтому этот режим годится для «одна моя личная сессия,
   которую я создал руками» (AGENTS_SESSION_ID + AGENTS_STATIC_KEYS в боте),
   а для ordinary-диалогов сессии и исполнителей должен создавать бот
   (AGENTS_ENABLED=1 без AGENTS_SESSION_ID).

   Секреты: в лог и в вывод --check токены уходят замаскированными.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- .env, если он есть рядом (тот же файл, что у бота) ---------- */
const envFile = process.argv.includes('--env-file')
  ? path.resolve(ROOT, '.env')
  : (fs.existsSync(path.join(ROOT, '.env')) ? path.join(ROOT, '.env') : null);
if (envFile && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  console.log(`читаю ${path.relative(ROOT, envFile)} (только то, чего нет в окружении)`);
}

const { maskSecret, buildExecutorCommand, EXECUTOR_KEY_ALIASES } = await import(
  pathToFileURL(path.join(ROOT, 'bot', 'src', 'agents.js')).href
);
const env = (k) => String(process.env[k] ?? '').trim();
const first = (...names) => { for (const n of names) { const v = env(n); if (v) return { name: n, value: v }; } return null; };
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };

const remote = first('AGENTS_REMOTE_URL', 'AGENTS_EXEC_REMOTE_URL');
const environment = first('AGENTS_ENVIRONMENT_ID', 'AGENTS_ENV_ID');
const key = EXECUTOR_KEY_ALIASES.map((n) => ({ name: n, value: env(n) })).find((x) => x.value);

const problems = [];
console.log('\nисполнитель окружения (codex exec-server)');
if (!remote) problems.push('нет AGENTS_REMOTE_URL — это session.environment.remote_url из ответа POST /v1/agents/sessions');
if (!environment) problems.push('нет AGENTS_ENVIRONMENT_ID — это session.environment.id той же сессии');
if (!key) problems.push(`нет ключа окружения ни в одной из: ${EXECUTOR_KEY_ALIASES.join(', ')}`);
const codex = env('AGENTS_CODEX_BIN') || 'codex';
if (!env('AGENTS_EXECUTOR_CMD')) {
  let found = false;
  try { found = spawnSync('sh', ['-c', `command -v ${codex}`], { encoding: 'utf8' }).status === 0; } catch { found = false; }
  if (found) console.log(`  ✅ ${codex} найден`);
  else console.log(`  ⚠️  ${codex} не найден в PATH — в окружении ставится так: npm install -g @openai/codex@alpha`);
}
const cmd = buildExecutorCommand({ remote: remote?.value, environmentId: environment?.value });
console.log('  команда: ' + maskSecret(cmd));
console.log('  ключ:    ' + (key ? `${key.name} = ${key.value.slice(0, 3)}…${key.value.slice(-3)}` : '❌ не задан'));
if (env('AGENTS_SESSION_ID')) console.log('  сессия:  ' + env('AGENTS_SESSION_ID') + ' (в боте должна быть той же: AGENTS_SESSION_ID)');
else console.log('  ⚠️  в боте не задан AGENTS_SESSION_ID — бот создаст СВОЮ сессию и это окружение ей не подойдёт');

if (problems.length) {
  console.log('\nне готово:');
  problems.forEach((p) => console.log('  ❌ ' + p));
  console.log('\nпосле правок: node scripts/exec-server.mjs --check');
  process.exit(1);
}
if (process.argv.includes('--check')) { console.log('\n✅ конфиг полный (ничего не запускал)'); process.exit(0); }

/* ---------- надзиратель ---------- */
console.log('\nподнимаю исполнителя; Ctrl+C — остановить\n');
let child = null, stopping = false, attempts = 0, restarts = 0;
const maxRestarts = num('AGENTS_EXEC_RESTART_MAX', 20);

function launch() {
  attempts++;
  const envForChild = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME || '/tmp' };
  if (key) envForChild.CODEX_API_KEY = key.value;
  for (const name of env('AGENTS_EXECUTOR_ENV').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (process.env[name] !== undefined) envForChild[name] = process.env[name];
  }
  child = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: envForChild });
  console.log(`  pid ${child.pid}`);
  const log = (b) => { for (const line of String(b).split('\n')) { const t = line.trim(); if (t) console.log('  │ ' + maskSecret(t).slice(0, 300)); } };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('error', (e) => console.error('  ❌ не удалось запустить: ' + (e?.message || e)));
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) process.exit(0);
    restarts++;
    if (attempts > maxRestarts) {
      console.error(`  ❌ ${attempts} падений подряд — сдаюсь. Смотри лог выше (сеть до api.openai.com и wss://codex-cloud-environments.chatgpt.com, права ключа, сам codex).`);
      process.exit(1);
    }
    const delay = Math.min(2000 * 2 ** Math.min(attempts - 1, 4), 60000);
    console.warn(`  ⚠️  упал (code=${code}, signal=${signal || 'нет'}) — рестарт через ${Math.round(delay / 1000)} с, перезапусков ${restarts}`);
    setTimeout(launch, delay);
  });
}
const stop = (sig) => {
  if (stopping) return;
  stopping = true;
  console.log(`\n${sig} — гашу исполнителя`);
  try { child?.kill('SIGTERM'); } catch { }
  setTimeout(() => process.exit(0), 1500).unref?.();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
launch();
