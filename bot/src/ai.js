/* ============================================================
   Дибитишка · «живой» чат через OpenAI API
   ------------------------------------------------------------
   Переменные окружения на бот-хосте (все, кроме первой, — необязательные):
     OPENAI_API_KEY   — ключ OpenAI. Пока его нет, чат работает
                        в локальном режиме (шаблонные ответы) и честно
                        говорит об этом; как только ключ появился и бот
                        перезапущен — Дибитишка оживает сама.
     OPENAI_MODEL     — модель (по умолчанию gpt-4o-mini)
     OPENAI_BASE_URL  — адрес API (по умолчанию https://api.openai.com/v1),
                        можно указать совместимый прокси
     AI_HISTORY       — сколько последних реплик помнить (по умолчанию 20)

   Без npm-зависимостей: используется встроенный fetch (Node ≥ 18).
   ============================================================ */
import { PERSONA, APP_FACTS } from './persona.js';

const KEY = () => (process.env.OPENAI_API_KEY || '').trim();
const MODEL = () => (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const BASE = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
const HISTORY = () => Math.max(2, Number(process.env.AI_HISTORY) || 20);
const TIMEOUT_MS = 45000;
const MAX_INPUT = 2000;

export const aiConfigured = () => !!KEY();

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
export async function complete({ userText, history = [], userContext = {}, channel = 'telegram' }) {
  if (!aiConfigured()) return null;
  const text = String(userText || '').trim().slice(0, MAX_INPUT);
  if (!text) return null;

  const system = [
    PERSONA,
    APP_FACTS,
    `# КОНТЕКСТ СЕАНСА\nКанал: ${channel === 'web' ? 'веб-версия приложения (чат внутри Mini App)' : 'Телеграм-бот'}. Сейчас ${new Date().toISOString().slice(0, 10)}.`,
    describeUser(userContext)
  ].join('\n\n');

  const messages = [
    { role: 'system', content: system },
    ...history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: text }
  ];

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` },
      body: JSON.stringify({ model: MODEL(), messages, temperature: 0.8, max_tokens: 700 }),
      signal: ctl.signal
    });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      console.error(`[ai] ${r.status} ${clip(err, 300)}`);
      return { error: r.status === 401 ? 'bad_key' : r.status === 429 ? 'rate_limit' : 'http_' + r.status };
    }
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content;
    if (!out) return { error: 'empty' };
    return { text: String(out).trim(), model: j.model || MODEL() };
  } catch (e) {
    console.error('[ai] ' + (e?.name === 'AbortError' ? 'timeout' : e?.message || e));
    return { error: e?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Понятная человеку фраза, когда модель недоступна (тон Дибитишки). */
export function fallbackLine(err) {
  if (err === 'bad_key') return 'Ключ к моему «живому» голосу не подошёл. Владельцу приложения: проверь OPENAI_API_KEY на бот-хосте.';
  if (err === 'rate_limit') return 'Меня сейчас слишком много спрашивают — подожди чуть-чуть и напиши ещё раз. Я тут.';
  if (err === 'timeout') return 'Я задумалась дольше обычного и не успела. Попробуй ещё раз — коротко, одной фразой.';
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
    ? `[ai] OpenAI подключён: модель ${MODEL()}, память ${HISTORY()} реплик`
    : '[ai] OPENAI_API_KEY не задан — чат в локальном режиме. Впиши ключ на бот-хосте и перезапусти, чтобы Дибитишка ожила.';
}
