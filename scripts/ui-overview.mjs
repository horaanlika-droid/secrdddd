#!/usr/bin/env node
/* Обзор интерфейса «Дибитишки» в двух палитрах.

   Скрипт поднимает приложение из `app/` на локальном порту, снимает настоящие
   экраны (Сегодня · Навыки · Профиль) в голубой и розовой палитре и собирает
   из них одну картинку — `docs/ui-overview.png` (отдельные кадры остаются
   в `test-results/ui/`, они в .gitignore).

   Состояние подсовывается до загрузки страницы (addInitScript), поэтому
   уровень, XP-шкала, шкалы роста и папки блоков на снимке заполнены примерно
   на треть — видно и прогресс, и то, что расти ещё есть куда. Значки при этом
   считаются сами (`reviewBadges()` при старте), то есть соответствуют цифрам.

   Браузер: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (как в browser-smoke.mjs)
   либо тот Chromium, что идёт с @playwright/test. Внешнее окружение передаётся
   браузеру целиком — так в песочнице до него доходит LD_LIBRARY_PATH с NSS.

   node scripts/ui-overview.mjs [--out docs/ui-overview.png] [--scale 2]
*/
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, argOf('out', 'docs/ui-overview.png'));
const SCALE = Number(argOf('scale', '2'));
const ART = path.join(ROOT, 'test-results/ui');
await fs.mkdir(ART, { recursive: true });
await fs.mkdir(path.dirname(OUT), { recursive: true });

/* ---------- экраны, которые попадают в обзор ---------- */
const SHOTS = [
  { id: 'today', route: '', height: 940, title: 'Сегодня',
    note: 'уровень и XP · эмоция дня · дела · практика' },
  { id: 'skills', route: 'skills', height: 940, fitTo: '.folders', title: 'Навыки',
    note: 'папки блоков со своим прогрессом' },
  { id: 'profile', route: 'profile', height: 1500, fitTo: '.badge-grid', title: 'Профиль',
    note: 'уровень · график настроения · шкалы роста · значки' }
];
const PALETTES = [
  { id: 'blue', title: 'Голубая', note: 'небо и мягкий синий', sw: ['#8FB8FB', '#B9D3FA', '#E9F1FD'] },
  { id: 'pink', title: 'Розовая', note: 'пудра, пион, тёплый свет', sw: ['#F794BC', '#F9C4DA', '#FCEFF5'] }
];

/* ---------- статический сервер приложения (как в browser-smoke.mjs) ---------- */
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const overviewHtml = () => posterHtml;             // постер собирается после снимков
const frames = new Map();                          // имя → PNG-буфер кадра
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/chat/status' || p === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"ai":false}'); }
  if (p === '/pay-url') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }
  if (p === '/gif') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"enabled":false,"items":[]}'); }
  if (p === '/overview.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(overviewHtml()); }
  if (p.startsWith('/frames/')) {
    const buf = frames.get(p.slice('/frames/'.length));
    if (!buf) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(buf);
  }
  const name = p === '/' ? 'index.html' : p === '/content.json' ? 'content/content.json' : p.slice(1);
  const file = path.resolve(ROOT, 'app', name);
  if (!file.startsWith(path.join(ROOT, 'app') + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    let bytes = await fs.readFile(file);
    if (name === 'config.js') bytes = Buffer.from(bytes.toString() + '\nwindow.DIBI_CONFIG.bot_public_url=location.origin;');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ---------- состояние для снимков: всё заполнено «немного» ----------
   levelInfo(): уровень = points / 120, поэтому 286 очков = 3-й уровень
   и 46/120 XP (38 %). Шкалы — от 21 % до 34 % от своих максимумов. */
const seedState = (palette) => `(() => {
  const DAY = 86400000, now = Date.now();
  const key = (d) => \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`;
  const at = (daysAgo, h, m) => { const d = new Date(now - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
  const dayKey = (daysAgo) => key(new Date(now - daysAgo * DAY));
  /* отметки эмоций за две недели — из них рисуется график в профиле */
  const moods = [[0, 9, 40, 4, ''], [1, 21, 10, 3, 'Вечером отпустило'], [2, 12, 5, 2, ''],
    [3, 20, 0, 5, ''], [4, 10, 30, 1, 'Утро было тяжёлым'], [6, 19, 45, 6, ''],
    [7, 13, 15, 3, ''], [9, 22, 0, 4, ''], [11, 11, 20, 0, ''], [13, 18, 30, 5, '']];
  const state = {
    onboarded: true,
    trial_started_at: now - 3 * DAY,
    premium_until: now + 25 * DAY,
    theme: 'light',
    palette: '${palette}',
    mood_schema: 2,
    install_hint_seen: true,
    install_done: true,
    reminders: { on: true, time: '21:00' },
    mastered: { selfcare: true, senses: true, breath: true, name: true, hyper: true },
    done: { [dayKey(1)]: ['breath'], [dayKey(2)]: ['senses'], [dayKey(3)]: ['selfcare'], [dayKey(4)]: ['gratitude'] },
    mood: {},
    mood_entries: moods.map(([d, h, m, v, note]) => ({ ts: at(d, h, m), value: v, note: note || undefined })),
    tasks: {
      anchors: { text: 'Чай у окна, плед и один эпизод сериала. Ещё — звонок Кате, она умеет слушать.', ts: at(2, 20, 0) },
      crisis_plan: { text: 'Сначала холодная вода на лицо и дыхание 4–6. Потом написать Кате. Телефон — не в руку, а на стол экраном вниз.', ts: at(5, 19, 30) }
    },
    deeds: { [dayKey(0)]: { items: [
      { id: 'a1', text: 'Выйти на воздух минут на десять', done: true, ts: at(0, 9, 10) },
      { id: 'a2', text: 'Позвонить маме', done: false, ts: at(0, 9, 12) }
    ], ts: at(0, 9, 12) } },
    game: {
      total_points: 286,
      alt_count: 2,
      scales: { awareness: 34, care: 27, resilience: 21, sensory: 15 },
      badges: {}
    }
  };
  localStorage.setItem('dibitishka.v1', JSON.stringify(state));
})()`;

/* ---------- постер, в который складываются кадры ---------- */
let posterHtml = '';
function buildPoster(pals, single) {
  const cell = (shot, pal) => `<div class="cell">
    <div class="frame"><img src="frames/${pal.id}-${shot.id}.png" alt="${pal.title} · ${shot.title}" width="${shot.w}" height="${shot.h}"></div>
  </div>`;
  posterHtml = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0; padding:56px 56px 64px; background:#EEF2FA; color:#0B1F4D;
       font:16px/1.5 "DejaVu Sans", "Open Sans", system-ui, sans-serif;
       background-image:radial-gradient(80% 40% at 50% 0%, #FFFFFF, transparent 70%)}
  .head{display:flex; align-items:flex-end; justify-content:space-between; gap:32px; margin-bottom:34px}
  h1{margin:0; font:600 40px/1.15 "DejaVu Serif", Georgia, serif; letter-spacing:-.02em}
  .head p{margin:8px 0 0; max-width:52ch; color:#5A6B8C; font-size:15px}
  .legend{display:flex; gap:26px; padding-bottom:4px}
  .legend div{text-align:right}
  .legend b{display:block; font-size:15px}
  .legend span{font-size:12.5px; color:#5A6B8C}
  .sw{display:flex; gap:5px; justify-content:flex-end; margin-bottom:6px}
  .sw i{width:18px; height:18px; border-radius:50%; box-shadow:inset 0 1px 0 rgba(255,255,255,.5), 0 2px 6px rgba(11,31,77,.16)}
  .grid{display:grid; grid-template-columns:${LABEL_W}px ${pals.map(() => `${FRAME_W}px`).join(' ')}; gap:26px 30px; align-items:start}
  .colhead{font:600 17px "DejaVu Sans", sans-serif; padding-bottom:2px; border-bottom:1.5px solid rgba(11,31,77,.12)}
  .rowlab{padding-top:10px; font:600 19px "DejaVu Sans", sans-serif}
  .rowlab small{display:block; margin-top:6px; font:400 12.5px/1.45 "DejaVu Sans", sans-serif; color:#5A6B8C}
  .frame{width:${FRAME_W}px; padding:7px; background:#fff; border:1px solid rgba(11,31,77,.10);
         border-radius:32px; box-shadow:0 18px 44px rgba(11,31,77,.16)}
  .frame img{display:block; width:100%; height:auto; border-radius:25px}
  .foot{margin-top:34px; color:#7C8AA6; font-size:12.5px}
  </style></head><body>
  <div class="head">
    <div>
      <h1>Дибитишка · обзор интерфейса${single ? ' · ' + pals[0].title.toLowerCase() + ' палитра' : ''}</h1>
      <p>${single
        ? `Три основных экрана в ${pals[0].title.toLowerCase()} палитре. Уровень, XP и шкалы роста заполнены примерно на треть.`
        : 'Три основных экрана в двух палитрах. Уровень, XP и шкалы роста заполнены примерно на треть — так видно и прогресс, и запас роста.'}</p>
    </div>
    <div class="legend">${pals.map(pl => `<div>
      <span class="sw">${pl.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>
      <b>${pl.title}</b><span>${pl.note}</span></div>`).join('')}</div>
  </div>
  <div class="grid">
    <div></div>${pals.length > 1 ? pals.map(pl => `<div class="colhead">${pl.title} палитра</div>`).join('') : '<div></div>'}
    ${SHOTS.map(shot => `<div class="rowlab">${shot.title}<small>${shot.note}</small></div>` +
      pals.map(pl => cell(shot, pl)).join('')).join('')}
  </div>
  <div class="foot">Каждый кадр — живой экран приложения (${SHOT_W}px), снятый Chromium: данные в состоянии, значки считаются по нему же.</div>
  </body></html>`;
}
const SHOT_W = 390;   /* ширина кадра приложения — как в browser-smoke.mjs */
const FRAME_W = 300;  /* ширина рамки в постере */
const LABEL_W = 170;  /* колонка подписей экранов */

/* ---------- съёмка ---------- */
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  /* окружение наружу целиком: так до браузера доходит LD_LIBRARY_PATH, если
     Chromium собран против библиотек, которых нет в системе */
  env: { ...process.env },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']
});
const report = [];
let outs = [];
try {
  for (const pal of PALETTES) {
    const ctx = await browser.newContext({ viewport: { width: SHOT_W, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route('https://telegram.org/**', route => route.abort());
    await page.addInitScript(seedState(pal.id));
    for (const shot of SHOTS) {
      await page.setViewportSize({ width: SHOT_W, height: shot.height });
      await page.goto(`${origin}/#/${shot.route}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#app .screen');
      await page.evaluate(() => document.querySelector('#splash')?.classList.add('gone'));
      /* живые анимации (дыхание маскота, блик на шкале XP) в кадре не нужны;
         тег ставим один раз: смена маршрута документ не перезагружает */
      await page.evaluate(() => {
        if (document.getElementById('ui-overview-still')) return;
        const st = document.createElement('style');
        st.id = 'ui-overview-still';
        st.textContent = '*{animation:none!important; transition:none!important}';
        document.head.append(st);
      });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      if (shot.fitTo) {
        /* кадр по нижнему краю блока (папки навыков, значки профиля) */
        const h = await page.evaluate(sel => Math.min(3200,
          Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY) + 112), shot.fitTo); /* +112: нижняя панель не должна накрывать последнюю карточку */
        await page.setViewportSize({ width: SHOT_W, height: h });
        shot.height = h;
      }
      await page.waitForTimeout(450);
      const name = `${pal.id}-${shot.id}.png`;
      const buf = await page.screenshot({ animations: 'disabled' });
      await fs.writeFile(path.join(ART, 'overview-' + name), buf);
      frames.set(name, buf);
      /* чем кадр подтверждается: ширины всех полосок прогресса, которые видны */
      const bars = await page.evaluate(() => [...document.querySelectorAll('.xp-fill, .scale-fill, .folder-track i, .level-track i')]
        .map(n => ({ cls: n.className || n.parentElement.className, w: n.style.width })));
      report.push({ palette: pal.id, screen: shot.id, bars });
      console.log(`  · ${pal.title} / ${shot.title}: ${bars.map(b => b.w).join(', ')}`);
    }
    await ctx.close();
  }

  /* ---------- постер: размеры кадров берём из самих PNG ---------- */
  const mod = await import('pngjs');
  const { PNG } = mod.PNG ? mod : mod.default;
  for (const shot of SHOTS) {
    const png = PNG.sync.read(frames.get(`${PALETTES[0].id}-${shot.id}.png`));
    Object.assign(shot, { w: png.width, h: png.height });
  }
  const POSTERS = [
    { pals: PALETTES, out: OUT, single: false },
    { pals: [PALETTES[0]], out: path.resolve(ROOT, 'docs/ui-overview-blue.png'), single: true },
    { pals: [PALETTES[1]], out: path.resolve(ROOT, 'docs/ui-overview-pink.png'), single: true }
  ];
  outs = [];
  for (const cfg of POSTERS) {
    buildPoster(cfg.pals, cfg.single);
    const posterW = LABEL_W + cfg.pals.length * FRAME_W + 30 * cfg.pals.length + 112;
    const poster = await browser.newPage({ viewport: { width: posterW, height: 1200 }, deviceScaleFactor: SCALE });
    await poster.goto(`${origin}/overview.html`, { waitUntil: 'networkidle' });
    await poster.waitForTimeout(300);
    await poster.screenshot({ path: cfg.out, fullPage: true, animations: 'disabled' });
    await poster.close();
    outs.push(path.relative(ROOT, cfg.out));
  }
} finally {
  await browser.close();
  server.close();
}

const missing = report.filter(r => !r.bars.length || r.bars.every(b => b.w === '0%'));
console.log('\nОбзор собран:\n  · ' + outs.join('\n  · '));
console.log('Кадры: ' + path.relative(ROOT, ART) + '/overview-*.png');
if (missing.length) {
  console.error('Шкалы не заполнились: ' + missing.map(m => m.palette + '/' + m.screen).join(', '));
  process.exit(1);
}
