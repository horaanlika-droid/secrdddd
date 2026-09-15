/* ============================================================
   Дибитишка · «живой» чат через OpenAI API
   ------------------------------------------------------------
   Переменные окружения на бот-хосте (все, кроме первой, — необязательные):
     OPENAI_API_KEY   — ключ OpenAI. Пока его нет, чат работает
                        в локальном режиме (шаблонные ответы) и честно
                        говорит об этом; как только ключ появился и бот
                        перезапустили — Дибитишка оживает сама.
     OPENAI_MODEL     — модель (по умолчанию gpt-4o-mini)
     OPENAI_BASE_URL  — адрес API (по умолчанию https://api.openai.com/v1),
                        можно указать совместимый прокси
     OPENAI_MAX_TOKENS— потолок ответа (по умолчанию 700)
     OPENAI_TEMPERATURE — 0…2 (по умолчанию 0.8); для reasoning-моделей
                        игнорируется автоматически
     AI_HISTORY       — сколько последних реплик помнить (по умолчанию 20)

   Без npm-зависимостей: используется встроенный fetch (Node ≥ 18).

   ⚠️ Почему здесь так много про «почему именно не ответило».
   Раньше любая осечка API выглядела для человека одинаково («попробуй
   позже»), и владелец приложения не мог понять, что сломалось:
     · 429 insufficient_quota  — на аккаунте кончились деньги (не «перегрузка»!);
     · 400 Unsupported parameter: max_tokens — свежим моделям (gpt-5, o*)
       нужен max_completion_tokens, а temperature они не принимают вовсе;
     · 404 model_not_found — в OPENAI_MODEL опечатка;
     · 401 — ключ не тот.
   Теперь ошибка разбирается в код (aiDiag), понятная человеку фраза идёт
   в чат, техническая — админу (/diag, GET /health), и параметры запроса
   подбираются сами с одним повтором.
   ============================================================ */
import { PERSONA, APP_FACTS } from './persona.js';

const KEY = () => (process.env.OPENAI_API_KEY || '').trim();
const MODEL = () => (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const BASE = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
const HISTORY = () => Math.max(2, Number(process.env.AI_HISTORY) || 20);
const TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const MAX_INPUT = 2000;

export const aiConfigured = () => !!KEY();

/* ---------- самодиагностика: что видел последний запрос ---------- */
const aiDiag = {
  configured: false,
  model: MODEL(),
  base: BASE(),
  history: HISTORY(),
  param_mode: null,       // 'legacy' = max_tokens+temperature · 'modern' = max_completion_tokens
  calls: 0,
  fails: 0,
  last_ok_at: null,
  last_ok_age_s: null,
  last_error: null,       // 'no_quota' | 'bad_key' | 'bad_model' | 'bad_param' | ...
  last_error_detail: null, // сообщение из ответа OpenAI (обрезано)
  last_error_at: null,
  last_latency_ms: null
};
export function aiDiagnostics() {
  const now = Date.now();
  return {
    ...aiDiag,
    configured: aiConfigured(),
    model: MODEL(),
    base: BASE(),
    history: HISTORY(),
    last_ok_age_s: aiDiag.last_ok_at ? Math.round((now - aiDiag.last_ok_at) / 1000) : null
  };
}
function noteOk(model, ms) {
  aiDiag.calls++;
  aiDiag.last_ok_at = Date.now();
  aiDiag.last_latency_ms = ms;
  aiDiag.model = model || aiDiag.model;
}
function noteFail(err, detail) {
  aiDiag.calls++; aiDiag.fails++;
  aiDiag.last_error = err;
  aiDiag.last_error_detail = detail ? clipErr(detail) : null;
  aiDiag.last_error_at = Date.now();
}
const clipErr = (s, n = 260) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* ---------- параметры: старые модели против новых ---------- */
/* reasoning-модели (o1/o3/o4, gpt-5*, chatgpt-*) не принимают temperature
   и max_tokens — им нужен max_completion_tokens. Угадываем по имени, а
   ошиблись — правим по ответу API (см. bad_param → повтор с другим режимом). */
const REASONING_RE = /(^|[^a-z0-9])(o[1-9][a-z0-9-]*|gpt-5|gpt-6|chatgpt)/i;
const maxTokens = () => Math.max(64, Number(process.env.OPENAI_MAX_TOKENS || 700) || 700);
function bodyFor(model, messages, mode, overrideTokens) {
  const body = { model, messages };
  const mt = Math.max(16, Number(overrideTokens) || maxTokens());
  if (mode === 'modern') body.max_completion_tokens = mt;
  else body.max_tokens = mt;
  if (mode !== 'modern') {
    const t = process.env.OPENAI_TEMPERATURE;
    const temp = t === undefined || t === '' ? 0.8 : Number(t);
    if (Number.isFinite(temp)) body.temperature = temp;
  }
  return body;
}
const guessMode = () => (REASONING_RE.test(MODEL()) ? 'modern' : 'legacy');

/** Разбирает ответ ошибки OpenAI в понятный код. */
export function parseApiError(status, raw = '') {
  const text = String(raw || '');
  let code = '', msg = '';
  try {
    const j = JSON.parse(text);
    const e = (j && j.error) || j || {};
    code = String(e.code || e.type || '');
    msg = String(e.message || '').trim();
  } catch { msg = text.replace(/\s+/g, ' ').trim(); }
  const hay = (code + ' ' + msg).toLowerCase();
  if (status === 401 || /invalid_api_key|incorrect api key|no_api_key/.test(hay)) return { error: 'bad_key', detail: msg || code };
  if (status === 403 && /(region|country)/.test(hay)) return { error: 'geo_blocked', detail: msg || code };
  if (/insufficient_quota|exceeded your current|billing|hard_limit|no credit|out of budget/.test(hay)) return { error: 'no_quota', detail: msg || code };
  if (status === 429) return { error: 'rate_limit', detail: msg || code };
  if (status === 404 || /model_not_found|does not exist|unknown model/.test(hay)) return { error: 'bad_model', detail: msg || code };
  if (status === 400) {
    if (/unsupported parameter|max_completion_tokens|max_tokens|temperature/.test(hay)) return { error: 'bad_param', detail: msg || code };
    if (/context length|too many tokens|maximum context/.test(hay)) return { error: 'too_long', detail: msg || code };
    return { error: 'bad_request', detail: msg || code };
  }
  if (status >= 500) return { error: 'openai_down', detail: msg || code };
  return { error: 'http_' + status, detail: msg || code };
}

/** Техническое объяснение для владельца (в /diag и /health), не для гостя. */
export function errorHint(err) {
  return ({
    no_key: 'OPENAI_API_KEY не задан на бот-хосте — чат в локальном режиме',
    bad_key: 'OPENAI_API_KEY не принят (401) — перевыпусти ключ, проверь, что он этого проекта, и что в переменной нет кавычек/пробелов',
    no_quota: 'на аккаунте OpenAI закончились средства (insufficient_quota) — пополни баланс; это НЕ «перегрузка сервера»',
    rate_limit: 'сработал лимит запросов (429) — подожди или снизь поток; при долгом лимите заведи второй ключ',
    bad_model: 'модель не найдена (404) — поправь OPENAI_MODEL; текущий не подходит или назван с опечаткой',
    bad_param: 'модель не принимает параметры запроса — включён режим max_completion_tokens, проверь OPENAI_MODEL',
    too_long: 'история+контекст не влезают в окно модели — уменьши AI_HISTORY',
    geo_blocked: 'запросы из этого региона/страны заблокированы для OpenAI',
    openai_down: 'у OpenAI ошибка на стороне (5xx) — обычно проходит само',
    timeout: 'модель не ответила за отведённое время (OPENAI_TIMEOUT_MS)',
    network: 'бот-хост не смог достучаться до API (сеть/DNS/прокси)',
    empty: 'модель вернула пустой ответ'
  })[err] || err || '';
}

/* ---------- контекст пользователя → текст для модели ---------- */
const clip = (s, n = 400) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** ctx — то, что знает про человека бот и/или прислал веб (buildChatContext в app/js/app.js). */
export function describeUser(ctx = {}) {
  const lines = [];
  if (ctx.name) lines.push(`Имя: ${clip(ctx.name, 60)}.`);
  if (ctx.level != null) lines.push(`Уровень в приложении: ${ctx.level}.`);
  if (ctx.streak != null) lines.push(`Серия дней подряд: ${ctx.streak}.`);
  if (ctx.moodNow) lines.push(`Последняя отметка в дневнике эмоций: ${clip(typeof ctx.moodNow === 'object' ? (ctx.moodNow.label || ctx.moodNow.title || JSON.stringify(ctx.moodNow)) : ctx.moodNow, 80)}.`);
  if (ctx.moodCount) lines.push(`Записей в дневнике эмоций: ${ctx.moodCount}.`);
  if (Array.isArray(ctx.mastered) && ctx.mastered.length) lines.push(`Освоенные навыки: ${ctx.mastered.slice(0, 8).map(m => clip(m, 60)).join(' · ')}.`);
  if (ctx.whoami) lines.push(`Задание «Кто я, когда мне хорошо» (слова пользователя): «${clip(ctx.whoami)}»`);
  if (ctx.anchors) lines.push(`Задание «Мои якоря» (слова пользователя): «${clip(ctx.anchors)}»`);
  if (ctx.crisis) lines.push(`Антикризисный план пользователя (его слова): «${clip(ctx.crisis)}»`);
  if (Array.isArray(ctx.filled)) {
    for (const t of ctx.filled) {
      if (!t || !t.text) continue;
      const title = String(t.title || '');
      if (/кто я|якор|антикриз/i.test(title)) continue; // уже выше
      lines.push(`Задание «${clip(title, 50)}»: «${clip(t.text, 250)}»`);
    }
  }
  if (ctx.premium === true) lines.push('Подписка активна.');
  if (ctx.premium === false) lines.push('Подписки нет (или пробная неделя закончилась) — не дави, просто знай.');
  if (ctx.todayPractice) lines.push(`Практика дня сегодня: ${clip(ctx.todayPractice, 120)}.`);
  if (!lines.length) return 'О пользователе пока ничего не известно — не выдумывай воспоминаний.';
  return 'Что известно о пользователе из его записей в приложении (используй бережно, цитируй только это, не выдумывай остального):\n' + lines.join('\n');
}

/* ---------- память диалога ---------- */
/** История хранится у вызывающего (в db пользователя): массив {role, content}. */
export function pushHistory(history, role, content) {
  const h = Array.isArray(history) ? history : [];
  h.push({ role, content: clip(content, 1500), t: Date.now() });
  while (h.length > HISTORY()) h.shift();
  return h;
}

/* ---------- запрос к модели ---------- */
async function postOnce(body, signal) {
  const r = await fetch(`${BASE()}/chat/completions`, {
    method: 'POST',
    headers: (() => {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` };
      const proj = (process.env.OPENAI_PROJECT || '').trim();
      if (proj) h['OpenAI-Project'] = proj;   // ключ проекта без этого заголовка ловит 401
      return h;
    })(),
    body: JSON.stringify(body),
    signal
  });
  const raw = r.ok ? '' : await r.text().catch(() => '');
  return { r, raw };
}

/**
 * Один ход диалога. Возвращает { text, model } либо { error, detail }.
 * @param {object} o
 * @param {string} o.userText @param {Array} o.history @param {object} o.userContext
 * @param {string} o.channel  @param {number} [o.maxTokens] — потолок ответа (для самопроверки)
 */
export async function complete({ userText, history = [], userContext = {}, channel = 'telegram', maxTokens: maxOverride } = {}) {
  if (!aiConfigured()) { noteFail('no_key', errorHint('no_key')); return { error: 'no_key' }; }
  const text = String(userText || '').trim().slice(0, MAX_INPUT);
  if (!text) return { error: 'empty' };

  const system = [
    PERSONA,
    APP_FACTS,
    `# КОНТЕКСТ СЕАНСА\nКанал: ${channel === 'web' ? 'веб-версия приложения (чат внутри Mini App)' : channel === 'diagnostics' ? 'служебная проверка связи' : 'Телеграм-бот'}. Сейчас ${new Date().toISOString().slice(0, 10)}.`,
    describeUser(userContext)
  ].join('\n\n');

  const convo = (hist) => [
    { role: 'system', content: system },
    ...hist.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: text }
  ];

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let mode = aiDiag.param_mode || guessMode();
    let hist = Array.isArray(history) ? history : [];
    let attempt = 0;
    for (;;) {
      attempt++;
      let r, raw;
      try {
        ({ r, raw } = await postOnce(bodyFor(MODEL(), convo(hist), mode, maxOverride), ctl.signal));
      } catch (e) {
        const err = e?.name === 'AbortError' ? 'timeout' : 'network';
        noteFail(err, e?.message || String(e));
        console.error(`[ai] ${err}: ${clipErr(e?.message || e)}`);
        return { error: err };
      }
      if (!r.ok) {
        const parsed = parseApiError(r.status, raw);
        console.error(`[ai] ${r.status} ${parsed.error}: ${clipErr(parsed.detail, 200)}`);
        // параметры не подошли — пробуем другой режим (и помним его на будущее)
        if (parsed.error === 'bad_param' && mode === 'legacy' && attempt === 1) {
          mode = 'modern'; aiDiag.param_mode = 'modern';
          console.warn('[ai] модель не приняла max_tokens/temperature — повторяю с max_completion_tokens');
          continue;
        }
        // контекст не влез — режем историю пополам и пробуем ещё раз
        if (parsed.error === 'too_long' && hist.length > 4 && attempt === 1) {
          hist = hist.slice(-Math.max(2, Math.floor(hist.length / 2)));
          console.warn('[ai] контекст не влез — повторяю с укороченной историей');
          continue;
        }
        noteFail(parsed.error, parsed.detail);
        return { error: parsed.error, detail: parsed.detail };
      }
      let j = null;
      try { j = await r.json(); } catch { /* не JSON — прокси что-то подмешал */ }
      const out = j?.choices?.[0]?.message?.content;
      if (!out || !String(out).trim()) {
        if (mode === 'legacy' && attempt === 1) { mode = 'modern'; aiDiag.param_mode = 'modern'; continue; }
        noteFail('empty', 'в ответе нет choices[0].message.content');
        return { error: 'empty' };
      }
      aiDiag.param_mode = mode;
      noteOk(j.model || MODEL(), Date.now() - started);
      return { text: String(out).trim(), model: j.model || MODEL(), mode, ms: Date.now() - started };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Проверка связи: один крошечный запрос, чтобы сказать «живой чат работает». */
export async function selfTest() {
  if (!aiConfigured()) return { ok: false, error: 'no_key', hint: errorHint('no_key') };
  const t0 = Date.now();
  const res = await complete({
    userText: 'Служебная проверка связи. Ответь ровно одним словом: да.',
    history: [], userContext: {}, channel: 'diagnostics', maxTokens: 24
  });
  if (res?.error) return { ok: false, error: res.error, detail: res.detail, hint: errorHint(res.error) };
  return { ok: true, model: res.model, ms: Date.now() - t0, answer: clip(res.text, 60) };
}

/** Понятная человеку фраза, когда модель недоступна (тон Дибитишки, без технических деталей). */
export function fallbackLine(err) {
  if (err === 'bad_key' || err === 'no_key') return 'Мой живой голос сейчас недоступен. Давай пока по-простому: выдох длиннее вдоха, три раза. Я рядом. 💧';
  if (err === 'no_quota') return 'Меня сейчас нет в сети — технические дела. Напиши владельцу приложения, а пока попробуй ещё раз через минутку. 💧';
  if (err === 'rate_limit') return 'Меня сейчас слишком много спрашивают — подожди чуть-чуть и напиши ещё раз. Я тут.';
  if (err === 'timeout') return 'Я задумалась дольше обычного и не успела. Попробуй ещё раз — коротко, одной фразой.';
  if (err === 'bad_model' || err === 'bad_param' || err === 'too_long') return 'Мой живой голос сейчас не настраивается. Не теряй меня — напиши ещё раз через минутку, а пока подыши длиннее, чем вдох.';
  if (err === 'geo_blocked') return 'Меня нет в этой сети. Напиши владельцу приложения — он починит. А пока: выдох длиннее вдоха, три раза. 💧';
  return 'Что-то с моим голосом сейчас не так. Давай пока по-простому: выдох длиннее вдоха, три раза. И напиши мне снова через минуту.';
}

/* ---------- локальный ответ из «памяти» (fallback при rate_limit / таймауте / сетевой ошибке) ----------
   Базовый эхо-бот на ключевых словах, который использует контекст пользователя (имя, антикризисный план,
   «кто я», якоря, освоенные навыки) — чтобы при перегрузке API человек не видел «попробуй позже»,
   а получал живой ответ из его же записей.  */
const GROUNDING_TIPS = [
  'Вдох на 4, выдох на 6. Три раза — длинный выдох говорит телу: можно расслабиться.',
  'Назови пять вещей, которые видишь, четыре — которые слышишь, три — которые чувствуешь кожей. Это заземляет.',
  'Поставь обе стопы на пол. Почувствуй, как они опираются. Ты здесь.',
  'Холодная вода на запястья или лицо — быстрый способ вернуть себя в «здесь и сейчас».',
  'Одна маленькая задача на ближайшие пять минут. Не «разобраться со всем», а одно действие.'
];
const clipLocal = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const hasWord = (t, ...words) => words.some(w => t.includes(w));

export function localReply(userText, userContext = {}) {
  const text = String(userText || '').toLowerCase().trim();
  const name = userContext.name ? `, ${userContext.name}` : '';
  const parts = [];
  if (userContext.whoami) parts.push(`Ты писал(а) о себе: «${clipLocal(userContext.whoami)}»`);
  if (userContext.anchors) parts.push(`Твои якоря: «${clipLocal(userContext.anchors)}»`);
  if (Array.isArray(userContext.mastered) && userContext.mastered.length) {
    parts.push(`Ты уже умеешь: ${userContext.mastered.slice(0, 4).map(m => clipLocal(m, 40)).join(' · ')}`);
  }

  // человек просит напомнить, кто он — самое важное, отвечаем по записям
  if (hasWord(text, 'кто я', 'напомни', 'какой я', 'какая я', 'забыл', 'забыла', 'потерял', 'потеряла')) {
    if (parts.length) {
      const lvl = userContext.level ? `У тебя уровень ${userContext.level}${userContext.streak ? `, серия ${userContext.streak} дн.` : ''}.` : '';
      return `Ты — не этот момент${name}. ${lvl}\n\n${parts.join('\n')}\n\nВолна пройдёт, а ты останешься. 💧`;
    }
    return `Пока тут мало твоих записей${name}, но ты уже здесь — и это уже маленький шаг. Заполни задания «Кто я, когда мне хорошо» и «Мои якоря», и я смогу напоминать тебе о тебя твоими же словами.`;
  }

  // острая ситуация / тяжело — заземление + антикризисный план, если заполнен
  if (hasWord(text, 'тяжело', 'тревож', 'страш', 'паник', 'плохо', 'накры', 'тошн', 'больно', 'не могу', 'срыв', 'ужас', 'умереть', 'смерт', 'убить')) {
    const crisis = userContext.crisis ? `\n\nТы сам(а) оставил(а) себе план на такой случай:\n«${clipLocal(userContext.crisis)}»` : '';
    const tip = GROUNDING_TIPS[Math.floor(Math.random() * GROUNDING_TIPS.length)];
    return `Слышу${name}. Давай по-маленькому, прямо сейчас:\n\n1. Выдох длиннее вдоха — три раза, медленно.\n2. Оглянись и назови пять вещей, которые видишь. Ты здесь.\n3. ${tip}${crisis}\n\nЭто точка на пути, а не весь путь. Я рядом. 💧`;
  }

  // просит совета — даём один маленький совет
  if (hasWord(text, 'совет', 'что делать', 'помог', 'подскаж', 'не знаю', 'как быть', 'как справ')) {
    const tip = GROUNDING_TIPS[Math.floor(Math.random() * GROUNDING_TIPS.length)];
    return `${tip}\n\nОдин вдох уже считается${name}. Если хочешь глубже — посмотри практики дня, они под рукой.`;
  }

  // усталость — мягкая поддержка
  if (hasWord(text, 'устал', 'устала', 'вымотан', 'сил нет', 'выгор', 'спать', 'отдох', 'утом')) {
    return `Усталость — это сигнал, а не слабость${name}. Тебе можно замедлиться.\n\nСегодня выбери одно маленькое «нет» и одно маленькое «мне можно отдохнуть». Меньше, чем кажется нужным, — уже достаточно.`;
  }

  // благодарность / привет
  if (hasWord(text, 'спасибо', 'благодар')) return 'Всегда рядом. Заходи, когда будет нужно — и когда будет хорошо, тоже. 💧';
  if (hasWord(text, 'привет', 'здравств', 'добрый', 'хай', 'хей')) {
    return `Привет${name}! Я тут. Могу подсказать, как пережить трудный момент, или напомнить, кто ты — из твоих же записей.`;
  }

  // generic — тёплый ответ + заземление + что-то из записей, если есть
  const tip = GROUNDING_TIPS[Math.floor(Math.random() * GROUNDING_TIPS.length)];
  const memoryLine = parts.length ? `\n\nКстати, напоминаю: ${parts[0]}` : '';
  return `Я слышу${name}. Сейчас мой «живой» голос немного перегружен, но я тут. ${tip}${memoryLine}\n\nПопробуй написать ещё раз через минутку — отвечу подробнее. 💧`;
}

/** Что писать в логи при старте. */
export function aiStatusLine() {
  return aiConfigured()
    ? `[ai] OpenAI подключён: модель ${MODEL()}, память ${HISTORY()} реплик (${aiDiag.param_mode || guessMode()} параметры)`
    : '[ai] OPENAI_API_KEY не задан — чат в локальном режиме. Впиши ключ на бот-хосте и перезапусти, чтобы Дибитишка ожила.';
}
