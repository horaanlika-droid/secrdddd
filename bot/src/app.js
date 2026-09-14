/* ============================================================
   Дибитишка · телеграм-бот — ПРИЛОЖЕНИЕ
   (грузится из src/index.js: та точка входа сначала проверяет и при
    нужде доустанавливает зависимости, поэтому здесь grammy уже есть)
   Три переменные на бот-хосте:
     TG_TOKEN    — токен бота
     ADMIN_IDS   — id админов через запятую
     TRIBUTE_API — ключ Tribute API (можно вписать после запуска)
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
import { getDB, save } from './store.js';
import { removeWhiteBackground } from './bgremove.js';
import { freePort } from './free-port.js';
import * as tribute from './tribute.js';
import * as ai from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.TG_TOKEN || '';
const ADMINS = new Set((process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number));
const PORT = Number(process.env.PORT || 8080);
const PRICE = 200;
const TRIAL_DAYS = 7;
/* Тарифы подписки: 1 месяц 200 ₽, 3 месяца 500 ₽, 6 месяцев 900 ₽.
   id совпадают с app/config.js (subscription.plans) и deep-link ?start=pay_<id>. */
const PLANS = [
  { id: 'm1', label: '1 месяц', price: 200, days: 30 },
  { id: 'm3', label: '3 месяца', price: 500, days: 90 },
  { id: 'm6', label: '6 месяцев', price: 900, days: 180 },
];
const planById = (id) => PLANS.find(p => p.id === id) || PLANS[0];
const plansLine = () => PLANS.map(p => `${p.label} — ${p.price} ₽`).join(', ');
const APP_DIR = path.join(__dirname, '..', '..', 'app');

if (!TOKEN) {
  console.error('Нет TG_TOKEN. Выстави три переменные: TG_TOKEN, ADMIN_IDS, TRIBUTE_API');
  process.exit(1);
}

const bot = new Bot(TOKEN);
const db = getDB();

/* ---------- контент: рабочая копия ---------- */
function seedContent() {
  if (db.content) return db.content;
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
  // deep-link из веб-версии: ?start=pay_m1|pay_m3|pay_m6 — сразу ведём к оплате тарифа
  const payload = String(ctx.match || '').trim();
  if (payload.startsWith('pay_')) return payFlow(ctx, planById(payload.slice(4)));
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
  const code = String(Math.floor(100000 + Math.random() * 900000));
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

/* Оплата выбранного тарифа: создаёт ссылку Tribute на нужный период. */
async function payFlow(ctx, plan) {
  const u = getUser(ctx);
  if (!u.trial_start) u.trial_start = Date.now();
  save();
  if (!tribute.tributeConfigured()) {
    return ctx.reply('Оплата подключается: владелец приложения впишет ключ Tribute API на бот-хосте, и эта кнопка оживёт. Первая неделя у тебя уже идёт — практикуй спокойно.');
  }
  const link = await tribute.createSubscriptionLink(u.id, plan);
  if (!link?.url) return ctx.reply('Не смог создать ссылку Tribute. Попробуй позже или напиши владельцу приложения.');
  ctx.reply(`Подписка Дибитишки: ${plan.label} — ${plan.price} ₽.\nОплата: ${link.url}\nПосле оплаты я активирую подписку сам на ${plan.days} дн.`);
}

bot.command('pay', async (ctx) => {
  const u = getUser(ctx);
  if (!u.trial_start) u.trial_start = Date.now();
  save();
  if (!tribute.tributeConfigured()) {
    return ctx.reply('Оплата подключается: владелец приложения впишет ключ Tribute API на бот-хосте, и эта кнопка оживёт. Первая неделя у тебя уже идёт — практикуй спокойно.');
  }
  const kb = new InlineKeyboard();
  PLANS.forEach(p => kb.text(`${p.label} — ${p.price} ₽`, 'pay:' + p.id).row());
  ctx.reply(`Подписка Дибитишки: ${plansLine()}.\nВыбери срок — сделаю ссылку Tribute. После оплаты я активирую подписку сам.`, { reply_markup: kb });
});

/* кнопки тарифов в /pay */
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  if (!data.startsWith('pay:')) return;
  const plan = planById(data.slice(4));
  await ctx.answerCallbackQuery();
  if (!tribute.tributeConfigured()) {
    return ctx.editMessageText('Оплата подключается: владелец приложения впишет ключ Tribute API на бот-хосте, и кнопки оживут. Первая неделя у тебя уже идёт — практикуй спокойно.').catch(() => {});
  }
  const u = getUser(ctx);
  if (!u.trial_start) u.trial_start = Date.now();
  save();
  const link = await tribute.createSubscriptionLink(u.id, plan);
  if (!link?.url) return ctx.editMessageText('Не смог создать ссылку Tribute. Попробуй позже или напиши владельцу приложения.').catch(() => {});
  ctx.editMessageText(`Подписка Дибитишки: ${plan.label} — ${plan.price} ₽.\nОплата: ${link.url}\nПосле оплаты я активирую подписку сам на ${plan.days} дн.`).catch(() => {});
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
    '/ai — статус живого чата (OpenAI)'
  );
});

bot.command('ai', (ctx) => {
  if (!isAdmin(ctx)) return;
  const us = Object.values(db.users);
  const talked = us.filter(u => (u.chat && u.chat.length) || (u.web_chat && u.web_chat.length)).length;
  ctx.reply(
    (ai.aiConfigured()
      ? `Живой чат: включён ✅\nМодель: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}\nБаза API: ${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}`
      : 'Живой чат: выключен ⏸\nВпиши OPENAI_API_KEY на бот-хосте и перезапусти бота — включится сам.') +
    `\nПользователей, говоривших со мной: ${talked}`
  );
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
  ctx.reply('Окей, начинаем с чистого листа. Я тут 💧');
});

bot.on('message:text', async (ctx) => {
  if (db.broadcast?.awaiting && isAdmin(ctx)) return handleDraft(ctx, false);
  if (ctx.from.is_bot) return;
  const u = getUser(ctx);
  save();
  const text = ctx.message.text || '';
  if (text.startsWith('/')) return; // неизвестная команда — молчим, чтобы не спорить с grammY
  if (!ai.aiConfigured()) {
    const p = todayPractice();
    return ctx.reply(`Я тут. Живой разговор со мной включится, когда владелец впишет OPENAI_API_KEY на бот-хосте. А пока: /today — практика дня (${p.title}), /code — код для веба.`).catch(() => {});
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
    const res = await ai.complete({
      userText: text,
      history: u.chat || [],
      userContext,
      channel: 'telegram'
    });
    clearInterval(typing);
    if (!res || res.error) {
      // при ошибках API (rate_limit/timeout/сеть) отвечаем из локальной памяти,
      // а не шаблоном «попробуй позже» — человеку нужен живой ответ прямо сейчас
      const useLocal = res?.error && res.error !== 'bad_key';
      const out = useLocal ? ai.localReply(text, userContext) : ai.fallbackLine(res?.error);
      // не добавляем в историю, чтобы при следующем запросе контекст не ломался
      return ctx.reply(out).catch(() => {});
    }
    u.chat = ai.pushHistory(u.chat, 'user', text);
    u.chat = ai.pushHistory(u.chat, 'assistant', res.text);
    save();
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
    'Access-Control-Allow-Headers': 'Content-Type',
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
    content += '\nif (window.DIBI_CONFIG && !window.DIBI_CONFIG.bot_public_url) window.DIBI_CONFIG.bot_public_url = window.location.origin;\n';
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  const u = new URL(req.url, 'http://x');

  if (req.method === 'GET' && u.pathname === '/health') {
    return json(res, 200, { ok: true, app: 'dibitishka-bot', users: Object.keys(db.users).length, ai: ai.aiConfigured() });
  }
  if (req.method === 'GET' && u.pathname === '/chat/status') {
    return json(res, 200, { ok: true, ai: ai.aiConfigured() });
  }
  if (req.method === 'POST' && u.pathname === '/chat') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { user_id, text, context, history } = JSON.parse(body || '{}');
        const msg = String(text || '').trim();
        if (!msg) return json(res, 400, { ok: false, error: 'empty' });
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
        const out = await ai.complete({ userText: msg, history: hist, userContext, channel: 'web' });
        if (!out || out.error) {
          // при перегрузке/таймауте/сети отдаём локальный ответ из памяти пользователя,
          // а не «меня слишком много спрашивают» — на фроненде есть ещё свой локальный чат,
          // это запас на случай, если фронт не может сгенерировать сам (например, гость без localStorage)
          const useLocal = out?.error && out.error !== 'bad_key';
          const text = useLocal ? ai.localReply(msg, userContext) : ai.fallbackLine(out?.error);
          return json(res, 200, { ok: false, ai: true, error: out?.error || 'unknown', text, local: !!useLocal });
        }
        if (user) {
          user.web_chat = ai.pushHistory(user.web_chat, 'user', msg);
          user.web_chat = ai.pushHistory(user.web_chat, 'assistant', out.text);
          save();
        }
        return json(res, 200, { ok: true, ai: true, text: out.text });
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
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body || '{}');
        const rec = db.codes[String(code || '').trim()];
        if (!rec || rec.exp < Date.now()) return json(res, 404, { ok: false });
        delete db.codes[String(code).trim()];
        save();
        const user = db.users[rec.user_id];
        return json(res, 200, { ok: true, user: { id: rec.user_id, name: user?.name || 'друг' } });
      } catch (e) {
        return json(res, 400, { ok: false });
      }
    });
    return;
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
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        // payload может прийти и строкой — Tribute кладёт туда { user_id, plan, days }
        const pl = typeof j.payload === 'string' ? JSON.parse(j.payload || '{}') : (j.payload || {});
        const uid = Number(pl.user_id || j.user_id);
        const user = db.users[uid];
        if (user && (j.status === 'succeeded' || j.paid)) {
          const plan = PLANS.find(p => p.id === (pl.plan || j.plan));
          const days = Number(pl.days || j.days || (plan && plan.days) || 30);
          user.premium_until = Math.max(Date.now(), user.premium_until || 0) + days * 86400000;
          save();
          bot.api.sendMessage(uid, `Оплата прошла! Подписка активна на ${days} дн. (${plan ? plan.label : 'месяц'}). Спасибо, что держишь меня в форме 💧`).catch(() => {});
        }
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 400, { ok: false });
      }
    });
    return;
  }

  if (req.method === 'GET' && tryServeApp(res, u.pathname)) return;
  json(res, 404, { ok: false });
});

/* ---------- авто-очистка порта при деплое ---------- */
let httpRetries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && httpRetries < 2) {
    httpRetries++;
    console.error(`[http] порт ${PORT} заняли в долю секунды (EADDRINUSE) — чищу снова и повторяю (попытка ${httpRetries}/2)`);
    setTimeout(() => {
      takePort().catch((err) => {
        console.error('[http] ' + err.message);
        process.exit(1);
      });
    }, 500);
    return;
  }
  console.error('[http] ' + e.message + (e.code === 'EADDRINUSE' ? ` — не удалось освободить, закрой процесс вручную: fuser -k ${PORT}/tcp` : ''));
  process.exit(1);
});

async function takePort() {
  const freed = await freePort(PORT);
  if (freed.length) console.log(`[port] порт ${PORT} освобождён до старта: pid ${freed.join(', ')}`);
  server.listen(PORT, '0.0.0.0', () => { console.log(`[http] API on :${PORT}`); console.log(ai.aiStatusLine()); });
}

takePort().catch((e) => {
  console.error('[http] ' + e.message);
  process.exit(1);
});

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

/* ---------- polling ---------- */
async function startPolling(attempt = 1) {
  try {
    await bot.start({ drop_pending_updates: false });
    console.log('[bot] polling started');
  } catch (err) {
    console.error(`[bot] polling не поднялся (попытка ${attempt}):`, err?.message || err);
    console.error('[bot] HTTP API продолжает работать, polling повторю через 15 секунд');
    setTimeout(() => startPolling(attempt + 1), 15000);
  }
}

if (process.env.NO_POLLING === '1') {
  console.log('[bot] polling отключён (NO_POLLING=1) — работает только HTTP API');
} else {
  startPolling();
}
