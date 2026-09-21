import { InputFile, InlineKeyboard } from 'grammy';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ============================================================
   дибитишка · эмодзи-пак для Telegram Premium
   ------------------------------------------------------------
   Custom emoji — те же стикеры, только 100×100 px и вставляются
   прямо в текст сообщения (ставить паки и использовать в чатах
   умеют подписчики Premium; создать пак может любой).

   Картинки НЕ генерируются на лету: их собирает
   `scripts/build-emoji.py` из готовых лиц и поз маскота в
   `bot/assets/emoji/` (ровно 100×100, RGBA, ≤ 64 КБ на файл —
   см. README пака). Отсюда берём только манифест: порядок,
   подписи и базовые эмодзи-ярлыки для @Stickers / Bot API.

   Публикация идёт через Bot API: createNewStickerSet с
   sticker_type = 'custom_emoji'. Имя набора детерминированное
   (<prefix>_by_<username бота>) — повторный /publish_emoji после
   сбоя или рестарта попадает в тот же набор, а не плодит новые.
   ============================================================ */

const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL('../assets/emoji/manifest.json', import.meta.url)), 'utf8'));

export const EMOJI = manifest.emoji;
export const EMOJI_TITLE = manifest.title;
export const emojiSetName = username => `${manifest.short_name_prefix}_by_${username}`;
export const emojiSetUrl = name => `https://t.me/addemoji/${name}`;

const asset = name => new InputFile(fileURLToPath(new URL(`../assets/emoji/${name}`, import.meta.url)));

export function registerEmoji(bot, { db, save, isAdmin }) {
  let publishing = false;

  const show = async ctx => {
    const keyboard = new InlineKeyboard();
    for (const e of EMOJI) keyboard.text(`${e.emoji[0]} ${e.label}`, `emo:${e.id}`).row();
    if (db.settings.emoji_set_name) {
      keyboard.url('✨ Добавить эмодзи-пак (Premium)', emojiSetUrl(db.settings.emoji_set_name));
    }
    await ctx.replyWithPhoto(asset('preview.jpg'), {
      caption: 'Дибитишка · эмодзи для Telegram Premium 💧\n' +
        `${EMOJI.length} лиц и поз, ровно 100×100 px — как просит Telegram для эмодзи.\n` +
        'Выбери эмоцию — пришлю картинку. Вставить в текст сообщения: добавь пак ' +
        '(это умеет Premium) — ссылка появится после публикации.' +
        (isAdmin(ctx) && !db.settings.emoji_set_name ? '\nОпубликовать пак: /publish_emoji' : ''),
      reply_markup: keyboard
    });
  };
  bot.command('emoji', show);

  bot.callbackQuery(/^emo:([a-z_]+)$/, async ctx => {
    await ctx.answerCallbackQuery();
    const e = EMOJI.find(x => x.id === ctx.match[1]);
    if (!e) return;
    const markup = db.settings.emoji_set_name
      ? new InlineKeyboard().url('Добавить пак (Premium)', emojiSetUrl(db.settings.emoji_set_name))
      : undefined;
    try { await ctx.replyWithPhoto(asset(e.file), { caption: `${e.emoji[0]} ${e.label} · 100×100 px`, reply_markup: markup }); }
    catch (err) {
      console.error('[emoji] send failed:', err?.description || err?.message);
      await ctx.reply('Не получилось отправить эмодзи. Попробуй ещё раз: /emoji');
    }
  });

  bot.command('publish_emoji', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('Публиковать пак может только администратор. Эмодзи: /emoji');
    if (ctx.chat.type !== 'private') return ctx.reply('Для публикации напиши /publish_emoji мне в личные сообщения.');
    if (publishing) return ctx.reply('Пак уже публикуется, подожди немного.');
    publishing = true;
    try {
      const me = await bot.api.getMe();
      const name = emojiSetName(me.username);
      // Детерминированное имя: повторная попытка после сбоя доходит в тот же набор.
      try { await bot.api.getStickerSet(name); }
      catch (err) {
        if (err?.error_code !== 400 || !/STICKERSET_INVALID/i.test(err.description || '')) throw err;
        await bot.api.createNewStickerSet(ctx.from.id, name, EMOJI_TITLE,
          EMOJI.map(e => ({ sticker: asset(e.file), format: 'static', emoji_list: e.emoji })),
          { sticker_type: 'custom_emoji' });
      }
      db.settings.emoji_set_name = name;
      save();
      await ctx.reply('Эмодзи-пак опубликован 💧 Ставить паки и вставлять эмодзи в текст умеет Telegram Premium.', {
        reply_markup: new InlineKeyboard().url('Добавить эмодзи-пак', emojiSetUrl(name))
      });
    } catch (err) {
      console.error('[emoji] publication failed:', err?.description || err?.message);
      await ctx.reply('Не удалось опубликовать пак. Проверь соединение с Telegram и повтори /publish_emoji. Посмотреть картинки: /emoji.');
    } finally { publishing = false; }
  });

  return show;
}
