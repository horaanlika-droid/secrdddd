#!/usr/bin/env node
/* ============================================================
   дибитишка · тест автоочистки порта при деплое
   ------------------------------------------------------------
   Запуск:  node scripts/port-clash.mjs

   Фаза 1 — «прошлый деплой не умер»:
     поднимаем копию бота на порту P, затем вторую копию с тем же P.
     Вторая обязана найти владельца, понять, что это наш же процесс,
     вежливо его остановить и занять порт (а не упасть с EADDRINUSE).

   Фаза 2 — «порт держит чужой»:
     на порту P посторонний http-сервер. Бот обязан его НЕ убивать,
     а взять следующий свободный порт.

   Фаза 3 — аккуратный выход: по SIGTERM бот пишет базу, закрывает
     сервер и освобождает порт.
   ============================================================ */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'bot', 'src', 'index.js');
const log = (...a) => console.log('[port-test]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync('/proc/net/tcp')) {
  log('пропущено: нет /proc (не Linux) — автоочистка порта там недоступна в принципе');
  process.exit(0);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
const isFree = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.on('connect', () => { s.destroy(); resolve(false); });
  s.on('error', () => resolve(true));
});
async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    return r.status === 200 ? await r.json() : null;
  } catch { return null; }
}
async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await wait(250);
  }
  throw new Error(`не дождался: ${what}`);
}

function startBot(port, dbFile) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      TG_TOKEN: process.env.TG_TOKEN || '123456:port-test',
      ADMIN_IDS: '1',
      PORT: String(port),
      DB_FILE: dbFile,
      NO_POLLING: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const chunks = [];
  const push = (d) => chunks.push(d.toString());
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  const api = {
    child,
    logs: () => chunks.join(''),
    exited: null,
    kill: (sig) => { try { child.kill(sig); } catch { /* уже мёртв */ } }
  };
  child.on('exit', (code, signal) => { api.exited = { code, signal }; });
  return api;
}

function startStranger(port) {
  const child = spawn(process.execPath, ['-e',
    `require('http').createServer((q,s)=>s.end('stranger')).listen(${port},'0.0.0.0',()=>console.log('stranger up'));`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dibitishka-port-'));
const failures = [];
const check = (cond, msg) => { if (cond) log('✓ ' + msg); else { failures.push(msg); log('✗ ' + msg); } };

const P = await freePort();
log(`сценарий на порту ${P}`);

/* ---------- фаза 1: прошлая копия бота держит порт ---------- */
log('фаза 1: поднимаю первую копию бота…');
const a = startBot(P, path.join(tmp, 'a.json'));
await waitFor(() => health(P), 60000, '/health от первой копии');
check(a.exited === null, 'первая копия жива и держит порт');

log('фаза 1: поднимаю вторую копию на ТОМ ЖЕ порту (как при деплое)…');
const b = startBot(P, path.join(tmp, 'b.json'));
const tookOver = await waitFor(() => /\[http\] API on :(\d+)/.test(b.logs()) ? b.logs().match(/\[http\] API on :(\d+)/)[1] : null, 60000, 'вторая копия заняла порт');
check(Number(tookOver) === P, `вторая копия работает на нужном порту ${P} (получилось ${tookOver})`);
check(/\[port\] прошлый процесс бота \(pid \d+/.test(b.logs()), 'вторая копия нашла прошлый процесс бота и попросила его уйти');
check(!/EADDRINUSE/.test(b.logs()), 'без падения с EADDRINUSE');

const aGone = await waitFor(() => a.exited ? a.exited : null, 10000, 'первая копия завершилась').catch(() => null);
check(!!aGone, `первая копия освободила порт (${aGone ? 'код ' + aGone.code + ', сигнал ' + aGone.signal : 'не завершилась'})`);
check(!!(await health(P)), '/health на порту отвечает уже новая копия');

/* ---------- фаза 3: аккуратный выход ---------- */
log('фаза 3: шлю SIGTERM второй копии…');
b.kill('SIGTERM');
await waitFor(() => b.exited ? b.exited : null, 15000, 'вторая копия завершилась по SIGTERM').catch(() => null);
check(/сохраняю базу и освобождаю порт/.test(b.logs()), 'по SIGTERM база сохранена, порт объявлен освобождаемым');
check(!!b.exited, `вторая копия завершилась (${b.exited ? 'код ' + b.exited.code : 'висит'})`);
check(await isFree(P), `порт ${P} действительно свободен после остановки`);

/* ---------- фаза 2: чужой процесс на порту не трогается ---------- */
log('фаза 2: занимаю порт посторонним сервером…');
const stranger = startStranger(P);
await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${P}/`); return (await r.text()) === 'stranger'; } catch { return false; } }, 15000, 'посторонний сервер поднялся');

const c = startBot(P, path.join(tmp, 'c.json'));
const movedTo = await waitFor(() => {
  const m = c.logs().match(/\[http\] API on :(\d+)/);
  return m ? Number(m[1]) : null;
}, 60000, 'бот взял свободный порт');
check(movedTo !== P, `бот не тронул чужой порт и ушёл на ${movedTo}`);
check(/чужим процессом/.test(c.logs()), 'бот честно сообщил, что порт занят чужим процессом');
const strangerAlive = await fetch(`http://127.0.0.1:${P}/`).then((r) => r.text()).catch(() => '');
check(strangerAlive === 'stranger', 'посторонний процесс жив — мы его не убили');
check(!!(await health(movedTo)), `бот отвечает на своём новом порту ${movedTo}`);

/* ---------- уборка ---------- */
c.kill('SIGTERM');
try { stranger.kill('SIGKILL'); } catch { /* уже мёртв */ }
a.kill('SIGKILL');
b.kill('SIGKILL');
await wait(500);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* не важно */ }

console.log('');
if (failures.length) {
  console.log(`тест порта: ${failures.length} провал(ов)`);
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('тест порта: всё чисто (автоочистка работает, чужие процессы не страдают)');
