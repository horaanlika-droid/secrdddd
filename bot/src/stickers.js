import { InputFile, InlineKeyboard } from 'grammy';
import { fileURLToPath } from 'node:url';

export const STICKERS = [
  { id: 'sleepy', label: 'Ещё пять минуточек', emoji: '😴' },
  { id: 'running', label: 'На пробежке', emoji: '🏃' },
  { id: 'spa', label: 'Время для себя', emoji: '🧖' },
  { id: 'flowers', label: 'Выращиваю радость', emoji: '🌸' },
  { id: 'kitten', label: 'Обнимаю котёнка', emoji: '🐱' }
];
const asset = name => new InputFile(fileURLToPath(new URL(`../assets/stickers/${name}`, import.meta.url)));
export const stickerSetName = username => `dibitishka_daily_v1_by_${username}`;

export function registerStickers(bot, { db, save, isAdmin }) {
  let publishing = false;
  const show = async ctx => {
    const keyboard = new InlineKeyboard();
    for (const s of STICKERS) keyboard.text(`${s.emoji} ${s.label}`, `sticker:${s.id}`).row();
    if (db.settings.sticker_set_name) {
      keyboard.url('✨ Добавить весь стикерпак', `https://t.me/addstickers/${db.settings.sticker_set_name}`);
    }
    await ctx.replyWithPhoto(asset('preview.jpg'), {
      caption: 'Дибитишка · маленькие радости 💜\nВыбери стикер — отправлю его в чат.' +
        (isAdmin(ctx) && !db.settings.sticker_set_name ? '\nОпубликовать набор: /publish_stickers' : ''),
      reply_markup: keyboard
    });
  };
  bot.command('stickers', show);
  bot.callbackQuery(/^sticker:(sleepy|running|spa|flowers|kitten)$/, async ctx => {
    await ctx.answerCallbackQuery();
    try { await ctx.replyWithSticker(asset(`${ctx.match[1]}.webp`)); }
    catch (err) {
      console.error('[stickers] send failed:', err?.description || err?.message);
      await ctx.reply('Не получилось отправить стикер. Попробуй ещё раз: /stickers');
    }
  });
  bot.command('publish_stickers', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('Публиковать набор может только администратор. Стикеры: /stickers');
    if (ctx.chat.type !== 'private') return ctx.reply('Для публикации напиши /publish_stickers мне в личные сообщения.');
    if (publishing) return ctx.reply('Набор уже публикуется, подожди немного.');
    publishing = true;
    try {
      const me = await bot.api.getMe();
      const name = stickerSetName(me.username);
      // Deterministic name lets a retry recover after a restart or failed DB save.
      try { await bot.api.getStickerSet(name); }
      catch (err) {
        if (err?.error_code !== 400 || !/STICKERSET_INVALID/i.test(err.description || '')) throw err;
        await bot.api.createNewStickerSet(ctx.from.id, name, 'Дибитишка · маленькие радости',
          STICKERS.map(s => ({ sticker: asset(`${s.id}.webp`), format: 'static', emoji_list: [s.emoji] })));
      }
      db.settings.sticker_set_name = name;
      save();
      await ctx.reply('Стикерпак опубликован 💜', {
        reply_markup: new InlineKeyboard().url('Добавить стикерпак', `https://t.me/addstickers/${name}`)
      });
    } catch (err) {
      console.error('[stickers] publication failed:', err?.description || err?.message);
      await ctx.reply('Не удалось опубликовать набор. Проверь соединение с Telegram и повтори /publish_stickers. Отдельные стикеры доступны через /stickers.');
    } finally { publishing = false; }
  });
  return show;
}
