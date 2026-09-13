/* ============================================================
   дибитишка · гарант зависимостей
   ------------------------------------------------------------
   Зачем: ошибка

     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'grammy'
         imported from /app/bot/src/index.js

   убивает процесс ДО того, как выполнится хоть одна строчка нашего
   кода: статический import в точке входа резолвится первым. Поэтому
   точка входа (src/index.js) больше не импортирует grammy напрямую —
   она сначала зовёт этот модуль, и только потом грузит приложение.

   Что делает:
     1. проверяет, что каждая зависимость из bot/package.json
        реально резолвится из bot/src;
     2. если чего-то нет — ставит САМ (npm ci → npm install →
        npm install <пакеты> → то же в корне репозитория);
     3. если папка приложения доступна только на чтение — ставит
        во временную папку и подключает её через ESM-хук
        (src/deps-loader.mjs);
     4. если совсем никак — печатает понятную диагностику и выходит
        с кодом 1 (а не падает загадочным ERR_MODULE_NOT_FOUND).

   CLI:
     node bot/src/ensure-deps.js            # проверить и при нужде доставить
     node bot/src/ensure-deps.js --check    # только проверить (CI, сборка Docker)
     node bot/src/ensure-deps.js --json     # машинный вывод
   Только встроенные модули node: — сам гарант обязан работать всегда.
   ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = __dirname;
export const BOT_DIR = path.resolve(__dirname, '..');
export const ROOT_DIR = path.resolve(BOT_DIR, '..');

const IS_WIN = process.platform === 'win32';
const log = (...a) => console.log('[deps]', ...a);
const warn = (...a) => console.error('[deps]', ...a);

/* ---------- какие зависимости объявлены ---------- */
export function declaredDeps(dir = BOT_DIR) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
  } catch {
    return null;
  }
}

/* ---------- резолвится ли пакет из bot/src ---------- */
const req = createRequire(path.join(SRC_DIR, 'ensure-deps.js'));

export function canResolve(name) {
  // основной путь — ровно тот, которым пойдёт приложение (ESM из bot/src)
  try {
    if (typeof import.meta.resolve === 'function') { import.meta.resolve(name); return true; }
  } catch { /* falls through */ }
  // запасной — для старых node и для CJS-пакетов
  try { req.resolve(name); return true; } catch { /* not found */ }
  return false;
}

/** { deps, names, found, missing } */
export function status(dir = BOT_DIR) {
  const deps = declaredDeps(dir) || {};
  const names = Object.keys(deps);
  const missing = names.filter((n) => !canResolve(n));
  return { deps, names, found: names.filter((n) => !missing.includes(n)), missing };
}

/* ---------- запуск npm без терминала ---------- */
function npmArgv() {
  const exe = process.env.npm_execpath;
  if (exe && fs.existsSync(exe) && /\.(js|cjs|mjs)$/.test(exe)) return [process.execPath, exe];
  const candidates = [
    path.join(path.dirname(process.execPath), IS_WIN ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js'),
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/lib/node_modules/npm/bin/npm-cli.js',
    '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js'
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(path.resolve(c))) return [process.execPath, path.resolve(c)]; } catch { /* next */ }
  }
  return IS_WIN ? ['npm.cmd'] : ['npm'];
}

function runNpm(args, cwd) {
  const [cmd, ...pre] = npmArgv();
  const res = spawnSync(cmd, [...pre, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: IS_WIN,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_progress: 'false' }
  });
  if (res.error) return { ok: false, tail: res.error.message };
  const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
  return { ok: res.status === 0, tail: out.split('\n').slice(-6).join('\n') };
}

/* ---------- план установки ---------- */
function installPlan(missing) {
  const deps = declaredDeps(BOT_DIR) || {};
  const specs = Object.entries(deps).map(([n, r]) => `${n}@${r}`);
  const onlyMissing = missing.map((n) => `${n}@${deps[n] || 'latest'}`);
  const plan = [];
  if (fs.existsSync(path.join(BOT_DIR, 'package-lock.json'))) {
    plan.push({ label: 'npm ci (bot/)', cwd: BOT_DIR, args: ['ci', '--omit=dev', '--no-audit', '--no-fund'] });
  }
  plan.push({ label: 'npm install (bot/)', cwd: BOT_DIR, args: ['install', '--omit=dev', '--no-audit', '--no-fund'] });
  if (onlyMissing.length) {
    plan.push({ label: `npm install ${onlyMissing.join(' ')} (bot/)`, cwd: BOT_DIR, args: ['install', '--omit=dev', '--no-audit', '--no-fund', ...onlyMissing] });
  }
  // хосты, которые ставят зависимости в корне репозитория: node найдёт их
  // сам (поиск node_modules идёт вверх по папкам)
  if (fs.existsSync(path.join(ROOT_DIR, 'package.json')) && ROOT_DIR !== BOT_DIR) {
    plan.push({ label: 'npm install (корень репозитория)', cwd: ROOT_DIR, args: ['install', '--omit=dev', '--no-audit', '--no-fund'] });
    if (specs.length) {
      plan.push({ label: 'npm install <все зависимости> (корень репозитория)', cwd: ROOT_DIR, args: ['install', '--omit=dev', '--no-audit', '--no-fund', ...specs] });
    }
  }
  return plan;
}

/* ---------- запасной выход: установка во временную папку ---------- */
async function installToTemp(missing) {
  const deps = declaredDeps(BOT_DIR) || {};
  const specs = missing.map((n) => `${n}@${deps[n] || 'latest'}`);
  if (!specs.length) return null;
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dibitishka-deps-'));
  } catch (e) {
    warn('временную папку создать не удалось:', e.message);
    return null;
  }
  log(`папка приложения только для чтения — ставлю во временную: ${dir}`);
  const r = runNpm(['install', '--prefix', dir, '--no-save', '--omit=dev', '--no-audit', '--no-fund', ...specs], dir);
  if (!r.ok) { warn('установка во временную папку не удалась:', r.tail); return null; }
  return fs.existsSync(path.join(dir, 'node_modules')) ? dir : null;
}

/** Подключить папку с зависимостями через ESM-хук (node >= 20.6). */
async function attachDepsDir(dir) {
  try {
    const { register } = await import('node:module');
    if (typeof register !== 'function') return false;
    process.env.DIBITISHKA_DEPS_DIR = dir;
    register(pathToFileURL(path.join(SRC_DIR, 'deps-loader.mjs')).href, {
      parentURL: import.meta.url,
      data: { roots: [dir] }
    });
    return true;
  } catch (e) {
    warn('ESM-хук подключить не удалось:', e.message);
    return false;
  }
}

async function importable(name) {
  try { await import(name); return true; } catch { return false; }
}

/* ---------- главная функция ---------- */
/**
 * Гарантирует, что все зависимости из bot/package.json резолвятся.
 * @param {{install?: boolean, quiet?: boolean}} opts
 * @returns {Promise<{missing: string[], names: string[], action: string}>}
 */
export async function ensureDeps({ install = true } = {}) {
  const st = status();
  if (!st.names.length) return { ...st, action: 'nothing-declared' };
  if (!st.missing.length) {
    log(`зависимости на месте: ${st.names.join(', ')}`);
    return { ...st, action: 'ok' };
  }

  warn(`не хватает: ${st.missing.join(', ')}`);
  if (!install) {
    const err = new Error(
      `Не установлены зависимости бота: ${st.missing.join(', ')}.\n` +
      `  поставь их: cd bot && npm ci   (или npm install)\n` +
      `  либо запусти бота обычным образом — он поставит их сам.`
    );
    err.code = 'DEPS_MISSING';
    throw err;
  }

  warn('ставлю сам — терминал не нужен');
  const tried = [];
  for (const step of installPlan(st.missing)) {
    if (!status().missing.length) break;
    log('пробую:', step.label);
    const r = runNpm(step.args, step.cwd);
    tried.push(`${step.label} → ${r.ok ? 'ок' : 'не вышло'}`);
    if (!r.ok) warn(`  не вышло (${step.label}):\n${r.tail.split('\n').map((l) => '    ' + l).join('\n')}`);
  }

  let now = status();
  if (!now.missing.length) {
    log('готово:', now.names.join(', '));
    return { ...now, action: 'installed' };
  }

  // крайний случай: папка приложения недоступна на запись
  const tmpDir = await installToTemp(now.missing);
  if (tmpDir && (await attachDepsDir(tmpDir))) {
    const still = now.missing.filter((n) => !importable(n));
    const ok = now.missing.filter((n) => !still.includes(n));
    if (!still.length) {
      log(`готово (зависимости во временной папке ${tmpDir}): ${ok.join(', ')}`);
      return { ...now, missing: [], action: 'temp-dir', depsDir: tmpDir };
    }
    warn(`даже во временной папке не нашлись: ${still.join(', ')}`);
  }

  const err = new Error(
    'Зависимости бота поставить автоматически не удалось: ' + now.missing.join(', ') + '\n' +
    '  что пробовал:\n' + tried.map((t) => '    · ' + t).join('\n') + '\n' +
    '  как починить руками (один раз, в папке bot/): npm ci\n' +
    '  в Docker: docker compose build --no-cache && docker compose up -d'
  );
  err.code = 'DEPS_MISSING';
  throw err;
}

/* ---------- CLI ---------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const asJson = args.includes('--json');
  try {
    const r = await ensureDeps({ install: !checkOnly });
    if (asJson) console.log(JSON.stringify({ ok: true, ...r }, null, 2));
    process.exit(0);
  } catch (e) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: e.message, missing: status().missing }, null, 2));
    } else {
      console.error('\n[deps] ✗ ' + e.message + '\n');
    }
    process.exit(1);
  }
}
