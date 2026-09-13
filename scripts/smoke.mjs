#!/usr/bin/env node
/* ============================================================
   дибитишка · смоук-тест: бот обязан подняться
   ------------------------------------------------------------
   Запуск:  node scripts/smoke.mjs      (или npm run smoke)

   Что делает: запускает бота ровно так, как это делает Docker
   (node bot/src/index.js), но с тестовым токеном и NO_POLLING=1 —
   в Telegram не лезет. Потом стучится в /health и /content.json.

   Это та самая проверка, которая поймала бы
   «Cannot find package 'grammy'» до деплоя: если зависимости
   потерялись, процесс не поднимется и тест упадёт с логами.
   ============================================================ */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'bot', 'src', 'index.js');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 90000); // первый запуск может ставить зависимости

const log = (...a) => console.log('[smoke]', ...a);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(port, urlPath) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const port = await freePort();
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dibitishka-smoke-')), 'db.json');

log(`поднимаю ${path.relative(ROOT, ENTRY)} на порту ${port}`);
const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env: {
    ...process.env,
    TG_TOKEN: process.env.TG_TOKEN || '123456:smoke-test-token',
    ADMIN_IDS: process.env.ADMIN_IDS || '1',
    PORT: String(port),
    DB_FILE: dbFile,
    NO_POLLING: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const output = [];
child.stdout.on('data', (d) => { const s = d.toString(); output.push(s); process.stdout.write(s); });
child.stderr.on('data', (d) => { const s = d.toString(); output.push(s); process.stderr.write(s); });

let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

const fail = async (why) => {
  console.error(`\n[smoke] ✗ ${why}`);
  console.error('[smoke] вывод процесса:\n' + output.join('').split('\n').slice(-40).map((l) => '    ' + l).join('\n'));
  try { child.kill('SIGKILL'); } catch { /* уже мёртв */ }
  try { fs.rmSync(path.dirname(dbFile), { recursive: true, force: true }); } catch { /* не важно */ }
  process.exit(1);
};

const deadline = Date.now() + TIMEOUT_MS;
let health = null;
while (Date.now() < deadline) {
  if (exited) await fail(`процесс завершился раньше времени (code=${exited.code}, signal=${exited.signal})`);
  try {
    const r = await getJson(port, '/health');
    if (r.status === 200 && r.body && r.body.ok === true) { health = r.body; break; }
  } catch { /* ещё не поднялся */ }
  await wait(500);
}
if (!health) await fail(`не дождался ответа /health за ${TIMEOUT_MS / 1000} с`);

log('✓ /health →', JSON.stringify(health));

const content = await getJson(port, '/content.json');
if (content.status !== 200 || !content.body || typeof content.body !== 'object') {
  await fail(`/content.json вернул ${content.status}`);
}
const blocks = Array.isArray(content.body.blocks) ? content.body.blocks.length : 0;
log(`✓ /content.json → 200, блоков контента: ${blocks}`);

child.kill('SIGTERM');
const stopped = await Promise.race([
  new Promise((r) => child.on('exit', () => r(true))),
  wait(5000).then(() => false)
]);
if (!stopped) { child.kill('SIGKILL'); await wait(200); }

try { fs.rmSync(path.dirname(dbFile), { recursive: true, force: true }); } catch { /* не важно */ }

log('✓ бот поднялся, зависимости на месте, HTTP API отвечает');
