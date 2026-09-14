/* ============================================================
   дибитишка · автоочистка порта при деплое
   ------------------------------------------------------------
   Задача: при деплое порт может остаться занятым прошлым
   процессом (старый контейнер не успел умереть, прошлый запуск
   завис). Раньше это давало

     Error: listen EADDRINUSE: address already in use 0.0.0.0:8080

   и бот не поднимался вовсе.

   Что делает acquirePort():
     1. пробует занять нужный порт;
     2. если порт занят — находит владельца (чистый node, через /proc:
        слушающий сокет → inode → pid; запасной путь — lsof/ss);
     3. если владелец — НАШ же прошлый процесс (в cmdline виден
        src/index.js или src/app.js), вежливо просит его уйти:
        SIGTERM → ждём → SIGKILL, и занимаем порт;
     4. если владелец чужой — НЕ трогает его и берёт следующий
        свободный порт (PORT+1…+10), громко об этом сообщая.
        Чужие процессы не убиваются никогда.
     5. PORT_STRICT=1 — не скакать по портам, а упасть с понятной
        ошибкой (нужно в Docker, где проброшен ровно один порт).

   Только встроенные модули node: — работает даже без node_modules.
   ============================================================ */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const log = (...a) => console.log('[port]', ...a);
const warn = (...a) => console.error('[port]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Наша ли это копия бота (по командной строке процесса). */
const OUR_MARKERS = ['src/index.js', 'src/app.js', 'dibitishka-bot'];
export function cmdlineOf(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
  } catch {
    return '';
  }
}
const isOurs = (pid) => pid !== process.pid && OUR_MARKERS.some((m) => cmdlineOf(pid).includes(m));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/* ---------- кто держит порт: /proc/net/tcp → inode → pid ---------- */
function listeningInode(port) {
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length < 10 || c[3] !== '0A') continue;           // 0A = LISTEN
      if (parseInt(c[1].split(':')[1], 16) !== port) continue; // HEX-порт
      return c[9];
    }
  }
  return null;
}
function pidByInode(inode) {
  const target = `socket:[${inode}]`;
  let pids;
  try { pids = fs.readdirSync('/proc'); } catch { return null; }
  for (const d of pids) {
    if (!/^\d+$/.test(d)) continue;
    let fds;
    try { fds = fs.readdirSync(`/proc/${d}/fd`); } catch { continue; }
    for (const fd of fds) {
      let link;
      try { link = fs.readlinkSync(`/proc/${d}/fd/${fd}`); } catch { continue; }
      if (link === target) return Number(d);
    }
  }
  return null;
}
/** Запасной путь для систем без /proc или без прав на чужие fd. */
function pidByTools(port) {
  const attempts = [
    ['lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']],
    ['ss', ['-lptnH', `sport = :${port}`]],
    ['fuser', [`${port}/tcp`]]
  ];
  for (const [cmd, args] of attempts) {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
      const out = `${r.stdout || ''} ${r.stderr || ''}`;
      const m = out.match(/pid=(\d+)/) || out.match(/\b(\d{1,7})\b/);
      if (r.status === 0 && m) return Number(m[1]);
    } catch { /* пробуем следующий инструмент */ }
  }
  return null;
}
export function portOwner(port) {
  const inode = listeningInode(port);
  return (inode && pidByInode(inode)) || pidByTools(port) || null;
}

/** SIGTERM, потом SIGKILL. true — если процесс освободил место. */
async function askToLeave(pid, graceMs = 5000) {
  const cmd = cmdlineOf(pid) || '(cmdline недоступен)';
  log(`прошлый процесс бота (pid ${pid}: ${cmd}) держит порт — прошу освободить`);
  try { process.kill(pid, 'SIGTERM'); } catch (e) { warn(`SIGTERM не прошёл: ${e.message}`); return false; }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) { log(`pid ${pid} освободил порт`); return true; }
    await sleep(150);
  }
  warn(`pid ${pid} не ушёл за ${graceMs / 1000} с — добиваю (SIGKILL)`);
  try { process.kill(pid, 'SIGKILL'); } catch (e) { warn(`SIGKILL не прошёл: ${e.message}`); return false; }
  for (let i = 0; i < 20; i++) {
    if (!alive(pid)) { log(`pid ${pid} освобождён принудительно`); return true; }
    await sleep(150);
  }
  return !alive(pid);
}

function tryListen(server, port, host) {
  return new Promise((resolve) => {
    const onError = (err) => { cleanup(); resolve({ ok: false, err }); };
    const onListening = () => { cleanup(); resolve({ ok: true }); };
    const cleanup = () => { server.off('error', onError); server.off('listening', onListening); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Занимает порт, при нужде чистя его от нашей же прошлой копии.
 * @param {import('node:http').Server} server
 * @param {number} preferred
 * @param {{host?: string, tries?: number, strict?: boolean}} [opts]
 * @returns {Promise<number>} фактический порт
 */
export async function acquirePort(server, preferred, opts = {}) {
  const host = opts.host || '0.0.0.0';
  const tries = opts.tries ?? 10;
  const strict = opts.strict ?? process.env.PORT_STRICT === '1';
  let port = Number(preferred);

  for (let attempt = 0; attempt < tries; attempt++) {
    const r = await tryListen(server, port, host);
    if (r.ok) {
      if (port !== Number(preferred)) warn(`работаю на порту ${port} вместо ${preferred}`);
      return port;
    }
    const code = r.err?.code;
    if (code !== 'EADDRINUSE' && code !== 'EACCES') throw r.err;

    if (code === 'EADDRINUSE') {
      const owner = portOwner(port);
      if (owner && isOurs(owner)) {
        const freed = await askToLeave(owner);
        if (freed) {
          const retry = await tryListen(server, port, host);
          if (retry.ok) return port;
          warn(`порт ${port} всё ещё не отдаётся (${retry.err?.code || retry.err?.message})`);
        }
      } else if (owner) {
        warn(`порт ${port} занят чужим процессом (pid ${owner}: ${cmdlineOf(owner) || 'n/a'}) — не трогаю его`);
      } else {
        warn(`порт ${port} занят, владельца определить не удалось`);
      }
    } else {
      warn(`нет прав занять порт ${port} (EACCES)`);
    }

    if (strict) {
      const e = new Error(`Порт ${port} занят, а PORT_STRICT=1 запрещает брать другой. Освободи порт или смени PORT.`);
      e.code = 'EADDRINUSE';
      throw e;
    }
    port += 1;
  }
  throw new Error(`Не нашёл свободный порт: перепробовал ${preferred}…${port - 1}`);
}
