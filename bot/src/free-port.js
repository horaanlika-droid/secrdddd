/* ============================================================
   дибитишка · бот — АВТО-ОЧИСТКА ПОРТА ПЕРЕД ЗАПУСКОМ (ДЕПЛОЕМ)
   ------------------------------------------------------------
   Перед тем как занять HTTP-порт, ищем процесс, который ещё его
   держит (обычно «оставшийся» бот с прошлого запуска — именно он
   превращал деплой в EADDRINUSE), и останавливаем: SIGTERM, ждём
   до 3 секунд, не отпустил — SIGKILL. После этого бот занимает
   порт, и новый деплой поднимается с первого раза.

   Как находим, кто держит порт:
     Linux  — /proc/net/tcp{,6} (LISTEN-сокет на нашем порту) →
              /proc/<pid>/fd (socket:[inode]) → pid. Ничего
              доустанавливать не нужно: работает и в alpine,
              и на голом хосте.
     macOS  — lsof (локальная разработка).

   Безопасность: не трогаем собственный процесс и pid 1,
   смотрим только LISTEN-сокеты ровно на тот порт, который
   собираемся занять.

   NO_PORT_CLEAN=1 — не чистить, а просто упасть с ошибкой,
   если порт занят (старое поведение, для отладки).
   ============================================================ */
import net from 'node:net';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Кто-то уже слушает порт? */
function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (busy) => { if (!done) { done = true; s.destroy(); resolve(busy); } };
    s.once('connect', () => finish(true));
    s.once('error', () => finish(false));
    s.setTimeout(700, () => finish(false));
  });
}

/* Inode LISTEN-сокетов нашего порта из /proc/net/tcp{,6} */
function listeningInodes(port) {
  const inodes = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let data = '';
    try { data = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of data.split('\n').slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length < 10 || c[3] !== '0A') continue; // 0A = LISTEN
      const hexPort = (c[1] || '').split(':')[1];
      if (hexPort && parseInt(hexPort, 16) === port) inodes.add(Number(c[9]));
    }
  }
  return inodes;
}

/* Какие процессы держат эти сокеты */
function pidsByInodes(inodes) {
  const pids = new Set();
  let procs = [];
  try { procs = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return pids; }
  for (const pid of procs) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      let link = '';
      try { link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (m && inodes.has(Number(m[1]))) { pids.add(Number(pid)); break; }
    }
  }
  return pids;
}

async function pidsOnPort(port) {
  if (process.platform === 'linux') {
    const inodes = listeningInodes(port);
    return inodes.size ? [...pidsByInodes(inodes)] : [];
  }
  try {
    const { stdout } = await pexec('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
    return stdout.split('\n').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/* SIGTERM → дожидаемся termMs → SIGKILL. true, если процесс ушёл. */
async function stopProcess(pid, termMs = 3000) {
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  const deadline = Date.now() + termMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; } // уже ушёл
    await wait(150);
  }
  try { process.kill(pid, 'SIGKILL'); } catch { return true; }
  await wait(200);
  try { process.kill(pid, 0); return false; } catch { return true; }
}

/**
 * Авто-очистка порта перед стартом: если порт занят — находим и
 * останавливаем его держателя. Возвращает список остановленных pid.
 * Бросает ошибку, если порт освободить не вышло.
 */
export async function freePort(port) {
  const killed = [];
  const clean = process.env.NO_PORT_CLEAN !== '1';
  for (let i = 0; i < 5; i++) {
    if (!(await portBusy(port))) return killed;
    if (!clean) break;
    const pids = (await pidsOnPort(port)).filter((p) => p > 1 && p !== process.pid);
    if (!pids.length) { await wait(300); continue; }
    for (const pid of pids) {
      console.log(`[port] порт ${port} занят (pid ${pid}) — останавливаю, чтобы новый запуск занял порт`);
      if (await stopProcess(pid)) killed.push(pid);
      else console.log(`[port] pid ${pid} не остановился — продолжаю без него`);
    }
    await wait(400);
  }
  if (await portBusy(port)) {
    throw new Error(
      `порт ${port} всё ещё занят после очистки` +
      (killed.length ? ` (остановил(а) pid ${killed.join(', ')})` : '') +
      (clean ? '' : ' — NO_PORT_CLEAN=1, процессы не трогаю') +
      `; при запуске вручную: fuser -k ${port}/tcp`
    );
  }
  return killed;
}
