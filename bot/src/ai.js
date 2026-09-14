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
  if (ctx.level != null) lines.push(`Уровень в приложении: ${ctx.level}${ctx.levelTitle ? ` («${clip(ctx.levelTitle, 40)}»)` : ''}.`);
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

/** Что писать в логи при старте. */
export function aiStatusLine() {
  return aiConfigured()
    ? `[ai] OpenAI подключён: модель ${MODEL()}, память ${HISTORY()} реплик`
    : '[ai] OPENAI_API_KEY не задан — чат в локальном режиме. Впиши ключ на бот-хосте и перезапусти, чтобы Дибитишка ожила.';
}
