/* Дибитишка · веб-приложение (TG Mini App + GitHub Pages + bot host) */

const CFG = window.DIBI_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.style.cssText = v;
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return n;
};

/* ---------- icons ---------- */
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICONS = {
  today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  skills: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  workbook: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
  merch: svg('<path d="M6 7h12l1.5 13.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5"/>'),
  house: svg('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-6h4v6"/>'),
  leaf: svg('<path d="M5 19C5 9 12 4 20 4c0 9-5 15-13 15"/><path d="M5 19c2-5 6-9 10-11"/>'),
  wave: svg('<path d="M3 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 3-2"/><path d="M3 14c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 3-2"/>'),
  spark: svg('<path d="M12 2l2.2 6.2L20 10l-5.8 1.8L12 18l-2.2-6.2L4 10l5.8-1.8z"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12"/><path d="M14 12V6.5a1.5 1.5 0 0 1 3 0V14"/><path d="M17 13.5c1.5-1.5 3 .5 2 2l-3 4.5c-1.3 2-3 3-5.5 3-3.5 0-6.5-2.5-6.5-6v-4a1.5 1.5 0 0 1 3 0"/>'),
  bell: svg('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  moon: svg('<path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10z"/>'),
  send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 8l9 6 9-6"/>'),
  card: svg('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  print: svg('<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  check: svg('<path d="M4.5 12.5l5 5 10-11"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  drop: svg('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>'),
  play: svg('<path d="M8 6.5v11l9-5.5z"/>')
};
const icon = (name, cls = '') => { const s = el('span'); s.className = cls; s.innerHTML = ICONS[name] || ICONS.drop; return s.firstChild; };

/* ---------- telegram bridge ---------- */
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const TG_MODE = !!(tg && tg.initDataUnsafe && tg.initDataUnsafe.user);
if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }
const haptic = (type = 'light') => {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (type === 'success' || type === 'error' || type === 'warning') tg.HapticFeedback.notificationOccurred(type);
    else tg.HapticFeedback.impactOccurred(type);
  } catch (e) {}
};

/* ---------- state ---------- */
const DB = 'dibitishka.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(DB)) || {}; } catch (e) { return {}; } };
const defaultState = {
  onboarded: false,
  trial_started_at: null,
  premium_until: 0,
  theme: 'system',
  mastered: {},
  done: {},
  mood: {},
  reminders: { on: false, time: '09:00' },
  merch_notify: [],
  web_user: null,
  game: {
    total_points: 0,
    alt_count: 0,
    plays: 0,
    best_jump: 0,
    last_jump: 0,
    scales: { awareness: 0, care: 0, resilience: 0, sensory: 0 },
    badges: {}
  }
};
const persisted = load();
const state = Object.assign({}, defaultState, persisted, {
  mastered: Object.assign({}, defaultState.mastered, persisted.mastered || {}),
  done: Object.assign({}, defaultState.done, persisted.done || {}),
  mood: Object.assign({}, defaultState.mood, persisted.mood || {}),
  reminders: Object.assign({}, defaultState.reminders, persisted.reminders || {}),
  merch_notify: Array.isArray(persisted.merch_notify) ? persisted.merch_notify : defaultState.merch_notify,
  game: Object.assign({}, defaultState.game, persisted.game || {}, {
    scales: Object.assign({}, defaultState.game.scales, persisted.game?.scales || {}),
    badges: Object.assign({}, defaultState.game.badges, persisted.game?.badges || {})
  })
});
const save = () => localStorage.setItem(DB, JSON.stringify(state));

const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TRIAL_MS = (CFG.subscription?.trial_days ?? 7) * 86400000;
const isPremium = () => (state.premium_until || 0) > Date.now() || (state.trial_started_at && Date.now() - state.trial_started_at < TRIAL_MS);
const trialDaysLeft = () => {
  if ((state.premium_until || 0) > Date.now()) return Infinity;
  if (!state.trial_started_at) return CFG.subscription?.trial_days ?? 7;
  return Math.max(0, Math.ceil((TRIAL_MS - (Date.now() - state.trial_started_at)) / 86400000));
};

/* ---------- content ---------- */
let CONTENT = null;
const API_BASE = (CFG.bot_public_url || '').trim().replace(/\/$/, '');
const apiUrl = (path) => API_BASE ? API_BASE + path : path;

async function loadContent() {
  const cached = localStorage.getItem('dibi.content');
  if (cached) { try { CONTENT = JSON.parse(cached); } catch (e) {} }
  const urls = [];
  if (API_BASE) urls.push(apiUrl('/content.json'));
  urls.push('content/content.json');
  for (const u of urls) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'v=' + (CONTENT?.version || 0), { signal: ctl.signal, cache: 'no-cache' });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.blocks) {
        if (!CONTENT || (j.version || 0) >= (CONTENT.version || 0)) {
          CONTENT = j;
          localStorage.setItem('dibi.content', JSON.stringify(j));
        }
        break;
      }
    } catch (e) {}
  }
  if (!CONTENT) throw new Error('no content');
}
const allPractices = () => CONTENT.blocks.flatMap(b => b.practices.map(p => ({ ...p, block: b })));
const findPractice = (id) => allPractices().find(p => p.id === id);
const pick = (arr, seed) => arr[seed % arr.length];
const daySeed = () => Math.floor(Date.now() / 86400000);

/* ---------- theme ---------- */
function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const bg = dark ? '#151210' : '#F7F2EA';
  document.querySelector('meta[name=theme-color]').content = bg;
  try { tg && tg.setHeaderColor && tg.setHeaderColor(bg); tg && tg.setBackgroundColor && tg.setBackgroundColor(bg); } catch (e) {}
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.theme === 'system' && applyTheme());

/* ---------- helpers ---------- */
let toastTimer;
let screenCleanup = null;
const SCALE_DEFS = [
  { key: 'awareness', title: 'Осознанность', hint: 'Замечаю, что со мной происходит', max: 120, tint: 'awareness', emoji: '✨' },
  { key: 'care', title: 'Забота о себе', hint: 'Выбираю мягкую поддержку', max: 80, tint: 'care', emoji: '💗' },
  { key: 'resilience', title: 'Устойчивость', hint: 'Держусь в волне и возвращаюсь', max: 100, tint: 'resilience', emoji: '🌿' },
  { key: 'sensory', title: 'Сенсорный баланс', hint: 'Слышу тело и среду', max: 60, tint: 'sensory', emoji: '🫧' }
];
const BADGES = {
  first_practice: { emoji: '💧', title: 'Первая капля', text: 'Сделана первая практика.' },
  alt_kind: { emoji: '🫶', title: 'Мягкий маршрут', text: 'Альтернатива тоже считается.' },
  streak3: { emoji: '🔥', title: 'Тихая серия', text: 'Три дня подряд с практиками.' },
  first_master: { emoji: '🏅', title: 'Умею', text: 'Отмечен первый освоенный навык.' },
  jump200: { emoji: '⭐', title: 'Высокий прыжок', text: 'В игре набрано 200+ очков.' },
  scales2: { emoji: '🌈', title: 'Баланс в сборе', text: 'Две шкалы перевалили за 70%.' }
};

function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

function confetti() {
  const box = el('div', { class: 'confetti' });
  const colors = ['#CCC3D1', '#C1BC77', '#AFB8CD', '#D8A4AF', '#F7DDD5', '#8D8B4C'];
  for (let i = 0; i < 18; i++) {
    const s = el('i');
    s.style.left = (20 + Math.random() * 60) + 'vw';
    s.style.top = (35 + Math.random() * 35) + 'vh';
    s.style.background = pick(colors, i + Math.floor(Math.random() * 6));
    s.style.animationDelay = (Math.random() * .25) + 's';
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1500);
}

function sheet(build) {
  const root = $('#sheet-root');
  root.innerHTML = '';
  const veil = el('div', { class: 'sheet-veil' });
  const sh = el('div', { class: 'sheet' }, el('div', { class: 'grab' }));
  root.append(veil, sh);
  const close = () => { veil.classList.remove('on'); sh.classList.remove('on'); setTimeout(() => root.innerHTML = '', 320); };
  veil.addEventListener('click', close);
  build(sh, close);
  requestAnimationFrame(() => { veil.classList.add('on'); sh.classList.add('on'); });
  return close;
}

function mascot(pose, line, sub) {
  return el('div', { class: 'mascot-wrap' },
    el('img', { class: 'mascot', src: `assets/mascot/${pose}.png`, alt: 'Дибитишка' }),
    el('div', { class: 'bubble' }, line, sub ? el('small', {}, sub) : null)
  );
}

const mline = (key) => pick(CONTENT.meta.mascot_lines[key] || ['…'], daySeed() + key.length);
function ring(pct, size = 48) {
  const r = 18, c = 2 * Math.PI * r;
  const w = el('div', { class: 'ring' });
  w.style.width = w.style.height = size + 'px';
  w.innerHTML = `<svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="4"/><circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="4" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg><b>${Math.round(pct * 100)}</b>`;
  return w;
}

function streakCount() {
  let n = 0;
  const d = new Date();
  if (!(state.done[todayKey(d)] || []).length) d.setDate(d.getDate() - 1);
  while ((state.done[todayKey(d)] || []).length) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const totalDoneCount = () => Object.values(state.done).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
const masteredCount = () => Object.values(state.mastered).filter(Boolean).length;
const levelInfo = () => {
  const need = 120;
  const points = state.game.total_points || 0;
  const level = Math.floor(points / need) + 1;
  const inLevel = points % need;
  return { level, need, points, inLevel, pct: inLevel / need };
};
const scaleDef = (key) => SCALE_DEFS.find(s => s.key === key);
const scalePct = (key) => {
  const def = scaleDef(key);
  return def ? Math.min(1, (state.game.scales[key] || 0) / def.max) : 0;
};

function gainScale(key, amount) {
  const def = scaleDef(key);
  if (!def || !amount) return 0;
  const cur = state.game.scales[key] || 0;
  const next = Math.min(def.max, cur + amount);
  state.game.scales[key] = next;
  return next - cur;
}

function unlockBadge(id, announce = true) {
  if (state.game.badges[id]) return false;
  state.game.badges[id] = Date.now();
  save();
  if (announce && BADGES[id]) {
    confetti();
    toast(`Новый значок: ${BADGES[id].title}`);
  }
  return true;
}

function reviewBadges(announce = false) {
  if (totalDoneCount() >= 1) unlockBadge('first_practice', announce);
  if ((state.game.alt_count || 0) >= 1) unlockBadge('alt_kind', announce);
  if (streakCount() >= 3) unlockBadge('streak3', announce);
  if (masteredCount() >= 1) unlockBadge('first_master', announce);
  if ((state.game.best_jump || 0) >= 200) unlockBadge('jump200', announce);
  if (SCALE_DEFS.filter(s => scalePct(s.key) >= .7).length >= 2) unlockBadge('scales2', announce);
}

function rewardPractice(p, isAlt) {
  const baseRewards = {
    base: { care: 12, resilience: 4, points: 14 },
    mind: { awareness: 14, points: 16 },
    stress: { resilience: 14, points: 16 },
    emo: { awareness: 8, resilience: 8, points: 16 },
    sense: { sensory: 14, care: 6, points: 15 }
  };
  const mult = isAlt ? .6 : 1;
  const reward = baseRewards[p.block.id] || { awareness: 8, points: 12 };
  const gained = [];
  for (const def of SCALE_DEFS) {
    const raw = reward[def.key] ? Math.round(reward[def.key] * mult) : 0;
    const actual = gainScale(def.key, raw);
    if (actual > 0) gained.push(`${def.emoji} +${actual} ${def.title.toLowerCase()}`);
  }
  const pts = Math.round((reward.points || 10) * mult);
  state.game.total_points += pts;
  if (isAlt) state.game.alt_count = (state.game.alt_count || 0) + 1;
  save();
  reviewBadges(true);
  return { gained, pts };
}

function rewardMastery(p) {
  const map = {
    base: { care: 10, awareness: 4, points: 18 },
    mind: { awareness: 12, points: 18 },
    stress: { resilience: 12, points: 18 },
    emo: { awareness: 8, resilience: 8, points: 18 },
    sense: { sensory: 10, care: 6, points: 18 }
  };
  const reward = map[p.block.id] || { awareness: 8, points: 18 };
  for (const def of SCALE_DEFS) gainScale(def.key, reward[def.key] || 0);
  state.game.total_points += reward.points || 18;
  save();
  reviewBadges(true);
}

function rewardRun(summary) {
  state.game.plays = (state.game.plays || 0) + 1;
  state.game.last_jump = summary.score;
  state.game.best_jump = Math.max(state.game.best_jump || 0, summary.score);
  state.game.total_points += summary.score + summary.collect.awareness * 6 + summary.collect.care * 6 + summary.collect.resilience * 6 + summary.collect.sensory * 6;
  gainScale('awareness', summary.collect.awareness * 4);
  gainScale('care', summary.collect.care * 4);
  gainScale('resilience', summary.collect.resilience * 4);
  gainScale('sensory', summary.collect.sensory * 4);
  save();
  reviewBadges(true);
}

function statPill(emoji, value, label) {
  return el('div', { class: 'streak' }, emoji, el('b', {}, String(value)), label);
}

function heroPoster({ greet, dateStr }) {
  const lvl = levelInfo();
  return el('section', { class: 'poster hero-poster' },
    el('i', { class: 'poster-bubble b1' }),
    el('i', { class: 'poster-bubble b2' }),
    el('div', { class: 'poster-copy' },
      el('div', { class: 'eyebrow' }, greet),
      el('div', { class: 'brand-script big' }, 'Дибитишка'),
      el('h2', { class: 'poster-title' }, 'Большие чувства. Маленькие шаги.'),
      el('p', { class: 'poster-text' }, dateStr),
      el('div', { class: 'poster-stats' },
        statPill('🔥', streakCount(), streakCount() === 1 ? 'День подряд' : 'Дня подряд'),
        statPill('✨', lvl.points, 'Очков роста'),
        statPill('🫧', lvl.level, 'Уровень'))
    ),
    el('img', { class: 'poster-mascot', src: 'assets/mascot/hello.png', alt: 'Дибитишка' })
  );
}

function scaleBoard(title = 'Шкалы роста') {
  const wrap = el('div');
  wrap.append(el('div', { class: 'sect' }, title));
  const board = el('div', { class: 'scale-board' });
  for (const def of SCALE_DEFS) {
    const val = state.game.scales[def.key] || 0;
    const pct = scalePct(def.key) * 100;
    board.append(el('div', { class: `scale-card ${def.tint}` },
      el('div', { class: 'top' },
        el('div', {}, el('b', {}, `${def.emoji} ${def.title}`), el('span', {}, def.hint)),
        el('b', {}, `${val}/${def.max}`)
      ),
      el('div', { class: 'scale-track' }, el('i', { class: 'scale-fill', style: `width:${pct}%` })),
      el('div', { class: 'scale-meta' },
        el('span', {}, pct >= 100 ? 'Шкала заполнена' : 'Растёт от практик и игры'),
        el('b', {}, `${Math.round(pct)}%`)
      )
    ));
  }
  wrap.append(board);
  return wrap;
}

function badgeBoard() {
  const wrap = el('div');
  wrap.append(el('div', { class: 'sect' }, 'Коллекция значков'));
  const grid = el('div', { class: 'badge-grid' });
  for (const [id, meta] of Object.entries(BADGES)) {
    const on = !!state.game.badges[id];
    grid.append(el('div', { class: 'badge-card' + (on ? '' : ' locked') },
      el('div', { class: 'emoji' }, meta.emoji),
      el('b', {}, meta.title),
      el('span', {}, on ? meta.text : 'Ещё не открыт')
    ));
  }
  wrap.append(grid);
  return wrap;
}

function levelCard() {
  const lvl = levelInfo();
  return el('div', { class: 'level-card' },
    el('div', { class: 'level-orb' }, el('b', {}, String(lvl.level))),
    el('div', { class: 'level-copy' },
      el('div', { class: 'brand-script' }, 'Уровень Дибитишки'),
      el('p', {}, `До следующего уровня осталось ${lvl.need - lvl.inLevel || lvl.need} очков. Лучший прыжок: ${state.game.best_jump || 0}.`),
      el('div', { class: 'level-track' }, el('i', { style: `width:${lvl.pct * 100}%` }))
    )
  );
}

/* ---------- tabbar ---------- */
const TABS = [
  { id: 'today', label: 'Сегодня', icon: 'today', route: '' },
  { id: 'skills', label: 'Навыки', icon: 'skills', route: 'skills' },
  { id: 'game', label: 'Игра', icon: 'play', route: 'game' },
  { id: 'workbook', label: 'Тетрадь', icon: 'workbook', route: 'workbook' },
  { id: 'profile', label: 'Профиль', icon: 'profile', route: 'profile' }
];
function renderTabbar(active) {
  const bar = $('#tabbar');
  if (!active) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = '';
  for (const t of TABS) {
    bar.append(el('button', { class: t.id === active ? 'on' : '', onclick: () => go(t.route) }, icon(t.icon), el('span', {}, t.label)));
  }
}

/* ---------- router ---------- */
const go = (route) => { location.hash = route ? '#/' + route : '#/'; };
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  return { a: a || '', b: b || '' };
}

/* ---------- screens ---------- */
function screenWelcome() {
  renderTabbar(null);
  const slides = [
    ['hello', 'Привет! Я Дибитишка', 'Я живу рядом, когда чувств слишком много. Будем собирать опору маленькими шагами — без стыда и гонки.'],
    ['calm', 'Навыки, игра и шкалы роста', 'Внутри — пять блоков практик, мягкие альтернативы, очки осознанности и мини-игра с прыжками за капельками.'],
    ['proud', 'Медленно — тоже вперёд', 'Я отмечаю прогресс бережно: за практики, честность с собой и даже за моменты, когда выбираешь путь помягче.']
  ];
  let i = 0;
  const scr = el('div', { class: 'screen' });
  const poster = el('section', { class: 'poster hero-poster' });
  const copy = el('div', { class: 'poster-copy wide' });
  const eyebrow = el('div', { class: 'eyebrow' });
  const brand = el('div', { class: 'brand-script big' }, 'Дибитишка');
  const title = el('h1', { class: 'poster-title' });
  const text = el('p', { class: 'poster-text' });
  const img = el('img', { class: 'poster-mascot', src: 'assets/mascot/hello.png', alt: 'Дибитишка' });
  const dots = el('div', { class: 'chips', style: 'justify-content:center' });
  const btn = el('button', { class: 'btn' });
  copy.append(eyebrow, brand, title, text);
  poster.append(el('i', { class: 'poster-bubble b1' }), el('i', { class: 'poster-bubble b2' }), copy, img);
  const draw = () => {
    img.src = `assets/mascot/${slides[i][0]}.png`;
    eyebrow.textContent = i === 0 ? 'Маленький спутник спокойствия' : i === 1 ? 'Новая версия — крупнее и мягче' : 'Без давления и оценки';
    title.textContent = slides[i][1];
    text.textContent = slides[i][2];
    dots.innerHTML = '';
    slides.forEach((_, k) => dots.append(el('button', { class: 'chip' + (k === i ? ' on' : ''), style: 'padding:5px 12px', onclick: () => { i = k; draw(); } }, '•')));
    btn.textContent = i < slides.length - 1 ? 'Дальше' : 'Начать бесплатную неделю';
  };
  btn.onclick = () => {
    haptic('medium');
    if (i < slides.length - 1) { i++; draw(); return; }
    state.onboarded = true;
    if (!state.trial_started_at) state.trial_started_at = Date.now();
    save();
    go('');
  };
  draw();
  scr.append(poster, dots, el('div', { style: 'height:16px' }), btn,
    el('p', { class: 'foot' }, `Первая неделя бесплатно, потом ${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'}.`, el('br'), 'app by @stonym0ntana'));
  return scr;
}

function paywallCard(scr) {
  const c = el('div', { class: 'card soft' });
  c.append(
    mascot('hug', mline('paywall')),
    el('h3', { style: 'margin-top:12px' }, 'Подписка Дибитишки'),
    el('p', {}, `${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'} · первая неделя бесплатно. Оплата идёт через Tribute прямо из бота.`),
    el('button', { class: 'btn', style: 'margin-top:10px', onclick: openPay }, 'Оформить подписку')
  );
  scr.append(c);
}

function openPay() {
  haptic('medium');
  const u = CFG.bot_username ? `https://t.me/${CFG.bot_username}?start=pay` : 'https://t.me/';
  sheet((sh, close) => {
    sh.append(
      mascot('hug', 'Оплата живёт в боте: он создаст ссылку Tribute и сам активирует подписку.'),
      el('p', {}, `${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'}. Первая неделя — бесплатно, она уже идёт с момента первого входа.`),
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => { try { tg && tg.openTelegramLink ? tg.openTelegramLink(u) : window.open(u); } catch (e) { window.open(u); } close(); } }, 'Оплатить в Telegram'),
      el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { close(); toast('Напиши боту /start, если подписка уже есть.'); } }, 'У меня уже есть подписка')
    );
  });
}

function screenToday() {
  renderTabbar('today');
  const scr = el('div', { class: 'screen' });
  const d = new Date();
  const dateStr = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const prettyDate = dateStr[0].toUpperCase() + dateStr.slice(1);
  const hour = d.getHours();
  const greet = hour < 5 ? 'Тихая ночь' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  scr.append(heroPoster({ greet, dateStr: prettyDate }));
  scr.append(levelCard());
  scr.append(scaleBoard());
  scr.append(mascot(hour < 12 ? 'hello' : 'calm', hour < 12 ? mline('morning') : mline('evening'), 'Дибитишка рядом'));

  const gameTeaser = el('div', { class: 'card poster-mini soft' },
    el('div', { class: 'poster-copy wide' },
      el('p', { class: 'cap' }, 'Мини-игра'),
      el('h3', {}, 'Прыжок за очками осознанности'),
      el('p', {}, 'Лови капли осознанности, заботы, устойчивости и сенсорного баланса. Лучший результат тоже идёт в прогресс.'),
      el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => go('game') }, 'Играть сейчас')
    ),
    el('img', { class: 'poster-mascot', src: 'assets/mascot/proud.png', alt: 'Дибитишка' })
  );
  scr.append(gameTeaser);

  if (!isPremium()) { paywallCard(scr); return scr; }

  const all = allPractices();
  const todays = pick(all, daySeed());
  const mini = findPractice(pick(CONTENT.minis, daySeed() + 3));
  const doneToday = (state.done[todayKey()] || []).includes(todays.id);

  const card = el('div', { class: `card tinted soft t-${todays.block.tint}` });
  card.append(
    el('p', { class: 'cap' }, `Практика дня · блок «${todays.block.title}»`),
    el('h3', {}, todays.title),
    el('p', {}, todays.why.slice(0, 126) + '…'),
    el('p', { class: 'mins' }, `≈ ${todays.minutes} мин ${doneToday ? '· уже отмечено сегодня' : ''}`),
    el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => go('p/' + todays.id) }, doneToday ? 'Пройти ещё раз' : 'Начать')
  );
  scr.append(el('div', { class: 'sect' }, 'Сегодняшний фокус'), card);

  scr.append(el('div', { class: 'sect' }, 'Быстрая практика'));
  scr.append(el('div', { class: 'group' }, el('button', { class: 'row', onclick: () => go('p/' + mini.id) },
    el('span', { class: 'ric c-sky' }, icon('drop')),
    el('span', { class: 'rmain' }, el('b', {}, mini.title), el('span', {}, '1–4 минуты, можно прямо сейчас')),
    el('span', { class: 'chev' }, '›')
  )));

  scr.append(el('div', { class: 'sect' }, 'Как я сейчас'));
  const moods = ['Тяжело', 'Тревожно', 'Ровно', 'Тепло', 'Радостно'];
  const mrow = el('div', { class: 'chips' });
  const cur = state.mood[todayKey()];
  moods.forEach((m, k) => mrow.append(el('button', {
    class: 'chip' + (cur === k ? ' on' : ''), onclick: () => {
      const moodKey = todayKey();
      const firstCheckInToday = state.mood[moodKey] === undefined;
      state.mood[moodKey] = k;
      if (firstCheckInToday) {
        if (k >= 2) gainScale('awareness', 1); else gainScale('care', 1);
      }
      save();
      haptic('light');
      toast(k === 0 ? 'Я рядом. Будь к себе понежнее.' : 'Спасибо за честность. Отмечено.');
      render();
    }
  }, m)));
  scr.append(mrow);
  scr.append(el('p', { class: 'foot' }, CONTENT.meta.credits));
  return scr;
}

function screenSkills() {
  renderTabbar('skills');
  const scr = el('div', { class: 'screen' });
  scr.append(el('h1', { class: 'ltitle' }, 'Навыки', el('small', {}, 'Пять блоков · проходи в своём порядке')));
  scr.append(mascot('peek', 'Выбирай любой блок. Можно идти медленно, перепрыгивать и возвращаться.'));
  for (const b of CONTENT.blocks) {
    const total = b.practices.length;
    const master = b.practices.filter(p => state.mastered[p.id]).length;
    const card = el('div', { class: `card tinted soft t-${b.tint}`, onclick: () => go('skills/' + b.id), style: 'cursor:pointer' });
    const top = el('div', { style: 'display:flex;align-items:center;gap:14px' });
    const ic = el('span', { class: 'ric c-' + b.tint, style: 'width:44px;height:44px;border-radius:14px;color:' + (b.tint === 'peony' ? '#6B403B' : '#fff') }, icon(b.icon));
    top.append(ic, el('div', { style: 'flex:1' }, el('h3', { style: 'margin:0' }, b.title), el('p', { style: 'margin:4px 0 0' }, b.subtitle)), ring(total ? master / total : 0));
    card.append(top, el('p', { style: 'margin:12px 0 0' }, master ? `Освоено ${master} из ${total}` : `${total} практик · начни с любой`));
    scr.append(card);
  }
  return scr;
}

function screenBlock(id) {
  renderTabbar('skills');
  const b = CONTENT.blocks.find(x => x.id === id);
  const scr = el('div', { class: 'screen sub' });
  if (!b) return scr;
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => go('skills') }, icon('back'), 'Назад'),
    el('h2', {}, b.title)
  ));
  scr.append(el('p', { class: 'subtitle' }, b.intro));
  const g = el('div', { class: 'group' });
  for (const p of b.practices) {
    const master = state.mastered[p.id];
    const done = (state.done[todayKey()] || []).includes(p.id);
    const ever = Object.entries(state.done).some(([, v]) => Array.isArray(v) && v.includes(p.id));
    const stat = master ? ['master', '✓'] : done ? ['done', '•'] : ever ? ['done', '·'] : ['new', ''];
    g.append(el('button', { class: 'row', onclick: () => go('p/' + p.id) },
      el('span', { class: 'pstat ' + stat[0] }, stat[1]),
      el('span', { class: 'rmain' }, el('b', {}, p.title), el('span', {}, master ? p.master : `≈ ${p.minutes} мин`)),
      el('span', { class: 'chev' }, '›')
    ));
  }
  scr.append(g);
  return scr;
}

function screenPractice(id) {
  renderTabbar(null);
  const p = findPractice(id);
  const scr = el('div', { class: 'screen sub' });
  if (!p) return scr;
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => history.length > 1 ? history.back() : go('skills') }, icon('back'), 'Назад'),
    el('h2', {}, p.block.title)
  ));

  const master = state.mastered[p.id];
  const done = (state.done[todayKey()] || []).includes(p.id);
  scr.append(mascot(master ? 'proud' : done ? 'calm' : 'hello', master ? mline('mastered') : done ? mline('done') : p.why, master ? p.master : null));

  scr.append(el('div', { class: 'sect' }, 'Как делать'));
  scr.append(el('ol', { class: 'steps' }, p.steps.map(s => el('li', {}, s))));
  scr.append(el('p', { class: 'mins' }, `≈ ${p.minutes} мин · за практику даются очки и рост шкал`));

  const altBox = el('div', { class: 'hidden' });
  const altCard = el('div', { class: 'card tinted soft t-sky' });
  altCard.append(
    el('p', { class: 'cap' }, 'Альтернатива помягче'),
    el('h3', {}, p.alt.title),
    el('ol', { class: 'steps' }, p.alt.steps.map(s => el('li', {}, s))),
    el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { markDone(p, true); } }, 'Отметить альтернативу')
  );
  altBox.append(altCard);

  scr.append(el('button', {
    class: 'btn ghost',
    onclick: (e) => {
      haptic('light');
      altBox.classList.toggle('hidden');
      e.target.textContent = altBox.classList.contains('hidden') ? 'Не могу сейчас — показать альтернативу' : 'Скрыть альтернативу';
    }
  }, 'Не могу сейчас — показать альтернативу'));
  scr.append(altBox);

  const btnDone = el('button', { class: 'btn', onclick: () => markDone(p, false) }, done ? 'Сегодня уже отмечено' : 'Сделано');
  const btnMaster = el('button', {
    class: 'btn ' + (master ? 'warm' : 'secondary'),
    onclick: () => {
      const turningOn = !state.mastered[p.id];
      state.mastered[p.id] = turningOn;
      save();
      haptic('success');
      if (turningOn) {
        rewardMastery(p);
        confetti();
        toast('Навык отмечен как «Я умею».');
      } else {
        toast('Отметку можно вернуть в любой момент.');
      }
      render();
    }
  }, master ? '✓ Я умею это' : 'Отметить «Я умею»');
  scr.append(el('div', { class: 'btnrow' }, btnDone, btnMaster));
  scr.append(el('p', { class: 'foot' }, 'Навык можно снять в любой момент: это не экзамен, а живая практика.'));
  return scr;
}

function markDone(p, isAlt) {
  const k = todayKey();
  state.done[k] = state.done[k] || [];
  const already = state.done[k].includes(p.id);
  if (!already) state.done[k].push(p.id);
  save();
  haptic(already ? 'light' : 'success');
  if (!already) {
    const reward = rewardPractice(p, isAlt);
    confetti();
    toast(isAlt ? `Альтернатива засчитана. +${reward.pts} очков.` : `Готово! +${reward.pts} очков роста.`);
  } else {
    toast('Сегодня эта практика уже засчитана. Повторить можно без потери тепла к себе 💧');
  }
  render();
}

function screenGame() {
  renderTabbar('game');
  const scr = el('div', { class: 'screen' });
  scr.append(el('h1', { class: 'ltitle' }, 'Мини-игра', el('small', {}, 'Doodle Jump, но с Дибитишкой и очками осознанности')));
  scr.append(mascot('proud', 'Прыгай выше, собирай капли и наполняй свои шкалы роста.', 'Очки из игры тоже идут в прогресс'));

  const summary = el('div', { class: 'game-summary' },
    el('div', { class: 'stat-pill' }, el('i', {}, '⭐'), el('b', {}, String(state.game.best_jump || 0)), el('span', {}, 'Лучший счёт')),
    el('div', { class: 'stat-pill' }, el('i', {}, '🕹️'), el('b', {}, String(state.game.plays || 0)), el('span', {}, 'Игр сыграно'))
  );

  const shell = el('div', { class: 'game-shell' });
  const stage = el('div', { class: 'game-stage' });
  const canvas = el('canvas', { class: 'game-canvas' });
  const hudScore = el('div', { class: 'game-chip' }, '⭐ ', el('strong', {}, '0'));
  const hudTokens = el('div', { class: 'game-chip' }, '🫧 ', el('strong', {}, '0'));
  const hud = el('div', { class: 'game-hud' }, hudScore, hudTokens);
  const overlay = el('div', { class: 'game-overlay' },
    el('h3', {}, 'Готов(а) к прыжку?'),
    el('p', {}, 'Держи палец слева или справа. На клавиатуре тоже работают стрелки. Собирай цветные капли: каждая пополняет свою шкалу.'),
    el('button', { class: 'btn', id: 'game-start-btn' }, 'Старт')
  );
  stage.append(canvas, hud, overlay);

  const legend = el('div', { class: 'game-legend' },
    el('div', { class: 'legend-pill' }, el('span', { class: 'legend-dot awareness' }), el('div', {}, el('b', {}, 'Осознанность'), 'Лавандовые капли')),
    el('div', { class: 'legend-pill' }, el('span', { class: 'legend-dot care' }), el('div', {}, el('b', {}, 'Забота'), 'Розовые капли')),
    el('div', { class: 'legend-pill' }, el('span', { class: 'legend-dot resilience' }), el('div', {}, el('b', {}, 'Устойчивость'), 'Оливковые капли')),
    el('div', { class: 'legend-pill' }, el('span', { class: 'legend-dot sensory' }), el('div', {}, el('b', {}, 'Сенсорика'), 'Голубые капли'))
  );

  const controls = el('div', { class: 'game-controls' });
  const left = el('button', { class: 'ctrl' }, icon('back'), 'Лево');
  const right = el('button', { class: 'ctrl' }, 'Право', icon('back', '')); right.lastChild.style.transform = 'rotate(180deg)';
  controls.append(left, right);

  shell.append(stage, legend, controls, summary);
  scr.append(shell);

  const cleanup = mountJumpGame({ canvas, overlay, hudScore, hudTokens, left, right, summary });
  screenCleanup = cleanup;
  return scr;
}

function mountJumpGame({ canvas, overlay, hudScore, hudTokens, left, right, summary }) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scoreEl = $('strong', hudScore);
  const tokenEl = $('strong', hudTokens);
  let raf = 0;
  let running = false;
  let score = 0;
  let totalTokens = 0;
  let rewarded = false;
  let move = 0;
  let touchLeft = false;
  let touchRight = false;
  let size = { w: 360, h: 560 };
  let player, platforms, items, clouds;
  let worldTop = 0;
  let lastTs = 0;
  let collect = { awareness: 0, care: 0, resilience: 0, sensory: 0 };

  const itemColors = {
    awareness: '#B7A8D6',
    care: '#D8A4AF',
    resilience: '#8D8B4C',
    sensory: '#89AEE6'
  };
  const itemKeys = Object.keys(itemColors);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    size.w = Math.max(300, Math.round(rect.width || canvas.parentElement.clientWidth || 360));
    size.h = Math.max(520, Math.round(rect.height || Math.min(window.innerHeight * .74, 600)));
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function newPlatform(y) {
    const w = 84 + Math.random() * 26;
    const x = 18 + Math.random() * (size.w - w - 36);
    const hasItem = Math.random() < .65;
    if (hasItem) {
      const key = itemKeys[Math.floor(Math.random() * itemKeys.length)];
      items.push({ x: x + w / 2, y: y - 24, r: 11, key, got: false });
    }
    return { x, y, w, h: 12 };
  }

  function resetGame() {
    resize();
    rewarded = false;
    score = 0;
    totalTokens = 0;
    worldTop = 0;
    lastTs = 0;
    collect = { awareness: 0, care: 0, resilience: 0, sensory: 0 };
    player = { x: size.w / 2 - 24, y: size.h - 118, w: 48, h: 62, vx: 0, vy: -10 };
    items = [];
    platforms = [];
    clouds = Array.from({ length: 7 }, (_, i) => ({ x: Math.random() * size.w, y: Math.random() * size.h * .55, r: 20 + Math.random() * 24, s: .2 + Math.random() * .3, o: .16 + Math.random() * .18 }));
    for (let i = 0; i < 11; i++) platforms.push(newPlatform(size.h - 40 - i * 68));
    overlay.innerHTML = '';
    overlay.append(
      el('h3', {}, 'Прыжок пошёл!'),
      el('p', {}, 'Лови капли и не падай вниз. Очки полетят в шкалы после приземления.'),
      el('button', { class: 'btn secondary', onclick: stopRun }, 'Остановить игру')
    );
    running = true;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function stopRun() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    finishRun();
  }

  function setMoveFromTouches() {
    move = touchLeft && !touchRight ? -1 : touchRight && !touchLeft ? 1 : 0;
  }

  function bindPress(node, dir) {
    const onDown = (e) => { e.preventDefault(); if (dir < 0) touchLeft = true; else touchRight = true; setMoveFromTouches(); };
    const onUp = (e) => { e.preventDefault(); if (dir < 0) touchLeft = false; else touchRight = false; setMoveFromTouches(); };
    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
    node.addEventListener('pointerleave', onUp);
    return () => {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      node.removeEventListener('pointerleave', onUp);
    };
  }

  function onKey(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') move = -1;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') move = 1;
  }
  function onKeyUp(e) {
    if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(e.key)) move = 0;
  }

  function update(dt) {
    player.vx += (move * 6.6 - player.vx) * Math.min(1, dt * 8);
    player.x += player.vx * dt * 60;
    player.vy += 0.36 * dt * 60;
    const prevY = player.y;
    player.y += player.vy * dt * 60;

    if (player.x > size.w + 24) player.x = -player.w;
    if (player.x < -player.w - 24) player.x = size.w + 12;

    for (const p of platforms) {
      const falling = player.vy > 0;
      const hitX = player.x + player.w > p.x && player.x < p.x + p.w;
      const prevBottom = prevY + player.h;
      const curBottom = player.y + player.h;
      if (falling && hitX && prevBottom <= p.y && curBottom >= p.y) {
        player.vy = -9.4;
        haptic('light');
      }
    }

    for (const it of items) {
      if (it.got) continue;
      const cx = player.x + player.w / 2;
      const cy = player.y + player.h / 2;
      const dx = cx - it.x;
      const dy = cy - it.y;
      if (Math.hypot(dx, dy) < 28) {
        it.got = true;
        collect[it.key] += 1;
        totalTokens += 1;
        score += 14;
        haptic('success');
      }
    }

    const ceiling = size.h * .33;
    if (player.y < ceiling) {
      const diff = ceiling - player.y;
      player.y = ceiling;
      worldTop += diff;
      score += Math.round(diff * .12);
      platforms.forEach(p => p.y += diff);
      items.forEach(it => it.y += diff);
      clouds.forEach(c => { c.y += diff * c.s * .15; if (c.y > size.h * .56) c.y = -40; });
    }

    platforms = platforms.filter(p => p.y < size.h + 40);
    items = items.filter(it => !it.got && it.y < size.h + 30);

    while (platforms.length < 12) {
      const top = platforms.reduce((m, p) => Math.min(m, p.y), size.h);
      platforms.push(newPlatform(top - (56 + Math.random() * 34)));
    }

    if (player.y > size.h + 70) {
      running = false;
      finishRun();
    }

    scoreEl.textContent = String(score);
    tokenEl.textContent = String(totalTokens);
  }

  function drawCloud(c) {
    ctx.fillStyle = `rgba(255,255,255,${c.o})`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x - c.r * .3, c.y - c.r * .35, c.r * .22, 0, Math.PI * 1.4);
    ctx.stroke();
  }

  function drawPlayer() {
    const x = player.x, y = player.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = 'rgba(55,90,160,.18)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#8FC0FF';
    ctx.beginPath();
    ctx.moveTo(player.w / 2, 0);
    ctx.bezierCurveTo(player.w * .92, player.h * .16, player.w, player.h * .46, player.w, player.h * .62);
    ctx.bezierCurveTo(player.w, player.h * .88, player.w * .8, player.h, player.w / 2, player.h);
    ctx.bezierCurveTo(player.w * .2, player.h, 0, player.h * .88, 0, player.h * .62);
    ctx.bezierCurveTo(0, player.h * .46, player.w * .08, player.h * .16, player.w / 2, 0);
    ctx.fill();

    const g = ctx.createLinearGradient(0, 0, player.w, player.h);
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,.08)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(player.w / 2, 4);
    ctx.bezierCurveTo(player.w * .85, player.h * .2, player.w * .92, player.h * .5, player.w * .84, player.h * .72);
    ctx.bezierCurveTo(player.w * .73, player.h * .95, player.w * .26, player.h * .95, player.w * .14, player.h * .72);
    ctx.bezierCurveTo(player.w * .07, player.h * .5, player.w * .15, player.h * .2, player.w / 2, 4);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(player.w / 2, player.h * .62, player.w * .29, player.h * .23, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#161616';
    ctx.beginPath(); ctx.arc(player.w * .4, player.h * .58, 4.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(player.w * .6, player.h * .58, 4.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(player.w * .385, player.h * .565, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(player.w * .585, player.h * .565, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#292929';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.w / 2, player.h * .67, 6, .15 * Math.PI, .85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(237,173,190,.9)';
    ctx.beginPath(); ctx.arc(player.w * .28, player.h * .67, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(player.w * .72, player.h * .67, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawItem(it) {
    const color = itemColors[it.key];
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, it.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.arc(-3, -3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawPlatform(p) {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = 'rgba(34,34,34,.12)';
    ctx.lineWidth = 1.2;
    const r = 9;
    ctx.beginPath();
    ctx.moveTo(p.x + r, p.y);
    ctx.lineTo(p.x + p.w - r, p.y);
    ctx.quadraticCurveTo(p.x + p.w, p.y, p.x + p.w, p.y + r);
    ctx.lineTo(p.x + p.w, p.y + p.h - r);
    ctx.quadraticCurveTo(p.x + p.w, p.y + p.h, p.x + p.w - r, p.y + p.h);
    ctx.lineTo(p.x + r, p.y + p.h);
    ctx.quadraticCurveTo(p.x, p.y + p.h, p.x, p.y + p.h - r);
    ctx.lineTo(p.x, p.y + r);
    ctx.quadraticCurveTo(p.x, p.y, p.x + r, p.y);
    ctx.fill();
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, size.w, size.h);
    const bg = ctx.createLinearGradient(0, 0, 0, size.h);
    bg.addColorStop(0, '#B9DAFF');
    bg.addColorStop(.54, '#6EB0FF');
    bg.addColorStop(.55, '#EFF7FF');
    bg.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.w, size.h);

    clouds.forEach(drawCloud);
    platforms.forEach(drawPlatform);
    items.forEach(drawItem);
    drawPlayer();
  }

  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(.024, (ts - lastTs) / 1000);
    lastTs = ts;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function finishRun() {
    cancelAnimationFrame(raf);
    if (!rewarded) {
      rewarded = true;
      rewardRun({ score, collect });
      summary.innerHTML = '';
      summary.append(
        el('div', { class: 'stat-pill' }, el('i', {}, '⭐'), el('b', {}, String(state.game.best_jump || 0)), el('span', {}, 'Лучший счёт')),
        el('div', { class: 'stat-pill' }, el('i', {}, '✨'), el('b', {}, String(state.game.total_points || 0)), el('span', {}, 'Очков всего'))
      );
    }
    overlay.innerHTML = '';
    overlay.append(
      el('h3', {}, 'Раунд завершён'),
      el('p', {}, `Счёт: ${score}. Собрано капель: ${totalTokens}. В прогресс пошли все очки и цвета, которые ты поймал(а).`),
      el('button', { class: 'btn', onclick: () => { haptic('medium'); resetGame(); } }, 'Ещё раз'),
      el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => go('today') }, 'Вернуться на главную')
    );
    awaitingRestart = true;
  }

  const unbindLeft = bindPress(left, -1);
  const unbindRight = bindPress(right, 1);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', resize);
  $('#game-start-btn', overlay)?.addEventListener('click', () => { haptic('medium'); resetGame(); });
  resize();
  draw();

  return () => {
    running = false;
    awaitingRestart = false;
    cancelAnimationFrame(raf);
    unbindLeft();
    unbindRight();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', resize);
  };
}

function screenWorkbook() {
  renderTabbar('workbook');
  const scr = el('div', { class: 'screen' });
  const w = CONTENT.workbook;
  scr.append(el('h1', { class: 'ltitle' }, 'Тетрадь', el('small', {}, w.subtitle)));
  scr.append(mascot('calm', mline('workbook')));
  scr.append(el('div', { class: 'card soft' },
    el('h3', {}, w.title),
    el('p', {}, w.intro),
    el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => location.href = 'workbook.html' }, icon('print'), 'Открыть и распечатать'),
    el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => go('merch') }, 'Печатная версия и мерч')
  ));
  scr.append(el('div', { class: 'sect' }, 'Что внутри'));
  scr.append(el('div', { class: 'group' }, CONTENT.blocks.map(b =>
    el('div', { class: 'row' },
      el('span', { class: 'ric c-' + b.tint, style: 'color:' + (b.tint === 'peony' ? '#6B403B' : '#fff') }, icon(b.icon)),
      el('span', { class: 'rmain' }, el('b', {}, b.title), el('span', {}, `${b.practices.length} практик · поля «Пиши здесь»`))
    ))
  ));
  return scr;
}

function screenMerch() {
  renderTabbar(null);
  const scr = el('div', { class: 'screen' });
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => go('workbook') }, icon('back'), 'Назад'),
    el('h2', {}, 'Мерч')
  ));
  scr.append(mascot('peek', mline('merch')));
  const grid = el('div', { class: 'mgrid' });
  const tints = ['t-lavender', 't-leaf', 't-sky', 't-peony'];
  CONTENT.merch.forEach((m, i) => {
    const noted = state.merch_notify.includes(m.id);
    const card = el('div', { class: 'mcard' });
    const ph = el('div', { class: 'ph ' + tints[i % 4] }, m.id === 'workbook_print' ? '📖' : m.id === 'tee' ? '👕' : m.id === 'shopper' ? '👜' : '✨');
    const notify = el('button', { class: 'btn ghost', style: 'min-height:36px;font-size:14px', onclick: () => {
      state.merch_notify = noted ? state.merch_notify.filter(x => x !== m.id) : [...state.merch_notify, m.id];
      save();
      haptic('light');
      toast(noted ? 'Убрано из списка ожидания.' : 'Сообщу, когда появится.');
      render();
    } }, noted ? '✓ Жду' : 'Сообщить мне');
    card.append(ph, el('div', { class: 'mb' }, el('b', {}, m.title), el('span', {}, m.note), el('div', { class: 'mp' }, m.price === 'скоро' ? 'Цена скоро' : m.price), notify));
    grid.append(card);
  });
  scr.append(grid);
  scr.append(el('p', { class: 'foot' }, 'Оплата мерча подключится вместе с Tribute API.'));
  return scr;
}

function screenProfile() {
  renderTabbar('profile');
  const scr = el('div', { class: 'screen' });
  scr.append(el('h1', { class: 'ltitle' }, 'Профиль', el('small', {}, 'Подписка, вход, напоминания и твой прогресс')));
  const name = TG_MODE ? (tg.initDataUnsafe.user.first_name + (tg.initDataUnsafe.user.last_name ? ' ' + tg.initDataUnsafe.user.last_name : '')) : state.web_user ? state.web_user.name : null;
  scr.append(mascot('hello', name ? `Привет, ${name}! Всё важное собрано здесь.` : 'Привет! Здесь живут твоя подписка, настройки и шкалы роста.', TG_MODE ? 'Вход через Telegram' : state.web_user ? 'Вход по коду из бота' : 'Гостевой режим'));
  scr.append(levelCard());
  scr.append(scaleBoard('Твой прогресс'));
  scr.append(badgeBoard());

  scr.append(el('div', { class: 'sect' }, 'Подписка'));
  const dl = trialDaysLeft();
  const subRows = [];
  subRows.push(el('div', { class: 'row' },
    el('span', { class: 'ric c-grass' }, icon('card')),
    el('span', { class: 'rmain' }, el('b', {}, (state.premium_until || 0) > Date.now() ? 'Подписка активна' : state.trial_started_at && dl > 0 ? `Бесплатная неделя: ещё ${dl} дн.` : 'Подписка не активна'), el('span', {}, `${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'} · Tribute`))
  ));
  if (!isPremium() || dl !== Infinity) subRows.push(el('button', { class: 'row', onclick: openPay },
    el('span', { class: 'ric c-rose' }, icon('lock')),
    el('span', { class: 'rmain' }, el('b', {}, isPremium() ? 'Продлить подписку' : 'Оформить подписку'), el('span', {}, 'Оплата в Telegram через Tribute')),
    el('span', { class: 'chev' }, '›')
  ));
  scr.append(el('div', { class: 'group' }, subRows));

  scr.append(el('div', { class: 'sect' }, 'Напоминания'));
  const remRow = el('button', { class: 'row', onclick: () => {
    state.reminders.on = !state.reminders.on;
    save();
    haptic('light');
    syncReminder();
    render();
  } },
    el('span', { class: 'ric c-sky' }, icon('bell')),
    el('span', { class: 'rmain' }, el('b', {}, 'Напоминание о практике'), el('span', {}, state.reminders.on ? `Ежедневно в ${state.reminders.time}` : 'Выключено')),
    el('span', { class: 'rval' }, state.reminders.on ? 'Вкл' : 'Выкл')
  );
  const times = el('div', { class: 'chips' });
  ['09:00', '12:00', '18:00', '21:00'].forEach(t => times.append(el('button', {
    class: 'chip' + (state.reminders.time === t ? ' on' : ''), onclick: () => { state.reminders.time = t; state.reminders.on = true; save(); syncReminder(); render(); }
  }, t)));
  scr.append(el('div', { class: 'group' }, remRow), times, el('p', { class: 'mins', style: 'margin:6px 4px' }, 'Пуши присылает бот в Telegram.'));

  scr.append(el('div', { class: 'sect' }, 'Оформление'));
  const themes = el('div', { class: 'chips' });
  [['system', 'Системная'], ['light', 'Светлая'], ['dark', 'Тёмная']].forEach(([k, l]) => themes.append(el('button', { class: 'chip' + (state.theme === k ? ' on' : ''), onclick: () => { state.theme = k; save(); applyTheme(); render(); } }, l)));
  scr.append(themes);

  scr.append(el('div', { class: 'sect' }, 'Связь и вход'));
  const rows = [];
  if (!TG_MODE) rows.push(el('button', { class: 'row', onclick: authSheet },
    el('span', { class: 'ric c-lavender', style: 'color:#4A3A55' }, icon('lock')),
    el('span', { class: 'rmain' }, el('b', {}, state.web_user ? `Вход выполнен: ${state.web_user.name}` : 'Войти по коду из бота'), el('span', {}, state.web_user ? 'Синхронизация включена' : 'Код придёт в Telegram')),
    el('span', { class: 'chev' }, '›')
  ));
  rows.push(el('button', { class: 'row', onclick: () => openLink(CFG.social?.telegram) },
    el('span', { class: 'ric c-sky' }, icon('send')),
    el('span', { class: 'rmain' }, el('b', {}, 'Телеграм-канал'), el('span', {}, CFG.social?.telegram || '')),
    el('span', { class: 'chev' }, '›')
  ));
  rows.push(el('button', { class: 'row', onclick: () => openLink('mailto:' + (CFG.social?.email || '')) },
    el('span', { class: 'ric c-peony', style: 'color:#6B403B' }, icon('mail')),
    el('span', { class: 'rmain' }, el('b', {}, 'Почта'), el('span', {}, CFG.social?.email || '')),
    el('span', { class: 'chev' }, '›')
  ));
  rows.push(el('button', { class: 'row', onclick: () => go('merch') },
    el('span', { class: 'ric c-rose' }, icon('merch')),
    el('span', { class: 'rmain' }, el('b', {}, 'Мерч и печатная версия'), el('span', {}, 'Футболка, шоппер, стикеры, тетрадь')),
    el('span', { class: 'chev' }, '›')
  ));
  scr.append(el('div', { class: 'group' }, rows));
  scr.append(el('p', { class: 'foot' }, 'Дибитишка · v1.1', el('br'), 'app by @stonym0ntana', el('br'), CONTENT.meta.credits));
  return scr;
}

function openLink(u) {
  if (!u) return;
  try { tg && tg.openTelegramLink && u.startsWith('https://t.me') ? tg.openTelegramLink(u) : window.open(u, '_blank'); } catch (e) { window.open(u, '_blank'); }
}

async function syncReminder() {
  if (!API_BASE) return;
  const uid = TG_MODE ? tg.initDataUnsafe.user.id : state.web_user?.id;
  if (!uid) return;
  try {
    await fetch(apiUrl('/me/reminder'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: uid, on: state.reminders.on, time: state.reminders.time })
    });
  } catch (e) {}
}

function authSheet() {
  sheet((sh, close) => {
    sh.append(
      el('h3', {}, 'Вход по коду'),
      el('p', {}, `Напиши боту @${CFG.bot_username || '…'} команду /code — он пришлёт одноразовый код. Введи его здесь, и веб-версия привяжется к твоему Telegram.`),
      el('input', { class: 'code-input', id: 'code-in', placeholder: '······', maxlength: 6, inputmode: 'numeric' }),
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: async () => {
        const code = ($('#code-in').value || '').trim();
        if (code.length < 4) return toast('Введи код целиком.');
        haptic('light');
        if (!API_BASE) { close(); return toast('Бот не подключён к веб-версии: нужен bot_public_url или открытие через bot host.'); }
        try {
          const r = await fetch(apiUrl('/auth/verify'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
          });
          const j = await r.json();
          if (j.ok) {
            state.web_user = { id: j.user.id, name: j.user.name || 'друг' };
            save();
            haptic('success');
            close();
            toast('Вход выполнен. Синхронизация готова.');
            render();
          } else toast('Код не подошёл или устарел.');
        } catch (e) { toast('Не удалось связаться с ботом.'); }
      } }, 'Войти'),
      el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { openLink(`https://t.me/${CFG.bot_username || ''}`); } }, 'Открыть бота за кодом')
    );
  });
}

/* ---------- render ---------- */
function render() {
  const r = route();
  const app = $('#app');
  if (typeof screenCleanup === 'function') { try { screenCleanup(); } catch (e) {} }
  screenCleanup = null;
  app.innerHTML = '';
  let scr;
  if (!state.onboarded) scr = screenWelcome();
  else switch (r.a) {
    case '': scr = screenToday(); break;
    case 'skills': scr = r.b ? screenBlock(r.b) : screenSkills(); break;
    case 'p': scr = screenPractice(r.b); break;
    case 'game': scr = screenGame(); break;
    case 'workbook': scr = screenWorkbook(); break;
    case 'merch': scr = screenMerch(); break;
    case 'profile': scr = screenProfile(); break;
    default: scr = screenToday();
  }
  app.append(scr);
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', render);

/* ---------- boot ---------- */
(async function boot() {
  applyTheme();
  reviewBadges(false);
  try {
    await loadContent();
  } catch (e) {
    $('#app').append(el('div', { class: 'screen' }, el('p', {}, 'Не могу загрузить контент. Проверь связь.')));
    $('#splash').classList.add('gone');
    return;
  }
  if (TG_MODE) {
    state.web_user = null;
    save();
  }
  render();
  setTimeout(() => $('#splash').classList.add('gone'), 1500);
})();
