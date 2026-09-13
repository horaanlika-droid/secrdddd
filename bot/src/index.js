/* ============================================================
   дибитишка · телеграм-бот
   Три переменные на бот-хосте:
     TG_TOKEN   — токен бота
     ADMIN_IDS  — id админов через запятую
     TRIBUTE_API— ключ Tribute API (можно вписать после запуска)
   Необязательно: PORT (по умолчанию 8080) — HTTP API для веб-версии
   ============================================================ */
import { Bot, InputFile, InlineKeyboard } from 'grammy';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDB, save, resetDB } from './store.js';
import { removeWhiteBackground } from './bgremove.js';
import * as tribute from './tribute.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.TG_TOKEN || '';
const ADMINS = new Set((process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number));
const PORT = Number(process.env.PORT || 8080);
const PRICE = 200, TRIAL_DAYS = 7;

if (!TOKEN) { console.error('Нет TG_TOKEN. Выстави три переменные: TG_TOKEN, ADMIN_IDS, TRIBUTE_API'); process.exit(1); }
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
    try { db.content = JSON.parse(fs.readFileSync(c, 'utf8')); save(); return db.content; } catch (e) {}
  }
  db.content = { version: 1, meta: { mascot_lines: { done: ['готово!'] } }, blocks: [], merch: [], minis: [], workbook: { title: 'тетрадь', crisis_fields: [], sensory_senses: [] } };
  save();
  return db.content;
}
const C = () => seedContent();
const MASCOT = (n) => {
  const p = path.join(__dirname, '..', 'assets', 'mascot', n + '.png');
  return fs.existsSync(p) ? new InputFile(p) : null;
};

/* ---------- утилиты ---------- */
const isAdmin = (ctx) => ADMINS.has(ctx.from?.id);
const allPractices = () => C().blocks.flatMap(b => b.practices.map(p => ({ ...p, block: b })));
const daySeed = () => Math.floor(Date.now() / 86400000);
const todayPractice = () => { const a = allPractices(); return a[daySeed() % a.length]; };
const isPremium = (u) => u && ((u.premium_until || 0) > Date.now() || (u.trial_start && Date.now() - u.trial_start < TRIAL_DAYS * 86400000));
const getUser = (ctx) => {
  const id = ctx.from.id;
  if (!db.users[id]) db.users[id] = { id, name: ctx.from.first_name || 'друг', username: ctx.from.username || '', joined: Date.now(), trial_start: null, premium_until: 0, reminder: { on: false, time: '09:00', tz: 3 } };
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
  const img = MASCOT('hello');
  const text = `привет, ${u.name}! я дибитишка — слезинка, которая помогает дружить с чувствами.\n\nво мне: пять блоков практик осознанности и ДПТ, практика дня, альтернативы, когда не можется, и печатная тетрадь.\n\nпервая неделя бесплатно, потом ${PRICE} ₽ в месяц. оплата — кнопкой /pay.\n\nвеб-версия: открой мини-приложение или зайди по коду — команда /code.`;
  if (img) await ctx.replyWithPhoto(img, { caption: text });
  else await ctx.reply(text);
});
bot.command('help', (ctx) => ctx.reply(
  'я дибитишка. команды:\n' +
  '/today — практика дня с комментарием\n' +
  '/code — одноразовый код для входа в веб-версию\n' +
  '/reminder 09:00 — ежедневный пуш (off — выключить)\n' +
  '/pay — оформить подписку (Tribute)\n' +
  '/status — моя подписка и прогресс\n' +
  (isAdmin(ctx) ? '\nадмин: /admin' : '')));
bot.command('today', async (ctx) => {
  getUser(ctx); save();
  const p = todayPractice();
  const img = MASCOT('calm');
  const text = `практика дня · блок «${p.block.title}»\n\n${p.title} · ≈ ${p.minutes} мин\n\n${p.why}\n\nшаги:\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nне можется? альтернатива: ${p.alt.title} — ${p.alt.steps.join(' · ')}`;
  if (img) await ctx.replyWithPhoto(img, { caption: text }); else await ctx.reply(text);
});
bot.command('code', (ctx) => {
  const u = getUser(ctx); save();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.codes[code] = { user_id: u.id, exp: Date.now() + 10 * 60000 };
  save();
  ctx.reply(`твой код для веб-версии: ${code}\nдействует 10 минут. введи его на сайте — и веб привяжется к этому аккаунту.`);
});
bot.command('reminder', (ctx) => {
  const u = getUser(ctx);
  const arg = ctx.match?.trim();
  if (!arg || arg === 'off') { u.reminder.on = false; save(); return ctx.reply('напоминания выключены. я буду скучать молча.'); }
  const m = arg.match(/^(\d{1,2}):(\d{2})(?:\s*([+-]\d{1,2}))?$/);
  if (!m) return ctx.reply('формат: /reminder 9:00 или /reminder 21:30 +3 (часовой пояс). off — выключить.');
  u.reminder = { on: true, time: `${m[1].padStart(2, '0')}:${m[2]}`, tz: m[3] ? Number(m[3]) : (u.reminder.tz ?? 3) };
  save();
  ctx.reply(`буду писать каждый день в ${u.reminder.time} (часовой пояс ${u.reminder.tz >= 0 ? '+' : ''}${u.reminder.tz}). вместе с практикой дня.`);
});
bot.command('status', (ctx) => {
  const u = getUser(ctx); save();
  const left = isPremium(u) ? (u.premium_until > Date.now() ? `подписка до ${new Date(u.premium_until).toLocaleDateString('ru-RU')}` : `бесплатная неделя ещё ${Math.max(0, Math.ceil((TRIAL_DAYS * 86400000 - (Date.now() - u.trial_start)) / 86400000))} дн.`) : 'подписки нет';
  ctx.reply(`профиль: ${u.name}\nподписка: ${left}\nнапоминания: ${u.reminder.on ? u.reminder.time : 'выкл'}`);
});
bot.command('pay', async (ctx) => {
  const u = getUser(ctx);
  if (!u.trial_start) u.trial_start = Date.now();
  save();
  if (!tribute.tributeConfigured()) {
    return ctx.reply('оплата подключается: владелец приложения впишет ключ Tribute API на бот-хосте, и эта кнопка оживёт. первая неделя у тебя уже идёт — практикуй спокойно.');
  }
  const link = await tribute.createSubscriptionLink(u.id, PRICE);
  if (!link?.url) return ctx.reply('не смог создать ссылку Tribute. попробуй позже или напиши владельцу приложения.');
  ctx.reply(`подписка дибитишки: ${PRICE} ₽ в месяц.\nоплата: ${link.url}\nпосле оплаты я активирую подписку сам.`);
});

/* ---------- админ ---------- */
bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply(
    'админ-панель дибитишки\n\n' +
    '/broadcast — начать рассылку (следующее сообщение = черновик, с текстом и/или фото)\n' +
    '/content — посмотреть структуру блоков\n' +
    '/content set <путь> <значение> — изменить любое поле (например: blocks.0.title Опора)\n' +
    '/content get <путь> — посмотреть поле\n' +
    '/export — прислать content.json файлом\n' +
    '/import — ответить этим сообщением на файл content.json\n' +
    '/users — статистика\n' +
    '/grant <id> [дней] — выдать подписку вручную');
});
bot.command('users', (ctx) => {
  if (!isAdmin(ctx)) return;
  const us = Object.values(db.users);
  ctx.reply(`всего: ${us.length}\nс подпиской: ${us.filter(isPremium).length}\nс напоминаниями: ${us.filter(u => u.reminder?.on).length}\nрассылок отправлено: ${db.stats.sent}`);
});
bot.command('grant', (ctx) => {
  if (!isAdmin(ctx)) return;
  const [id, days] = String(ctx.match || '').trim().split(/\s+/);
  const u = db.users[Number(id)];
  if (!u) return ctx.reply('такого пользователя нет в базе');
  const d = Number(days) || 30;
  u.premium_until = Math.max(Date.now(), u.premium_until || 0) + d * 86400000;
  save();
  ctx.reply(`выдано ${d} дн. пользователю ${u.name}`);
});
bot.command('content', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const arg = String(ctx.match || '').trim();
  if (!arg) {
    const lines = C().blocks.map((b, i) => `${i}. ${b.title} (${b.id}) · ${b.practices.length} практ.`);
    return ctx.reply('блоки:\n' + lines.join('\n') + '\n\nизменить: /content set blocks.0.title Новое имя\nпосмотреть: /content get blocks.0.intro');
  }
  const m = arg.match(/^(set|get)\s+(\S+)\s*([\s\S]*)$/);
  if (!m) return ctx.reply('формат: /content set <путь> <значение> или /content get <путь>');
  const [, cmd, p, val] = m;
  if (cmd === 'get') {
    const v = getPath(C(), p);
    return ctx.reply(v === undefined ? 'нет такого пути' : (typeof v === 'string' ? v : JSON.stringify(v).slice(0, 3500)));
  }
  if (!val) return ctx.reply('что установить?');
  const ok = setPath(C(), p, val.trim());
  C().version = (C().version || 1) + 1;
  C().updated = new Date().toISOString().slice(0, 10);
  save();
  ctx.reply(ok ? `готово, обновил(а) ${p}. веб-приложение подтянет само.` : 'не нашёл(ла) такой путь');
});
bot.command('export', (ctx) => {
  if (!isAdmin(ctx)) return;
  const tmp = path.join(__dirname, '..', 'content.export.json');
  fs.writeFileSync(tmp, JSON.stringify(C(), null, 2));
  ctx.replyWithDocument(new InputFile(tmp, 'content.json'), { caption: 'рабочая копия контента. положи её в app/content/content.json репозитория, если бот без порта.' });
});
bot.on(':document', async (ctx) => {
  if (!isAdmin(ctx) || !ctx.message.document?.file_name?.endsWith('.json')) return;
  try {
    const f = await ctx.getFile();
    const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
    const j = await r.json();
    if (j && j.blocks) { db.content = j; save(); ctx.reply('контент загружен из файла. версия: ' + j.version); }
    else ctx.reply('в файле нет blocks — не похоже на контент');
  } catch (e) { ctx.reply('не вышло импортировать: ' + e.message); }
});

/* ---------- рассылки ---------- */
bot.command('broadcast', (ctx) => {
  if (!isAdmin(ctx)) return;
  db.broadcast = { admin: ctx.from.id, awaiting: true };
  save();
  ctx.reply('пришли следующее сообщение: текст, картинку или и то и другое. я покажу превью и спрошу подтверждение. у картинок с белым фоном предложу вырезать фон — будет эффект объёма.');
});
bot.on(':photo', async (ctx) => await handleDraft(ctx, true));
bot.on('message:text', async (ctx) => {
  if (db.broadcast?.awaiting && isAdmin(ctx)) return handleDraft(ctx, false);
  // мягко отвечаем пользователям на любой текст
  if (!ctx.from.is_bot) {
    const u = getUser(ctx); save();
    const p = todayPractice();
    ctx.reply(`я тут. если хочется практики — /today (${p.title}). если нужен код для веба — /code.`).catch(() => {});
  }
});
async function handleDraft(ctx, hasPhoto) {
  if (!db.broadcast?.awaiting || !isAdmin(ctx)) return;
  db.broadcast = {
    admin: ctx.from.id, awaiting: false,
    text: ctx.message.caption || ctx.message.text || '',
    photo: hasPhoto ? ctx.message.photo.at(-1).file_id : null
  };
  save();
  const kb = new InlineKeyboard()
    .text('отправить как есть', 'bc_send');
  if (hasPhoto) kb.text('вырезать белый фон и отправить', 'bc_cut');
  kb.text('отмена', 'bc_cancel');
  const n = Object.keys(db.users).length;
  if (hasPhoto) await ctx.replyWithPhoto(db.broadcast.photo, { caption: `превью рассылки на ${n} чел:\n\n${db.broadcast.text || '(без текста)'}`, reply_markup: kb });
  else await ctx.reply(`превью рассылки на ${n} чел:\n\n${db.broadcast.text}`, { reply_markup: kb });
}
bot.callbackQuery('bc_send', (ctx) => sendBroadcast(ctx, false));
bot.callbackQuery('bc_cut', (ctx) => sendBroadcast(ctx, true));
bot.callbackQuery('bc_cancel', async (ctx) => {
  db.broadcast = null; save();
  await ctx.answerCallbackQuery('отменено');
  await ctx.editMessageCaption('рассылка отменена').catch(() => ctx.reply('рассылка отменена'));
});
async function sendBroadcast(ctx, cutBg) {
  if (!isAdmin(ctx)) return;
  const d = db.broadcast;
  if (!d || d.awaiting) return ctx.answerCallbackQuery('нет черновика');
  await ctx.answerCallbackQuery('отправляю…');
  let photoBuf = null;
  if (d.photo) {
    try {
      const f = await ctx.api.getFile(d.photo);
      const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
      const ab = await r.arrayBuffer();
      photoBuf = Buffer.from(ab);
      const isPng = /\.png$/i.test(f.file_path || '');
      if (cutBg) photoBuf = removeWhiteBackground(photoBuf, isPng);
    } catch (e) { console.error('[broadcast] photo error', e.message); }
  }
  let ok = 0, fail = 0;
  for (const u of Object.values(db.users)) {
    try {
      if (photoBuf) await ctx.api.sendPhoto(u.id, new InputFile(photoBuf, 'dibitishka.png'), { caption: d.text || undefined });
      else await ctx.api.sendMessage(u.id, d.text);
      ok++;
    } catch (e) { fail++; }
    await new Promise(r => setTimeout(r, 40)); // уважение к лимитам
  }
  db.stats.sent++;
  db.broadcast = null;
  save();
  ctx.reply(`разослано: ${ok}, не дошло: ${fail}${cutBg ? '. фон вырезан — картинка парит над чатом' : ''}`);
}

/* ---------- HTTP API для веб-версии (CORS) ---------- */
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(obj));
};
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/health') return json(res, 200, { ok: true, app: 'dibitishka-bot', users: Object.keys(db.users).length });
  if (req.method === 'GET' && u.pathname === '/content.json') return json(res, 200, C());
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
        const u2 = db.users[rec.user_id];
        return json(res, 200, { ok: true, user: { id: rec.user_id, name: u2?.name || 'друг' } });
      } catch (e) { return json(res, 400, { ok: false }); }
    });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/me/reminder') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { user_id, on, time } = JSON.parse(body || '{}');
        const u2 = db.users[Number(user_id)];
        if (!u2) return json(res, 404, { ok: false });
        u2.reminder = { on: !!on, time: time || u2.reminder.time || '09:00', tz: u2.reminder?.tz ?? 3 };
        save();
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { ok: false }); }
    });
    return;
  }
  /* Tribute webhook: активирует подписку после оплаты */
  if (req.method === 'POST' && u.pathname === '/tribute/webhook') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const uid = Number(j.payload?.user_id || j.user_id);
        const u2 = db.users[uid];
        if (u2 && (j.status === 'succeeded' || j.paid)) {
          u2.premium_until = Math.max(Date.now(), u2.premium_until || 0) + 30 * 86400000;
          save();
          bot.api.sendMessage(uid, 'оплата прошла! подписка активна на месяц. спасибо, что держишь меня в форме 💧').catch(() => {});
        }
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { ok: false }); }
    });
    return;
  }
  json(res, 404, { ok: false });
}).listen(PORT, '0.0.0.0', () => console.log(`[http] API on :${PORT}`));

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
    const text = `времени для практики: ${p.title} · ≈ ${p.minutes} мин\n\n${p.why}\n\nне можется — альтернатива: ${p.alt.title}. открыть приложение: /today`;
    if (img) bot.api.sendPhoto(u.id, img, { caption: text }).catch(() => {});
    else bot.api.sendMessage(u.id, text).catch(() => {});
  }
}, 30000);

bot.start({ drop_pending_updates: false }).then(() => console.log('[bot] polling started'));
