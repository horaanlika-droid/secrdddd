import assert from 'node:assert/strict';
import { registerStickers, STICKERS } from '../bot/src/stickers.js';
const commands = {}, callbacks = [];
let created = 0, saved = 0, exists = false;
const db = { settings: {} };
const bot = {
  command: (name, fn) => commands[name] = fn,
  callbackQuery: (pattern, fn) => callbacks.push(fn),
  api: {
    getMe: async () => ({ username: 'example_bot' }),
    getStickerSet: async () => { if (!exists) throw { error_code: 400, description: 'Bad Request: STICKERSET_INVALID' }; },
    createNewStickerSet: async (id, name, title, stickers) => {
      assert.equal(id, 1); assert.equal(stickers.length, 5);
      assert.ok(stickers.every(s => s.format === 'static' && s.emoji_list.length));
      created++; exists = true;
    }
  }
};
registerStickers(bot, { db, save: () => saved++, isAdmin: ctx => ctx.from.id === 1 });
const replies = [];
const ctx = { from: { id: 2 }, chat: { type: 'private' }, reply: async (...args) => replies.push(args) };
await commands.publish_stickers(ctx); assert.equal(created, 0);
ctx.from.id = 1; ctx.chat.type = 'group';
await commands.publish_stickers(ctx); assert.equal(created, 0);
ctx.chat.type = 'private';
await commands.publish_stickers(ctx); await commands.publish_stickers(ctx);
assert.equal(created, 1); assert.equal(saved, 2);
assert.equal(db.settings.sticker_set_name, 'dibitishka_daily_v1_by_example_bot');
ctx.replyWithPhoto = async (file, opts) => assert.ok(opts.reply_markup.inline_keyboard.flat().some(b => b.url));
await commands.stickers(ctx);
let sent = 0;
ctx.answerCallbackQuery = async () => {};
ctx.replyWithSticker = async () => sent++;
for (const s of STICKERS) { ctx.match = ['', s.id]; await callbacks[0](ctx); }
assert.equal(sent, 5);
bot.api.getStickerSet = async () => { throw new Error('offline'); };
await commands.publish_stickers(ctx); assert.equal(created, 1);
console.log('Sticker tests passed: permissions, publication, retry, menu, five stickers, network failure.');
