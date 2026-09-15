/* ============================================================
   Дибитишка · телеграм-бот — ПРИЛОЖЕНИЕ
   (грузится из src/index.js: та точка входа сначала проверяет и при
    нужде доустанавливает зависимости, поэтому здесь grammy уже есть)
   Переменные на бот-хосте:
     TG_TOKEN             — токен бота
     ADMIN_IDS            — id админов через запятую
     TRIBUTE_API          — ключ Tribute API для подписи вебхуков
   Ссылка оплаты меняется админом через /tribute set <ссылка> и хранится в базе.
   Необязательно: PORT (по умолчанию 8080) — HTTP API + статика веб-версии
                  OPENAI_API_KEY — «живой» чат Дибитишки (см. src/ai.js);
                                   пока не задан — чат в локальном режиме
                  NO_POLLING=1 — только HTTP API (смоук-тесты, CI)
   ============================================================ */
import { Bot, InputFile, InlineKeyboard } from 'grammy';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDB, save, flush, dbFile } from './store.js';
import { removeWhiteBackground } from './bgremove.js';
import { acquirePort } from './port.js';
import * as tribute from './tribute.js';
import * as ai from './ai.js';
import * as agents from './agents.js';
import { createWebAuth, loginCode, readJson } from './web-auth.js';
import { createBoardApi } from './boards.js';
import { createGifApi } from './gif.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.TG_TOKEN || '';
const ADMINS = new Set((process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number));
const PORT = Number(process.env.PORT || 8080);
const TRIAL_DAYS = 7;
/* Один способ доступа: минимальный monthly-донат в Tribute.
   id m1 сохранён для уже выпущенных deep-link ?start=pay_m1. */
const PLANS = [{ id: 'm1', label: 'месяц доступа', days: 30 }];
const planById = () => PLANS[0];
const plansLine = () => 'минимальный донат раз в месяц';
const APP_DIR = path.join(__dirname, '..', '..', 'app');

if (!TOKEN) {
  console.error('Нет TG_TOKEN. Выстави три переменные: TG_TOKEN, ADMIN_IDS, TRIBUTE_API');
  process.exit(1);
}

const bot = new Bot(TOKEN);
const db = getDB();
db.stats = db.stats || { sent: 0 };
db.settings = Object.assign({ tribute_monthly_url: '' }, db.settings || {});
const savedTributeUrl = tribute.setDynamicPayUrl(db.settings.tribute_monthly_url);
if (!savedTributeUrl.ok) console.error('[tribute] сохранённая ссылка не прошла проверку — обнови её через /tribute set <ссылка>');
const webAuth = createWebAuth({ token: TOKEN, db, save });

/* ============================================================
   Самодиагностика: почему бот молчит — видно снаружи, без терминала
   ------------------------------------------------------------
   Telegram-половина (polling) и HTTP-половина (/chat) живут в одном
   процессе, но ломаются независимо. HTTP может бодро отвечать,
   /health показывать «ai: true» — а сообщений из Telegram этот процесс
   не видит вообще (409: polling держит старая копия; токен от другого
   бота; NO_POLLING=1). Раньше это было нечем проверить, и «ии чат не
   реагирует» искали в OpenAI. Поэтому состояние пишется всегда,
   а /health и /diag его отдают.
   ============================================================ */
const runtime = {
  started_at: Date.now(),
  port: null,
  polling: 'starting',   // starting | running | retry | dead | off
  poll_attempts: 0,
  poll_error: null,      // conflict | auth | network | unknown
  poll_error_text: null,
  poll_error_at: null,
  last_update_at: null,  // когда процесс в последний раз видел апдейт
  me: null               // { id, username } — какой именно бот это отвечает
};

async function notifyAdmins(text) {
  const ids = [...ADMINS];
  if (!ids.length) {
    console.warn('[admin] ADMIN_IDS пуст — некому сообщить: ' + String(text).replace(/\n/g, ' | '));
    return;
  }
  for (const id of ids) {
    try { await bot.api.sendMessage(id, text); }
    catch (e) { console.warn(`[admin] не дошло до ${id}: ${e?.message || e}`); }
  }
}
const alerts = new Map();
/** Одно и то же предупреждение — не чаще раза в 10 минут. */
function alertAdmins(key, text, everyMs = 600000) {
  if (Date.now() - (alerts.get(key) || 0) < everyMs) return false;
  alerts.set(key, Date.now());
  notifyAdmins(text).catch(() => {});
  return true;
}
/* Ошибки, которые может починить только владелец: ключ, деньги, модель, регион.
   Гостю их показывать нельзя, админу — можно и нужно. */
const OWNER_ERRORS = new Set(['bad_key', 'no_key', 'no_quota', 'bad_model', 'bad_param', 'too_long', 'geo_blocked']);
function alertOwner(key, err) {
  if (!err || !OWNER_ERRORS.has(err)) return false;
  return alertAdmins(key, `⚠️ Живой чат Дибитишки не отвечает\nошибка: ${err}\nчто делать: ${ai.errorHint(err)}\n\nПодробности — /diag или GET /health`);
}

/* Любой апдейт — доказательство, что polling действительно принимает сообщения. */
bot.use(async (ctx, next) => {
  runtime.last_update_at = Date.now();
  db.stats.updates = (db.stats.updates || 0) + 1;
  if (runtime.polling !== 'running') {
    runtime.polling = 'running';
    runtime.poll_error = null;
    console.log('[bot] polling принимает апдейты');
  }
  await next();
});

/* ---------- контент: рабочая копия ---------- */
function seedContent() {
  if (db.content) {
    // v8 убирает конкретные цены из старой постоянной копии, не трогая
    // отредактированные админом практики и остальные поля.
    if (Number(db.content.version || 0) < 8) {
      db.content.version = 8;
      db.content.updated = '2026-09-15';
      if (db.content.meta) {
        db.content.meta.price_note = 'Минимальный донат раз в месяц · первая неделя бесплатно';
        const paywall = db.content.meta.mascot_lines?.paywall;
        if (Array.isArray(paywall) && paywall.length) {
          paywall[0] = 'Неделя бесплатно, дальше — минимальный донат раз в месяц. Без давления: я никуда не денусь.';
        }
      }
      save();
    }
    return db.content;
  }
  const candidates = [
    path.join(__dirname, '..', '..', 'app', 'content', 'content.json'),
    path.join(__dirname, '..', 'seed', 'content.json')
  ];
  for (const c of candidates) {
    try {
      db.content = JSON.parse(fs.readFileSync(c, 'utf8'));
      save();
      return db.content;
    } catch (e) {}
  }
  db.content = {
    version: 1,
    meta: { mascot_lines: { done: ['Готово!'] } },
    blocks: [],
    merch: [],
    minis: [],
    workbook: { title: 'Тетрадь', crisis_fields: [], sensory_senses: [] }
  };
  save();
  return db.content;
}
const C = () => seedContent();
const MASCOT = (name) => {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'mascot', name + '.png'),
    path.join(__dirname, '..', '..', 'app', 'assets', 'mascot', name + '.png')
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  return file ? new InputFile(file) : null;
};

/* ---------- утилиты ---------- */
const isAdmin = (ctx) => ADMINS.has(ctx.from?.id);
const allPractices = () => C().blocks.flatMap(b => b.practices.map(p => ({ ...p, block: b })));
const daySeed = () => Math.floor(Date.now() / 86400000);
const todayPractice = () => { const a = allPractices(); return a[daySeed() % a.length]; };
const isPremium = (u) => u && ((u.premium_until || 0) > Date.now() || (u.trial_start && Date.now() - u.trial_start < TRIAL_DAYS * 86400000));
const getUser = (ctx) => {
  const id = ctx.from.id;
  if (!db.users[id]) {
    db.users[id] = {
      id,
      name: ctx.from.first_name || 'друг',
      username: ctx.from.username || '',
      joined: Date.now(),
      trial_start: null,
      premium_until: 0,
      reminder: { on: false, time: '09:00', tz: 3 }
    };
  }
  return db.users[id];
};
function setPath(obj, p, value) {
  const parts = p.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (cur[k] === undefined) return false;
    cur = cur[k];
  }
  const last = /^\d+$/.test(parts.at(-1)) ? Number(parts.at(-1)) : parts.at(-1);
  try { cur[last] = JSON.parse(value); } catch (e) { cur[last] = value; }
  return true;
}
const getPath = (obj, p) => p.split('.').reduce((a, k) => a === undefined ? a : a[/^\d+$/.test(k) ? Number(k) : k], obj);

/* ---------- пользовательские команды ---------- */
bot.command('start', async (ctx) => {
  const u = getUser(ctx);
  if (!u.trial_start) u.trial_start = Date.now();
  save();
  // deep-link из веб-версии: ?start=pay_m1 — сразу к monthly-донату.
  // Старые pay_m3/pay_m6 тоже мягко приводим к единственному месячному варианту.
  const payload = String(ctx.match || '').trim();
  if (payload.startsWith('pay_')) return payFlow(ctx, planById());
  const img = MASCOT('hello');
  const text = `Привет, ${u.name}! Я Дибитишка — слезинка, которая помогает дружить с чувствами.\n\nВо мне: пять блоков практик осознанности и ДПТ, практика дня, мягкие альтернативы, дневник эмоций, письменные задания, чат поддержки и печатная тетрадь.\n\nПервая неделя бесплатно, потом ${plansLine()}. Оплата — командой /pay.\n\nВеб-версия: открой мини-приложение или зайди по коду — команда /code.`;
  if (img) await ctx.replyWithPhoto(img, { caption: text });
  else await ctx.reply(text);
});

bot.command('help', (ctx) => ctx.reply(
  'Я Дибитишка. Команды:\n' +
  '/today — практика дня с комментарием\n' +
  '/code — одноразовый код для входа в веб-версию\n' +
  '/reminder 09:00 — ежедневный пуш (off — выключить)\n' +
  '/pay — оформить подписку (Tribute)\n' +
  '/status — моя подписка и прогресс\n' +
  '/reset — начать разговор со мной с чистого листа\n' +
  '\nА ещё можно просто написать мне, что сейчас происходит, — я отвечу.\n' +
  (isAdmin(ctx) ? '\nАдмин: /admin' : '')
));

/* Примеры к практике (p.extras) — те же, что показывает веб. Без них шаги вроде
   «прочитай примеры ниже» и «выбери одну фразу из примеров» ведут в пустоту. */
const EXTRAS_TITLES = {
  affirmations: 'Примеры фраз',
  words: 'Слова-названия',
  senses: 'Примеры по чувствам',
  examples: 'Примеры'
};
const practiceExamplesText = (p) => Object.entries(p.extras || {}).map(([key, val]) => {
  const lines = Array.isArray(val)
    ? val.map((v) => `· ${v}`)
    : Object.entries(val || {})
      .filter(([, list]) => Array.isArray(list))
      .map(([group, list]) => `${group}: ${list.join(', ')}`);
  return lines.length ? `${EXTRAS_TITLES[key] || 'Примеры'}:\n${lines.join('\n')}` : '';
}).filter(Boolean).join('\n\n');

bot.command('today', async (ctx) => {
  getUser(ctx);
  save();
  const p = todayPractice();
  const img = MASCOT('calm');
  const text = `Практика дня · блок «${p.block.title}»\n\n${p.title} · ≈ ${p.minutes} мин\n\n${p.why}\n\nШаги:\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nНе можется? Альтернатива: ${p.alt.title} — ${p.alt.steps.join(' · ')}`;
  const examples = practiceExamplesText(p);
  const full = examples ? `${text}\n\n${examples}` : text;
  // подпись к фото в Telegram — максимум 1024 символа, поэтому длинные примеры уходят вторым сообщением
  if (img) {
    if (full.length <= 1024) await ctx.replyWithPhoto(img, { caption: full });
    else { await ctx.replyWithPhoto(img, { caption: text }); await ctx.reply(examples); }
  } else {
    await ctx.reply(full);
  }
});

bot.command('code', (ctx) => {
  const u = getUser(ctx);
  save();
  const code = loginCode();
  db.codes[code] = { user_id: u.id, exp: Date.now() + 10 * 60000 };
  save();
  ctx.reply(`Твой код для веб-версии: ${code}\nДействует 10 минут. Введи его на сайте — и веб привяжется к этому аккаунту.`);
});

bot.command('reminder', (ctx) => {
  const u = getUser(ctx);
  const arg = ctx.match?.trim();
  if (!arg || arg === 'off') {
    u.reminder.on = false;
    save();
    return ctx.reply('Напоминания выключены. Я буду скучать молча.');
  }
  const m = arg.match(/^(\d{1,2}):(\d{2})(?:\s*([+-]\d{1,2}))?$/);
  if (!m) return ctx.reply('Формат: /reminder 9:00 или /reminder 21:30 +3 (часовой пояс). off — выключить.');
  u.reminder = { on: true, time: `${m[1].padStart(2, '0')}:${m[2]}`, tz: m[3] ? Number(m[3]) : (u.reminder.tz ?? 3) };
  save();
  ctx.reply(`Буду писать каждый день в ${u.reminder.time} (часовой пояс ${u.reminder.tz >= 0 ? '+' : ''}${u.reminder.tz}). Вместе с практикой дня.`);
});

bot.command('status', (ctx) => {
  const u = getUser(ctx);
  save();
  const left = isPremium(u)
    ? (u.premium_until > Date.now()
        ? `Подписка до ${new Date(u.premium_until).toLocaleDateString('ru-RU')}`
        : `Бесплатная неделя ещё ${Math.max(0, Math.ceil((TRIAL_DAYS * 86400000 - (Date.now() - u.trial_start)) / 86400000))} дн.`)
    : 'Подписки нет';
  ctx.reply(`Профиль: ${u.name}\nПодписка: ${left}\nНапоминания: ${u.reminder.on ? u.reminder.time : 'выкл'}`);
});

/* Актуальная monthly-ссылка живёт в базе и меняется прямо в админ-панели. */
const payHelpForOwner = () => (
  'Добавь ссылку без перезапуска: /tribute set <ссылка Donation Request>. ' +
  'В Tribute у запроса должен быть ежемесячный период и минимальный донат. ' +
  'TRIBUTE_API на хосте нужен для проверки вебхука.'
);
function payKeyboard(_plan, url) {
  return new InlineKeyboard().url('💗 Минимальный донат · раз в месяц', url);
}
async function payFlow(ctx, plan) {
  const u = getUser(ctx);
  if (!u.trial_start) u.trial_start = Date.now();
  save();
  if (!tribute.tributeConfigured()) {
    return ctx.reply(
      'Оплата пока подключается, первая неделя у тебя уже идёт — практикуй спокойно. ' +
      (isAdmin(ctx) ? payHelpForOwner() : 'Напиши владельцу приложения — он завершит настройку ежемесячной поддержки Tribute.')
    );
  }
  const link = await tribute.createSubscriptionLink(u.id, plan);
  if (!link?.url) {
    console.error('[pay] нет ссылки ежемесячного доната Tribute', plan.id, JSON.stringify(tribute.tributeStatus()));
    return ctx.reply(
      'Не смог создать ссылку Tribute. Попробуй позже' +
      (isAdmin(ctx) ? '. ' + payHelpForOwner() + ' Подробности — в логах бота ([tribute]).' : ' или напиши владельцу приложения.')
    );
  }
  ctx.reply(
    'Подписка Дибитишки открывается за минимальный донат раз в месяц.\n' +
    'Tribute будет повторять выбранную поддержку ежемесячно; каждый платёж продлевает доступ на месяц. Отменить можно в Tribute в любой момент.',
    { reply_markup: payKeyboard(plan, link.url) }
  );
}

bot.command('pay', async (ctx) => payFlow(ctx, PLANS[0]));

/* кнопка ежемесячного доната в /pay */
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  if (!data.startsWith('pay:')) return;
  const plan = planById();
  await ctx.answerCallbackQuery();
  if (!tribute.tributeConfigured()) {
    return ctx.editMessageText(
      'Оплата пока подключается, первая неделя у тебя уже идёт — практикуй спокойно. ' +
      (isAdmin(ctx) ? payHelpForOwner() : 'Напиши владельцу приложения — он завершит настройку ежемесячной поддержки Tribute.')
    ).catch(() => {});
  }
  const u = getUser(ctx);
  if (!u.trial_start) u.trial_start = Date.now();
  save();
  const link = await tribute.createSubscriptionLink(u.id, plan);
  if (!link?.url) {
    console.error('[pay] нет ссылки ежемесячного доната Tribute', plan.id, JSON.stringify(tribute.tributeStatus()));
    return ctx.editMessageText(
      'Не смог создать ссылку Tribute. Попробуй позже' +
      (isAdmin(ctx) ? '. ' + payHelpForOwner() : ' или напиши владельцу приложения.')
    ).catch(() => {});
  }
  ctx.editMessageText(
    'Подписка Дибитишки открывается за минимальный донат раз в месяц.\n' +
    'Tribute повторяет выбранную поддержку ежемесячно; каждый платёж продлевает доступ на месяц. Отменить можно в любой момент.',
    { reply_markup: payKeyboard(plan, link.url) }
  ).catch(() => {});
});

/* ---------- админ ---------- */
bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply(
    'Админ-панель Дибитишки\n\n' +
    '/broadcast — начать рассылку (следующее сообщение = черновик, с текстом и/или фото)\n' +
    '/content — посмотреть структуру блоков\n' +
    '/content set <путь> <значение> — изменить любое поле (например: blocks.0.title Опора)\n' +
    '/content get <путь> — посмотреть поле\n' +
    '/export — прислать content.json файлом\n' +
    '/import — ответить этим сообщением на файл content.json\n' +
    '/users — статистика\n' +
    '/grant <id> [дней] — выдать подписку вручную\n' +
    '/ai — статус живого чата (OpenAI)\n' +
    '/tribute — статус оплаты\n' +
    '/tribute set <ссылка> — заменить monthly-ссылку без перезапуска\n' +
    '/tribute clear — убрать ссылку из админ-панели'
  );
});

bot.command('tribute', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const arg = String(ctx.match || '').trim();
  const setMatch = arg.match(/^(?:set|link)\s+(.+)$/i);
  const rawUrl = setMatch?.[1] || (/^https:\/\//i.test(arg) ? arg : '');

  if (rawUrl) {
    const parsed = tribute.normalizePayUrl(rawUrl);
    if (!parsed.ok) {
      return ctx.reply('Ссылка не похожа на Donation Request Tribute. Нужна официальная https-ссылка вида https://t.me/tribute/app?startapp=d…');
    }
    db.settings.tribute_monthly_url = parsed.url;
    tribute.setDynamicPayUrl(parsed.url);
    save(); flush();
    const ready = tribute.tributeStatus().ok;
    return ctx.reply(
      '✅ Ссылка ежемесячного доната сохранена сразу, без перезапуска.\n\n' +
      (ready ? 'Проверь /pay. ' : '⚠️ /pay пока на паузе: сначала добавь TRIBUTE_API на хосте. ') +
      'В Tribute у Donation Request должны быть включены ежемесячный период и минимальный донат.'
    );
  }

  if (/^(?:clear|off|remove)$/i.test(arg)) {
    db.settings.tribute_monthly_url = '';
    tribute.setDynamicPayUrl('');
    save(); flush();
    const fallback = tribute.tributeStatus().source === 'env';
    return ctx.reply(fallback
      ? 'Ссылка из админ-панели очищена. Сейчас используется запасная ссылка из окружения хоста.'
      : 'Ссылка очищена. /pay будет на паузе, пока не задашь новую через /tribute set <ссылка>.');
  }

  if (arg) return ctx.reply('Команды: /tribute set <ссылка>, /tribute clear или просто /tribute для статуса.');

  const st = tribute.tributeStatus();
  const mark = (v) => v ? '✅' : '⛔';
  const source = st.source === 'admin' ? 'админ-панель (можно менять без перезапуска)'
    : st.source === 'env' ? 'переменная окружения (запасной вариант)' : 'не задана';
  const lines = [
    'Оплата Tribute:',
    `${mark(st.link)} monthly-ссылка: ${source}`,
    `${mark(st.key)} ключ TRIBUTE_API ${st.key ? '' : '(без него webhook и /pay безопасно выключены)'}`,
    st.donation_token ? '✅ Donation Request распознана по токену' : st.link ? '⚠️ Токен ссылки не распознан — проверь формат' : null,
    '',
    st.ok ? 'Пейвол работает: /pay отдаёт актуальную ссылку.'
      : st.link ? 'Пейвол на паузе: добавь TRIBUTE_API на хосте.' : 'Пейвол на паузе: /tribute set <ссылка>',
    'Изменить: /tribute set https://t.me/tribute/app?startapp=d…',
    'Очистить: /tribute clear'
  ].filter(Boolean);
  if (st.key) {
    const chk = await tribute.checkApiKey();
    lines.push(chk.ok
      ? 'Ключ живой: Tribute отвечает ✅'
      : `Ключ не проходит у Tribute (${chk.reason}). Перевыпусти его на хосте.`);
  }
  lines.push('Webhook URL в Tribute: https://<адрес бота>/tribute/webhook');
  const url = tribute.getPayUrl();
  const kb = url ? new InlineKeyboard().url('Открыть текущую ссылку', url) : undefined;
  ctx.reply(lines.join('\n'), kb ? { reply_markup: kb } : undefined);
});

bot.command('ai', (ctx) => {
  if (!isAdmin(ctx)) return;
  const rep = statusReport();
  const h = rep.ai_health;
  const lines = [
    h.configured ? 'Живой чат: ключ есть ✅' : 'Живой чат: ключа нет ⏸ — впиши OPENAI_API_KEY на бот-хосте',
    `Модель: ${h.model} · API: ${h.base}`,
    `Параметры запроса: ${h.param_mode || 'по умолчанию для этой модели'} · память диалога: ${h.history} реплик`,
    `Запросов: ${h.calls}, неудачных: ${h.fails}`,
    h.last_ok_at ? `Последний ответ модели: ${Math.round((Date.now() - h.last_ok_at) / 1000)} с назад (${h.last_latency_ms || '?'} мс)` : 'Успешных ответов модели ещё не было ❌',
    h.last_error ? `Последняя ошибка: ${h.last_error}${h.last_error_detail ? ' — ' + h.last_error_detail : ''}` : 'Ошибок API нет',
    h.last_error ? `Что делать: ${ai.errorHint(h.last_error)}` : '',
    `Пользователей, говоривших со мной: ${rep.db.users_talked}`,
    `Telegram-половина: polling ${rep.telegram.polling}${rep.telegram.as ? ', я ' + rep.telegram.as : ''}`
  ].filter(Boolean);
  ctx.reply(lines.join('\n') + '\n\nПолная диагностика с проверкой связи — /diag');
});

/* /diag — ответ на «чат молчит, но я не понимаю где». Один запрос:
   Telegram (polling), HTTP (порт), OpenAI (живой тестовый вызов), база. */
bot.command('diag', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.replyWithChatAction('typing').catch(() => {});
  const rep = statusReport();
  const t = rep.telegram, a = rep.ai_health;
  const test = await ai.selfTest();
  const ago = (s) => s === null || s === undefined ? 'никогда' : s < 60 ? `${s} с назад` : s < 3600 ? `${Math.round(s / 60)} мин назад` : `${Math.round(s / 3600)} ч назад`;
  const lines = [
    'Диагностика Дибитишки',
    '',
    `Telegram: ${t.as || 'getMe не прошёл'} · polling: ${t.polling} (попыток ${t.poll_attempts}) · апдейтов: ${t.updates} · последний: ${ago(t.last_update_age_s)}`,
    t.poll_error ? `  ⚠️ ${t.poll_error}: ${t.poll_error_text || ''}\n  ${POLL_ADVICE[t.poll_error] || ''}` : '  сообщения доходят ✅',
    '',
    `HTTP API: порт ${runtime.port ?? 'не занят'} · аптайм ${Math.round(rep.uptime_s / 60)} мин`,
    '',
    `OpenAI: ${a.configured ? 'ключ есть' : 'НЕТ КЛЮЧА'} · модель ${a.model} · ${a.base}`,
    `  последний ответ: ${a.last_ok_at ? ago(a.last_ok_age_s) : 'не было'} · ошибок ${a.fails}/${a.calls}`,
    a.last_error ? `  последняя ошибка: ${a.last_error} — ${a.last_error_detail || ai.errorHint(a.last_error)}` : '',
    test.ok
      ? `  тест живого чата: ок ✅ (${test.model}, ${test.ms} мс) — «${test.answer}»`
      : `  тест живого чата: ❌ ${test.error} → ${test.detail || test.hint}`,
    '',
    rep.agents.enabled
      ? `Agents API: включён · модель ${rep.agents.model} · сессий ${rep.agents.sessions} (создано ${rep.agents.created}, закрыто ${rep.agents.closed}) · ходов ${rep.agents.turns} · фолбэков ${rep.agents.fallbacks}` +
        `\n  исполнитель: ${rep.agents.executor_cmd ? 'автозапуск' : 'вручную (AGENTS_EXECUTOR_CMD не задан)'} · ключ окружения: ${rep.agents.executor_key ? 'есть' : 'НЕТ (OPENAI_EXECUTOR_API_KEY)'}` +
        (rep.agents.live?.length ? '\n  ' + rep.agents.live.map((x) => `${x.key}: ${x.session_id} · окружение ${x.environment_state} · ${x.executor}${x.idle_s !== null ? ' · покой ' + x.idle_s + ' с' : ''}`).join('\n  ') : '') +
        (rep.agents.last_error ? `\n  ⚠️ ${rep.agents.last_error}: ${rep.agents.last_error_detail || ''}` : '')
      : 'Agents API: выключен (AGENTS_ENABLED=1) — чат идёт через chat/completions',
    '',
    `База: ${rep.db.file} · пользователей ${rep.users}, из них говорили ${rep.db.users_talked}`,
    a.configured && rep.users === 0 ? '  ⚠️ база пустая, а HTTP жив: похоже, данные не переживают рестарт (том не примонтирован) или Telegram читает другая копия' : '',
    '',
    rep.problems.length ? 'Что мешает: \n· ' + rep.problems.join('\n· ') : 'Всё на месте — если чат всё ещё молчит, напиши мне /start'
  ].filter(Boolean);
  for (const part of splitMessage(lines.join('\n'), 3500)) await ctx.reply(part).catch(() => {});
});


bot.command('users', (ctx) => {
  if (!isAdmin(ctx)) return;
  const us = Object.values(db.users);
  ctx.reply(`Всего: ${us.length}\nС подпиской: ${us.filter(isPremium).length}\nС напоминаниями: ${us.filter(u => u.reminder?.on).length}\nРассылок отправлено: ${db.stats.sent}`);
});

bot.command('grant', (ctx) => {
  if (!isAdmin(ctx)) return;
  const [id, days] = String(ctx.match || '').trim().split(/\s+/);
  const u = db.users[Number(id)];
  if (!u) return ctx.reply('Такого пользователя нет в базе.');
  const d = Number(days) || 30;
  u.premium_until = Math.max(Date.now(), u.premium_until || 0) + d * 86400000;
  save();
  ctx.reply(`Выдано ${d} дн. пользователю ${u.name}.`);
});

bot.command('content', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const arg = String(ctx.match || '').trim();
  if (!arg) {
    const lines = C().blocks.map((b, i) => `${i}. ${b.title} (${b.id}) · ${b.practices.length} практ.`);
    return ctx.reply('Блоки:\n' + lines.join('\n') + '\n\nИзменить: /content set blocks.0.title Новое имя\nПосмотреть: /content get blocks.0.intro');
  }
  const m = arg.match(/^(set|get)\s+(\S+)\s*([\s\S]*)$/);
  if (!m) return ctx.reply('Формат: /content set <путь> <значение> или /content get <путь>.');
  const [, cmd, p, val] = m;
  if (cmd === 'get') {
    const v = getPath(C(), p);
    return ctx.reply(v === undefined ? 'Нет такого пути.' : (typeof v === 'string' ? v : JSON.stringify(v).slice(0, 3500)));
  }
  if (!val) return ctx.reply('Что установить?');
  const ok = setPath(C(), p, val.trim());
  C().version = (C().version || 1) + 1;
  C().updated = new Date().toISOString().slice(0, 10);
  save();
  ctx.reply(ok ? `Готово, обновил(а) ${p}. Веб-приложение подтянет само.` : 'Не нашёл(ла) такой путь.');
});

bot.command('export', (ctx) => {
  if (!isAdmin(ctx)) return;
  const tmp = path.join(__dirname, '..', 'content.export.json');
  fs.writeFileSync(tmp, JSON.stringify(C(), null, 2));
  ctx.replyWithDocument(new InputFile(tmp, 'content.json'), { caption: 'Рабочая копия контента. Положи её в app/content/content.json репозитория, если бот без порта.' });
});

bot.on(':document', async (ctx) => {
  if (!isAdmin(ctx) || !ctx.message.document?.file_name?.endsWith('.json')) return;
  try {
    const f = await ctx.getFile();
    const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
    const j = await r.json();
    if (j && j.blocks) {
      db.content = j;
      save();
      ctx.reply('Контент загружен из файла. Версия: ' + j.version);
    } else {
      ctx.reply('В файле нет blocks — не похоже на контент.');
    }
  } catch (e) {
    ctx.reply('Не вышло импортировать: ' + e.message);
  }
});

/* ---------- рассылки ---------- */
bot.command('broadcast', (ctx) => {
  if (!isAdmin(ctx)) return;
  db.broadcast = { admin: ctx.from.id, awaiting: true };
  save();
  ctx.reply('Пришли следующее сообщение: текст, картинку или и то и другое. Я покажу превью и спрошу подтверждение. У картинок с белым фоном предложу вырезать фон — будет эффект объёма.');
});

bot.on(':photo', async (ctx) => await handleDraft(ctx, true));
bot.command('reset', (ctx) => {
  const u = getUser(ctx);
  u.chat = [];
  save();
  // у Agents API память живёт в сессии, а не в u.chat — чистый лист только
  // вместе с закрытой сессией (иначе «reset» сбросит только половину памяти)
  agents.closeSession('tg:' + ctx.from.id, 'reset').catch(() => {});
  ctx.reply('Окей, начинаем с чистого листа. Я тут 💧');
});

/* ---------- один ход диалога: Agents API (если включён) или chat/completions ----------
   AGENTS_ENABLED=1 даёт диалогу persistent-сессию с изолированным окружением
   (бот/src/agents.js). Если сессия или окружение подвели — человек этого не
   замечает: тихо уходим в chat/completions, а владелец получает причину. */
async function chatAnswer({ key, userText, history, userContext, channel, onDelta }) {
  if (!agents.agentsEnabled()) return ai.complete({ userText, history, userContext, channel });
  const res = await agents.ask({ key, userText, userContext, channel, onDelta });
  if (res && !res.error) return { ...res, backend: 'agents' };
  alertAdmins('agents:' + res?.error,
    `⚠️ Agents API недоступен (${res?.error})\n${res?.detail || ''}\nотвечаю через chat/completions · /diag → agents`,
    300000);
  console.warn(`[agents] фолбэк в chat/completions: ${res?.error} ${res?.detail || ''}`);
  const alt = await ai.complete({ userText, history, userContext, channel });
  return alt && !alt.error ? { ...alt, backend: 'chat/completions', agents_error: res?.error } : alt;
}

bot.on('message:text', async (ctx) => {
  if (db.broadcast?.awaiting && isAdmin(ctx)) return handleDraft(ctx, false);
  if (ctx.from.is_bot) return;
  const u = getUser(ctx);
  save();
  const text = ctx.message.text || '';
  if (text.startsWith('/')) {
    // неизвестная команда: не молчим в пустоту (именно так выглядит «бот не реагирует»),
    // но и не спорим с grammY — объясняем, где команды
    console.log(`[bot] неизвестная команда: ${text.slice(0, 40)}`);
    return ctx.reply('Такой команды у меня нет. /start — с чего начать, /today — практика дня, /help — всё остальное.').catch(() => {});
  }
  if (!ai.aiConfigured()) {
    alertOwner('web:no_key', 'no_key');
    const p = todayPractice();
    const tech = isAdmin(ctx) ? '\n\n(у бота нет OPENAI_API_KEY на хосте — /diag покажет подробности)' : '';
    return ctx.reply(`Я тут, просто отвечаю коротко: живой голос ещё не подключён. А пока — /today, практика дня (${p.title}) или /code для веба.${tech}`).catch(() => {});
  }
  await ctx.replyWithChatAction('typing').catch(() => {});
  const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 4000);
  try {
    // Собираем контекст пользователя для локального ответа на случай ошибки API.
    // Задания (whoami/anchors/crisis) и прогресс хранятся пока только на вебе;
    // в ТГ бот попадает только имя и подписка — этого достаточно для тёплого ответа.
    const userContext = {
      name: u.name, premium: isPremium(u), todayPractice: todayPractice()?.title,
      level: null, streak: null, mastered: [],
      whoami: null, anchors: null, crisis: null
    };
    let live = null, liveBuf = '', liveAt = 0;
    if (agents.agentsEnabled()) live = await ctx.reply('…').catch(() => null);
    const onDelta = live ? (d) => {
      if (!d) return;
      liveBuf += d;
      if (Date.now() - liveAt < 1200) return;   // Telegram не любит частые edit
      liveAt = Date.now();
      ctx.api.editMessageText(ctx.chat.id, live.message_id, liveBuf).catch(() => {});
    } : null;
    const res = await chatAnswer({
      key: 'tg:' + ctx.from.id,
      userText: text,
      history: u.chat || [],
      userContext,
      channel: 'telegram',
      onDelta
    });
    clearInterval(typing);
    if (!res || res.error) {
      /* Человек в трудный момент не должен читать про переменные окружения:
         отвечаем из его же записей (localReply), а причину — владельцу
         отдельным сообщением и в /health. Стабильные ошибки (ключ, деньги,
         модель) не прячем: без них «чат молчит» ищут вслепую. */
      alertOwner('tg:' + res?.error, res?.error);
      const tech = isAdmin(ctx)
        ? `\n\n(технически: ${res?.error}${res?.detail ? ' — ' + String(res.detail).slice(0, 180) : ''}\n${ai.errorHint(res?.error)}\n/diag — полная диагностика)`
        : '';
      const out = ai.localReply(text, userContext) + tech;
      // не добавляем в историю, чтобы при следующем запросе контекст не ломался
      if (live) return ctx.api.editMessageText(ctx.chat.id, live.message_id, out.slice(0, 4000)).catch(() => ctx.reply(out).catch(() => {}));
      return ctx.reply(out).catch(() => {});
    }
    u.chat = ai.pushHistory(u.chat, 'user', text);
    u.chat = ai.pushHistory(u.chat, 'assistant', res.text);
    save();
    if (live) {
      const done = await ctx.api.editMessageText(ctx.chat.id, live.message_id, res.text.slice(0, 4000)).catch(() => null);
      if (done) return;
    }
    for (const part of splitMessage(res.text)) await ctx.reply(part).catch(() => {});
  } catch (e) {
    clearInterval(typing);
    console.error('[ai] tg:', e?.message || e);
    ctx.reply(ai.localReply(text, { name: u.name })).catch(() => {});
  }
});

/** Телеграм режет сообщения на 4096 символов — делим по абзацам. */
function splitMessage(text, limit = 4000) {
  const out = [];
  let cur = '';
  for (const para of String(text).split(/\n{2,}/)) {
    const piece = para.length > limit ? para.slice(0, limit) : para;
    if ((cur + '\n\n' + piece).length > limit && cur) { out.push(cur); cur = piece; }
    else cur = cur ? cur + '\n\n' + piece : piece;
  }
  if (cur) out.push(cur);
  return out.length ? out : [String(text).slice(0, limit)];
}

async function handleDraft(ctx, hasPhoto) {
  if (!db.broadcast?.awaiting || !isAdmin(ctx)) return;
  db.broadcast = {
    admin: ctx.from.id,
    awaiting: false,
    text: ctx.message.caption || ctx.message.text || '',
    photo: hasPhoto ? ctx.message.photo.at(-1).file_id : null
  };
  save();
  const kb = new InlineKeyboard().text('Отправить как есть', 'bc_send');
  if (hasPhoto) kb.text('Вырезать белый фон и отправить', 'bc_cut');
  kb.text('Отмена', 'bc_cancel');
  const n = Object.keys(db.users).length;
  if (hasPhoto) {
    await ctx.replyWithPhoto(db.broadcast.photo, { caption: `Превью рассылки на ${n} чел:\n\n${db.broadcast.text || '(без текста)'}`, reply_markup: kb });
  } else {
    await ctx.reply(`Превью рассылки на ${n} чел:\n\n${db.broadcast.text}`, { reply_markup: kb });
  }
}

bot.callbackQuery('bc_send', (ctx) => sendBroadcast(ctx, false));
bot.callbackQuery('bc_cut', (ctx) => sendBroadcast(ctx, true));
bot.callbackQuery('bc_cancel', async (ctx) => {
  db.broadcast = null;
  save();
  await ctx.answerCallbackQuery('Отменено');
  await ctx.editMessageCaption('Рассылка отменена').catch(() => ctx.reply('Рассылка отменена'));
});

async function sendBroadcast(ctx, cutBg) {
  if (!isAdmin(ctx)) return;
  const d = db.broadcast;
  if (!d || d.awaiting) return ctx.answerCallbackQuery('Нет черновика');
  await ctx.answerCallbackQuery('Отправляю…');
  let photoBuf = null;
  if (d.photo) {
    try {
      const f = await ctx.api.getFile(d.photo);
      const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
      const ab = await r.arrayBuffer();
      photoBuf = Buffer.from(ab);
      const isPng = /\.png$/i.test(f.file_path || '');
      if (cutBg) photoBuf = await removeWhiteBackground(photoBuf, isPng);
    } catch (e) {
      console.error('[broadcast] photo error', e.message);
      if (cutBg && photoBuf) ctx.reply(`Вырезать фон не удалось (${e.message}). Отправляю картинку как есть.`).catch(() => {});
    }
  }
  let ok = 0;
  let fail = 0;
  for (const u of Object.values(db.users)) {
    try {
      if (photoBuf) await ctx.api.sendPhoto(u.id, new InputFile(photoBuf, 'dibitishka.png'), { caption: d.text || undefined });
      else await ctx.api.sendMessage(u.id, d.text);
      ok++;
    } catch (e) {
      fail++;
    }
    await new Promise(r => setTimeout(r, 40));
  }
  db.stats.sent++;
  db.broadcast = null;
  save();
  ctx.reply(`Разослано: ${ok}, не дошло: ${fail}${cutBg ? '. Фон вырезан — картинка парит над чатом.' : ''}`);
}

/* ---------- HTTP API + статика для веб-версии ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const json = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(obj));
};

const sendFile = (res, filePath, extraHeaders = {}) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': /\.(html|json|js)$/i.test(filePath) ? 'no-cache' : 'public, max-age=3600',
      ...extraHeaders
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  } catch (e) {
    return false;
  }
};

const sendConfigJs = (res) => {
  try {
    const filePath = path.join(APP_DIR, 'config.js');
    let content = fs.readFileSync(filePath, 'utf8');
    content += '\nif (window.DIBI_CONFIG) window.DIBI_CONFIG.bot_public_url = window.location.origin;\n';
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(content);
    return true;
  } catch (e) {
    return false;
  }
};

const tryServeApp = (res, pathname) => {
  const direct = new Map([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/app', 'index.html'],
    ['/app/', 'index.html'],
    ['/app/index.html', 'index.html'],
    ['/workbook.html', 'workbook.html'],
    ['/app/workbook.html', 'workbook.html']
  ]);

  if (pathname === '/config.js' || pathname === '/app/config.js') return sendConfigJs(res);

  const rel = direct.get(pathname)
    || (pathname.startsWith('/app/assets/') ? pathname.slice('/app/'.length)
      : pathname.startsWith('/app/css/') ? pathname.slice('/app/'.length)
      : pathname.startsWith('/app/js/') ? pathname.slice('/app/'.length)
      : pathname.startsWith('/app/content/') ? pathname.slice('/app/'.length)
      : pathname.startsWith('/assets/') ? pathname.slice(1)
      : pathname.startsWith('/css/') ? pathname.slice(1)
      : pathname.startsWith('/js/') ? pathname.slice(1)
      : pathname.startsWith('/content/') ? pathname.slice(1)
      : null);

  if (!rel) return false;
  const resolved = path.resolve(APP_DIR, rel);
  if (!resolved.startsWith(APP_DIR + path.sep) && resolved !== APP_DIR) return false;
  return sendFile(res, resolved);
};

/* ---------- отчёт о состоянии: /health, /diag и веб-чат смотрят сюда ---------- */
function statusReport(opts = {}) {
  const now = Date.now();
  const aiH = ai.aiDiagnostics();
  const users = Object.keys(db.users).length;
  const talked = Object.values(db.users)
    .filter(u => (u.chat && u.chat.length) || (u.web_chat && u.web_chat.length)).length;
  const problems = [];
  if (runtime.polling === 'off') problems.push('polling выключён (NO_POLLING=1): бот отвечает только по HTTP');
  else if (runtime.polling !== 'running') {
    problems.push(`polling не работает (${runtime.poll_error || 'не поднялся'}) — сообщения из Telegram до этого процесса не доходят`);
  } else if (!runtime.last_update_at) {
    problems.push('polling работает, но не видел ещё ни одного сообщения — проверь, что пишешь тому же боту, чей TG_TOKEN здесь');
  }
  if (!aiH.configured) problems.push('OPENAI_API_KEY не задан — и Telegram, и веб отвечают шаблонами');
  else if (!aiH.last_ok_at) problems.push(`ни одного успешного ответа модели: ${aiH.last_error_detail || aiH.last_error || 'запросов ещё не было'}`);
  else if (aiH.last_error && now - (aiH.last_error_at || 0) < 600000) problems.push(`последняя ошибка OpenAI: ${aiH.last_error}`);  const ag = agents.agentsDiagnostics();
  if (ag.enabled && ag.last_error) problems.push(`agents: ${ag.last_error}${ag.last_error_detail ? ' — ' + ag.last_error_detail : ''}`);
  if (ag.enabled && !ag.executor_key) problems.push('agents: не задан OPENAI_EXECUTOR_API_KEY — исполнителю нечем подключаться к окружению');
  if (ag.enabled && !ag.executor_cmd) problems.push('agents: AGENTS_EXECUTOR_CMD не задан — codex exec-server надо запускать вручную');

  return {
    ok: true,
    app: 'dibitishka-bot',
    uptime_s: Math.round((now - runtime.started_at) / 1000),
    users,
    ai: aiH.configured,
    telegram: {
      as: runtime.me ? `@${runtime.me.username}` : null,
      bot_id: runtime.me ? runtime.me.id : null,
      polling: runtime.polling,
      poll_attempts: runtime.poll_attempts,
      poll_error: runtime.poll_error,
      poll_error_text: runtime.poll_error_text,
      last_update_age_s: runtime.last_update_at ? Math.round((now - runtime.last_update_at) / 1000) : null,
      updates: db.stats.updates || 0,
      admins: ADMINS.size
    },
    ai_health: aiH,
    ai_hint: aiH.last_error ? ai.errorHint(aiH.last_error) : null,
    agents: agents.agentsDiagnostics(),
    tribute: tribute.tributeStatus(),
    db: { file: dbFile, users_talked: talked },
    problems
  };
}

/* ---------- лимит на открытый /chat: чат публичный, а ключ OpenAI — твой ---------- */
const CHAT_RATE = Math.max(1, Number(process.env.CHAT_RATE_PER_MIN || 20));
const rate = new Map(); // ip -> [ts, ...]
function rateOk(ip) {
  const now = Date.now();
  const list = (rate.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= CHAT_RATE) { rate.set(ip, list); return false; }
  list.push(now);
  rate.set(ip, list);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of rate) {
    const live = list.filter((t) => now - t < 60000);
    if (live.length) rate.set(ip, live); else rate.delete(ip);
  }
}, 60000).unref?.();

const boardApi = createBoardApi({ root: process.env.BOARDS_DATA_DIR || path.join(path.dirname(dbFile), 'board-data'), auth: webAuth, json });
const gifApi = createGifApi({ json });
const codeAttempts = new Map();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  const u = new URL(req.url, 'http://x');
  if (await boardApi(req, res, u)) return;
  if (await gifApi(req, res, u)) return;

  if (req.method === 'GET' && u.pathname === '/health') {
    return json(res, 200, statusReport());
  }
  if (req.method === 'GET' && u.pathname === '/chat/status') {
    const rep = statusReport();
    // веб смотрит только на rep.ai — остальное для отладки из браузера (console)
    return json(res, 200, {
      ok: true,
      ai: rep.ai,
      problems: rep.problems,
      ...(process.env.DIAG_PUBLIC === '1' ? { ai_health: rep.ai_health, telegram: rep.telegram } : {})
    });
  }
  if (req.method === 'POST' && u.pathname === '/chat') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { user_id, text, context, history } = JSON.parse(body || '{}');
        const msg = String(text || '').trim();
        if (!msg) return json(res, 400, { ok: false, error: 'empty' });
        if (!rateOk(ip)) {
          // чат публичный: без лимита один скрипт съедает бюджет ключа владельца
          return json(res, 200, { ok: false, ai: ai.aiConfigured(), error: 'slow_down', text: ai.fallbackLine('rate_limit') });
        }
        if (!ai.aiConfigured()) return json(res, 200, { ok: false, ai: false, error: 'no_key' });
        const uid = Number(user_id);
        const user = uid ? db.users[uid] : null;
        // историю берём у бота (если пользователь известен), иначе — из тела запроса (гость в вебе)
        const hist = user ? (user.web_chat || []) : (Array.isArray(history) ? history.slice(-20) : []);
        const userContext = { ...(context && typeof context === 'object' ? context : {}) };
        if (user) {
          if (!userContext.name) userContext.name = user.name;
          userContext.premium = isPremium(user);
        }
        userContext.todayPractice = todayPractice()?.title;
        const out = await chatAnswer({
          key: 'web:' + (uid || ip),
          userText: msg, history: hist, userContext, channel: 'web'
        });
        if (!out || out.error) {
          /* Человеку — тёплый ответ из его же записей, никогда «проверь OPENAI_API_KEY»:
             техническое сообщение в чате поддержки только пугает. Причину — админу
             и в /health, а не в пузырь чата. */
          alertOwner('web:' + out?.error, out?.error);
          return json(res, 200, {
            ok: false, ai: true, error: out?.error || 'unknown',
            text: ai.localReply(msg, userContext), local: true,
            backend: out?.backend || null,
            ...(process.env.DIAG_PUBLIC === '1' ? { hint: ai.errorHint(out?.error), detail: out?.detail || null } : {})
          });
        }
        if (user) {
          user.web_chat = ai.pushHistory(user.web_chat, 'user', msg);
          user.web_chat = ai.pushHistory(user.web_chat, 'assistant', out.text);
          save();
        }
        return json(res, 200, {
          ok: true, ai: true, text: out.text,
          model: out.model, backend: out.backend || 'chat/completions',
          ...(out.agents_error ? { agents_fallback: out.agents_error } : {})
        });
      } catch (e) {
        return json(res, 400, { ok: false, error: 'bad_request' });
      }
    });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/content.json') {
    return json(res, 200, C());
  }
  if (req.method === 'POST' && u.pathname === '/auth/verify') {
    const now = Date.now(), ip = req.socket.remoteAddress || '?';
    for (const [key, rec] of codeAttempts) if (now - rec.time > 600000) codeAttempts.delete(key);
    const attempt = codeAttempts.get(ip) || { time: now, count: 0 };
    attempt.count++; codeAttempts.set(ip, attempt);
    if (attempt.count > 10) return json(res, 429, { ok: false, error: 'rate_limit' });
    try {
      const { code } = await readJson(req, 1024);
      if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return json(res, 400, { ok: false });
      const rec = db.codes[code.trim()];
      if (!rec || rec.exp < now) return json(res, 401, { ok: false });
      const user = db.users[rec.user_id];
      if (!user) return json(res, 401, { ok: false });
      delete db.codes[code.trim()];
      const session = webAuth.issue(rec.user_id);
      save();
      return json(res, 200, { ok: true, user: { id: rec.user_id, name: user.name || 'друг' }, ...session });
    } catch (e) { return json(res, e.status || 400, { ok: false }); }
  }
  if (req.method === 'GET' && u.pathname === '/me') {
    const uid = Number(u.searchParams.get('user_id'));
    const user = db.users[uid];
    if (!user) return json(res, 404, { ok: false });
    return json(res, 200, {
      ok: true,
      premium_until: user.premium_until || 0,
      trial_start: user.trial_start || 0,
      is_premium: isPremium(user)
    });
  }
  if (req.method === 'GET' && u.pathname === '/pay-url') {
    /* Веб открывает окно Tribute сразу внутри приложения (как «Разовый донат»),
       поэтому отдаём актуальную monthly-ссылку Donation Request. Секретов в
       ней нет: это публичная страница оплаты, та же, куда ведёт кнопка /pay.
       Без настроенного Tribute ok=false — веб покажет прежнюю шторку. */
    const url = tribute.getPayUrl();
    return json(res, 200, { ok: tribute.tributeConfigured(), url: url || '' });
  }
  if (req.method === 'POST' && u.pathname === '/me/reminder') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { user_id, on, time } = JSON.parse(body || '{}');
        const user = db.users[Number(user_id)];
        if (!user) return json(res, 404, { ok: false });
        user.reminder = { on: !!on, time: time || user.reminder.time || '09:00', tz: user.reminder?.tz ?? 3 };
        save();
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 400, { ok: false });
      }
    });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/tribute/webhook') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 256000) req.destroy(); });
    req.on('end', () => {
      // 1) подпись: Tribute подписывает сырое тело ключом (HMAC-SHA256 → trbt-signature)
      const sig = tribute.verifySignature(body, req.headers['trbt-signature'] || '');
      if (!sig.ok) {
        console.error('[tribute] webhook: неверная подпись — проверь TRIBUTE_API и URL вебхука в кабинете');
        return json(res, 401, { ok: false, error: sig.reason || 'bad_signature' });
      }
      // 2) формат: { name, created_at, sent_at, payload }
      let j;
      try { j = JSON.parse(body || '{}'); }
      catch (e) { return json(res, 400, { ok: false, error: 'bad_json' }); }
      const name = j.name || '';
      const p = (j.payload && typeof j.payload === 'object') ? j.payload : {};
      // 3) отмена recurring-доната не отнимает уже оплаченный месяц.
      if (name === 'cancelled_donation') {
        console.log(`[tribute] ${name}: telegram_user_id=${p.telegram_user_id || '?'}, доступ оставлен до конца срока`);
        for (const aid of ADMINS) {
          bot.api.sendMessage(aid, `Tribute: ежемесячная поддержка отменена — пользователь ${p.telegram_user_id || '?'}. Уже оплаченный доступ оставлен до конца срока.`).catch(() => {});
        }
        return json(res, 200, { ok: true, ignored: name });
      }
      // Разовый донат и monthly-донат от другой Donation Request не открывают доступ.
      if (!tribute.isPaidEvent(name, p)) return json(res, 200, { ok: true, ignored: name || 'not_configured_monthly_donation' });

      // 4) дедуп после проверки события: ретрай не должен прибавить второй месяц.
      const dkey = tribute.webhookDedupeKey(j);
      if (dkey) {
        db.tribute_seen = db.tribute_seen || {};
        if (db.tribute_seen[dkey]) return json(res, 200, { ok: true, dup: true });
        db.tribute_seen[dkey] = Date.now();
        const keys = Object.keys(db.tribute_seen);
        if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete db.tribute_seen[k];
        save();
      }
      // 5) донатор: ищем по telegram_user_id; мог оплатить раньше, чем нажал /start, —
      // тогда заводим запись сами, иначе подписка «потеряется» (такого пользователя нет в базе)
      const uid = Number(p.telegram_user_id || p.user_id);
      if (!uid) return json(res, 200, { ok: true, ignored: 'no_user' });
      let user = db.users[uid];
      if (!user) {
        user = db.users[uid] = {
          id: uid,
          name: p.telegram_username ? String(p.telegram_username) : 'друг',
          username: p.telegram_username ? String(p.telegram_username) : '',
          joined: Date.now(),
          trial_start: Date.now(),
          premium_until: 0,
          reminder: { on: false, time: '09:00', tz: 3 }
        };
        console.log(`[tribute] ${name}: новый пользователь ${uid} создан из вебхука`);
      }
      // 6) активация: expires_at из вебхука точнее всего; иначе — дни по карте товаров
      const exp = p.expires_at ? Date.parse(p.expires_at) : NaN;
      let days = 0;
      if (Number.isFinite(exp) && exp > Date.now()) {
        user.premium_until = Math.max(user.premium_until || 0, exp);
      } else {
        days = tribute.daysForTributePayload(p);
        user.premium_until = Math.max(Date.now(), user.premium_until || 0) + days * 86400000;
      }
      save(); flush(); // доступ и dedupe должны пережить рестарт сразу после ответа webhook
      const until = new Date(user.premium_until).toLocaleDateString('ru-RU');
      console.log(`[tribute] ${name}: ${uid} → подписка до ${until}${days ? ` (+${days} дн.)` : ' (по expires_at)'}`);
      bot.api.sendMessage(uid, `Оплата прошла! Подписка активна до ${until}. Спасибо, что держишь меня в форме 💧`).catch(() => {});
      return json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'GET' && tryServeApp(res, u.pathname)) return;
  json(res, 404, { ok: false });
});

/* ---------- занимаем порт: своя прошлая копия уходит, чужая не страдает ---------- */
server.on('error', (e) => {
  // EADDRINUSE разбирает acquirePort (он просит уйти нашу прошлую копию и,
  // если держатель чужой, берёт следующий порт) — здесь только настоящий мусор
  if (e?.code === 'EADDRINUSE') return;
  console.error('[http] ' + (e?.message || e));
});

acquirePort(server, PORT, { host: '0.0.0.0' })
  .then((actual) => {
    runtime.port = actual;
    console.log(`[http] API on :${actual}`);
    if (actual !== PORT) console.warn(`[http] порт ${PORT} был занят — я на ${actual}. Для вева это значит: обнови bot_public_url/проброс порта, иначе чат не достучится.`);
    console.log(ai.aiStatusLine());
    const line = agents.agentsStatusLine();
    if (line) console.log(line);
  })
  .catch((e) => {
    console.error('[http] ' + (e?.message || e));
    process.exit(1);
  });

/* ---------- аккуратный выход: база на диск, polling остановлен, порт свободен ----------
   Без этого старый процесс переживает деплой и продолжает держать polling
   Telegram: новая копия вечно ловит 409 Conflict и выглядит как
   «бот жив (HTTP отвечает), но на сообщения молчит». */
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[bot] ${signal} — сохраняю базу и освобождаю порт`);
  try { flush(); } catch (e) { console.error('[db] не записал: ' + (e?.message || e)); }
  try { await bot.stop(); } catch { /* polling мог и не подняться */ }
  // исполнители окружения (codex exec-server) не должны пережить процесс
  try { agents.closeAllSessions('shutdown'); } catch { /* и не было ни одного */ }
  try { server.close(); } catch { /* уже закрыт */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/* ---------- планировщик напоминаний ---------- */
setInterval(() => {
  const now = new Date();
  for (const u of Object.values(db.users)) {
    if (!u.reminder?.on) continue;
    const local = new Date(now.getTime() + (u.reminder.tz || 3) * 3600000 + now.getTimezoneOffset() * 60000);
    const hm = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
    if (hm !== u.reminder.time) continue;
    if (u.last_push === now.toDateString()) continue;
    u.last_push = now.toDateString();
    save();
    const p = todayPractice();
    const img = MASCOT(['hello', 'calm', 'hug'][daySeed() % 3]);
    const text = `Время для практики: ${p.title} · ≈ ${p.minutes} мин\n\n${p.why}\n\nНе можется — альтернатива: ${p.alt.title}. Открыть приложение: /today`;
    if (img) bot.api.sendPhoto(u.id, img, { caption: text }).catch(() => {});
    else bot.api.sendMessage(u.id, text).catch(() => {});
  }
}, 30000);

/* ---------- polling: с внятной причиной, а не молчаливым ретраем ---------- */
function classifyPollError(err) {
  const s = `${err?.description || ''} ${err?.message || ''} ${err?.error_code || ''}`.toLowerCase();
  if (/409|conflict|terminated by other getupdates|only one bot instance/.test(s)) return 'conflict';
  if (/401|unauthorized|invalid token/.test(s)) return 'auth';
  if (/enotfound|eai_again|etimedout|econn|network|fetch failed|proxy|socket hang/.test(s)) return 'network';
  return 'unknown';
}
const POLL_ADVICE = {
  conflict: 'polling этого токена уже держит ДРУГАЯ копия бота. Найди её (docker ps; pgrep -af "bot/src/index.js") и останови — либо сделай restart старого контейнера. Пока она жива, новая копия сообщений не увидит: Telegram отдаёт апдейты одному получателю.',
  auth: 'Telegram не принимает TG_TOKEN (401). Проверь токен в @BotFather и убедись, что это токен ТОГО бота, которому ты пишешь (сравни @username из getMe с адресатом в чате).',
  network: 'Нет связи с api.telegram.org с этого хоста (DNS, файрвол, прокси). HTTP API при этом может работать — поэтому /health отвечает, а чат молчит.',
  unknown: 'Смотри telegram.poll_error_text в /health'
};

async function startPolling(attempt = 1) {
  runtime.poll_attempts = attempt;
  try {
    await bot.init();                                  // getMe: падает здесь, если токен не тот
    const me = bot.botInfo || {};
    runtime.me = { id: me.id, username: me.username };
    console.log(`[bot] это @${me.username} (id ${me.id}) · админов: ${ADMINS.size} · порт: ${runtime.port ?? 'не занят'}`);
    if (!ADMINS.size) console.warn('[bot] ADMIN_IDS пуст — /diag и /ai никто не увидит');
    await bot.start({
      drop_pending_updates: false,
      // grammY резолвит start() только когда polling остановлен, поэтому «жив» отмечаем в onStart
      onStart: () => {
        runtime.polling = 'running';
        runtime.poll_error = null;
        runtime.poll_error_text = null;
        console.log('[bot] polling started');
      }
    });
    if (runtime.polling === 'running') { runtime.polling = 'stopped'; console.log('[bot] polling остановлен'); }
  } catch (err) {
    const kind = classifyPollError(err);
    runtime.polling = attempt >= 4 ? 'dead' : 'retry';
    runtime.poll_error = kind;
    runtime.poll_error_text = String(err?.description || err?.message || err).slice(0, 300);
    runtime.poll_error_at = Date.now();
    const backoff = Math.min(15000 * 2 ** Math.min(attempt - 1, 3), 120000);
    console.error(`[bot] polling не поднялся (попытка ${attempt}, ${kind}): ${runtime.poll_error_text}`);
    console.error('[bot] ' + (POLL_ADVICE[kind] || POLL_ADVICE.unknown));
    console.error(`[bot] HTTP API продолжает работать, повторю через ${Math.round(backoff / 1000)} с`);
    alertAdmins('polling:' + kind, `⚠️ Дибитишка не получает сообщения из Telegram (${kind})\n${POLL_ADVICE[kind] || POLL_ADVICE.unknown}`);
    setTimeout(() => startPolling(attempt + 1), backoff);
  }
}

if (process.env.NO_POLLING === '1') {
  runtime.polling = 'off';
  console.log('[bot] polling отключён (NO_POLLING=1) — работает только HTTP API');
} else {
  startPolling();
}

