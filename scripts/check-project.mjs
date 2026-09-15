#!/usr/bin/env node
/* ============================================================
   дибитишка · проверка проекта на будущие конфликты
   ------------------------------------------------------------
   Запуск:  node scripts/check-project.mjs     (или npm run check)
   В CI:    .github/workflows/ci.yml — любое «✗» роняет сборку.

   Ловит ровно те поломки, из-за которых бот уже падал:
     1. зависимости из bot/package.json не резолвятся из bot/src;
     2. точка входа снова импортирует grammy статически (тогда
        ERR_MODULE_NOT_FOUND убьёт процесс до наших проверок);
     3. разошлись bot/package.json и package-lock.json;
     4. разошлись зависимости bot/package.json и корневого package.json;
     5. Dockerfile потерял проверку зависимостей / указывает на
        несуществующий файл запуска;
     6. .dockerignore начал выкидывать из образа нужные файлы;
     7. в коде появился импорт пакета, которого нет в dependencies.
   Только встроенные модули node: — работает везде, где есть node.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOT = path.join(ROOT, 'bot');
const BUILTINS = new Set(builtinModules);

const results = [];
const ok = (msg) => results.push({ ok: true, msg });
const bad = (msg, hint = '') => results.push({ ok: false, msg, hint });

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

/* ---------- .dockerignore ---------- */
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
function dockerIgnoreRules() {
  return read(path.join(ROOT, '.dockerignore'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
/** путь (posix, относительно корня сборки) исключён из контекста? */
function isIgnored(relPath, rules = dockerIgnoreRules()) {
  let ignored = false;
  for (const raw of rules) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    const clean = pattern.replace(/\/+$/, '');
    if (!clean) continue;
    const hit = globToRegExp(clean).test(relPath) || relPath.startsWith(clean + '/');
    if (hit) ignored = !negated;
  }
  return ignored;
}

/* ---------- импорты в исходниках ---------- */
/**
 * Выкидывает комментарии и не трогает строки — иначе в отчёт попадают
 * «импорты» из пояснений в коде (на этом уже попались один раз).
 */
function stripComments(src) {
  let out = '';
  let state = 'code';
  let prev = '';
  const regexAllowed = () => !prev || /[(,=:[!&|?{};+\-*/%~^<>]/.test(prev);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i++; continue; }
      if (c === '/' && d === '*') { state = 'block'; i++; continue; }
      if (c === '/' && regexAllowed()) { state = 'regex'; continue; }
      if (c === "'" || c === '"' || c === '`') state = c;
      out += c;
      if (!/\s/.test(c)) prev = c;
      continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } continue; }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i++; } continue; }
    if (state === 'regex') {
      if (c === '\\') { i++; continue; }
      if (c === '[') { state = 'class'; continue; }
      if (c === '/') { state = 'code'; prev = '/'; }
      continue;
    }
    if (state === 'class') {
      if (c === '\\') { i++; continue; }
      if (c === ']') state = 'regex';
      continue;
    }
    // внутри строки: оставляем как есть, чтобы import 'x' находился
    if (c === '\\') { out += c + (d ?? ''); i++; continue; }
    if (c === state) { state = 'code'; prev = c; }
    out += c;
  }
  return out;
}

function importsOf(file) {
  const src = stripComments(read(file));
  const found = new Set();
  const patterns = [
    /import\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g,   // import x from 'y' / import 'y'
    /export\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g,   // export ... from 'y'
    /import\(\s*['"]([^'"]+)['"]\s*\)/g                   // await import('y')
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) found.add(m[1]);
  }
  return [...found];
}
const isRelative = (s) => s.startsWith('.') || s.startsWith('/');
const isBuiltin = (s) => s.startsWith('node:') || BUILTINS.has(s.split('/')[0]);
const pkgName = (s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/* ---------- 1. структура и зависимости ---------- */
const botPkg = readJson(path.join(BOT, 'package.json'));
const rootPkg = readJson(path.join(ROOT, 'package.json'));
const botLock = readJson(path.join(BOT, 'package-lock.json'));
const rootLock = readJson(path.join(ROOT, 'package-lock.json'));

if (!botPkg) bad('bot/package.json не читается');
else {
  ok('bot/package.json читается');
  if (botPkg.type !== 'module') bad('bot/package.json: нужен "type": "module"', 'бот написан на ESM');
  else ok('bot/package.json: type = module');
}
if (!rootPkg) bad('package.json в корне не читается', 'хосты, ставящие зависимости в корне, останутся без grammy');
else ok('package.json в корне читается');

const botDeps = botPkg?.dependencies || {};
const rootDeps = rootPkg?.dependencies || {};
const botNames = Object.keys(botDeps);
if (!botNames.length) bad('bot/package.json: список dependencies пуст');
else ok(`bot/package.json: зависимости ${botNames.join(', ')}`);

/* ---------- 2. зависимости реально резолвятся ---------- */
{
  const req = createRequire(path.join(BOT, 'src', 'ensure-deps.js'));
  const missing = botNames.filter((n) => {
    try { req.resolve(n); return false; } catch { return true; }
  });
  if (missing.length) bad(`не резолвятся из bot/src: ${missing.join(', ')}`, 'cd bot && npm ci (в CI это делает workflow)');
  else ok(`резолвятся из bot/src: ${botNames.join(', ')}`);
}

/* ---------- 3. package-lock.json не разошёлся с package.json ---------- */
for (const [label, lock, pkg, dir] of [
  ['bot/package-lock.json', botLock, botPkg, BOT],
  ['package-lock.json', rootLock, rootPkg, ROOT]
]) {
  if (!lock) { bad(`${label} отсутствует`, 'без него npm ci в Docker/CI не работает'); continue; }
  const pkgs = lock.packages || {};
  const miss = Object.keys(pkg?.dependencies || {}).filter((n) => !pkgs[`node_modules/${n}`]);
  if (miss.length) bad(`${label}: нет записей для ${miss.join(', ')}`, 'обнови lock: npm install в соответствующей папке');
  else ok(`${label}: все зависимости описаны`);
  if (pkg && lock.name && lock.name !== pkg.name) bad(`${label}: name «${lock.name}» ≠ «${pkg.name}»`);
  const rootEntry = pkgs[''];
  if (rootEntry && pkg) {
    const a = JSON.stringify(rootEntry.dependencies || {});
    const b = JSON.stringify(pkg.dependencies || {});
    if (a !== b) bad(`${label}: зависимости в lock не совпадают с package.json`, 'npm install — и закоммить обновлённый lock');
    else ok(`${label}: зависимости совпадают с package.json`);
  }
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    // не ошибка, а подсказка: CI ставит зависимости сам
    ok(`${label}: node_modules ещё нет — поставится при npm ci`);
  }
}

/* ---------- 4. корень и bot/ не разошлись ---------- */
{
  const diff = [
    ...botNames.filter((n) => rootDeps[n] !== botDeps[n]).map((n) => `${n}: bot=${botDeps[n]} корень=${rootDeps[n] ?? '—'}`),
    ...Object.keys(rootDeps).filter((n) => !(n in botDeps)).map((n) => `${n}: есть в корне, нет в bot/`)
  ];
  if (diff.length) bad('зависимости bot/ и корня разошлись', diff.join('; '));
  else ok('зависимости bot/ и корня совпадают');
}

/* ---------- 5. точка входа не импортирует пакеты напрямую ---------- */
{
  const entry = path.join(BOT, 'src', 'index.js');
  if (!exists(entry)) bad('bot/src/index.js отсутствует', 'это точка входа: npm start / CMD в Docker');
  else {
    const bads = importsOf(entry).filter((s) => !isRelative(s) && !isBuiltin(s));
    if (bads.length) {
      bad(`bot/src/index.js статически импортирует ${bads.join(', ')}`,
        'именно так и получался ERR_MODULE_NOT_FOUND: точка входа обязана ' +
        'сначала звать ensure-deps.js, а приложение держать в src/app.js');
    } else ok('bot/src/index.js не импортирует пакеты напрямую (гарант зависимостей сработает)');
  }
}

/* ---------- 6. все импорты в коде объявлены в dependencies ---------- */
{
  const unknown = [];
  for (const f of [...jsFiles(path.join(BOT, 'src')), ...jsFiles(path.join(ROOT, 'scripts'))]) {
    const rel = path.relative(ROOT, f);
    for (const spec of importsOf(f)) {
      if (isRelative(spec) || isBuiltin(spec)) continue;
      const name = pkgName(spec);
      if (!botDeps[name] && !rootDeps[name]) unknown.push(`${rel}: ${spec}`);
    }
  }
  if (unknown.length) bad('импорты не объявлены в dependencies', unknown.join('; '));
  else ok('все сторонние импорты объявлены в dependencies');
}

/* ---------- 7. Dockerfile ---------- */
{
  const dockerfile = read(path.join(ROOT, 'Dockerfile'));
  if (!dockerfile) bad('Dockerfile отсутствует');
  else {
    ok('Dockerfile на месте');
    const cmd = dockerfile.match(/^CMD\s+\[([^\]]+)\]/m);
    if (!cmd) bad('Dockerfile: не нашёл CMD');
    else {
      const parts = cmd[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const entryRel = parts[parts.length - 1];
      if (!exists(path.join(ROOT, entryRel))) bad(`Dockerfile: CMD указывает на несуществующий ${entryRel}`);
      else ok(`Dockerfile: CMD → ${entryRel} существует`);
    }
    if (!/ensure-deps\.js\s+--check/.test(dockerfile)) {
      bad('Dockerfile: нет проверки зависимостей при сборке', 'верни строку RUN node bot/src/ensure-deps.js --check');
    } else ok('Dockerfile: сборка проверяет зависимости (ensure-deps --check)');
    if (!/npm\s+ci/.test(dockerfile)) bad('Dockerfile: нет npm ci');
    else ok('Dockerfile: зависимости ставятся через npm ci');
  }
  for (const script of ['start', 'check', 'smoke']) {
    const s = rootPkg?.scripts?.[script];
    if (!s) continue;
    const file = (s.match(/node\s+(\S+\.m?js)/) || [])[1];
    if (file && !exists(path.join(ROOT, file))) bad(`package.json: скрипт ${script} указывает на несуществующий ${file}`);
  }
  const botStart = botPkg?.scripts?.start;
  if (botStart) {
    const file = (botStart.match(/node\s+(\S+\.m?js)/) || [])[1];
    if (file && !exists(path.join(BOT, file))) bad(`bot/package.json: start указывает на несуществующий ${file}`);
    else if (file) ok(`bot/package.json: start → ${file} существует`);
  }
}

/* ---------- 8. .dockerignore не выкидывает нужное ---------- */
{
  const rules = dockerIgnoreRules();
  const needed = [
    'package.json', 'package-lock.json',
    'bot/package.json', 'bot/package-lock.json',
    'bot/src/index.js', 'bot/src/app.js', 'bot/src/ensure-deps.js',
    'bot/src/deps-loader.mjs', 'bot/src/store.js', 'bot/src/bgremove.js', 'bot/src/tribute.js',
    'bot/seed/content.json', 'scripts/smoke.mjs', 'scripts/check-project.mjs'
  ].filter((p) => exists(path.join(ROOT, p)));
  const lost = needed.filter((p) => isIgnored(p, rules));
  if (lost.length) bad('.dockerignore исключает нужные файлы', lost.join(', '));
  else ok(`.dockerignore не трогает нужные файлы (${needed.length} шт.)`);

  const mustIgnore = ['bot/node_modules/grammy/package.json', 'node_modules/grammy/package.json', '.env'];
  const leaked = mustIgnore.filter((p) => !isIgnored(p, rules));
  if (leaked.length) bad('.dockerignore пропускает в образ лишнее', leaked.join(', '));
  else ok('.dockerignore не пускает в образ node_modules и .env');
}

/* ---------- 9. health-check бота согласован ---------- */
{
  const app = read(path.join(BOT, 'src', 'app.js'));
  const compose = read(path.join(ROOT, 'docker-compose.yml'));
  if (!app.includes("'/health'") && !app.includes('"/health"')) bad('bot/src/app.js: нет эндпоинта /health', 'на него смотрят HEALTHCHECK в Docker и compose');
  else ok('bot/src/app.js: /health на месте');
  if (compose && !compose.includes('/health')) bad('docker-compose.yml: healthcheck не проверяет /health');
  else if (compose) ok('docker-compose.yml: healthcheck проверяет /health');
  if (!app.includes('NO_POLLING')) bad('bot/src/app.js: нет поддержки NO_POLLING=1', 'без неё смоук-тест и сборка Docker лезут в Telegram');
  else ok('bot/src/app.js: NO_POLLING=1 поддерживается');
}

/* ---------- 10. CI-проверка существует ---------- */
{
  const wf = path.join(ROOT, '.github', 'workflows');
  const files = exists(wf) ? fs.readdirSync(wf) : [];
  if (!files.some((f) => /check|ci|test/i.test(f))) bad('нет CI-workflow с проверками', 'добавь .github/workflows/ci.yml');
  else ok(`CI-workflow на месте: ${files.join(', ')}`);

  // ветки arena/* — временные, триггер на них протухнет сразу после мерджа.
  // Заодно следим за дублем ключа branches: с таким YAML GitHub не запускает
  // workflow вообще (падает за 0 секунд), а на вид конфиг выглядит рабочим.
  for (const f of files) {
    const text = read(path.join(wf, f));
    const listed = [
      ...[...text.matchAll(/branches:\s*\[([^\]]*)\]/g)].flatMap((m) => m[1].split(',')),
      ...[...text.matchAll(/branches:\s*\n((?:\s*-\s*\S+\n?)+)/g)].flatMap((m) => m[1].split('\n'))
    ].map((s) => s.trim().replace(/^-\s*/, '').replace(/['"]/g, '')).filter((b) => b && b !== '[]');
    const stale = [...new Set(listed.filter((b) => b !== 'main'))];
    if (stale.length) bad(`${f}: триггер на непостоянную ветку`, stale.join(', ') + ' — оставь только main');
    else if (/branches:/.test(text)) ok(`${f}: триггер только на постоянные ветки`);
    const onBlock = (text.match(/^on:[\s\S]*?\n(?=\S)/m) || [''])[0];
    const dup = (onBlock.match(/^\s+branches:/gm) || []).length;
    if (dup > 1) bad(`${f}: в on: два одинаковых ключа branches:`, 'нужен один — иначе workflow падает, не начавшись');
    else ok(`${f}: on: без дублей ключей`);
  }
}

/* ---------- 11. GitHub Pages: сайт, а не README ---------- */
{
  const rootIndex = read(path.join(ROOT, 'index.html'));
  if (!rootIndex) {
    bad('в корне нет index.html',
      'Pages в режиме «Deploy from a branch» собирает корень репозитория: ' +
      'без index.html Jekyll покажет README.md вместо приложения');
  } else {
    if (!rootIndex.includes('app/index.html')) bad('index.html в корне не ведёт в app/index.html');
    else ok('index.html в корне ведёт в app/index.html');
    if (!/location\.replace|http-equiv="refresh"/.test(rootIndex)) bad('index.html в корне не делает редирект');
    else ok('index.html в корне редиректит на приложение');
    if (!/location\.hash/.test(rootIndex)) bad('index.html в корне теряет #hash', 'Telegram Mini App передаёт tgWebAppData во фрагменте');
    else ok('index.html в корне сохраняет query и hash (важно для Telegram)');
  }
  if (!exists(path.join(ROOT, '.nojekyll'))) bad('нет .nojekyll', 'без него Jekyll обрабатывает корень и может показать README');
  else ok('.nojekyll на месте — Jekyll отключён');
  if (!exists(path.join(ROOT, 'app', 'index.html'))) bad('нет app/index.html — приложению нечем открываться');
  else ok('app/index.html на месте');

  const pages = read(path.join(ROOT, '.github', 'workflows', 'pages.yml'));
  if (!pages) bad('нет .github/workflows/pages.yml');
  else {
    if (!/path:\s*app/.test(pages)) bad('pages.yml публикует не папку app');
    else ok('pages.yml публикует app/');
  }
}

/* ---------- 12. порт: автоочистка и аккуратный выход ---------- */
{
  const app = read(path.join(BOT, 'src', 'app.js'));
  const store = read(path.join(BOT, 'src', 'store.js'));
  if (!exists(path.join(BOT, 'src', 'port.js'))) bad('нет bot/src/port.js — порт при деплое не чистится');
  else ok('bot/src/port.js на месте');
  if (!/acquirePort\(/.test(app)) bad('bot/src/app.js не зовёт acquirePort', 'иначе EADDRINUSE снова уронит деплой');
  else ok('bot/src/app.js занимает порт через acquirePort');
  if (!/\.listen\(PORT/.test(app)) ok('bot/src/app.js не слушает порт в лоб (есть очистка)');
  else bad('bot/src/app.js слушает PORT напрямую', 'так EADDRINUSE убивает старт — нужен acquirePort');
  if (!/SIGTERM/.test(app)) bad('bot/src/app.js не обрабатывает SIGTERM', 'деплой оборвёт процесс и потеряет несохранённую базу');
  else ok('bot/src/app.js обрабатывает SIGTERM');
  if (!/export const flush/.test(store)) bad('bot/src/store.js не отдаёт flush()', 'отложенный save() не успеет записать базу при останове');
  else ok('bot/src/store.js отдаёт flush() для немедленной записи');
}

/* ---------- 13. примеры к практикам: обещаны в тексте → есть в контенте и в витринах ----------
   Поломка, из-за которой появилась эта проверка: практика «Фразы, которые
   держат» (блок «Опора») говорила «прочитай примеры ниже», а примеры из
   p.extras не рисовала ни одна витрина — шаг вёл в пустоту. */
{
  const content = readJson(path.join(ROOT, 'app', 'content', 'content.json'));
  const seed = readJson(path.join(BOT, 'seed', 'content.json'));
  const web = read(path.join(ROOT, 'app', 'js', 'app.js'));
  const botApp = read(path.join(BOT, 'src', 'app.js'));
  const book = read(path.join(ROOT, 'app', 'workbook.html'));
  if (!content) bad('app/content/content.json не читается как JSON');
  else {
    const PROMISE = /примеры?\s+(ниже|выше)|из\s+примеров|списка?\s+ниже|из\s+списка/i;
    const flat = (v) => (Array.isArray(v) ? v : Object.values(v || {}).filter(Array.isArray).flat());
    const practices = content.blocks.flatMap((b) => b.practices.map((p) => ({ block: b, p })));
    const promised = practices.filter(({ p }) =>
      [...p.steps, ...((p.alt && p.alt.steps) || [])].some((s) => PROMISE.test(s)));
    if (!promised.length) {
      bad('в контенте не осталось практик, обещающих примеры', 'проверка протухла: убери её вместе с формулировками «примеры ниже»');
    } else {
      const empty = promised.filter(({ p }) => !Object.keys(p.extras || {}).length);
      if (empty.length) bad('практика обещает примеры, а extras пуст',
        empty.map(({ block, p }) => `${block.title} → ${p.title}`).join(', '));
      else ok(`у практик с «примерами ниже» есть extras (${promised.length} шт.)`);

      const thin = promised.filter(({ p }) => Object.values(p.extras || {}).some((v) => flat(v).length < 2));
      if (thin.length) bad('в extras меньше двух примеров — выбирать не из чего',
        thin.map(({ p }) => p.title).join(', '));
      else ok('в каждой группе extras минимум два примера');
    }

    if (!seed) bad('bot/seed/content.json не читается как JSON');
    else if (JSON.stringify(seed.blocks) !== JSON.stringify(content.blocks)) {
      bad('bot/seed/content.json разошёлся с app/content/content.json по практикам',
        'бот без app/ берёт контент из seed — примеры там должны быть те же');
    } else ok('бот-сид и веб-контент совпадают по блокам практик');

    if (!/practiceExamples\(/.test(web)) bad('app/js/app.js не рисует примеры практики (p.extras)',
      'верни practiceExamples(p) в screenPractice()');
    else ok('веб рисует примеры практики (practiceExamples)');
    if (!/practiceExamplesText\(/.test(botApp)) bad('bot/src/app.js не присылает примеры в /today');
    else ok('бот присылает примеры в /today');
    if (!/extrasHtml\(/.test(book)) bad('app/workbook.html не печатает примеры в карточке практики');
    else ok('печатная тетрадь показывает примеры внутри практики');
  }
}

/* ---------- 14. «чат молчит» должен быть диагностируем, а не угадываем ----------
   Поломка, из-за которой появилась эта проверка: HTTP API жил, /health
   показывал «ai: true», а Telegram-половина процесса не получала ничего
   (409: polling держала старая копия). Искали полгода не там. Правила ниже
   не дают снова оставить бота без самодиагностики, а ошибки OpenAI — без
   разбора на «ключ / деньги / модель / параметры». */
{
  const ai = read(path.join(BOT, 'src', 'ai.js'));
  const app = read(path.join(BOT, 'src', 'app.js'));
  const web = read(path.join(ROOT, 'app', 'js', 'app.js'));
  const css = read(path.join(ROOT, 'app', 'css', 'app.css'));
  const rootIndex = read(path.join(ROOT, 'index.html'));
  const docs = read(path.join(ROOT, 'docs', 'SETUP.md'));
  const pkg = readJson(path.join(ROOT, 'package.json'));

  /* OpenAI: совместимость параметров и разбор кодов ошибок */
  if (!ai) bad('нет bot/src/ai.js');
  else {
    if (/max_completion_tokens/.test(ai)) ok('bot/src/ai.js: есть режим max_completion_tokens (gpt-5*/o* не принимают max_tokens)');
    else bad('bot/src/ai.js не умеет max_completion_tokens', 'свежие модели отвечают 400 Unsupported parameter, и чат молча скатывается в шаблоны');
    if (/insufficient_quota/.test(ai)) ok('bot/src/ai.js: «кончились средства» отличается от «перегрузки»');
    else bad('bot/src/ai.js: 429 insufficient_quota не разбирается', 'иначе «no_quota» выглядит как «меня слишком много спрашивают» и чинится не там');
    for (const fn of ['aiDiagnostics', 'selfTest', 'errorHint']) {
      if (new RegExp('export (async )?function ' + fn + '\\b|export const ' + fn + '\\b').test(ai)) ok(`bot/src/ai.js: отдаёт ${fn}()`);
      else bad(`bot/src/ai.js не отдаёт ${fn}()`, 'без него /diag и /health нечем проверять связь');
    }
  }

  /* бот: состояние polling, лимит на публичный /chat, техничка — только админу */
  if (!app) bad('нет bot/src/app.js');
  else {
    if (/polling/.test(app) && /statusReport/.test(app)) ok('bot/src/app.js: /health отдаёт состояние polling');
    else bad('bot/src/app.js: /health не показывает polling', 'именно поэтому «бот жив, но молчит» было не найти');
    if (/'\/diag'|command\('diag'/.test(app)) ok('bot/src/app.js: /diag для диагностики на месте');
    else bad('bot/src/app.js: нет /diag', 'должна быть одна команда, отвечающая «почему молчит»');
    if (!/free-port/.test(app)) ok('bot/src/app.js: не зовёт free-port (он убивал чужие процессы на порту)');
    else bad('bot/src/app.js снова зовёт ./free-port.js', 'нужен acquirePort из bot/src/port.js: он трогает только наши копии');
    if (/CHAT_RATE/.test(app)) ok('bot/src/app.js: публичный POST /chat под лимитом');
    else bad('bot/src/app.js: у открытого /chat нет лимита', 'один скрипт съедает бюджет ключа владельца');
    if (/OWNER_ERRORS/.test(app)) ok('bot/src/app.js: технические причины уходят админу, а не в чат');
    else bad('bot/src/app.js: причину ошибки API видно гостю', '«проверь OPENAI_API_KEY» в чате поддержки пугает — неси её админу');
  }

  /* веб: отказ живого чата виден человеку */
  if (/AI_REASON/.test(web) && /chat-note/.test(web)) ok('app/js/app.js: чат объясняет, почему отвечает шаблонами');
  else bad('app/js/app.js: фолбэк чата снова без объяснения причины', 'тихий локальный ответ выглядит как «ии не реагирует»');
  if (/\.chat-note/.test(css)) ok('app/css/app.css: стиль .chat-note на месте');
  else bad('app/css/app.css: нет стиля .chat-note');

  /* корень Pages: редирект не должен съедать #hash (в нём tgWebAppData) */
  if (rootIndex && /http-equiv="refresh"/.test(rootIndex)) {
    bad('index.html в корне снова редиректит через <meta http-equiv="refresh">',
      'meta-refresh уносит только путь: теряется #hash с tgWebAppData → Mini App не узнаёт пользователя, чат без памяти');
  } else if (rootIndex) ok('index.html в корне: редирект скриптом, #hash сохраняется');

  /* инструменты и документация */
  if (pkg?.scripts?.['ai-check'] && exists(path.join(ROOT, 'scripts', 'ai-check.mjs'))) ok('npm run ai-check: проверка «почему молчит» на месте');
  else bad('нет npm run ai-check (scripts/ai-check.mjs)', 'быстрая диагностика должна быть одной командой, а не расследованием');
  if (/\/diag/.test(docs) && /ai-check/.test(docs)) ok('docs/SETUP.md: раздел про диагностику чата есть');
  else bad('docs/SETUP.md: нет раздела «чат молчит» с /diag и npm run ai-check', 'человек не должен гадать, где смотреть причину');
}

/* ---------- 15. agents-бэкенд: контракт и тишина о секретах ----------
   Отдельный рубеж: сессия Agents API + self-hosted окружение. Ловит то,
   что невозможно проверить без mock-сервера: путь и заголовок беты, форма
   input-события, признаки конца хода, и главное — что connect-токен
   окружения не уезжает ни в логи, ни в /health, ни в окружение процесса. */
{
  const ag = read(path.join(BOT, 'src', 'agents.js'));
  const app = read(path.join(BOT, 'src', 'app.js'));
  const envEx = read(path.join(ROOT, '.env.example'));
  const docs = read(path.join(ROOT, 'docs', 'SETUP.md'));
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const ci = read(path.join(ROOT, '.github', 'workflows', 'ci.yml'));
  if (!ag) bad('нет bot/src/agents.js', 'agents-бэкенд (сессия + окружение) — см. docs/SETUP.md');
  else {
    const contract = [
      ['/agents/sessions', 'путь создания сессии'],
      ["'agents=v1'", 'заголовок OpenAI-Beta: agents=v1'],
      ['agent.session.input.message', 'форма input-события'],
      ['agent.session.turn.output_text.delta', 'чтение дельт текста'],
      ['agent.session.turn.completed', 'признак конца хода (idle — не он)'],
      ['agent.session.environment.failed', 'реакция на неподключённое окружение']
    ];
    const missing = contract.filter(([needle]) => !ag.includes(needle));
    if (!missing.length) ok(`bot/src/agents.js: контракт Agents API на месте (${contract.length} пунктов)`);
    else bad('bot/src/agents.js потерял часть контракта: ' + missing.map(([, w]) => w).join(', '));

    const diag = ag.slice(ag.indexOf('export function agentsDiagnostics'), ag.indexOf('/* ---------- HTTP')) || '';
    if (ag.includes('maskSecret(') && !/remote_url:/.test(diag)) ok('bot/src/agents.js: remote_url маскируется и не светится в диагностике');
    else bad('bot/src/agents.js: connect-токен окружения виден снаружи', 'remote_url содержит одноразовый токен подключения — только маска, и никогда в /health');
    if (!/env:\s*\{\.\.\.process\.env/.test(ag)) ok('bot/src/agents.js: в песочницу не льётся окружение процесса');
    else bad('bot/src/agents.js: исполнителю передаётся ...process.env', 'вместе с OPENAI_API_KEY и ADMIN_IDS попадёт в песочницу, где крутится код от модели');
  }
  if (/agentsEnabled\(\)/.test(app) && /фолбэк в chat\/completions/.test(app)) ok('bot/src/app.js: agents с автоматическим фолбэком на chat/completions');
  else bad('bot/src/app.js: у agents-бэкенда нет фолбэка', 'человек не должен остаться без ответа из-за недоступного окружения');
  if (/closeAllSessions/.test(app)) ok('bot/src/app.js: исполнители закрываются по SIGTERM');
  else bad('bot/src/app.js: codex exec-server переживёт останов процесса', 'нужен closeAllSessions() в shutdown');

  if (/AGENTS_ENABLED/.test(envEx) && /OPENAI_EXECUTOR_API_KEY/.test(envEx)) ok('.env.example: переменные agents-бэкенда описаны');
  else bad('.env.example: нет блока AGENTS_* / OPENAI_EXECUTOR_API_KEY');
  if (/exec-server/.test(docs) && /AGENTS_EXECUTOR_CMD/.test(docs)) ok('docs/SETUP.md: запуск окружения и исполнителя описан');
  else bad('docs/SETUP.md: не описан codex exec-server / AGENTS_EXECUTOR_CMD');
  if (pkg?.scripts?.['agents-test'] && ci?.includes('agents-test') && exists(path.join(ROOT, 'scripts', 'agents-mock-check.mjs'))) ok('npm run agents-test: мок Agents API в CI');
  else bad('нет agents-test в package.json/CI', 'контракт беты надо проверяять без живого ключа');
}

/* ---------- 16. v25: эмоции с лицом Дибитишки, доски, папки, живой маскот ----------
   Правила появились после итерации 25. Смысл каждого:
   — эмоции больше не на эмодзи: у каждого состояния своё сгенерированное лицо,
     и набор должен совпадать с набором файлов (иначе на экране дырка);
   — старые отметки 0..4 нельзя терять: без миграции шкалы график в профиле
     «съезжает», а человек видит не свою историю;
   — заметка должна стоять ВЫШЕ чипов эмоций (просьба итерации);
   — картинки досок лежат в IndexedDB, а не в localStorage: иначе фото из
     галереи переполняют хранилище на втором снимке;
   — папки навыков и кадры живого маскота — реальные файлы, а не подпись. */
{
  const web = read(path.join(ROOT, 'app', 'js', 'app.js'));
  const css = read(path.join(ROOT, 'app', 'css', 'app.css'));
  const faces = ['hard', 'sad', 'anxious', 'even', 'warm', 'fun', 'joy', 'mixed', 'unclear'];
  const folders = ['opora', 'osoznannost', 'stress', 'emotions', 'sensorika'];

  if (!web) bad('нет app/js/app.js');
  else {
    const moodLine = (web.match(/const MOODS = \[[^\]]*\]/) || [''])[0];
    const faceLine = (web.match(/const MOOD_FACES = \[[^\]]*\]/) || [''])[0];
    const moods = (moodLine.match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1));
    const faceKeys = (faceLine.match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1));
    for (const need of ['Грустно', 'Весело', 'Смешанно', 'Непонятно']) {
      if (moods.includes(need)) ok(`эмоции: «${need}» на месте`);
      else bad(`эмоции: пропало состояние «${need}»`, 'в итерации 25 добавили грустно/весело/смешанно/непонятно');
    }
    if (moods.length === faceKeys.length && moods.length >= 9) ok(`эмоции: ${moods.length} состояний и столько же лиц`);
    else bad('эмоции: число состояний и лиц разошлось', 'MOODS и MOOD_FACES должны идти парами');
    const missing = faceKeys.filter((k) => !exists(path.join(ROOT, 'app', 'assets', 'mascot', 'faces', `${k}.png`)));
    if (faceKeys.length && !missing.length) ok('лица эмоций: файлы на месте (assets/mascot/faces/*.png)');
    else bad(`лица эмоций: нет файлов ${missing.join(', ') || '(набор пуст)'}`, 'пересобери: python3 scripts/build-mood-faces.py');
    if (!/MOOD_EMOJI = \[[^\]]*[\u{1F300}-\u{1FAFF}]/u.test(web)) ok('эмоции: стандартные эмодзи убраны (остались только PNG-лица)');
    else bad('эмоции: вернулись стандартные эмодзи', 'в чипах эмоций должно быть лицо Дибитишки, а не 😊/😞');

    if (/persisted\.mood_schema/.test(web)) ok('эмоции: миграция старой шкалы 0..4 смотрит на сохранённое состояние');
    else bad('эмоции: миграция шкалы снова смотрит на state', 'defaultState подставит новую схему, и старые отметки перестанут пересчитываться');

    /* заметка — выше чипов эмоций */
    const noteAt = web.indexOf('mood-note-wrap');
    const chipsAt = web.indexOf('mood-chips');
    if (noteAt > 0 && chipsAt > noteAt) ok('главная: короткая заметка стоит выше эмоций');
    else bad('главная: заметка уехала под эмоции', 'в итерации 25 просили перенести её наверх');

    /* кнопка «Поделиться» */
    if (/shareMoodCard/.test(web) && /navigator\.share/.test(web)) ok('«Поделиться»: карточка настроения собирается на canvas + нативный share');
    else bad('«Поделиться»: нет сборки карточки или нативного share');
    if (/support-card/.test(web) && /support-card/.test(css)) ok('профиль: подписка и донат — один блок (support-card)');
    else bad('профиль: подписка и донат снова разъехались', 'верни subscriptionCard() и стиль .support-card');
    const subAt = web.indexOf('subscriptionCard()');
    const statsAt = web.indexOf("'График настроения'");
    if (subAt > 0 && statsAt > subAt) ok('профиль: блок подписки/доната выше графика настроения');
    else bad('профиль: подписка снова ниже графика', 'её просили поднять вверх и объединить с донатом');

    /* доски впечатлений */
    if (/indexedDB\.open\('dibitishka\.media'/.test(web)) ok('доски: картинки в IndexedDB (в localStorage они не влезут)');
    else bad('доски: картинки снова кладут в localStorage', 'второе фото переполнит хранилище');
    if (/case 'boards'/.test(web) && /case 'board'/.test(web)) ok('доски: маршруты #/boards и #/board/<id> на месте');
    else bad('доски: нет маршрутов в render()');
    if (/addGifSheet|kind: 'gif'/.test(web) && /tenor\.com\/search/.test(web)) ok('доски: GIF по ссылке + поиск по тегам в Tenor');
    else bad('доски: пропал блок GIF по ссылке');
    if (/boardBgSheet/.test(web) && /BOARD_BGS/.test(web)) ok('доски: свой фон — темы и фото');
    else bad('доски: нет выбора фона');
    if (/search/.test(web) && /board-search/.test(css)) ok('доски: поиск по тегам и подписям');
    else bad('доски: нет поиска по тегам');

    /* живой маскот */
    if (/liveMascot\(/.test(web) && /live-mascot/.test(css)) ok('главная: живой маскот (моргает и улыбается)');
    else bad('главная: живой маскот пропал');
    for (const f of ['hero-blink.png', 'hero-smile.png']) {
      if (exists(path.join(ROOT, 'app', 'assets', 'mascot', f))) ok(`маскот: кадр ${f} на месте`);
      else bad(`маскот: нет кадра ${f}`, 'пересобери: python3 scripts/build-mascot-frames.py');
    }
    /* кадры должны быть тех же размеров, что и опорная поза, иначе анимация «прыгает».
       Размер PNG читаем из заголовка — без внешних пакетов, чтобы работало и в CI. */
    const pngSize = (file) => {
      try {
        const buf = fs.readFileSync(file);
        if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
        return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
      } catch (e) { return null; }
    };
    const sizes = ['hello.png', 'hero-blink.png', 'hero-smile.png']
      .map((f) => pngSize(path.join(ROOT, 'app', 'assets', 'mascot', f)));
    if (sizes.every((x) => x && x[0] === sizes[0][0] && x[1] === sizes[0][1])) {
      ok(`маскот: кадры анимации совпадают по размеру с hello.png (${sizes[0].join('×')})`);
    } else {
      bad('маскот: кадры анимации разного размера с hello.png',
        'при переключении слоёв персонаж будет дёргаться — пересобери: python3 scripts/build-mascot-frames.py');
    }

    /* папки навыков */
    const folderLine = (web.match(/const FOLDER_ART = \{[^}]*\}/) || [''])[0];
    if (folderLine) ok('навыки: карта папок FOLDER_ART на месте');
    else bad('навыки: нет FOLDER_ART — блоки не найдут свои папки');
    const missingFolders = folders.filter((k) => !exists(path.join(ROOT, 'app', 'assets', 'folders', `${k}.png`)));
    if (!missingFolders.length) ok('навыки: все пять папок отрисованы (assets/folders/*.png)');
    else bad(`навыки: нет папок ${missingFolders.join(', ')}`, 'пересобери: python3 scripts/slice-folders.py');
    if (/\.folders\b/.test(css) && /\.folder\.f-/.test(css)) ok('навыки: стили папок с цветами блоков на месте');
    else bad('навыки: нет стилей .folders/.folder.f-*');
  }
}

/* ---------- итог ---------- */
const failed = results.filter((r) => !r.ok);
console.log('');
for (const r of results) {
  console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.msg}`);
  if (!r.ok && r.hint) console.log(`      ↳ ${r.hint}`);
}
console.log('');
if (failed.length) {
  console.log(`проверка проекта: ${failed.length} проблем(а) из ${results.length} проверок`);
  process.exit(1);
}
console.log(`проверка проекта: всё чисто (${results.length} проверок)`);
