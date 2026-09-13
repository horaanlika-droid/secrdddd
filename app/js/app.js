/* дибитишка · веб-приложение (TG Mini App + GitHub Pages) */

const CFG = window.DIBI_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
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
  drop: svg('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>')
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
const state = Object.assign({
  onboarded: false,
  trial_started_at: null,
  premium_until: 0,
  theme: 'system',
  mastered: {},
  done: {},          // { 'YYYY-MM-DD': [practiceId] }
  mood: {},          // { 'YYYY-MM-DD': moodIndex }
  reminders: { on: false, time: '09:00' },
  merch_notify: [],
  web_user: null     // { id, name } после входа по коду
}, load());
const save = () => localStorage.setItem(DB, JSON.stringify(state));

const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TRIAL_MS = (CFG.subscription?.trial_days ?? 7) * 86400000;
const isPremium = () => (state.premium_until || 0) > Date.now() ||
  (state.trial_started_at && Date.now() - state.trial_started_at < TRIAL_MS);
const trialDaysLeft = () => {
  if ((state.premium_until || 0) > Date.now()) return Infinity;
  if (!state.trial_started_at) return CFG.subscription?.trial_days ?? 7;
  return Math.max(0, Math.ceil((TRIAL_MS - (Date.now() - state.trial_started_at)) / 86400000));
};

/* ---------- content ---------- */
let CONTENT = null;
async function loadContent() {
  const cached = localStorage.getItem('dibi.content');
  if (cached) { try { CONTENT = JSON.parse(cached); } catch (e) {} }
  const urls = [];
  if (CFG.bot_public_url) urls.push(CFG.bot_public_url.replace(/\/$/, '') + '/content.json');
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
        if (!CONTENT || (j.version || 0) >= (CONTENT.version || 0)) { CONTENT = j; localStorage.setItem('dibi.content', JSON.stringify(j)); }
        break;
      }
    } catch (e) { /* offline or no bot: fall through */ }
  }
  if (!CONTENT) throw new Error('no content');
}
const allPractices = () => CONTENT.blocks.flatMap(b => b.practices.map(p => ({ ...p, block: b })));
const findPractice = id => allPractices().find(p => p.id === id);
const pick = (arr, seed) => arr[seed % arr.length];
const daySeed = () => { const d = new Date(); return Math.floor(d.getTime() / 86400000); };

/* ---------- theme ---------- */
function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const bg = dark ? '#161311' : '#F5F1EA';
  document.querySelector('meta[name=theme-color]').content = bg;
  try { tg && tg.setHeaderColor && tg.setHeaderColor(bg); tg && tg.setBackgroundColor && tg.setBackgroundColor(bg); } catch (e) {}
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.theme === 'system' && applyTheme());

/* ---------- ui helpers ---------- */
let toastTimer;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('on');
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
    el('img', { class: 'mascot', src: `assets/mascot/${pose}.png`, alt: 'дибитишка' }),
    el('div', { class: 'bubble' }, line, sub ? el('small', {}, sub) : null));
}
const mline = (key) => pick(CONTENT.meta.mascot_lines[key] || ['…'], daySeed() + key.length);
function ring(pct, size = 44) {
  const r = 18, c = 2 * Math.PI * r;
  const w = el('div', { class: 'ring' });
  w.style.width = w.style.height = size + 'px';
  w.innerHTML = `<svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="4"/><circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="4" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg><b>${Math.round(pct * 100)}</b>`;
  return w;
}
function streakCount() {
  let n = 0; const d = new Date();
  if (!(state.done[todayKey(d)] || []).length) d.setDate(d.getDate() - 1);
  while ((state.done[todayKey(d)] || []).length) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- tabbar ---------- */
const TABS = [
  { id: 'today', label: 'Сегодня', icon: 'today', route: '' },
  { id: 'skills', label: 'Навыки', icon: 'skills', route: 'skills' },
  { id: 'workbook', label: 'Тетрадь', icon: 'workbook', route: 'workbook' },
  { id: 'merch', label: 'Мерч', icon: 'merch', route: 'merch' },
  { id: 'profile', label: 'Профиль', icon: 'profile', route: 'profile' }
];
function renderTabbar(active) {
  const bar = $('#tabbar');
  if (!active) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false; bar.innerHTML = '';
  for (const t of TABS) {
    bar.append(el('button', { class: t.id === active ? 'on' : '', onclick: () => go(t.route) },
      icon(t.icon), el('span', {}, t.label)));
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
    ['hello', 'привет! я дибитишка', 'я — слезинка, которая живет у тебя в телефоне. я знаю, как чувства умеют накрывать с головой, и умею помогать бережно.'],
    ['calm', 'навыки осознанности по шагам', 'внутри — пять блоков практик из рабочей тетради ДПТ, переписанные моими словами. каждый день — одна маленькая практика. не можется — дам альтернативу.'],
    ['proud', 'ты уже умеешь больше, чем думаешь', 'я отмечаю каждое «умею» и никогда не ругаю за пропуски. медленно — тоже вперёд.']
  ];
  let i = 0;
  const scr = el('div', { class: 'screen' });
  const img = el('img', { class: 'mascot', src: 'assets/mascot/hello.png', alt: '' });
  img.style.width = '180px'; img.style.margin = '12vh auto 8px';
  const title = el('h1', { class: 'ltitle' });
  const text = el('p', { class: 'subtitle' });
  text.style.fontSize = '16px';
  const dots = el('div', { class: 'chips', style: 'justify-content:center' });
  const btn = el('button', { class: 'btn' });
  const draw = () => {
    img.src = `assets/mascot/${slides[i][0]}.png`;
    title.textContent = slides[i][1];
    text.textContent = slides[i][2];
    dots.innerHTML = '';
    slides.forEach((_, k) => dots.append(el('span', { class: 'chip' + (k === i ? ' on' : ''), style: 'padding:4px 12px', onclick: () => { i = k; draw(); } }, '·')));
    btn.textContent = i < slides.length - 1 ? 'дальше' : 'начать неделю бесплатно';
  };
  btn.onclick = () => {
    haptic('medium');
    if (i < slides.length - 1) { i++; draw(); return; }
    state.onboarded = true;
    if (!state.trial_started_at) state.trial_started_at = Date.now();
    save(); go('');
  };
  draw();
  scr.append(img, title, text, dots, el('div', { style: 'height:18px' }), btn,
    el('p', { class: 'foot' }, `первая неделя бесплатно, потом ${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'}`, el('br'), 'app by @stonym0ntana'));
  return scr;
}

function screenToday() {
  renderTabbar('today');
  const scr = el('div', { class: 'screen' });
  const d = new Date();
  const dateStr = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = d.getHours();
  const greet = hour < 5 ? 'тихая ночь' : hour < 12 ? 'доброе утро' : hour < 18 ? 'добрый день' : 'добрый вечер';
  scr.append(el('h1', { class: 'ltitle' }, greet, el('small', {}, dateStr[0].toUpperCase() + dateStr.slice(1))));

  const st = streakCount();
  const chips = el('div', { class: 'chips' });
  chips.append(el('span', { class: 'streak' }, '🔥', el('b', {}, String(st)), st === 1 ? 'день подряд' : 'дня подряд'));
  const masteredN = Object.values(state.mastered).filter(Boolean).length;
  chips.append(el('span', { class: 'streak', onclick: () => go('skills') }, '💧', el('b', {}, String(masteredN)), 'умею'));
  scr.append(chips);

  scr.append(mascot(hour < 12 ? 'hello' : 'calm', hour < 12 ? mline('morning') : mline('evening'), 'дибитишка рядом'));

  if (!isPremium()) { paywallCard(scr); return scr; }

  /* practice of the day */
  const all = allPractices();
  const todays = pick(all, daySeed());
  const mini = findPractice(pick(CONTENT.minis, daySeed() + 3));
  const doneToday = (state.done[todayKey()] || []).includes(todays.id);

  const card = el('div', { class: `card tinted t-${todays.block.tint}` });
  card.append(el('p', { class: 'cap' }, `практика дня · блок «${todays.block.title}»`),
    el('h3', {}, todays.title),
    el('p', {}, todays.why.slice(0, 110) + '…'),
    el('p', { class: 'mins' }, `≈ ${todays.minutes} мин ${doneToday ? '· пройдено сегодня 💧' : ''}`));
  card.append(el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => go('p/' + todays.id) }, doneToday ? 'пройти заново' : 'начать'));
  scr.append(card);

  scr.append(el('div', { class: 'sect' }, 'мини-практика на минуту'));
  scr.append(el('div', { class: 'group' }, el('button', { class: 'row', onclick: () => go('p/' + mini.id) },
    el('span', { class: 'ric c-sky' }, icon('drop')),
    el('span', { class: 'rmain' }, el('b', {}, mini.title), el('span', {}, '1–4 минуты, можно прямо сейчас')),
    el('span', { class: 'chev' }, '›'))));

  /* mood check-in */
  scr.append(el('div', { class: 'sect' }, 'как я сейчас'));
  const moods = ['тяжело', 'тревожно', 'ровно', 'тепло', 'радостно'];
  const mrow = el('div', { class: 'chips' });
  const cur = state.mood[todayKey()];
  moods.forEach((m, k) => mrow.append(el('button', {
    class: 'chip' + (cur === k ? ' on' : ''), onclick: () => {
      state.mood[todayKey()] = k; save(); haptic('light');
      toast(k === 0 ? 'я рядом. будь к себе понежнее' : 'отметил(а). спасибо за честность');
      route().a === 'today' && render();
    }
  }, m)));
  scr.append(mrow);
  scr.append(el('p', { class: 'foot' }, CONTENT.meta.credits));
  return scr;
}

function paywallCard(scr) {
  const c = el('div', { class: 'card' });
  c.append(mascot('hug', mline('paywall')),
    el('h3', { style: 'margin-top:12px' }, 'Подписка дибитишки'),
    el('p', {}, `${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'} · первая неделя бесплатно. оплата прямо в приложении через Tribute.`),
    el('button', { class: 'btn', style: 'margin-top:10px', onclick: openPay }, 'оформить подписку'));
  scr.append(c);
}
function openPay() {
  haptic('medium');
  const u = CFG.bot_username ? `https://t.me/${CFG.bot_username}?start=pay` : 'https://t.me/';
  sheet((sh, close) => {
    sh.append(mascot('hug', 'оплата живёт в боте: он создаст ссылку Tribute и активирует подписку сам.'),
      el('p', {}, `${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'}. первая неделя — бесплатно, она уже идёт с момента первого входа.`),
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => { try { tg && tg.openTelegramLink ? tg.openTelegramLink(u) : window.open(u); } catch (e) { window.open(u); } close(); } }, 'оплатить в telegram'),
      el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { close(); toast('напиши боту /start, если подписка уже есть'); } }, 'у меня уже есть подписка'));
  });
}

function screenSkills() {
  renderTabbar('skills');
  const scr = el('div', { class: 'screen' });
  scr.append(el('h1', { class: 'ltitle' }, 'Навыки', el('small', {}, 'пять блоков · проходи в любом порядке')));
  scr.append(mascot('peek', 'выбирай(те) любое. можно пропускать любое. всегда есть выбор.', null));
  for (const b of CONTENT.blocks) {
    const total = b.practices.length;
    const master = b.practices.filter(p => state.mastered[p.id]).length;
    const card = el('div', { class: `card tinted t-${b.tint}`, onclick: () => go('skills/' + b.id), style: 'cursor:pointer' });
    const top = el('div', { style: 'display:flex;align-items:center;gap:14px' });
    const ic = el('span', { class: 'ric c-' + b.tint, style: 'width:42px;height:42px;border-radius:14px;color:' + (b.tint === 'peony' ? '#6B403B' : '#fff') }, icon(b.icon));
    top.append(ic, el('div', { style: 'flex:1' }, el('h3', { style: 'margin:0' }, b.title), el('p', { style: 'margin:2px 0 0' }, b.subtitle)), ring(total ? master / total : 0));
    card.append(top, el('p', { style: 'margin:10px 0 0' }, master ? `умеешь ${master} из ${total}` : `${total} практик · начни с любой`));
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
    el('button', { class: 'back', onclick: () => go('skills') }, icon('back'), 'назад'),
    el('h2', {}, b.title)));
  scr.append(el('p', { class: 'subtitle' }, b.intro));
  const g = el('div', { class: 'group' });
  for (const p of b.practices) {
    const master = state.mastered[p.id];
    const done = (state.done[todayKey()] || []).includes(p.id);
    const ever = Object.entries(state.done).some(([, v]) => v.includes(p.id));
    const stat = master ? ['master', '✓'] : done ? ['done', '•'] : ever ? ['done', '·'] : ['new', ''];
    g.append(el('button', { class: 'row', onclick: () => go('p/' + p.id) },
      el('span', { class: 'pstat ' + stat[0] }, stat[1]),
      el('span', { class: 'rmain' }, el('b', {}, p.title), el('span', {}, master ? p.master : `≈ ${p.minutes} мин`)),
      el('span', { class: 'chev' }, '›')));
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
    el('button', { class: 'back', onclick: () => history.length > 1 ? history.back() : go('skills') }, icon('back'), 'назад'),
    el('h2', {}, p.block.title)));

  const master = state.mastered[p.id];
  const done = (state.done[todayKey()] || []).includes(p.id);
  scr.append(mascot(master ? 'proud' : done ? 'calm' : 'hello',
    master ? mline('mastered') : done ? mline('done') : p.why,
    master ? p.master : null));

  scr.append(el('div', { class: 'sect' }, 'как делать'));
  scr.append(el('ol', { class: 'steps' }, p.steps.map(s => el('li', {}, s))));
  scr.append(el('p', { class: 'mins' }, `≈ ${p.minutes} мин · можно пройти заново в любой день`));

  /* alternative */
  const altBox = el('div', { class: 'hidden' });
  const altCard = el('div', { class: 'card tinted t-sky' });
  altCard.append(el('p', { class: 'cap' }, 'альтернатива помягче'), el('h3', {}, p.alt.title),
    el('ol', { class: 'steps' }, p.alt.steps.map(s => el('li', {}, s))),
    el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { markDone(p, true); } }, 'отметить альтернативу'));
  altBox.append(altCard);

  scr.append(el('button', { class: 'btn ghost', onclick: (e) => { haptic('light'); altBox.classList.toggle('hidden'); e.target.textContent = altBox.classList.contains('hidden') ? 'не могу сейчас — показать альтернативу' : 'скрыть альтернативу'; } }, 'не могу сейчас — показать альтернативу'));
  scr.append(altBox);

  const btnDone = el('button', { class: 'btn', onclick: () => markDone(p, false) }, done ? 'пройти заново' : 'сделал(а)');
  const btnMaster = el('button', { class: 'btn ' + (master ? 'warm' : 'secondary'), onclick: () => {
    state.mastered[p.id] = !state.mastered[p.id]; save(); haptic('success');
    if (state.mastered[p.id]) { confetti(); toast(mline('mastered')); } else toast('ок, умение снято. вернёмся потом');
    render();
  } }, master ? '✓ я умею это' : 'отметить «я умею»');
  scr.append(el('div', { class: 'btnrow' }, btnDone, btnMaster));
  scr.append(el('p', { class: 'foot' }, '«умею» можно снять в любой момент: навык — не татуировка'));
  return scr;
}

function markDone(p, isAlt) {
  const k = todayKey();
  state.done[k] = state.done[k] || [];
  if (!state.done[k].includes(p.id)) state.done[k].push(p.id);
  save(); haptic('success'); confetti();
  toast(isAlt ? 'альтернатива засчитана. это тоже практика' : pick(CONTENT.meta.mascot_lines.done, streakCount()));
  render();
}

function screenWorkbook() {
  renderTabbar('workbook');
  const scr = el('div', { class: 'screen' });
  const w = CONTENT.workbook;
  scr.append(el('h1', { class: 'ltitle' }, 'Тетрадь', el('small', {}, w.subtitle)));
  scr.append(mascot('calm', mline('workbook')));
  scr.append(el('div', { class: 'card' },
    el('h3', {}, w.title),
    el('p', {}, w.intro),
    el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => location.href = 'workbook.html' }, icon('print'), 'открыть и распечатать'),
    el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => go('merch') }, 'заказать печатную версию')));
  scr.append(el('div', { class: 'sect' }, 'что внутри'));
  scr.append(el('div', { class: 'group' }, CONTENT.blocks.map(b =>
    el('div', { class: 'row' },
      el('span', { class: 'ric c-' + b.tint, style: 'color:' + (b.tint === 'peony' ? '#6B403B' : '#fff') }, icon(b.icon)),
      el('span', { class: 'rmain' }, el('b', {}, b.title), el('span', {}, `${b.practices.length} практик · поля «пиши здесь»`))))));
  return scr;
}

function screenMerch() {
  renderTabbar('merch');
  const scr = el('div', { class: 'screen' });
  scr.append(el('h1', { class: 'ltitle' }, 'Мерч', el('small', {}, 'скоро · оплата будет прямо здесь')));
  scr.append(mascot('peek', mline('merch')));
  const grid = el('div', { class: 'mgrid' });
  const tints = ['t-lavender', 't-leaf', 't-sky', 't-peony'];
  CONTENT.merch.forEach((m, i) => {
    const noted = state.merch_notify.includes(m.id);
    const card = el('div', { class: 'mcard' });
    const ph = el('div', { class: 'ph ' + tints[i % 4] }, m.id === 'workbook_print' ? '📖' : m.id === 'tee' ? '👕' : m.id === 'shopper' ? '👜' : '✨');
    const notify = el('button', { class: 'btn ghost', style: 'min-height:36px;font-size:14px', onclick: () => {
      state.merch_notify = noted ? state.merch_notify.filter(x => x !== m.id) : [...state.merch_notify, m.id];
      save(); haptic('light'); toast(noted ? 'убрал(а) из списка ожидания' : 'сообщу, когда появится'); render();
    } }, noted ? '✓ в списке ожидания' : 'сообщить мне');
    card.append(ph, el('div', { class: 'mb' }, el('b', {}, m.title), el('span', {}, m.note),
      el('div', { class: 'mp' }, m.price === 'скоро' ? 'цена скоро' : m.price), notify));
    grid.append(card);
  });
  scr.append(grid);
  scr.append(el('p', { class: 'foot' }, 'оплата мерча подключится вместе с Tribute API — как и подписка'));
  return scr;
}

function screenProfile() {
  renderTabbar('profile');
  const scr = el('div', { class: 'screen' });
  scr.append(el('h1', { class: 'ltitle' }, 'Профиль'));
  const name = TG_MODE ? (tg.initDataUnsafe.user.first_name + (tg.initDataUnsafe.user.last_name ? ' ' + tg.initDataUnsafe.user.last_name : '')) : state.web_user ? state.web_user.name : null;
  scr.append(mascot('hello', name ? `привет, ${name}! всё своё держу здесь.` : 'привет! здесь живёт твоя подписка и настройки.', TG_MODE ? 'вход через telegram' : state.web_user ? 'вход по коду из бота' : 'гостевой режим'));

  /* subscription */
  scr.append(el('div', { class: 'sect' }, 'подписка'));
  const dl = trialDaysLeft();
  const subRows = [];
  subRows.push(el('div', { class: 'row' },
    el('span', { class: 'ric c-grass' }, icon('card')),
    el('span', { class: 'rmain' }, el('b', {}, (state.premium_until || 0) > Date.now() ? 'подписка активна' : state.trial_started_at && dl > 0 ? `бесплатная неделя: ещё ${dl} дн.` : 'подписка не активна'),
      el('span', {}, `${CFG.subscription?.price_ru || '200 ₽'} ${CFG.subscription?.period || 'в месяц'} · tribute`))));
  if (!isPremium() || dl !== Infinity) subRows.push(el('button', { class: 'row', onclick: openPay },
    el('span', { class: 'ric c-rose' }, icon('lock')),
    el('span', { class: 'rmain' }, el('b', {}, isPremium() ? 'продлить подписку' : 'оформить подписку'), el('span', {}, 'оплата в telegram через tribute')),
    el('span', { class: 'chev' }, '›')));
  scr.append(el('div', { class: 'group' }, subRows));

  /* pushes */
  scr.append(el('div', { class: 'sect' }, 'пуш-уведомления'));
  const remRow = el('button', { class: 'row', onclick: () => {
    state.reminders.on = !state.reminders.on; save(); haptic('light');
    syncReminder(); render();
  } },
    el('span', { class: 'ric c-sky' }, icon('bell')),
    el('span', { class: 'rmain' }, el('b', {}, 'напоминание о практике'), el('span', {}, state.reminders.on ? `ежедневно в ${state.reminders.time}` : 'выключено')),
    el('span', { class: 'rval' }, state.reminders.on ? 'вкл' : 'выкл'));
  const times = el('div', { class: 'chips' });
  ['09:00', '12:00', '18:00', '21:00'].forEach(t => times.append(el('button', {
    class: 'chip' + (state.reminders.time === t ? ' on' : ''), onclick: () => { state.reminders.time = t; state.reminders.on = true; save(); syncReminder(); render(); }
  }, t)));
  scr.append(el('div', { class: 'group' }, remRow), times,
    el('p', { class: 'mins', style: 'margin:6px 4px' }, 'пуши присылает бот в telegram. в веб-версии без бота настрой командой /reminder'));

  /* appearance */
  scr.append(el('div', { class: 'sect' }, 'оформление'));
  const themes = el('div', { class: 'chips' });
  [['system', 'системная'], ['light', 'светлая'], ['dark', 'тёмная']].forEach(([k, l]) =>
    themes.append(el('button', { class: 'chip' + (state.theme === k ? ' on' : ''), onclick: () => { state.theme = k; save(); applyTheme(); render(); } }, l)));
  scr.append(themes);

  /* social + auth */
  scr.append(el('div', { class: 'sect' }, 'связь и вход'));
  const rows = [];
  if (!TG_MODE) rows.push(el('button', { class: 'row', onclick: authSheet },
    el('span', { class: 'ric c-lavender', style: 'color:#4A3A55' }, icon('lock')),
    el('span', { class: 'rmain' }, el('b', {}, state.web_user ? `вошли как ${state.web_user.name}` : 'войти по коду из бота'), el('span', {}, state.web_user ? 'синхронизация и пуши доступны' : 'код придёт в telegram')),
    el('span', { class: 'chev' }, '›')));
  rows.push(el('button', { class: 'row', onclick: () => openLink(CFG.social?.telegram) },
    el('span', { class: 'ric c-sky' }, icon('send')),
    el('span', { class: 'rmain' }, el('b', {}, 'телеграм-канал'), el('span', {}, CFG.social?.telegram || '')),
    el('span', { class: 'chev' }, '›')));
  rows.push(el('button', { class: 'row', onclick: () => openLink('mailto:' + (CFG.social?.email || '')) },
    el('span', { class: 'ric c-peony', style: 'color:#6B403B' }, icon('mail')),
    el('span', { class: 'rmain' }, el('b', {}, 'почта'), el('span', {}, CFG.social?.email || '')),
    el('span', { class: 'chev' }, '›')));
  scr.append(el('div', { class: 'group' }, rows));
  scr.append(el('p', { class: 'foot' }, 'дибитишка · v1.0', el('br'), 'app by @stonym0ntana', el('br'), CONTENT.meta.credits));
  return scr;
}
function openLink(u) { try { tg && tg.openTelegramLink && u.startsWith('https://t.me') ? tg.openTelegramLink(u) : window.open(u, '_blank'); } catch (e) { window.open(u, '_blank'); } }

async function syncReminder() {
  if (!CFG.bot_public_url) return;
  const uid = TG_MODE ? tg.initDataUnsafe.user.id : state.web_user?.id;
  if (!uid) return;
  try {
    await fetch(CFG.bot_public_url.replace(/\/$/, '') + '/me/reminder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: uid, on: state.reminders.on, time: state.reminders.time })
    });
  } catch (e) {}
}

function authSheet() {
  sheet((sh, close) => {
    sh.append(el('h3', {}, 'Вход по коду'),
      el('p', {}, `напиши боту @${CFG.bot_username || '…'} команду /code — он пришлёт одноразовый код. введи его здесь, и веб-версия привяжется к твоему телеграму: пуши и синхронизация заработают.`),
      el('input', { class: 'code-input', id: 'code-in', placeholder: '······', maxlength: 6, inputmode: 'numeric' }),
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: async () => {
        const code = ($('#code-in').value || '').trim();
        if (code.length < 4) return toast('введи код целиком');
        haptic('light');
        if (!CFG.bot_public_url) { close(); return toast('бот не подключён к веб-версии: заполни bot_public_url в config.js'); }
        try {
          const r = await fetch(CFG.bot_public_url.replace(/\/$/, '') + '/auth/verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
          });
          const j = await r.json();
          if (j.ok) { state.web_user = { id: j.user.id, name: j.user.name || 'друг' }; save(); haptic('success'); close(); toast('привет в вебе! пуши теперь доходят'); render(); }
          else toast('код не подошёл или устарел');
        } catch (e) { toast('не достучался(ась) до бота'); }
      } }, 'войти'),
      el('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { openLink(`https://t.me/${CFG.bot_username || ''}`); } }, 'открыть бота за кодом'));
  });
}

/* ---------- render ---------- */
function render() {
  const r = route();
  const app = $('#app');
  app.innerHTML = '';
  let scr;
  if (!state.onboarded) scr = screenWelcome();
  else switch (r.a) {
    case '': scr = screenToday(); break;
    case 'skills': scr = r.b ? screenBlock(r.b) : screenSkills(); break;
    case 'p': scr = screenPractice(r.b); break;
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
  try { await loadContent(); } catch (e) {
    $('#app').append(el('div', { class: 'screen' }, el('p', {}, 'не могу загрузить контент. проверь связь.')));
    $('#splash').classList.add('gone');
    return;
  }
  if (TG_MODE) {
    const u = tg.initDataUnsafe.user;
    state.web_user = null; // в TG режиме профиль берём из initData
    if (!state.onboarded) { /* покажем welcome */ }
  }
  render();
  setTimeout(() => $('#splash').classList.add('gone'), 1500);
})();
