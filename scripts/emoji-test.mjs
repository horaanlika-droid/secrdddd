import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Пак эмодзи Дибитишки: формат файлов и публикация через Bot API.
   Файлы собирает scripts/build-emoji.py (Pillow), а эта проверка живёт
   на чистом Node — поэтому ходит в CI без питона и без Pillow. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'bot/assets/emoji');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

/* ---------- 1. манифест и файлы на диске ---------- */
const ids = manifest.emoji.map(e => e.id);
assert.ok(ids.length >= 3, 'эмодзи в паке минимум три');
assert.equal(new Set(ids).size, ids.length, 'id эмодзи уникальны');
for (const e of manifest.emoji) {
  assert.ok(Array.isArray(e.emoji) && e.emoji.length, `${e.id}: есть базовый эмодзи-ярлык`);
  assert.ok(e.label?.trim(), `${e.id}: есть подпись`);
}

/* ---------- 2. каждый PNG — ровно 100×100, RGBA, без ICC/EXIF ---------- */
const pngInfo = (file) => {
  const b = fs.readFileSync(path.join(DIR, file));
  assert.ok(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${file}: подпись PNG`);
  assert.equal(b.subarray(12, 16).toString('latin1'), 'IHDR', `${file}: первым идёт IHDR`);
  const chunks = [];
  for (let off = 8; off < b.length; ) {
    const len = b.readUInt32BE(off);
    chunks.push(b.subarray(off + 4, off + 8).toString('latin1'));
    off += 12 + len;
  }
  return {
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
    depth: b[24],
    color: b[25],
    chunks,
    bytes: b.length
  };
};
for (const e of manifest.emoji) {
  const p = pngInfo(e.file);
  assert.equal(p.width, manifest.size, `${e.file}: ширина ровно ${manifest.size} px`);
  assert.equal(p.height, manifest.size, `${e.file}: высота ровно ${manifest.size} px`);
  assert.equal(p.depth, 8, `${e.file}: 8 бит на канал`);
  assert.equal(p.color, 6, `${e.file}: цветовой тип 6 (RGBA, прозрачный слой)`);
  assert.ok(!p.chunks.includes('iCCP'), `${e.file}: без ICC-профиля (Telegram шлёт «Unsupported format»)`);
  assert.ok(!p.chunks.includes('eXIf'), `${e.file}: без EXIF`);
  assert.ok(p.bytes <= manifest.max_bytes, `${e.file}: ${p.bytes} байт ≤ ${manifest.max_bytes}`);
}
/* на диске нет PNG вне манифеста — иначе пак и меню разъедутся */
const onDisk = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
assert.deepEqual(onDisk, manifest.emoji.map(e => e.file).sort(), 'PNG на диске = PNG в манифесте');
assert.ok(fs.existsSync(path.join(DIR, 'preview.jpg')), 'preview.jpg для меню /emoji на месте');

/* ---------- 3. модуль бота читает тот же манифест ---------- */
const { EMOJI, EMOJI_TITLE, emojiSetName, emojiSetUrl } = await import('../bot/src/emoji.js');
assert.deepEqual(EMOJI.map(e => e.id), ids, 'bot/src/emoji.js отдаёт эмодзи в порядке манифеста');
const name = emojiSetName('example_bot');
assert.match(name, /^[a-z0-9_]+_by_[a-z0-9_]+$/, 'короткое имя набора — lowercase с подчёркиваниями');
assert.ok(name.endsWith('_by_example_bot') && name.startsWith(manifest.short_name_prefix));
assert.equal(emojiSetUrl(name), `https://t.me/addemoji/${name}`, 'ссылка на пак — t.me/addemoji/…');
assert.ok(EMOJI_TITLE.length <= 64, 'заголовок набора ≤ 64 символов');

/* ---------- 4. публикация: права, формат набора, повтор, отказ сети ---------- */
const commands = {}, callbacks = [];
let created = 0, saved = 0, exists = false, lastArgs = null;
const db = { settings: {} };
const bot = {
  command: (n, fn) => commands[n] = fn,
  callbackQuery: (pattern, fn) => callbacks.push(fn),
  api: {
    getMe: async () => ({ username: 'example_bot' }),
    getStickerSet: async () => { if (!exists) throw { error_code: 400, description: 'Bad Request: STICKERSET_INVALID' }; },
    createNewStickerSet: async (id, setName, title, stickers, other) => {
      assert.equal(id, 1);
      assert.equal(setName, name);
      assert.equal(stickers.length, EMOJI.length);
      assert.ok(stickers.every(s => s.format === 'static' && s.emoji_list.length));
      assert.equal(other?.sticker_type, 'custom_emoji', 'набор создаётся как custom emoji, а не как стикеры');
      lastArgs = { title, other };
      created++; exists = true;
    }
  }
};
const { registerEmoji } = await import('../bot/src/emoji.js');
registerEmoji(bot, { db, save: () => saved++, isAdmin: ctx => ctx.from.id === 1 });

const replies = [];
const ctx = { from: { id: 2 }, chat: { type: 'private' }, reply: async (...a) => replies.push(a) };
await commands.publish_emoji(ctx);
assert.equal(created, 0, 'не админ публиковать не может');
ctx.from.id = 1; ctx.chat.type = 'group';
await commands.publish_emoji(ctx);
assert.equal(created, 0, 'из группы публикация не стартует');
ctx.chat.type = 'private';
await commands.publish_emoji(ctx);
await commands.publish_emoji(ctx); // повтор после успеха не плодит набор
assert.equal(created, 1);
assert.equal(saved, 2, 'имя опубликованного набора сохраняется в базе');
assert.equal(db.settings.emoji_set_name, name);
assert.ok(lastArgs.title === EMOJI_TITLE);

/* меню /emoji и отправка картинки по нажатию */
const photos = [];
ctx.replyWithPhoto = async (file, opts) => { photos.push(opts); return true; };
await commands.emoji(ctx);
assert.ok(photos[0].reply_markup.inline_keyboard.flat().length >= EMOJI.length, 'в меню кнопка на каждый эмодзи');
assert.ok(photos[0].reply_markup.inline_keyboard.flat().some(b => b.url?.includes('/addemoji/')), 'после публикации в меню ссылка на пак');
let sent = 0;
ctx.answerCallbackQuery = async () => {};
ctx.replyWithPhoto = async () => sent++;
for (const e of EMOJI) { ctx.match = ['emo:' + e.id, e.id]; await callbacks[0](ctx); }
assert.equal(sent, EMOJI.length, 'каждый эмодзи отправляется картинкой');

/* сеть отказала — пользователю понятно, а не тихий провал */
bot.api.getStickerSet = async () => { throw new Error('offline'); };
await commands.publish_emoji(ctx);
assert.equal(created, 1);
assert.ok(replies.at(-1)[0].includes('Не удалось опубликовать'), 'при отказе сети — честное сообщение с подсказкой');

/* ---------- 5. бот действительно подключил пак ---------- */
const app = fs.readFileSync(path.join(ROOT, 'bot/src/app.js'), 'utf8');
for (const needle of ["registerEmoji", "payload === 'emoji'", "'show_emoji'", '/emoji —', '/publish_emoji']) {
  assert.ok(app.includes(needle), `app.js подключает эмодзи: ${needle}`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.ok(pkg.scripts['emoji-test'], 'npm run emoji-test описан в package.json');
assert.ok(pkg.scripts.verify.includes('emoji-test'), 'emoji-test входит в npm run verify');
const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
assert.ok(ci.includes('emoji-test'), 'проверка эмодзи идёт в CI');

console.log(`Emoji tests passed: ${EMOJI.length} файлов 100×100 RGBA ≤ ${manifest.max_bytes / 1024} КБ, manifest ↔ диск ↔ бот, публикация custom_emoji, права, повтор, отказ сети.`);
