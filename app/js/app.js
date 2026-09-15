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
  play: svg('<path d="M8 6.5v11l9-5.5z"/>'),
  chat: svg('<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H6l-3 3v-3a8.5 8.5 0 1 1 18-8.5z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/>'),
  chart: svg('<path d="M4 20V5"/><path d="M4 20h16"/><path d="M7 15l4-5 3 3 5-7"/>'),
  share: svg('<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 14v4.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V14"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 18l4.5-4.5 3.5 3.5 3-3 4 4"/>'),
  gif: svg('<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M7 10v4M7 12h2.5M12 10v4M15.5 14v-4h3M15.5 12h2.5"/>'),
  note: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 11h6M9 15h4"/>'),
  heart: svg('<path d="M12 20s-7.2-4.6-9.2-9.1C1.2 7.5 3.6 4.5 6.7 4.5c1.9 0 3.7 1 4.7 2.6.5.8.6.9.6.9s.1-.1.6-.9c1-1.6 2.8-2.6 4.7-2.6 3.1 0 5.5 3 3.9 6.4C19.2 15.4 12 20 12 20z"/>')
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
  theme: 'light',
  palette: 'blue',          // «голубая» / «розовая» — см. applyPalette()
  mood_schema: 2,           // v25: эмоций стало девять (см. миграцию ниже)
  mastered: {},
  done: {},
  mood: {},
  reminders: { on: false, time: '09:00' },
  merch_notify: [],
  web_user: null,
  mood_entries: [],
  tasks: {},
  picked: {},                // примеры из практик, которые человек отметил своими: "practiceId:extrasKey" → [тексты]
  game: {
    total_points: 0,
    alt_count: 0,
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
  mood_entries: Array.isArray(persisted.mood_entries) ? persisted.mood_entries : defaultState.mood_entries,
  tasks: Object.assign({}, defaultState.tasks, persisted.tasks || {}),
  picked: Object.assign({}, defaultState.picked, persisted.picked || {}),
  game: Object.assign({}, defaultState.game, persisted.game || {}, {
    scales: Object.assign({}, defaultState.game.scales, persisted.game?.scales || {}),
    badges: Object.assign({}, defaultState.game.badges, persisted.game?.badges || {})
  })
});
const save = () => localStorage.setItem(DB, JSON.stringify(state));

// миграция: старый дневник «одна отметка в день» (state.mood) → лог записей mood_entries
if (!state.mood_entries.length && Object.keys(state.mood).length) {
  state.mood_entries = Object.entries(state.mood).map(([k, v]) => {
    const [y, m, d] = k.split('-').map(Number);
    return { ts: new Date(y, m - 1, d, 12).getTime(), value: v };
  });
  save();
}

// миграция v25: эмоции были 0..4 («Тяжело…Радостно»), стали 0..8
// (добавились Грустно, Весело, Смешанно, Непонятно). Старые отметки
// раскладываем по новой шкале, чтобы график в профиле не поехал.
if ((persisted.mood_schema || 1) < 2) {
  const OLD = [0, 2, 3, 4, 6];
  state.mood_entries = state.mood_entries.map(e => Object.assign({}, e, { value: OLD[e.value] ?? 4 }));
  state.mood = Object.fromEntries(Object.entries(state.mood).map(([k, v]) => [k, OLD[v] ?? 4]));
  state.mood_schema = 2;
  save();
}

const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TRIAL_MS = (CFG.subscription?.trial_days ?? 7) * 86400000;
const isPremium = () => (state.premium_until || 0) > Date.now() || (state.trial_started_at && Date.now() - state.trial_started_at < TRIAL_MS);
const trialDaysLeft = () => {
  if ((state.premium_until || 0) > Date.now()) return Infinity;
  if (!state.trial_started_at) return CFG.subscription?.trial_days ?? 7;
  return Math.max(0, Math.ceil((TRIAL_MS - (Date.now() - state.trial_started_at)) / 86400000));
};

/* ---------- тарифы подписки: 1 мес 200 ₽ · 3 мес 500 ₽ · 6 мес 900 ₽ ---------- */
const PLANS = () => (Array.isArray(CFG.subscription?.plans) && CFG.subscription.plans.length)
  ? CFG.subscription.plans
  : [{ id: 'm1', title: '1 месяц', per: 'в месяц', price_ru: '200 ₽', days: 30, note: '200 ₽ в месяц' }];
let pickedPlanId = null;
const pickedPlan = () => {
  const plans = PLANS();
  return plans.find(p => p.id === pickedPlanId) || plans[0];
};
const plansLine = () => PLANS().map(p => `${p.price_ru} / ${p.title}`).join(' · ');

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

/* ---------- тема и палитра (голубая / розовая) ---------- */
/* Тема одна — светлая; «розовая» — это палитра: переопределяются токены в
   css/app.css (:root[data-palette="pink"]). У локапа два файла: просветы внутри
   букв залиты в тон фона своей палитры, поэтому подложка под логотипом не нужна. */
const PALETTES = {
  blue: { title: 'Голубая', note: 'Небо и мягкий синий', bg: '#EDF3FE', logo: 'assets/brand/logo-wordmark.png' },
  pink: { title: 'Розовая', note: 'Пудра, пион, тёплый свет', bg: '#FCEFF5', logo: 'assets/brand/logo-wordmark-pink.png' }
};
const paletteId = () => (PALETTES[state.palette] ? state.palette : 'blue');
const brandLogo = () => PALETTES[paletteId()].logo;

function applyPalette() {
  const p = PALETTES[paletteId()];
  document.documentElement.dataset.palette = paletteId();
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = p.bg;
  try { tg && tg.setHeaderColor && tg.setHeaderColor(p.bg); tg && tg.setBackgroundColor && tg.setBackgroundColor(p.bg); } catch (e) {}
  // локап на прелоаде живёт в index.html — меняем картинку под палитру
  document.querySelectorAll('img[data-brand-logo]').forEach(img => { img.src = p.logo; });
}
function setPalette(id) {
  if (!PALETTES[id] || id === paletteId()) return;
  state.palette = id;
  save();
  haptic('light');
  applyPalette();
  render();
}
function applyTheme() {
  document.documentElement.dataset.theme = 'light';   // светлая — как договорились в правках
  applyPalette();
}

/* ---------- helpers ---------- */
let toastTimer;
let screenCleanup = null;
const SCALE_DEFS = [
  { key: 'awareness', title: 'Осознанность', hint: 'Замечаю, что со мной происходит', max: 120, tint: 'awareness', emoji: '✨' },
  { key: 'care', title: 'Забота о себе', hint: 'Выбираю мягкую поддержку', max: 80, tint: 'care', emoji: '💗' },
  { key: 'resilience', title: 'Устойчивость', hint: 'Держусь в волне и возвращаюсь', max: 100, tint: 'resilience', emoji: '🌿' },
  { key: 'sensory', title: 'Сенсорный баланс', hint: 'Слышу тело и среду', max: 60, tint: 'sensory', emoji: '🫧' }
];
/* Эмоции v25: девять состояний, и у каждого — своё лицо Дибитишки.
   Грустно / весело / смешанно / непонятно добавлены к прежним.
   Стандартные эмодзи в эмоциях больше не используются: вместо них PNG-лица
   из assets/mascot/faces (сгенерированы из маскота, фон вырезан). */
const MOODS = ['Тяжело', 'Грустно', 'Тревожно', 'Ровно', 'Тепло', 'Весело', 'Радостно', 'Смешанно', 'Непонятно'];
const MOOD_FACES = ['hard', 'sad', 'anxious', 'even', 'warm', 'fun', 'joy', 'mixed', 'unclear'];
// подсказка под чипом: чем этот оттенок отличается от соседних
const MOOD_HINTS = ['сил мало, всё тянет вниз', 'печально и хочется тишины', 'внутри шатко и неспокойно', 'ни туда, ни сюда — ровно', 'мягко и по-доброму', 'легко, хочется смеяться', 'звонко и радостно', 'и хорошо, и тяжело сразу', 'сама не понимаю, что это'];
const MOOD_LEVEL = [0, 1, 2, 4, 5, 6, 8, 4, 4];   // где точка стоит на графике (0..8)
const MOOD_EMOJI = MOOD_FACES;                     // обратная совместимость старых записей
const moodFaceSrc = (v) => `assets/mascot/faces/${MOOD_FACES[v] || 'even'}.png`;
const moodFace = (v, cls = 'mood-face') => el('img', { class: cls, src: moodFaceSrc(v), alt: MOODS[v] || '', loading: 'lazy' });
const DAILY_PHRASES = [
  "Ты справляешься. Даже если сейчас так не кажется.",
  "Сегодня можно просто быть.",
  "Не обязательно делать всё сразу.",
  "Маленький шаг — тоже шаг.",
  "Ты не обязан быть продуктивным, чтобы быть молодцом.",
  "Можно начать с самого простого.",
  "Я рядом. Давай потихоньку.",
  "Сегодня достаточно сделать чуть-чуть.",
  "Ты уже делаешь важную вещь — замечаешь себя.",
  "Иногда лучший прогресс — это остановиться.",
  "Большие чувства. Маленькие шаги.",
  "Давай не спешить.",
  "Один маленький шаг на сегодня?",
  "Начнём с того, что уже есть.",
  "Не нужно идеально. Нужно достаточно.",
  "Пять минут тоже считаются.",
  "Шаг за шагом становится легче.",
  "Можно попробовать. Можно передумать.",
  "Давай сделаем только следующий шаг.",
  "Сегодня прокачиваем себя на 1%.",
  "Заметь. Назови. Выбери.",
  "Что ты сейчас чувствуешь?",
  "Эмоция — это информация, а не приказ.",
  "Можно чувствовать и не действовать сразу.",
  "Пауза тоже действие.",
  "Дышим. Замечаем. Выбираем.",
  "Тебе не нужно бороться с каждой эмоцией.",
  "Чувство пройдёт. А ты останешься.",
  "Можно принять момент и всё равно что-то изменить.",
  "Между импульсом и действием есть пауза.",
  "Сегодня трудный день? Тогда особенно медленно.",
  "Ничего страшного, если сегодня мало сил.",
  "Давай сначала позаботимся о тебе.",
  "Ты можешь отложить сложное.",
  "Сейчас не нужно решать всю жизнь.",
  "Сначала выдохнем.",
  "Тебе можно отдохнуть.",
  "Иногда продержаться — уже достижение.",
  "Не ругай себя за то, что тебе трудно.",
  "Давай переживём этот момент вместе."
];
const dailyPhrase = () => pick(DAILY_PHRASES, daySeed());
const BADGES = {
  first_practice: { emoji: '💧', title: 'Первая капля', text: 'Сделана первая практика.' },
  alt_kind: { emoji: '🫶', title: 'Мягкий маршрут', text: 'Альтернатива тоже считается.' },
  streak3: { emoji: '🔥', title: 'Тихая серия', text: 'Три дня подряд с практиками.' },
  first_master: { emoji: '🏅', title: 'Умею', text: 'Отмечен первый освоенный навык.' },
  scales2: { emoji: '🌈', title: 'Баланс в сборе', text: 'Две шкалы перевалили за 70%.' },
  first_mood: { emoji: '🌱', title: 'Первый отклик', text: 'Первая отметка эмоции в дневнике.' },
  mood7: { emoji: '📔', title: 'Честный дневник', text: 'Семь отметок эмоций.' },
  first_task: { emoji: '📝', title: 'Первая страница', text: 'Заполнено первое текстовое задание.' },
  task3: { emoji: '🧭', title: 'Моя опора', text: 'Заполнено три текстовых задания.' }
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

function gain(text) {
  const g = el('div', { class: 'gain' });
  g.textContent = text;
  g.style.left = (44 + Math.random() * 12) + '%';
  g.style.bottom = 'calc(env(safe-area-inset-bottom,0px) + 108px)';
  document.body.append(g);
  setTimeout(() => g.remove(), 1250);
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

/* Живой маскот (главная): три кадра одной позы — глаза открыты, моргание,
   улыбка — лежат стопкой и переключаются по очереди. Внешне это зацикленная
   анимация: персонаж моргает, улыбается и мягко перекачивается с ноги на ногу
   (качание и дыхание — в CSS, .live-mascot). Кадры собираются скриптом
   scripts/make-mascot-frames.mjs, так что совпадают попиксельно. */
function liveMascot(opts = {}) {
  const base = opts.base || 'assets/mascot/hello.png';
  const blink = opts.blink || 'assets/mascot/hero-blink.png';
  const smile = opts.smile || 'assets/mascot/hero-smile.png';
  return el('div', { class: 'live-mascot' },
    el('img', { class: 'live-mascot-face is-base', src: base, alt: 'Дибитишка' }),
    el('img', { class: 'live-mascot-face is-blink', src: blink, alt: '', 'aria-hidden': 'true' }),
    el('img', { class: 'live-mascot-face is-smile', src: smile, alt: '', 'aria-hidden': 'true' })
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

/* ---------- дневник эмоций ---------- */
const moodEntries = () => [...state.mood_entries].sort((a, b) => (b.ts || 0) - (a.ts || 0));
const moodEntriesCount = () => state.mood_entries.length;
// последняя отметка за сегодняшний день (для подсветки чипа)
const moodTodayValue = () => {
  const k = todayKey();
  return [...state.mood_entries].filter(e => todayKey(new Date(e.ts)) === k).sort((a, b) => a.ts - b.ts).pop();
};
function addMood(value, note) {
  const k = todayKey();
  const hadToday = state.mood_entries.some(e => todayKey(new Date(e.ts)) === k);
  const cleanNote = (note || '').trim().slice(0, 200);
  state.mood_entries.push({ ts: Date.now(), value, note: cleanNote || undefined });
  // лёгкий, один раз в день: честность с собой тоже растёт в шкалы
  // (0–2 — тяжёлые оттенки, тут важнее забота; 3–8 — там, где нужно замечать и называть)
  if (!hadToday) gainScale(value >= 3 ? 'awareness' : 'care', 1);
  // храним ~2 года записей
  const cutoff = Date.now() - 730 * 86400000;
  state.mood_entries = state.mood_entries.filter(e => (e.ts || 0) >= cutoff);
  save();
  reviewBadges(true);
}
// ряд для графика: последние `days` дней, для каждого — последняя отметка дня (или null)
function moodSeries(days = 14) {
  const out = [];
  const byDay = {};
  for (const e of state.mood_entries) {
    const k = todayKey(new Date(e.ts));
    if (!byDay[k]) byDay[k] = e.ts;
    else byDay[k] = Math.max(byDay[k], e.ts);
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    const ts = byDay[k];
    out.push({ day: d, key: k, ts, value: ts ? state.mood_entries.find(e => e.ts === ts)?.value : null });
  }
  return out;
}
// сколько дней за период вообще имели хотя бы одну отметку
const moodDaysCount = (days = 14) => moodSeries(days).filter(p => p.value !== null).length;

/* ---------- текстовые задания ---------- */
const taskAnswersCount = () => Object.values(state.tasks).filter(t => t && (t.text || '').trim()).length;
const findTask = (id) => (CONTENT?.tasks || []).find(t => t.id === id);
const taskFilled = (id) => !!(state.tasks[id] && (state.tasks[id].text || '').trim());

/* лёгкий SVG-график настроения: последние `days` дней */
function moodGraph(days = 14) {
  const series = moodSeries(days);
  const W = 300, H = 118, pad = 8;
  const top = MOODS.length - 1;                                   // 8 — верх шкалы
  const x = (i) => pad + (W - pad * 2) * (i / (days - 1));
  const y = (v) => pad + (H - pad * 2) * (1 - (MOOD_LEVEL[v] ?? 4) / top);
  const pts = series.map((p, i) => ({ x: x(i), y: p.value === null ? null : y(p.value), v: p.value }));
  const solid = pts.filter(p => p.y !== null);
  const svg = el('div');
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="mood-svg">`;
  // сетка и ось «ровно»
  s += `<line x1="${pad}" y1="${y(3)}" x2="${W - pad}" y2="${y(3)}" class="mood-mid"/>`;
  if (solid.length > 1) {
    const path = solid.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${path} L${solid[solid.length - 1].x.toFixed(1)},${H - pad} L${solid[0].x.toFixed(1)},${H - pad} Z`;
    s += `<path d="${area}" class="mood-area"/>`;
    s += `<path d="${path}" class="mood-line"/>`;
  }
  for (const p of solid) {
    const lvl = MOOD_LEVEL[p.v] ?? 4;
    const c = lvl >= 6 ? 'hi' : lvl >= 4 ? 'mid' : 'lo';
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" class="mood-dot ${c}"/>`;
  }
  s += `</svg>`;
  svg.innerHTML = s;
  const labels = el('div', { class: 'mood-axis' },
    moodFace(6, 'mood-axis-face'), el('span', { class: 'grow' }), moodFace(0, 'mood-axis-face'));
  const caption = el('p', { class: 'mood-caption' }, solid.length
    ? `${moodDaysCount(days)} ${plural(moodDaysCount(days), 'день', 'дня', 'дней')} с отметками за ${days} дн. Тяжёлый день — это точка на пути, а не весь путь.`
    : 'Пока нет записей — отметь эмоцию на главной, и здесь появится твой путь.');
  return el('div', { class: 'mood-graph' }, svg, labels, caption);
}
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const levelInfo = () => {
  const need = 120;
  const points = state.game.total_points || 0;
  const level = Math.floor(points / need) + 1;
  const inLevel = points % need;
  return { level, need, points, inLevel, pct: inLevel / need, toNext: need - inLevel };
};
function addPoints(n) {
  const before = levelInfo().level;
  state.game.total_points += n || 0;
  const after = levelInfo().level;
  return after > before ? after : 0;
}
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
  if (SCALE_DEFS.filter(s => scalePct(s.key) >= .7).length >= 2) unlockBadge('scales2', announce);
  if (moodEntriesCount() >= 1) unlockBadge('first_mood', announce);
  if (moodEntriesCount() >= 7) unlockBadge('mood7', announce);
  if (taskAnswersCount() >= 1) unlockBadge('first_task', announce);
  if (taskAnswersCount() >= 3) unlockBadge('task3', announce);
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
    if (actual > 0) gained.push(`+${actual} ${def.title.toLowerCase()}`);   // иконки убраны — шкала узнаётся по цвету
  }
  const pts = Math.round((reward.points || 10) * mult);
  const lvl = addPoints(pts);
  if (isAlt) state.game.alt_count = (state.game.alt_count || 0) + 1;
  save();
  reviewBadges(true);
  if (lvl) { confetti(); toast(`Новый уровень ${lvl}!`); }
  gain('+' + pts + ' XP');
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
  const lvl = addPoints(reward.points || 18);
  save();
  reviewBadges(true);
  if (lvl) { confetti(); toast(`Новый уровень ${lvl}!`); }
  gain('+' + (reward.points || 18) + ' XP');
}

function heroPoster({ dateStr }) {
  const lvl = levelInfo();
  const streak = streakCount();
  const phrase = dailyPhrase();
  const isLong = phrase.length > 48;
  return el('section', { class: 'hero' },
    el('img', { class: 'hero-brand', src: brandLogo(), alt: 'Дибитишка', 'data-brand-logo': '' }),
    el('div', { class: 'hero-phrase' + (isLong ? ' long' : '') }, phrase),
    el('p', { class: 'hero-date' }, dateStr),
    el('div', { class: 'hero-mascot-wrap' }, liveMascot()),
    el('div', { class: 'xp' },
      el('div', { class: 'xp-head' },
        el('span', { class: 'level-pill' }, `Уровень ${lvl.level}`),
        el('span', { class: 'xp-nums' }, `${lvl.inLevel} / ${lvl.need} XP`)
      ),
      el('div', { class: 'xp-track' }, el('i', { class: 'xp-fill', style: `width:${Math.round(lvl.pct * 100)}%` })),
      el('div', { class: 'xp-foot' },
        el('span', {}, `🔥 серия ${streak} ${plural(streak, 'день', 'дня', 'дней')}`),
        el('span', {}, `✨ ${lvl.points} очков роста`)
      )
    )
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
        el('div', {}, el('b', {}, def.title), el('span', {}, def.hint)),
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
      el('p', {}, `${lvl.inLevel}/${lvl.need} XP · до следующего уровня ещё ${lvl.toNext}. Всего: ${lvl.points} ${plural(lvl.points, 'очко', 'очка', 'очков')}.`),
      el('div', { class: 'level-track' }, el('i', { style: `width:${Math.round(lvl.pct * 100)}%` }))
    )
  );
}

/* ---------- живой цифровой друг ---------- */
function bindMascotFriends(root) {
  root.querySelectorAll('.mascot, .hero-mascot, .onboard-mascot, .poster-mascot, .live-mascot').forEach(img => {
    if (img.dataset.friend) return;
    img.dataset.friend = 'true';
    img.setAttribute('role', 'button');
    img.setAttribute('tabindex', '0');
    img.setAttribute('aria-label', 'Поприветствовать персонажа');
    const react = () => {
      haptic('light');
      img.classList.remove('mascot-tapped');
      void img.offsetWidth;
      img.classList.add('mascot-tapped');
      const sparks = el('span', { class: 'friend-sparks', 'aria-hidden': 'true' });
      for (let i = 0; i < 7; i++) sparks.append(el('i', { style: `--i:${i}` }));
      img.parentElement?.append(sparks);
      setTimeout(() => { img.classList.remove('mascot-tapped'); sparks.remove(); }, 850);
    };
    img.addEventListener('pointerdown', react);
    img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); react(); } });
  });
}

/* ---------- tabbar ---------- */
const TABS = [
  { id: 'today', label: 'Сегодня', icon: 'today', route: '' },
  { id: 'skills', label: 'Навыки', icon: 'skills', route: 'skills' },
  { id: 'chat', label: 'Чат', icon: 'chat', route: 'chat' },
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
    ['hello', 'Привет! Я рядом', 'Я живу рядом, когда чувств слишком много. Будем собирать опору маленькими шагами — без стыда и гонки.'],
    ['calm', 'Дневник, задания и чат', 'Отмечай эмоции — соберётся твой график пути. Пиши письменные опоры, а в трудный момент чат напомнит, кто ты и что тебя держит.'],
    ['proud', 'Медленно — тоже вперёд', 'Прогресс отмечаю бережно: за практики, честность с собой и даже за моменты, когда выбираешь путь помягче.']
  ];
  const pills = ['Маленький спутник спокойствия', 'Шкала опыта и уровни', 'Без давления и оценки'];
  let i = 0;
  const scr = el('div', { class: 'screen onboard' });
  const pill = el('div', { class: 'onboard-pill' });
  const title = el('h1', { class: 'onboard-title' });
  const text = el('p', { class: 'onboard-text' });
  const img = el('img', { class: 'onboard-mascot', src: 'assets/mascot/hello.png', alt: 'Дибитишка' });
  const wrap = el('div', { class: 'onboard-mascot-wrap' }, img);
  const dots = el('div', { class: 'dots' });
  const nextBtn = el('button', { class: 'round-btn', 'aria-label': 'Дальше' }, '→');
  const foot = el('div', { class: 'onboard-foot' }, dots, nextBtn);
  const cta = el('button', { class: 'btn onboard-cta hidden' }, 'Начать бесплатную неделю', el('span', { class: 'arr' }, '→'));
  const note = el('p', { class: 'onboard-note' },
    `Первая неделя бесплатно, потом ${plansLine()}.`
  );
  const finish = () => {
    state.onboarded = true;
    if (!state.trial_started_at) state.trial_started_at = Date.now();
    save();
    go('');
  };
  const draw = () => {
    img.src = `assets/mascot/${slides[i][0]}.png`;
    pill.textContent = pills[i];
    title.textContent = slides[i][1];
    text.textContent = slides[i][2];
    dots.innerHTML = '';
    slides.forEach((_, k) => dots.append(el('button', { class: 'dot' + (k === i ? ' on' : ''), 'aria-label': 'Слайд ' + (k + 1), onclick: () => { i = k; draw(); } })));
    const last = i === slides.length - 1;
    foot.classList.toggle('hidden', last);
    cta.classList.toggle('hidden', !last);
  };
  nextBtn.onclick = () => { haptic('medium'); if (i < slides.length - 1) { i++; draw(); } };
  cta.onclick = () => { haptic('medium'); finish(); };
  draw();
  scr.append(pill, title, text, wrap, el('div', { class: 'onboard-spacer' }), foot, cta, note);
  return scr;
}

/* Выбор периода подписки: три карточки-тарифа, выбранный подсвечивается. */
function planPicker() {
  const plans = PLANS();
  if (!plans.some(p => p.id === pickedPlanId)) pickedPlanId = plans[0].id;
  const wrap = el('div', { class: 'plans' });
  const rows = plans.map(p => {
    const row = el('button', {
      class: 'plan' + (p.id === pickedPlanId ? ' on' : ''), type: 'button',
      onclick: () => {
        pickedPlanId = p.id; haptic('light');
        rows.forEach(r => r.el.classList.toggle('on', r.id === p.id));
      }
    },
      el('span', { class: 'plan-main' },
        el('b', {}, p.title, p.badge ? el('span', { class: 'plan-badge' }, p.badge) : null),
        el('span', {}, p.note || p.per || '')),
      el('span', { class: 'plan-price' }, p.price_ru),
      el('span', { class: 'plan-dot' }, '')
    );
    return { id: p.id, el: row };
  });
  rows.forEach(r => wrap.append(r.el));
  return wrap;
}

function paywallCard(scr) {
  const c = el('div', { class: 'card soft' });
  c.append(
    mascot('hug', mline('paywall')),
    el('h3', { style: 'margin-top:12px' }, 'Подписка Дибитишки'),
    el('p', {}, `Первая неделя бесплатно. Дальше — выбери период, как удобнее: ${plansLine()}. Оплата идёт через Tribute прямо из бота.`),
    planPicker(),
    el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => openPay() }, 'Оформить подписку')
  );
  scr.append(c);
}

function openPay(planId) {
  haptic('medium');
  if (planId) pickedPlanId = planId;
  sheet((sh, close) => {
    const payBtn = el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => {
      const p = pickedPlan();
      const u = CFG.bot_username ? `https://t.me/${CFG.bot_username}?start=pay_${p.id}` : 'https://t.me/';
      try { tg && tg.openTelegramLink ? tg.openTelegramLink(u) : window.open(u); } catch (e) { window.open(u); }
      close();
    } }, 'Оплатить в Telegram');
    sh.append(
      mascot('hug', 'Оплата живёт в боте: он создаст ссылку Tribute и сам активирует подписку.'),
      el('p', {}, `Выбери период — первая неделя уже бесплатная, она идёт с момента первого входа. ${plansLine()}.`),
      planPicker(),
      payBtn,
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
  scr.append(heroPoster({ dateStr: prettyDate }));

  if (!isPremium()) { paywallCard(scr); return scr; }

  // Отметь эмоцию: короткая заметка — СВЕРХУ эмоций, рядом «Поделиться».
  scr.append(el('div', { class: 'sect' }, 'Отметь эмоцию'));
  const curEntry = moodTodayValue();
  const noteInput = el('textarea', {
    class: 'mood-note-input', id: 'mood-note', rows: 2, maxlength: 200,
    placeholder: 'Короткая заметка — что сейчас на душе? (необязательно)'
  });
  const shareBtn = el('button', {
    class: 'share-btn', type: 'button', onclick: () => shareMoodCard()
  }, icon('share'), el('span', {}, 'Поделиться'));
  scr.append(el('div', { class: 'mood-note-wrap' },
    noteInput,
    el('div', { class: 'mood-note-actions' }, shareBtn,
      el('span', { class: 'mins' }, 'Заметка попадёт в дневник. «Поделиться» соберёт карточку настроения — её можно отправить в сторис.'))
  ));

  const mrow = el('div', { class: 'chips mood-chips' });
  MOODS.forEach((m, k) => mrow.append(el('button', {
    class: 'chip mood' + (curEntry && curEntry.value === k ? ' on' : ''),
    'aria-label': `${m} — ${MOOD_HINTS[k]}`,
    'aria-pressed': curEntry && curEntry.value === k ? 'true' : 'false',
    onclick: () => {
      const noteEl = document.getElementById('mood-note');
      const noteVal = noteEl ? noteEl.value : '';
      addMood(k, noteVal);
      if (noteEl) noteEl.value = '';
      haptic('light');
      const words = k === 0 ? 'Я рядом. Будь к себе понежнее.'
        : k === 3 ? 'Ровно — тоже важная отметка.'
        : k === 8 ? 'Непонятно — это тоже ответ. Не обязательно называть точнее.'
        : k === 7 ? 'Смешанно — так бывает: и хорошо, и тяжело сразу.'
        : 'Спасибо за честность. Отмечено.';
      toast(words);
      render();
    }
  }, moodFace(k, 'chip-face'), el('span', { class: 'chip-label' }, m))));
  scr.append(mrow, el('p', { class: 'mins mood-hint' },
    curEntry ? `Сейчас отмечено: «${MOODS[curEntry.value]}». Можно отметить ещё раз, когда состояние изменится.`
             : 'Отмечать можно сколько угодно раз за день — выбирай, что ближе сейчас.'));

  // ежедневная цель
  const doneCount = (state.done[todayKey()] || []).length;
  const moodDone = state.mood_entries.some(e => todayKey(new Date(e.ts)) === todayKey());
  scr.append(el('div', { class: 'sect' }, 'Сегодняшняя цель'));
  scr.append(el('div', { class: 'daily' },
    ring(doneCount >= 1 ? 1 : doneCount),
    el('div', { class: 'dm' },
      el('b', {}, doneCount >= 1 ? 'Практика дня сделана' : '1 практика сегодня'),
      el('span', {}, moodDone ? 'Настроение отмечено · цель собрана' : 'Отметь ещё настроение — это тоже шаг')
    )
  ));

  const all = allPractices();
  const todays = pick(all, daySeed());
  const mini = findPractice(pick(CONTENT.minis, daySeed() + 3));
  const doneToday = (state.done[todayKey()] || []).includes(todays.id);

  const card = el('div', { class: `card tinted soft t-${todays.block.tint}` });
  card.append(
    el('p', { class: 'cap' }, `блок «${todays.block.title}» · ≈ ${todays.minutes} мин`),
    el('h3', {}, todays.title),
    el('p', {}, todays.why.slice(0, 120) + '…'),
    el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => go('p/' + todays.id) }, doneToday ? 'Пройти ещё раз' : 'Начать')
  );
  scr.append(el('div', { class: 'sect' }, 'Практика дня'), card);

  scr.append(el('div', { class: 'sect' }, 'Быстрая практика'));
  scr.append(el('div', { class: 'group' }, el('button', { class: 'row', onclick: () => go('p/' + mini.id) },
    el('span', { class: 'ric c-sky' }, icon('drop')),
    el('span', { class: 'rmain' }, el('b', {}, mini.title), el('span', {}, '1–4 минуты, можно прямо сейчас')),
    el('span', { class: 'chev' }, '›')
  )));

  // mood moved higher: заметка сверху, лица вместо эмодзи и «Поделиться» — там же
    // (дубликат убран — блок «Отметь эмоцию» стоит выше дашборда)

  scr.append(el('div', { class: 'sect' }, 'Доска впечатлений'));
  scr.append(el('button', { class: 'board-teaser', onclick: () => go('boards') },
    el('span', { class: 'board-teaser-stack', 'aria-hidden': 'true' },
      el('img', { src: 'assets/mascot/faces/warm.png', alt: '' }),
      el('img', { src: 'assets/mascot/faces/joy.png', alt: '' }),
      el('img', { src: 'assets/mascot/faces/even.png', alt: '' })
    ),
    el('span', { class: 'board-teaser-copy' },
      el('b', {}, boardsTeaserTitle()),
      el('span', {}, 'Фото, гифки, стихи и мысли — на фоне, который нравится. То, что напоминает, кто ты.')
    ),
    el('span', { class: 'chev' }, '›')
  ));

  scr.append(el('div', { class: 'sect' }, 'Чат поддержки'));
  scr.append(el('div', { class: 'card poster-mini soft' },
    el('div', { class: 'poster-copy wide' },
      el('h3', {}, 'Поговорить с Дибитишкой'),
      el('p', {}, 'Совет в трудный момент и напоминание, кто ты — из твоих же записей.'),
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => go('chat') }, 'Открыть чат', el('span', { class: 'arr' }, '→'))
    ),
    el('img', { class: 'poster-mascot', src: 'assets/mascot/hug.png', alt: 'Дибитишка' })
  ));

  scr.append(el('p', { class: 'foot' }, CONTENT.meta.credits));
  return scr;
}

/* Папки навыков: у каждого блока своя иконка-папка в стиле маскота
   (одна генерация → нарезка на пять файлов, см. scripts/slice-folders.mjs). */
const FOLDER_ART = { base: 'opora', mind: 'osoznannost', stress: 'stress', emo: 'emotions', sense: 'sensorika' };

function screenSkills() {
  renderTabbar('skills');
  const scr = el('div', { class: 'screen' });
  scr.append(el('h1', { class: 'ltitle' }, 'Навыки', el('small', {}, 'Пять блоков · проходи в своём порядке')));
  scr.append(el('div', { class: 'mascot-wrap peeking' },
    el('img', { class: 'mascot', src: 'assets/mascot/book.png', alt: 'Дибитишка' }),
    el('div', { class: 'bubble' }, 'Выбирай любой блок. Можно идти медленно, перепрыгивать и возвращаться.')
  ));
  /* v25: разделы навыков — милые папки, как иконка папки на компьютере,
     только в нашем стиле: у каждого блока свой цвет и своё лицо на обложке. */
  const folders = el('div', { class: 'folders' });
  for (const b of CONTENT.blocks) {
    const total = b.practices.length;
    const master = b.practices.filter(p => state.mastered[p.id]).length;
    const pct = total ? master / total : 0;
    folders.append(el('button', {
      class: `folder f-${b.tint}`, onclick: () => go('skills/' + b.id),
      'aria-label': `${b.title}: ${master ? 'освоено ' + master + ' из ' + total : total + ' практик'}`
    },
      el('span', { class: 'folder-art' },
        el('img', { src: `assets/folders/${FOLDER_ART[b.id] || 'opora'}.png`, alt: '', loading: 'lazy' }),
        master ? el('span', { class: 'folder-badge' }, String(master)) : null
      ),
      el('span', { class: 'folder-copy' },
        el('b', {}, b.title),
        el('span', { class: 'folder-sub' }, b.subtitle),
        el('span', { class: 'folder-track' }, el('i', { style: `width:${Math.round(pct * 100)}%` })),
        el('span', { class: 'folder-meta' },
          master ? `Освоено ${master} из ${total}` : `${total} практик · начни с любой`,
          el('span', { class: 'chev' }, '›'))
      )
    ));
  }
  scr.append(folders);
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

/* ---------- примеры к практике (p.extras) ----------
   Часть практик в тексте шагов прямо отсылает к примерам: «прочитай примеры
   ниже», «выбери одну фразу из примеров», «подбери слова-названия». Сами
   примеры лежат в content.json в поле extras — без этого блока шаг просит то,
   чего на экране нет. Рендерим любой extras: массив строк или группы
   «название группы → список». */
const EXTRAS_META = {
  affirmations: { title: 'Примеры фраз', note: 'Нажми на фразу — она отметится как твоя и скопируется.', pick: true },
  words: { title: 'Слова-названия', note: 'Можно брать отсюда или найти свои. Нажми — слово скопируется.', pick: true },
  senses: { title: 'Примеры по чувствам', note: 'Чужие примеры — чтобы легче вспомнить свои.' },
  examples: { title: 'Примеры', note: '' }
};
const extrasMeta = (key) => EXTRAS_META[key] || { title: 'Примеры', note: '' };
const pickedKey = (p, key) => `${p.id}:${key}`;

function copyText(text) {
  const ok = () => toast('Скопировано. Можно вставить в заметку или на заставку.');
  const fallback = () => {
    try {
      const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const done = document.execCommand('copy');
      ta.remove();
      done ? ok() : toast('Скопировать не вышло — просто перепиши словами.');
    } catch (e) { toast('Скопировать не вышло — просто перепиши словами.'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(fallback);
  } else fallback();
}

function examplesCard(p, key, value) {
  const groups = Array.isArray(value) ? [{ label: null, list: value }]
    : Object.entries(value || {}).filter(([, v]) => Array.isArray(v)).map(([label, list]) => ({ label, list }));
  if (!groups.length) return null;
  const meta = extrasMeta(key);
  const storeKey = pickedKey(p, key);
  const chosen = Array.isArray(state.picked[storeKey]) ? state.picked[storeKey] : [];
  const card = el('div', { class: 'card tinted soft t-' + (p.block?.tint || 'sky') });
  card.append(el('p', { class: 'cap' }, meta.title));

  const count = el('p', { class: 'mins ex-count' }, '');
  const syncCount = () => {
    count.textContent = chosen.length
      ? `Отмечено: ${chosen.length}. Можно переписать своими словами.`
      : 'Отметь одну-две, на которые тело отзывается теплом.';
  };

  for (const grp of groups) {
    if (grp.label) card.append(el('p', { class: 'ex-group' }, grp.label));
    const ul = el('ul', { class: 'examples' + (meta.pick ? ' pick' : '') });
    for (const text of grp.list) {
      const mark = meta.pick ? el('span', { class: 'ex-mark' }, chosen.includes(text) ? '✓' : '') : null;
      const li = el('li', { class: chosen.includes(text) ? 'on' : '' }, mark, el('span', { class: 'ex-text' }, text));
      if (meta.pick) {
        li.addEventListener('click', () => {
          const i = chosen.indexOf(text);
          if (i >= 0) chosen.splice(i, 1); else chosen.push(text);
          state.picked[storeKey] = chosen;
          save();
          haptic('light');
          const on = chosen.includes(text);
          li.classList.toggle('on', on);
          mark.textContent = on ? '✓' : '';
          copyText(text);
          syncCount();
        });
      }
      ul.append(li);
    }
    card.append(ul);
  }
  if (meta.note) card.append(el('p', { class: 'mins' }, meta.note));
  if (meta.pick) { card.append(count); syncCount(); }
  return card;
}

/* карточки примеров практики в том же порядке, в каком они лежат в content.json */
const practiceExamples = (p) => Object.entries(p.extras || {})
  .map(([key, value]) => examplesCard(p, key, value))
  .filter(Boolean);

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
  // примеры из p.extras — сразу под шагами: шаги на них ссылаются («примеры ниже»)
  for (const card of practiceExamples(p)) scr.append(card);
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

/* ---------- чат поддержки ---------- */
const CHAT_HINTS = ['Мне тяжело', 'Мне тревожно', 'Напомни, кто я', 'Дай совет на сейчас'];
const CHAT_TIPS = [
  { text: 'Вдох на 4, выдох на 6. Три раза. Длинный выдох говорит телу: можно расслабиться.' },
  { text: 'Назови пять вещей, которые видишь, четыре — которые слышишь, три — которые чувствуешь кожей. Это заземление.' },
  { text: 'Одна маленькая задача на ближайшие пять минут. Не «разобраться со всем», а одно действие.' },
  { text: 'Холодная вода на запястья или лицо — быстрый способ вернуть тело в «здесь».' },
  { text: 'Если можно — приглуши свет и звук на пару минут. Меньше входящего — легче внутри.' }
];
const clipText = (s, n = 200) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Шаблон-персона и правила. Контекст ниже собирается из данных пользователя
// и подставляется в слоты ответов. Если захочешь подключить LLM — передай
// CHAT_PERSONA + buildChatContext() как промпт, ответы унаследуют тон и факты.
const CHAT_PERSONA = `Ты — Дибитишка, слезинка-хранительница чувств. Говори коротко, тепло, без осуждения и давления. Не даёшь медицинских советов и не заменяешь врача. В трудный момент предлагаешь одну маленькую опору, а не список дел. Напоминаешь человеку, кто он, опираясь только на его собственные записи.`;

function buildChatContext() {
  const mastered = allPractices().filter(p => state.mastered[p.id]).map(p => p.master);
  const filled = (CONTENT?.tasks || []).filter(t => taskFilled(t.id)).map(t => ({
    title: t.title, emoji: t.emoji, text: (state.tasks[t.id].text || '').trim()
  }));
  const byId = (id) => (state.tasks[id] && state.tasks[id].text || '').trim();
  const last = moodEntries()[0];
  const lvl = levelInfo();
  return {
    name: TG_MODE ? tg.initDataUnsafe.user.first_name : state.web_user?.name || null,
    mastered, filled,
    whoami: byId('who_am_i'), anchors: byId('anchors'), crisis: byId('crisis_plan'),
    streak: streakCount(), level: lvl.level,
    moodNow: last ? MOODS[last.value] : null,
    moodCount: moodEntriesCount()
  };
}

function chatReply(text) {
  const ctx = buildChatContext();
  const t = (text || '').toLowerCase();
  const has = (...words) => words.some(w => t.includes(w));
  const name = ctx.name ? `, ${ctx.name}` : '';
  let reply;
  if (has('кто я', 'напомни', 'какой я', 'какая я', 'забыл', 'забыла', 'потерял', 'потеряла', 'кто ты')) {
    if (ctx.whoami || ctx.anchors || ctx.mastered.length) {
      const parts = [];
      if (ctx.whoami) parts.push(`Ты писал(а) о себе: «${clipText(ctx.whoami)}»`);
      if (ctx.anchors) parts.push(`Твои якоря: «${clipText(ctx.anchors)}»`);
      if (ctx.mastered.length) parts.push(`Ты умеешь: ${ctx.mastered.slice(0, 4).join(' · ')}`);
      reply = `Ты — не этот момент${name}. Ты — тот, кто держался ${ctx.streak} ${plural(ctx.streak, 'день', 'дня', 'дней')} подряд и дошёл до уровня ${ctx.level}.\n\n${parts.join('\n')}\n\nЕсли сейчас тяжело — это волна, а ты глубже любой волны. 💧`;
    } else {
      reply = `Пока тут мало записей${name}, но это поправимо. Заполни в профиле задания «Кто я, когда мне хорошо» и «Мои якоря» — и я буду напоминать тебе о тебе твоими же словами.`;
    }
  } else if (has('тяжело', 'тревож', 'страш', 'паник', 'плохо', 'накры', 'тошн', 'больно', 'не могу', 'срыв', 'ужас')) {
    const crisis = ctx.crisis ? `\n\nТы сам(а) оставил(а) себе план на такой случай:\n«${clipText(ctx.crisis)}»` : '';
    reply = `Слышу${name}. Давай по-маленькому, прямо сейчас:\n\n1. Выдох длиннее вдоха — три раза, медленно.\n2. Назови пять вещей, которые видишь. Ты здесь, а не там, где страшно.\n3. Одно действие на пять минут — и всё. Больше пока не надо.${crisis}\n\nЭто точка на пути, а не весь путь. Я рядом. 💧`;
  } else if (has('совет', 'что делать', 'помог', 'подскаж', 'не знаю', 'как быть', 'как справ')) {
    const tip = CHAT_TIPS[Math.floor(Math.random() * CHAT_TIPS.length)];
    reply = `Совет на сейчас: ${tip.text}\n\nОдин вдох уже считается. Если хочешь глубже — загляни в «Навыки».`;
  } else if (has('устал', 'устала', 'вымотан', 'сил нет', 'выгор', 'спать', 'отдох', 'утом')) {
    reply = `Усталость — это сигнал, а не слабость${name}. Тебе можно замедлиться.\n\nСегодня выбери одно маленькое «нет» и одно маленькое «можно отдохнуть». Меньше, чем кажется нужным, — уже достаточно.`;
  } else if (has('спасибо', 'благодар')) {
    reply = `Всегда рядом. Заходи, когда будет нужно — и когда будет хорошо, тоже. 💧`;
  } else if (has('привет', 'здравств', 'добрый', 'хай')) {
    reply = `Привет${name}! Я тут. Могу подсказать, как пережить трудный момент, напомнить, кто ты, или просто побыть рядом.`;
  } else {
    reply = `Я слышу${name}. Я лучше всего умею: подсказать в трудный момент, напомнить, кто ты, и побыть рядом. Попробуй: «Мне тяжело», «Напомни, кто я» или «Дай совет».`;
  }
  return reply;
}

/* Живой чат через бота (POST /chat → OpenAI). Пока у бота нет OPENAI_API_KEY
   или веб не подключён к боту — работает локальный chatReply().
   Важно: причина «почему не живой» не прячется — её видно под ответом,
   иначе «чат молчит» превращается в гадание (см. docs/SETUP.md). */
let AI_STATUS = null;      // null — не проверяли, true/false — ответ бота
let AI_NOTE = null;        // последняя причина из /chat/status или /chat
let aiFails = 0;           // подряд неудачных попыток — после двух включаем локальный режим
const AI_REASON = {
  no_key: 'бот-хост без ключа OpenAI',
  bad_key: 'ключ OpenAI не подошёл',
  no_quota: 'на аккаунте OpenAI закончились средства',
  rate_limit: 'слишком много запросов сразу',
  slow_down: 'ты пишешь быстрее, чем я успеваю',
  timeout: 'модель не успела ответить',
  bad_model: 'модель не найдена',
  bad_param: 'модель не приняла параметры запроса',
  too_long: 'история диалога не влезает в модель',
  geo_blocked: 'доступ к OpenAI ограничен в этом регионе',
  openai_down: 'у OpenAI сбой на стороне',
  network: 'не удалось достучаться до бота',
  offline: 'бот-хост не отвечает'
};
const aiReason = (code) => AI_REASON[code] || AI_NOTE || 'бот вернул ошибку';
async function checkAi() {
  if (!API_BASE) { AI_STATUS = false; AI_NOTE = 'веб не подключён к боту (bot_public_url пуст)'; return false; }
  try {
    const r = await fetch(apiUrl('/chat/status'), { cache: 'no-cache' });
    const j = await r.json();
    AI_STATUS = !!(j && j.ai);
    if (!AI_STATUS && Array.isArray(j.problems) && j.problems.length) AI_NOTE = String(j.problems[0]);
    if (AI_STATUS) aiFails = 0;
  } catch (e) { AI_STATUS = false; AI_NOTE = AI_REASON.network; }
  return AI_STATUS;
}
const chatHistoryKey = 'dibi_chat_history';
const loadChatHistory = () => { try { return JSON.parse(localStorage.getItem(chatHistoryKey) || '[]'); } catch (e) { return []; } };
const saveChatHistory = (h) => { try { localStorage.setItem(chatHistoryKey, JSON.stringify(h.slice(-20))); } catch (e) {} };
async function aiReply(text, history) {
  const uid = TG_MODE ? tg.initDataUnsafe.user.id : state.web_user?.id;
  try {
    const r = await fetch(apiUrl('/chat'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: uid || null, text, context: buildChatContext(), history: history.map(m => ({ role: m.role, content: m.content })) })
    });
    let j = null;
    try { j = await r.json(); } catch (e) { return { error: true, reason: 'offline' }; }
    if (j && j.ok && j.text) return { text: j.text, live: true };
    if (j && j.ai === false) { AI_STATUS = false; AI_NOTE = aiReason(j.error); return null; }
    // при ошибке API (no_quota/timeout/сеть) сигналим наверх — там вызовем chatReply()
    // из локальной памяти пользователя: ответ получится живой, из его же записей
    const reason = (j && j.error) || (r.status >= 500 ? 'openai_down' : 'offline');
    AI_NOTE = (j && j.hint) ? String(j.hint) : aiReason(reason);
    if (j && j.hint) console.warn('[dibi chat] владелец: ' + j.hint);
    return { error: true, reason };
  } catch (e) {
    AI_NOTE = AI_REASON.network;
    return { error: true, reason: 'network' };
  }
}

function screenChat() {
  renderTabbar('chat');
  const scr = el('div', { class: 'screen chat-screen' });
  scr.append(el('div', { class: 'chat-mascot-header' },
    el('img', { class: 'chat-mascot-small', src: 'assets/mascot/question.png', alt: 'Дибитишка' }),
    el('div', {}, el('h1', { class: 'ltitle', style: 'margin:0' }, 'Чат', el('small', {}, 'Поддержка в трудный момент — и напоминание, кто ты')))
  ));
  const feed = el('div', { class: 'chat-feed', id: 'chat-feed' });
  // laconic mascot illustration
  const deco = el('img', { class: 'chat-illustration', src: 'assets/mascot/question.png', alt: '', 'aria-hidden': 'true' });
  feed.append(deco);
  const inputRow = el('div', { class: 'chat-input' });
  const input = el('input', { class: 'chat-field', id: 'chat-field', placeholder: 'Напиши, что сейчас…', maxlength: 400 });
  const sendBtn = el('button', { class: 'chat-send', 'aria-label': 'Отправить' }, icon('send'));
  inputRow.append(input, sendBtn);
  const hints = el('div', { class: 'chips chat-hints' }, CHAT_HINTS.map(h => el('button', { class: 'chip', onclick: () => submit(h) }, h)));
  scr.append(feed, hints, inputRow);
  const foot = el('p', { class: 'foot' }, 'Локальный помощник: ответы собираются из твоих же записей и практик. Не заменяет врача и экстренную помощь.');
  scr.append(foot);
  const setFoot = () => {
    foot.textContent = AI_STATUS
      ? 'Живой чат: Дибитишка отвечает сама, помня твои записи. Не заменяет врача и экстренную помощь.'
      : 'Локальный помощник: ответы собираются из твоих же записей' + (AI_NOTE ? ` · живой чат на паузе: ${AI_NOTE}` : '') + '. Не заменяет врача и экстренную помощь.';
    foot.title = 'Нажми, чтобы проверить живой чат ещё раз';
  };
  foot.onclick = async () => {
    foot.textContent = 'проверяю связь с ботом…';
    const ok = await checkAi();
    setFoot();
    toast(ok ? 'Живой чат на месте ✅' : 'Пока отвечаю из твоих записей' + (AI_NOTE ? `: ${AI_NOTE}` : ''));
  };
  checkAi().then(setFoot);
  let history = loadChatHistory();

  const push = (text, who) => {
    const m = el('div', { class: 'msg ' + (who === 'me' ? 'me' : 'bot') });
    const body = el('div', { class: 'bubble' });
    String(text).split('\n').forEach((line, i) => { if (i) body.append(el('br')); body.append(line); });
    m.append(body);
    feed.append(m);
    feed.scrollTop = feed.scrollHeight;
  };
  // тихая строчка под пузырём: что сейчас с живым голосом, без технических подробностей
  let lastNote = null;
  const note = (text) => {
    if (!text || text === lastNote) return;
    lastNote = text;
    const n = el('p', { class: 'chat-note' }, text);
    feed.append(n);
    feed.scrollTop = feed.scrollHeight;
  };
  const submit = (raw) => {
    const v = (raw ?? input.value).trim();
    if (!v) return;
    input.value = '';
    push(v, 'me');
    haptic('light');
    if (!AI_STATUS) {
      setTimeout(() => { push(chatReply(v), 'bot'); if (AI_NOTE) note('Живой голос на паузе — отвечаю из твоих записей.'); }, 420);
      return;
    }
    const typing = el('div', { class: 'msg bot typing' }, el('div', { class: 'bubble' }, '…'));
    feed.append(typing); feed.scrollTop = feed.scrollHeight;
    input.disabled = true; sendBtn.disabled = true;
    aiReply(v, history).then((r) => {
      typing.remove();
      if (!r || r.error) {
        // либо AI выключен совсем, либо временно недоступен — отвечаем из локальной памяти,
        // и говорим об этом прямо: тихий фолбэк выглядел как «чат не реагирует»
        aiFails++;
        push(chatReply(v), 'bot');
        note('Живой голос сейчас недоступен' + (r && r.reason ? ` (${aiReason(r.reason)})` : '') + ' — отвечаю из твоих записей. Я тут 💧');
        if (aiFails >= 2) AI_STATUS = false;   // дёргать API дальше смысла нет, пока не перепроверим
        setFoot();
        return;
      }
      aiFails = 0; lastNote = null;
      push(r.text, 'bot');
      history.push({ role: 'user', content: v }, { role: 'assistant', content: r.text });
      history = history.slice(-20); saveChatHistory(history);
    }).catch(() => { typing.remove(); push(chatReply(v), 'bot'); })
      .finally(() => { input.disabled = false; sendBtn.disabled = false; input.focus(); });
  };
  sendBtn.onclick = () => submit();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => push(chatReply('привет'), 'bot'), 250);
  return scr;
}

/* ---------- дневник эмоций ---------- */
function screenDiary() {
  renderTabbar('profile');
  const scr = el('div', { class: 'screen sub' });
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => go('profile') }, icon('back'), 'Назад'),
    el('h2', {}, 'Дневник эмоций')
  ));
  const entries = moodEntries();
  if (!entries.length) {
    scr.append(el('div', { class: 'card soft' },
      el('h3', {}, 'Пока пусто'),
      el('p', {}, 'Отмечай эмоцию на главной каждый раз, когда заходишь. Со временем соберётся твоя история — и станет видно: тяжёлый день это точка на пути, а не весь путь.')));
    return scr;
  }
  const map = new Map(), days = [];
  for (const e of entries) {
    const k = todayKey(new Date(e.ts));
    if (!map.has(k)) { const g = { key: k, items: [] }; map.set(k, g); days.push(g); }
    map.get(k).items.push(e);
  }
  for (const g of days) {
    const d = new Date(g.key + 'T12:00:00');
    const label = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    scr.append(el('div', { class: 'sect' }, label[0].toUpperCase() + label.slice(1)));
    scr.append(el('div', { class: 'group' }, g.items.map(e => {
      const time = new Date(e.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const note = (e.note || '').trim();
      return el('div', { class: 'row', style: note ? 'flex-direction:column; align-items:flex-start; gap:6px; padding-top:14px; padding-bottom:14px' : '' },
        el('div', { style: 'display:flex; align-items:center; gap:14px; width:100%' },
          el('span', { class: 'ric c-lavender' }, moodFace(e.value, 'ric-face')),
          el('span', { class: 'rmain' }, el('b', {}, MOODS[e.value] || ''), el('span', {}, time)),
          el('span', { class: 'chev' }, '•')
        ),
        note ? el('div', { class: 'mood-entry-note', style: 'width:100%; margin-left:56px; max-width:calc(100% - 56px)' }, note) : null
      );
    })));
  }
  scr.append(el('p', { class: 'foot' }, 'Каждая точка на этой ленте — запись, а не приговор.'));
  return scr;
}

/* ---------- текстовые задания ---------- */
function screenTasks() {
  renderTabbar('profile');
  const scr = el('div', { class: 'screen sub' });
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => go('profile') }, icon('back'), 'Назад'),
    el('h2', {}, 'Задания')
  ));
  scr.append(el('p', { class: 'subtitle' }, 'Пиши своими словами. Записи видны только тебе — и помогают Дибитишке напоминать, кто ты.'));
  const tasks = CONTENT.tasks || [];
  const filledN = tasks.filter(t => taskFilled(t.id)).length;
  scr.append(el('div', { class: 'group' }, tasks.map(t => {
    const filled = taskFilled(t.id);
    return el('button', { class: 'row', onclick: () => go('task/' + t.id) },
      el('span', { class: 'ric c-sky' }, t.emoji),
      el('span', { class: 'rmain' }, el('b', {}, t.title), el('span', {}, filled ? 'Заполнено' : t.hint)),
      el('span', { class: 'rval' }, filled ? '✓' : '·')
    );
  })));
  scr.append(el('p', { class: 'foot' }, `Заполнено ${filledN} из ${tasks.length}.`));
  return scr;
}

function screenTask(id) {
  renderTabbar(null);
  const t = findTask(id);
  const scr = el('div', { class: 'screen sub' });
  if (!t) {
    scr.append(el('div', { class: 'navbar' }, el('button', { class: 'back', onclick: () => go('tasks') }, icon('back'), 'Назад')));
    return scr;
  }
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => go('tasks') }, icon('back'), 'Назад'),
    el('h2', {}, 'Задание')
  ));
  scr.append(el('h1', { class: 'ltitle' }, `${t.emoji} ${t.title}`, el('small', {}, t.hint)));
  scr.append(el('div', { class: 'card soft' }, el('p', {}, t.prompt)));
  const saved = state.tasks[t.id];
  const ta = el('textarea', { class: 'task-input', id: 'task-text', placeholder: 'Пиши здесь…' });
  ta.value = saved ? saved.text : (t.starter || '');
  scr.append(ta);
  scr.append(el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => {
    const text = ($('#task-text').value || '').trim();
    const was = taskFilled(t.id);
    state.tasks[t.id] = { text, ts: Date.now() };
    save();
    haptic('success');
    reviewBadges(true);
    if (!was && text) confetti();
    toast(text ? 'Сохранено. Дибитишка запомнил(а).' : 'Очищено.');
    go('tasks');
  } }, 'Сохранить'));
  scr.append(el('p', { class: 'foot' }, 'Можно редактировать сколько угодно — это живой документ, а не экзамен.'));
  return scr;
}

function screenWorkbook() {
  renderTabbar('workbook');
  const scr = el('div', { class: 'screen' });
  const w = CONTENT.workbook;
  const full = isPremium();
  scr.append(el('h1', { class: 'ltitle' }, 'Тетрадь', el('small', {}, w.subtitle)));
  // v23: обложка без персонажа — отдельная иллюстрация «DBT diary» в стиле приложения
  scr.append(el('div', { class: 'workbook-art-wrap' },
    el('img', { class: 'workbook-art', src: 'assets/workbook/dbt-diary.png', alt: 'Рабочая тетрадь DBT diary' })
  ));
  const card = el('div', { class: 'card soft' });
  card.append(
    el('h3', {}, w.title),
    el('p', {}, w.intro),
    full
      ? el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => location.href = 'workbook.html?full=1' }, icon('print'), 'Открыть и распечатать')
      : el('div', { class: 'preview-note' },
          el('b', {}, 'Превью: 3 страницы бесплатно'),
          el('span', {}, 'Полная тетрадь открывается с подпиской.')
        )
  );
  if (!full) {
    card.append(
      el('button', { class: 'btn secondary', style: 'margin-top:12px', onclick: () => location.href = 'workbook.html' }, 'Смотреть превью'),
      el('button', { class: 'btn', style: 'margin-top:8px', onclick: openPay }, 'Открыть полную — оформить подписку')
    );
  }
  card.append(el('button', { class: 'btn ghost', style: 'margin-top:8px', onclick: () => go('merch') }, 'Печатная версия и мерч'));
  scr.append(card);
  scr.append(el('div', { class: 'sect' }, 'Что внутри'));
  scr.append(el('div', { class: 'group' }, CONTENT.blocks.map(b =>
    el('div', { class: 'row row-tint cbar-' + b.tint },
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
  scr.append(mascot('cozy', name ? `Привет, ${name}! Всё важное собрано здесь.` : 'Привет! Здесь живут твоя подписка, настройки и шкалы роста.', TG_MODE ? 'Вход через Telegram' : state.web_user ? 'Вход по коду из бота' : 'Гостевой режим'));
  scr.append(levelCard());
  // v25: «Подписка» и «Донат» подняты наверх и собраны в одну композицию
  scr.append(subscriptionCard());

  // график настроения поднят в верх профиля — сразу под шкалой уровня
  scr.append(el('div', { class: 'sect tight' }, 'График настроения'));
  const graphCard = el('div', { class: 'card soft mood-card' });
  graphCard.append(
    el('h3', {}, 'Это лишь точка на пути'),
    moodGraph(14),
    el('button', { class: 'btn secondary', style: 'margin-top:12px', onclick: () => go('diary') }, 'Открыть дневник эмоций')
  );
  scr.append(graphCard);

  scr.append(el('div', { class: 'stats-grid' },
    el('div', { class: 'stat-pill' }, el('i', {}, '✨'), el('b', {}, String(levelInfo().points)), el('span', {}, 'Очков роста')),
    el('div', { class: 'stat-pill' }, el('i', {}, '🔥'), el('b', {}, String(streakCount())), el('span', {}, plural(streakCount(), 'день', 'дня', 'дней'))),
    el('div', { class: 'stat-pill' }, el('i', {}, '📔'), el('b', {}, String(moodEntriesCount())), el('span', {}, plural(moodEntriesCount(), 'запись', 'записи', 'записей')))
  ));
  scr.append(scaleBoard('Твой прогресс'));
  scr.append(badgeBoard());

  scr.append(el('div', { class: 'sect' }, 'Мои задания'));
  const tasks = CONTENT.tasks || [];
  const tasksFilledN = tasks.filter(t => taskFilled(t.id)).length;
  scr.append(el('div', { class: 'daily' },
    ring(tasks.length ? tasksFilledN / tasks.length : 0),
    el('div', { class: 'dm' },
      el('b', {}, `${tasksFilledN} из ${tasks.length} заполнено`),
      el('span', {}, 'Антикризисный план, колесо баланса и другие письменные опоры')
    ),
    el('button', { class: 'btn ghost', style: 'width:auto;min-height:0;padding:8px 12px;font-size:14px', onclick: () => go('tasks') }, 'Открыть ›')
  ));
  scr.append(el('div', { class: 'group', style: 'margin-top:14px' },
    el('button', { class: 'row', onclick: () => go('boards') },
      el('span', { class: 'ric c-sky' }, icon('image')),
      el('span', { class: 'rmain' }, el('b', {}, 'Доски впечатлений'), el('span', {}, `${boardsTeaserTitle()} · фото, гифки, стихи и мысли`)),
      el('span', { class: 'chev' }, '›')
    )
  ));

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
  const pick = el('div', { class: 'palette-pick' });
  for (const [id, p] of Object.entries(PALETTES)) {
    pick.append(el('button', {
      class: `palette-opt${id === paletteId() ? ' on' : ''}`, onclick: () => setPalette(id),
      'aria-pressed': id === paletteId() ? 'true' : 'false'
    },
      el('span', { class: `swatch sw-${id === 'pink' ? 'peony' : 'sky'}` }, el('i'), el('i'), el('i')),
      el('b', {}, p.title),
      el('span', {}, p.note),
      el('span', { class: 'tick', 'aria-hidden': 'true' }, icon('check'))
    ));
  }
  scr.append(pick, el('p', { class: 'mins', style: 'margin:8px 4px' }, 'Тема всегда светлая — цвет выбирай под настроение.'));

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

  scr.append(el('p', { class: 'foot' }, 'Версия 1.3 · Air · Glow', el('br'), CONTENT.meta.credits));
  return scr;
}

function openLink(u) {
  if (!u) return;
  try { tg && tg.openTelegramLink && u.startsWith('https://t.me') ? tg.openTelegramLink(u) : window.open(u, '_blank'); } catch (e) { window.open(u, '_blank'); }
}

async function syncPremium() {
  if (!API_BASE) return;
  const uid = TG_MODE ? tg.initDataUnsafe.user.id : state.web_user?.id;
  if (!uid) return;
  try {
    const r = await fetch(apiUrl('/me?user_id=' + encodeURIComponent(uid)));
    const j = await r.json();
    if (j && j.ok) {
      if (typeof j.premium_until === 'number') state.premium_until = j.premium_until || 0;
      if (typeof j.trial_start === 'number' && j.trial_start && !state.trial_started_at) state.trial_started_at = j.trial_start;
      save();
    }
  } catch (e) {}
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
            syncPremium();
            render();
          } else toast('Код не подошёл или устарел.');
        } catch (e) { toast('Не удалось связаться с ботом.'); }
      } }, 'Войти'),
      el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { openLink(`https://t.me/${CFG.bot_username || ''}`); } }, 'Открыть бота за кодом')
    );
  });
}

/* ============================================================
   v25 · Доска впечатлений
   ------------------------------------------------------------
   Отдельная страница: доски, которые человек собирает сам, чтобы
   вспомнить, кто он, что любит и чем вдохновляется.
   - фон доски: готовые темы или своё фото;
   - плитки: фото из галереи, GIF по ссылке, заметки, стихи и мысли;
   - досок может быть много (по темам), внутри — поиск по тегам и подписям.
   Картинки лежат в IndexedDB (в localStorage ~5 МБ, для фото мало),
   метаданные — в localStorage под своим ключом.
   ============================================================ */
const BOARDS_KEY = 'dibitishka.boards.v1';
const MEDIA_URLS = new Map();     // key → objectURL (чтобы не читать IndexedDB на каждый рендер)
let MEDIA_DB = null;

function mediaDB() {
  if (MEDIA_DB) return Promise.resolve(MEDIA_DB);
  return new Promise((res) => {
    try {
      const r = indexedDB.open('dibitishka.media', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      };
      r.onsuccess = () => { MEDIA_DB = r.result; res(MEDIA_DB); };
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function mediaPut(key, blob) {
  const db = await mediaDB();
  if (!db) return false;
  return new Promise((res) => {
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').put(blob, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => res(false);
  });
}
async function mediaGet(key) {
  const db = await mediaDB();
  if (!db) return null;
  return new Promise((res) => {
    const tx = db.transaction('media', 'readonly');
    const q = tx.objectStore('media').get(key);
    q.onsuccess = () => res(q.result || null);
    q.onerror = () => res(null);
  });
}
async function mediaDel(key) {
  MEDIA_URLS.delete(key);
  const db = await mediaDB();
  if (!db) return;
  const tx = db.transaction('media', 'readwrite');
  tx.objectStore('media').delete(key);
}
// ссылки и картинки-файлы живут в одном поле src: http(s)/data:/blob: отдаём как есть
function mediaUrl(src) {
  if (!src) return Promise.resolve('');
  if (/^(https?:|data:|blob:)/.test(src)) return Promise.resolve(src);
  if (MEDIA_URLS.has(src)) return Promise.resolve(MEDIA_URLS.get(src));
  return mediaGet(src).then(blob => {
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    MEDIA_URLS.set(src, url);
    return url;
  });
}
// после рендера заполняем <img data-media="ключ"> реальными ссылками
function hydrateMedia(root) {
  root.querySelectorAll('[data-media]').forEach(async (node) => {
    const url = await mediaUrl(node.dataset.media);
    if (url) node.src = url;
    else { node.classList.add('media-missing'); node.closest('.tile')?.classList.add('tile-broken'); }
  });
}

/* --- уменьшаем фото перед сохранением: 1400px по длинной стороне, jpeg 82% --- */
function fileToImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    img.src = url;
  });
}
async function compressImage(file, max = 1400, quality = 0.82) {
  try {
    const img = await fileToImage(file);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
    return blob || file;
  } catch (e) { return file; }
}
function pickFiles(accept, multiple, cb) {
  const inp = el('input', { type: 'file', accept, style: 'display:none', ...(multiple ? { multiple: '' } : {}) });
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const files = [...(inp.files || [])];
    inp.remove();
    for (const f of files) await cb(f);
  });
  inp.click();
}

/* --- фоны досок: спокойные, в стиле приложения --- */
const BOARD_BGS = [
  { id: 'sky',      title: 'Небо',    css: 'linear-gradient(180deg,#EAF1FE,#D7E5FB)' },
  { id: 'peony',    title: 'Пион',    css: 'linear-gradient(180deg,#FBEFF3,#F5DBE5)' },
  { id: 'grass',    title: 'Луг',     css: 'linear-gradient(180deg,#F3F4E5,#E3E7CB)' },
  { id: 'sand',     title: 'Тёплый',  css: 'linear-gradient(180deg,#FCF5EB,#F1E1CB)' },
  { id: 'lavender', title: 'Лаванда', css: 'linear-gradient(180deg,#F1EFFA,#E1DCF4)' },
  { id: 'paper',    title: 'Бумага',  css: 'repeating-linear-gradient(180deg,#FDFBF6 0 26px,#F4EFE4 26px 27px)' },
  { id: 'dots',     title: 'Горошек', css: 'radial-gradient(#DCE6FA 1.6px, transparent 1.7px) 0 0/22px 22px, #F7FAFF' },
  { id: 'grid',     title: 'Клетка',  css: 'linear-gradient(#EEF3FD 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg,#EEF3FD 1px, transparent 1px) 0 0/24px 24px, #FBFDFF' },
  { id: 'stars',    title: 'Звёзды',  css: 'radial-gradient(circle at 20% 30%, #FFF 2px, transparent 3px), radial-gradient(circle at 70% 70%, #FFF 2px, transparent 3px), linear-gradient(180deg,#E7EEFC,#D5E0F8)' }
];
const bgDef = (id) => BOARD_BGS.find(b => b.id === id) || BOARD_BGS[0];

const loadBoards = () => {
  try {
    const j = JSON.parse(localStorage.getItem(BOARDS_KEY));
    return Array.isArray(j) ? j : null;
  } catch (e) { return null; }
};
const boardUid = () => 'b' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const tileUid = () => 't' + Math.random().toString(36).slice(2, 8);
function seedBoards() {
  return [{
    id: boardUid(), title: 'Моё вдохновение', bg: 'sky', created: Date.now(),
    tiles: [
      { id: tileUid(), kind: 'note', text: 'Это доска про тебя. Что ты любишь? Чем вдохновляешься? Что напоминает, кто ты?', tags: ['начало'], rot: -1.5, size: 'm', created: Date.now() },
      { id: tileUid(), kind: 'note', text: 'Сюда можно положить фото из галереи, гифку по ссылке, стихотворение или мысль, которая заставляет дышать по-новому.', tags: [], rot: 1.2, size: 'm', created: Date.now() }
    ]
  }];
}
let BOARDS = loadBoards();
if (!BOARDS) { BOARDS = seedBoards(); }
const saveBoards = () => { try { localStorage.setItem(BOARDS_KEY, JSON.stringify(BOARDS)); } catch (e) { toast('Память переполнена — попробуй убрать пару тяжёлых фото.'); } };
const boardById = (id) => BOARDS.find(b => b.id === id);
const boardTiles = (b) => [...(b.tiles || [])].sort((x, y) => (x.created || 0) - (y.created || 0));
const boardTileCount = (b) => (b.tiles || []).length;
const allBoardTiles = () => BOARDS.flatMap(b => boardTiles(b).map(t => ({ board: b, tile: t })));

function boardsTeaserTitle() {
  const n = BOARDS.length;
  if (!n) return 'Собрать первую доску';
  const tiles = BOARDS.reduce((s, b) => s + boardTileCount(b), 0);
  return `${n} ${plural(n, 'доска', 'доски', 'досок')} · ${tiles} ${plural(tiles, 'впечатление', 'впечатления', 'впечатлений')}`;
}

function boardBgStyle(b) {
  if (b.bg === 'photo' && b.bgKey) {
    const url = MEDIA_URLS.get(b.bgKey);
    return url ? `background-image:url('${url}'); background-size:cover; background-position:center` : 'background:#F3F6FD';
  }
  return `background:${bgDef(b.bg).css}`;
}

/* --- плитка на доске: фото, гифка или заметка --- */
function tileEl(b, t) {
  const box = el('div', { class: `tile tile-${t.kind} size-${t.size || 'm'}` });
  box.style.setProperty('--rot', (t.rot || 0) + 'deg');
  if (t.kind === 'photo') {
    box.append(el('img', { class: 'tile-media', 'data-media': t.src, alt: t.caption || 'фото на доске', loading: 'lazy' }));
  } else if (t.kind === 'gif') {
    box.append(el('img', { class: 'tile-media', src: t.src, alt: t.caption || 'gif', loading: 'lazy', referrerpolicy: 'no-referrer' }));
    box.append(el('span', { class: 'tile-gif-mark' }, 'GIF'));
  } else {
    box.append(el('p', { class: 'tile-note' }, t.text || ''));
  }
  if (t.caption && t.kind !== 'note') box.append(el('span', { class: 'tile-cap' }, t.caption));
  if ((t.tags || []).length) box.append(el('span', { class: 'tile-tags' }, t.tags.map(x => '#' + x).join(' ')));
  box.addEventListener('click', () => tileSheet(b, t));
  return box;
}

function saveTiles(b) {
  BOARDS = BOARDS.map(x => x.id === b.id ? b : x);
  saveBoards();
}

/* --- лист действий по плитке --- */
function tileSheet(b, t) {
  sheet((sh, close) => {
    const capInput = el('input', { class: 'board-input', value: t.caption || '', placeholder: t.kind === 'note' ? 'Текст заметки' : 'Подпись к картинке' });
    const tagInput = el('input', { class: 'board-input', value: (t.tags || []).join(', '), placeholder: 'теги: вдохновение, лето, море' });
    sh.append(
      el('h3', {}, t.kind === 'note' ? 'Заметка' : t.kind === 'gif' ? 'Гифка' : 'Фото'),
      el('p', { class: 'mins' }, 'Подпись и теги помогают потом искать: по тегам работает поиск на доске и в списке досок.'),
      capInput, tagInput,
      el('div', { class: 'sect tight' }, 'Размер')
    );
    const sizeRow = el('div', { class: 'chips' });
    [['s', 'маленькая'], ['m', 'средняя'], ['l', 'большая']].forEach(([id, label]) => sizeRow.append(el('button', {
      class: 'chip' + ((t.size || 'm') === id ? ' on' : ''),
      onclick: () => { t.size = id; saveTiles(b); close(); render(); }
    }, label)));
    sh.append(sizeRow,
      el('div', { class: 'chips' },
        el('button', { class: 'chip', onclick: () => { t.rot = Math.max(-8, (t.rot || 0) - 2); saveTiles(b); close(); render(); } }, '⟲ наклонить'),
        el('button', { class: 'chip', onclick: () => { t.rot = Math.min(8, (t.rot || 0) + 2); saveTiles(b); close(); render(); } }, '⟳ выпрямить')
      ),
      el('button', { class: 'btn', style: 'margin-top:14px', onclick: () => {
        const text = capInput.value.trim();
        if (t.kind === 'note') t.text = text || t.text;
        else t.caption = text || undefined;
        t.tags = tagInput.value.split(/[,\s]+/).map(x => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 8);
        saveTiles(b); close(); haptic('light'); toast('Сохранено.'); render();
      } }, 'Сохранить'),
      t.kind === 'photo' ? el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => {
        b.bg = 'photo'; b.bgKey = t.src; saveBoards(); close(); toast('Это фото стало фоном доски.'); render();
      } }, 'Поставить фоном доски') : null,
      el('button', { class: 'btn ghost', style: 'margin-top:8px', onclick: async () => {
        if (t.kind === 'photo') await mediaDel(t.src);
        b.tiles = (b.tiles || []).filter(x => x.id !== t.id);
        saveTiles(b); close(); haptic('success'); toast('Убрано с доски.'); render();
      } }, 'Убрать с доски')
    );
  });
}

/* --- добавление плиток --- */
function addTileSheet(b) {
  sheet((sh, close) => {
    sh.append(
      el('h3', {}, 'Что добавим?'),
      el('p', { class: 'mins' }, 'Фото можно выбрать из галереи, гифку — вставить ссылкой, а мысли и стихи просто написать.'),
      el('div', { class: 'add-grid' },
        el('button', { class: 'add-opt', onclick: () => { close(); addPhotosToBoard(b); } },
          el('span', { class: 'ric c-sky' }, icon('image')), el('b', {}, 'Фото из галереи'), el('span', {}, 'можно несколько сразу')),
        el('button', { class: 'add-opt', onclick: () => { close(); addGifSheet(b); } },
          el('span', { class: 'ric c-lavender' }, icon('gif')), el('b', {}, 'GIF по ссылке'), el('span', {}, 'вставь адрес гифки или найди её в Tenor')),
        el('button', { class: 'add-opt', onclick: () => { close(); addNoteSheet(b); } },
          el('span', { class: 'ric c-grass' }, icon('note')), el('b', {}, 'Заметка, стихи, мысль'), el('span', {}, 'то, что заставляет дышать по-новому'))
      )
    );
  });
}
function addPhotosToBoard(b) {
  toast('Добавляю фото…');
  pickFiles('image/*', true, async (file) => {
    const blob = await compressImage(file);
    const key = 'm' + tileUid();
    const stored = await mediaPut(key, blob);
    b.tiles = [...(b.tiles || []), stored
      ? { id: tileUid(), kind: 'photo', src: key, caption: '', tags: [], rot: (Math.random() * 4 - 2), size: (b.tiles || []).length % 3 === 0 ? 'l' : 'm', created: Date.now() }
      : { id: tileUid(), kind: 'note', text: 'Фото не сохранилось — попробуй ещё раз.', tags: [], rot: 0, size: 'm', created: Date.now() }];
    saveTiles(b);
    render();
  });
}
function addGifSheet(b) {
  const urlInput = el('input', { class: 'board-input', placeholder: 'https://media.tenor.com/… .gif' });
  const tagInput = el('input', { class: 'board-input', placeholder: 'теги: кот, дождь, поддержка' });
  sheet((sh, close) => {
    sh.append(
      el('h3', {}, 'GIF по ссылке'),
      el('p', { class: 'mins' }, 'Открой Tenor или Giphy по своим тегам, скопируй адрес гифки (или ссылку на картинку) и вставь сюда — она появится на доске. Если анимацию хочется взять из галереи, сохрани её как фото.'),
      urlInput, tagInput,
      el('button', { class: 'btn secondary', style: 'margin-top:10px', onclick: () => {
        const q = tagInput.value.trim() || 'вдохновение';
        openLink('https://tenor.com/search/' + encodeURIComponent(q.replace(/\s+/g, '-')));
      } }, 'Найти в Tenor по тегам', el('span', { class: 'arr' }, '→')),
      el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => {
        const src = urlInput.value.trim();
        if (!/^https?:\/\//i.test(src)) return toast('Нужна ссылка на гифку или картинку.');
        b.tiles = [...(b.tiles || []), {
          id: tileUid(), kind: 'gif', src, caption: '',
          tags: tagInput.value.split(/[,\s]+/).map(x => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 8),
          rot: (Math.random() * 4 - 2), size: 'm', created: Date.now()
        }];
        saveTiles(b); close(); haptic('success'); toast('Гифка на доске.'); render();
      } }, 'Добавить на доску')
    );
  });
}
function addNoteSheet(b) {
  const ta = el('textarea', { class: 'mood-note-input', rows: 5, placeholder: 'Мысль, строки, цитата — то, что держит…' });
  const tagInput = el('input', { class: 'board-input', placeholder: 'теги: опора, тёплое, вечер' });
  sheet((sh, close) => {
    sh.append(
      el('h3', {}, 'Заметка на доску'),
      ta, tagInput,
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => {
        const text = ta.value.trim();
        if (!text) return toast('Напиши хотя бы строку.');
        b.tiles = [...(b.tiles || []), {
          id: tileUid(), kind: 'note', text,
          tags: tagInput.value.split(/[,\s]+/).map(x => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 8),
          rot: (Math.random() * 4 - 2), size: 'm', created: Date.now()
        }];
        saveTiles(b); close(); haptic('success'); toast('На доске.'); render();
      } }, 'Добавить на доску')
    );
  });
}

/* --- фон доски --- */
function boardBgSheet(b) {
  sheet((sh, close) => {
    const grid = el('div', { class: 'bg-grid' });
    for (const bg of BOARD_BGS) {
      grid.append(el('button', {
        class: 'bg-opt' + (b.bg === bg.id ? ' on' : ''), style: `background:${bg.css}`,
        onclick: () => { b.bg = bg.id; b.bgKey = null; saveBoards(); close(); haptic('light'); render(); }
      }, el('span', {}, bg.title)));
    }
    sh.append(
      el('h3', {}, 'Фон доски'),
      el('p', { class: 'mins' }, 'Можно взять готовую тему или поставить своё фото.'),
      grid,
      el('button', { class: 'btn secondary', style: 'margin-top:12px', onclick: () => {
        pickFiles('image/*', false, async (file) => {
          const blob = await compressImage(file, 1600, .8);
          const key = 'bg' + tileUid();
          const stored = await mediaPut(key, blob);
          if (!stored) return toast('Не получилось сохранить фото.');
          b.bg = 'photo'; b.bgKey = key;
          saveBoards(); close(); toast('Фон обновлён.'); render();
        });
      } }, icon('image'), 'Своё фото фоном')
    );
  });
}

/* --- экран со списком досок --- */
function screenBoards() {
  renderTabbar(null);
  const scr = el('div', { class: 'screen sub' });
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => go('') }, icon('back'), 'Назад'),
    el('h2', {}, 'Доски впечатлений')
  ));
  scr.append(el('h1', { class: 'ltitle' }, 'Доски впечатлений',
    el('small', {}, 'То, что заставляет понять, кто ты, что любишь и чем вдохновляешься. Иногда это очень важно вспомнить.')));
  scr.append(el('div', { class: 'mascot-wrap peeking' },
    el('img', { class: 'mascot', src: 'assets/mascot/notebook.png', alt: 'Дибитишка' }),
    el('div', { class: 'bubble' }, 'Заведи сколько угодно досок: «любимое», «вдохновение», «стихи», «лето». На каждой — свой фон, фото, гифки и заметки.')
  ));

  // поиск по тегам и подписям — сразу по всем доскам
  const q = el('input', { class: 'board-search', type: 'search', placeholder: 'Поиск по тегам и подписям (#море, стихи…)' });
  const found = el('div', { class: 'found-list hidden' });
  const redraw = (term) => {
    const s = (term || '').trim().toLowerCase().replace(/^#/, '');
    found.innerHTML = '';
    if (!s) { found.classList.add('hidden'); return; }
    const hits = allBoardTiles().filter(({ tile }) =>
      (tile.tags || []).some(x => x.toLowerCase().includes(s)) ||
      (tile.caption || '').toLowerCase().includes(s) ||
      (tile.text || '').toLowerCase().includes(s));
    found.classList.remove('hidden');
    if (!hits.length) { found.append(el('p', { class: 'mins' }, 'Ничего не нашлось. Теги ставятся в карточке плитки.')); return; }
    for (const { board, tile } of hits.slice(0, 40)) {
      found.append(el('button', { class: 'row', onclick: () => go('board/' + board.id) },
        el('span', { class: 'ric c-sky' }, tile.kind === 'photo' ? icon('image') : tile.kind === 'gif' ? icon('gif') : icon('note')),
        el('span', { class: 'rmain' }, el('b', {}, tile.caption || tile.text || 'Плитка'),
          el('span', {}, board.title + ((tile.tags || []).length ? ' · ' + tile.tags.map(x => '#' + x).join(' ') : ''))),
        el('span', { class: 'chev' }, '›')
      ));
    }
  };
  q.addEventListener('input', () => redraw(q.value));
  scr.append(q, found);

  scr.append(el('div', { class: 'sect tight' }, 'Мои доски'));
  const grid = el('div', { class: 'boards-grid' });
  for (const b of BOARDS) {
    const cover = el('button', { class: 'board-cover', onclick: () => go('board/' + b.id) });
    cover.style.cssText = boardBgStyle(b);
    const preview = el('span', { class: 'cover-thumbs' });
    const media = boardTiles(b).filter(t => t.kind !== 'note').slice(0, 3);
    if (media.length) {
      for (const t of media) preview.append(el('img', {
        src: t.kind === 'gif' ? t.src : '', 'data-media': t.kind === 'photo' ? t.src : null, alt: '', loading: 'lazy'
      }));
    } else {
      const notes = boardTiles(b).filter(t => t.kind === 'note').slice(0, 1);
      preview.append(el('span', { class: 'cover-quote' }, (notes[0]?.text || 'пусто — добавь первое впечатление').slice(0, 90)));
    }
    cover.append(preview,
      el('span', { class: 'cover-foot' },
        el('b', {}, b.title),
        el('span', {}, `плиток: ${boardTileCount(b)}`)));
    grid.append(cover);
  }
  scr.append(grid);
  scr.append(el('button', { class: 'btn', style: 'margin-top:16px', onclick: () => newBoardSheet() }, '＋ Новая доска'));
  scr.append(el('p', { class: 'foot' }, 'Доски хранятся на этом устройстве. Сюда можно возвращаться в любой момент — это твоё место.'));
  return scr;
}

function newBoardSheet() {
  const title = el('input', { class: 'board-input', placeholder: 'Название: «Любимое», «Вдохновение», «Лето»…' });
  let bg = 'sky';
  sheet((sh, close) => {
    const grid = el('div', { class: 'bg-grid' });
    for (const b of BOARD_BGS) {
      grid.append(el('button', {
        class: 'bg-opt' + (bg === b.id ? ' on' : ''), style: `background:${b.css}`,
        onclick: (e) => {
          bg = b.id;
          grid.querySelectorAll('.bg-opt').forEach(x => x.classList.remove('on'));
          e.currentTarget.classList.add('on');
        }
      }, el('span', {}, b.title)));
    }
    sh.append(
      el('h3', {}, 'Новая доска'),
      el('p', { class: 'mins' }, 'Досок может быть много — например, по темам: «что меня радует», «места», «люди», «стихи».'),
      title,
      el('div', { class: 'sect tight' }, 'Фон'),
      grid,
      el('button', { class: 'btn', style: 'margin-top:14px', onclick: () => {
        const name = title.value.trim();
        if (!name) return toast('Дай доске имя — хотя бы одно слово.');
        const b = { id: boardUid(), title: name, bg, tiles: [], created: Date.now() };
        BOARDS = [...BOARDS, b];
        saveBoards(); close(); haptic('success');
        go('board/' + b.id);
      } }, 'Создать')
    );
  });
}

/* --- сама доска --- */
function screenBoard(id) {
  renderTabbar(null);
  const scr = el('div', { class: 'screen sub' });
  const b = boardById(id);
  scr.append(el('div', { class: 'navbar' },
    el('button', { class: 'back', onclick: () => go('boards') }, icon('back'), 'Доски'),
    el('h2', {}, b ? b.title : 'Доска')
  ));
  if (!b) {
    scr.append(el('div', { class: 'card soft' }, el('h3', {}, 'Доска не найдена'), el('p', {}, 'Возможно, она была удалена.')));
    return scr;
  }
  scr.append(el('div', { class: 'board-head' },
    el('div', { class: 'board-head-copy' },
      el('b', {}, b.title),
      el('span', {}, `${boardTileCount(b)} ${plural(boardTileCount(b), 'впечатление', 'впечатления', 'впечатлений')} на доске`)),
    el('button', { class: 'icon-btn', 'aria-label': 'Настройки доски', onclick: () => boardMenuSheet(b) }, '⋯')
  ));

  // фильтр по тегам внутри доски
  const q = el('input', { class: 'board-search', type: 'search', placeholder: 'Поиск по тегам: #море, #тёплое' });
  const canvas = el('div', { class: 'board-canvas' });
  canvas.style.cssText = boardBgStyle(b);
  const drawTiles = (term = '') => {
    canvas.innerHTML = '';
    const s = term.trim().toLowerCase().replace(/^#/, '');
    const list = boardTiles(b).filter(t => !s ||
      (t.tags || []).some(x => x.toLowerCase().includes(s)) ||
      (t.caption || '').toLowerCase().includes(s) ||
      (t.text || '').toLowerCase().includes(s));
    if (!list.length) {
      canvas.append(el('div', { class: 'board-empty' },
        el('b', {}, b.tiles.length ? 'По этому тегу ничего нет' : 'Пока пусто'),
        el('span', {}, b.tiles.length ? 'Попробуй другой тег или очисти поиск.' : 'Добавь первое фото, гифку или мысль — доска начнёт собираться.')));
      return;
    }
    for (const t of list) canvas.append(tileEl(b, t));
  };
  q.addEventListener('input', () => drawTiles(q.value));
  drawTiles();
  scr.append(q, canvas);
  scr.append(el('div', { class: 'board-actions' },
    el('button', { class: 'btn', onclick: () => addTileSheet(b) }, '＋ Добавить'),
    el('button', { class: 'btn secondary', 'aria-label': 'Фон доски', onclick: () => boardBgSheet(b) }, icon('image'), 'Фон')
  ));
  // фон-картинку подтягиваем после отрисовки (объект-ссылки из IndexedDB)
  if (b.bg === 'photo' && b.bgKey && !MEDIA_URLS.has(b.bgKey)) {
    mediaUrl(b.bgKey).then(() => { canvas.style.cssText = boardBgStyle(b); });
  }
  return scr;
}

function boardMenuSheet(b) {
  const title = el('input', { class: 'board-input', value: b.title, placeholder: 'Название доски' });
  sheet((sh, close) => {
    sh.append(
      el('h3', {}, 'Настройки доски'),
      title,
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => {
        const name = title.value.trim();
        if (!name) return toast('Название пустое.');
        b.title = name; saveBoards(); close(); toast('Название обновлено.'); render();
      } }, 'Сохранить название'),
      el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { close(); boardBgSheet(b); } }, icon('image'), 'Сменить фон'),
      el('button', { class: 'btn ghost', style: 'margin-top:8px', onclick: async () => {
        for (const t of b.tiles || []) if (t.kind === 'photo') await mediaDel(t.src);
        if (b.bgKey) await mediaDel(b.bgKey);
        BOARDS = BOARDS.filter(x => x.id !== b.id);
        saveBoards(); close(); haptic('success'); toast('Доска удалена.'); go('boards');
      } }, 'Удалить доску')
    );
  });
}

/* ============================================================
   v25 · «Поделиться» — карточка настроения картинкой
   ============================================================ */
function loadImg(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function wrapText(g, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text).split(/\s+/);
  let line = '', lines = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (g.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((l, i) => g.fillText(l, x, y + i * lineHeight));
  return lines;
}
const lastMoodNote = () => {
  const e = moodTodayValue();
  return (e && (e.note || '').trim()) || '';
};
async function renderMoodCard() {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cur = moodTodayValue();
  const v = cur ? cur.value : 4;
  const pink = paletteId() === 'pink';
  const grad = g.createLinearGradient(0, 0, W, H);
  if (pink) { grad.addColorStop(0, '#FCEFF5'); grad.addColorStop(.55, '#F7E3EE'); grad.addColorStop(1, '#EEDCEA'); }
  else { grad.addColorStop(0, '#EDF3FE'); grad.addColorStop(.55, '#E2ECFD'); grad.addColorStop(1, '#D8E6FB'); }
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const blob = (x, y, r, col) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  };
  blob(180, 170, 520, 'rgba(255,255,255,.9)');
  blob(940, 1180, 520, pink ? 'rgba(216,164,175,.35)' : 'rgba(126,147,194,.28)');
  g.save();
  g.shadowColor = 'rgba(40,70,130,.18)'; g.shadowBlur = 60; g.shadowOffsetY = 24;
  g.fillStyle = '#fff';
  roundRect(g, 90, 110, W - 180, H - 220, 68); g.fill();
  g.restore();
  const logo = await loadImg(brandLogo());
  if (logo) {
    const lw = 560, lh = lw / (logo.width / logo.height);
    g.drawImage(logo, (W - lw) / 2, 165, lw, lh);
  }
  const face = await loadImg(moodFaceSrc(v));
  if (face) g.drawImage(face, (W - 520) / 2, 300, 520, 520);
  g.textAlign = 'center';
  g.fillStyle = '#1E2A45';
  g.font = '800 62px "Nunito", "Segoe UI", system-ui, sans-serif';
  g.fillText(`Сейчас мне: ${MOODS[v].toLowerCase()}`, W / 2, 930);
  const note = lastMoodNote() || dailyPhrase();
  g.fillStyle = '#48557A';
  g.font = '500 42px "Nunito", "Segoe UI", system-ui, sans-serif';
  wrapText(g, `«${note}»`, W / 2, 1010, W - 300, 58, 4);
  const d = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  g.fillStyle = '#7C89AB';
  g.font = '600 32px "Nunito", "Segoe UI", system-ui, sans-serif';
  g.fillText(d, W / 2, 1215);
  g.font = '700 30px "Nunito", "Segoe UI", system-ui, sans-serif';
  g.fillText('Дибитишка · бережно, шаг за шагом', W / 2, 1272);
  return new Promise(res => c.toBlob(res, 'image/png'));
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
async function shareMoodCard() {
  haptic('light');
  const cur = moodTodayValue();
  const blob = await renderMoodCard().catch(() => null);
  const note = lastMoodNote();
  const text = `${cur ? 'Мне сейчас: ' + MOODS[cur.value].toLowerCase() : 'Дибитишка — про состояние и опору'}${note ? '\n«' + note + '»' : ''}`;
  if (!blob) { toast('Не получилось собрать карточку — попробуй ещё раз.'); return; }
  const file = new File([blob], 'dibitishka-mood.png', { type: 'image/png' });
  // 1) нативный «поделиться» с картинкой (работает и внутри Telegram)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      haptic('success');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  // 2) запасной путь: сохраняем картинку и кладём подпись в буфер
  downloadBlob(blob, 'dibitishka-mood.png');
  copyText(text);
  toast('Карточка сохранена — можно отправить её в чат или сторис.');
  haptic('success');
}

/* ---------- профиль: подписка и поддержка одним блоком (v25) ----------
   Раньше «Подписка» жила в середине профиля, а «Донат» — в самом низу.
   Теперь это одна композиция сразу под шкалой уровня: статус, продление и
   донат рядом, чтобы важное не приходилось искать. */
function subscriptionCard() {
  const dl = trialDaysLeft();
  const active = (state.premium_until || 0) > Date.now();
  const status = active ? 'Подписка активна'
    : (state.trial_started_at && dl > 0) ? `Бесплатная неделя: ещё ${dl} ${plural(dl, 'день', 'дня', 'дней')}`
    : 'Подписка не активна';
  const note = active ? `Продлить можно в любой момент · ${plansLine()}`
    : isPremium() ? `${plansLine()} · продление в Telegram через Tribute`
    : `${plansLine()} · первая неделя бесплатно`;
  return el('section', { class: 'support-card' },
    el('div', { class: 'support-head' },
      el('span', { class: 'ric c-grass' }, icon('card')),
      el('div', { class: 'support-copy' }, el('b', {}, status), el('span', {}, note))
    ),
    el('div', { class: 'support-actions' },
      el('button', { class: 'btn', onclick: openPay }, isPremium() ? 'Продлить подписку' : 'Оформить подписку'),
      el('button', { class: 'btn secondary', onclick: () => openLink(CFG.donate_url) }, icon('heart'), 'Донат')
    ),
    el('p', { class: 'mins support-note' }, 'Подписка открывает практики, дневник, задания и тетрадь. Донат — разовое спасибо разработчикам, он ничего не меняет в доступе.')
  );
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
    case 'chat': scr = screenChat(); break;
    case 'boards': scr = screenBoards(); break;
    case 'board': scr = screenBoard(r.b); break;
    case 'diary': scr = screenDiary(); break;
    case 'tasks': scr = screenTasks(); break;
    case 'task': scr = screenTask(r.b); break;
    case 'workbook': scr = screenWorkbook(); break;
    case 'merch': scr = screenMerch(); break;
    case 'profile': scr = screenProfile(); break;
    default: scr = screenToday();
  }
  app.append(scr);
  bindMascotFriends(app);
  hydrateMedia(app);          // картинки досок живут в IndexedDB — подставляем ссылки
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
  syncPremium();
  render();
  setTimeout(() => $('#splash').classList.add('gone'), 1500);
})();
