#!/usr/bin/env python3
"""Пак эмодзи Дибитишки для Telegram Premium (custom emoji).

Usage: .venv/bin/python scripts/build-emoji.py [--no-webp]

Что делает: берёт ГОТОВЫЕ лица эмоций (bot/assets/mascot/faces/*.png, 256×256)
и четыре позы маскота (bot/assets/mascot/*.png, 1024×1024), обрезает по
альфа-рамке, вписывает в квадрат 100×100 px с полем 6 px и кладёт в
bot/assets/emoji/. Ничего нового не генерируется — тот же персонаж, тот же
материал, что уже живёт в приложении и в стикерпаке.

Требования Telegram к статическому custom emoji:
  · ровно 100×100 px, квадрат;
  · .PNG или .WEBP с прозрачным слоем;
  · без ICC/EXIF (иначе «Unsupported format»);
  · запас по весу: официальный лимит 512 КБ, но часть клиентов ругается уже
    на 64 КБ — поэтому квантуем до 256 цветов и держим ≤ 64 КБ.

Кладёт рядом:
  · bot/assets/emoji/*.png         — файлы для загрузки (по одному на эмодзи);
  · bot/assets/emoji/*.webp        — те же картинки в WEBP (альтернатива);
  · bot/assets/emoji/manifest.json — порядок, подписи и базовые эмодзи;
                                     его читает bot/src/emoji.js;
  · bot/assets/emoji/preview.jpg   — лист-превью 5×4 для глаз и для /emoji.

Пересобрать: .venv/bin/python scripts/build-emoji.py
Проверить результат без Pillow: npm run emoji-test
"""
import json
import sys
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
mascot = root / 'bot/assets/mascot'
faces = mascot / 'faces'
dest = root / 'bot/assets/emoji'

SIZE = 100          # Telegram: ровно 100×100 px
FILL = 88           # контент занимает 88 px, поле 6 px — эмодзи не слипаются
MAX_BYTES = 64 * 1024  # держимся строгого порога 64 КБ

TITLE = 'Дибитишка · эмоции'
SHORT_PREFIX = 'dibitishka_faces_v1'  # полное имя: <prefix>_by_<bot username>

# id, источник, подпись, базовые эмодзи (их просит @Stickers после файла)
EMOJI = [
    ('hello',     'pose:hello.png',     'привет',          ['👋']),
    ('joy',       'face:joy.png',       'радостно',        ['😄']),
    ('fun',       'face:fun.png',       'весело',          ['😜']),
    ('warm',      'face:warm.png',      'тепло',           ['🥰']),
    ('love',      'face:love.png',      'с любовью',       ['❤️']),
    ('proud_face', 'face:proud.png',    'горжусь',         ['😌']),
    ('calm',      'face:calm.png',      'спокойно',        ['😌']),
    ('even',      'face:even.png',      'ровно',           ['🙂']),
    ('curious',   'face:curious.png',   'любопытно',       ['🤔']),
    ('surprised', 'face:surprised.png', 'удивлённо',       ['😮']),
    ('unclear',   'face:unclear.png',   'непонятно',       ['😕']),
    ('mixed',     'face:mixed.png',     'смешанно',        ['🌀']),
    ('hard',      'face:hard.png',      'тяжело',          ['😖']),
    ('sad',       'face:sad.png',       'грустно',         ['😢']),
    ('anxious',   'face:anxious.png',   'тревожно',        ['😰']),
    ('angry',     'face:angry.png',     'сердито',         ['😠']),
    ('sleepy',    'face:sleepy.png',    'сонно',           ['😴']),
    ('hug',       'pose:hug.png',       'обнимаю',         ['🫂']),
    ('proud',     'pose:proud.png',     'справился',       ['🌟']),
    ('meditate',  'pose:meditate.png',  'дышу',            ['🧘']),
]


def source(ref: str) -> Path:
    kind, name = ref.split(':', 1)
    return (faces / name) if kind == 'face' else (mascot / name)


def to_emoji(src: Path) -> Image.Image:
    """Обрезать по альфа-рамке, вписать в FILL×FILL и отцентровать на 100×100."""
    im = Image.open(src).convert('RGBA')
    bbox = im.getbbox()
    if bbox is None:
        raise SystemExit(f'{src}: пустая картинка (нет ни одного непрозрачного пикселя)')
    im = im.crop(bbox)
    im.thumbnail((FILL, FILL), Image.Resampling.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    return out


def save_png(im: Image.Image, path: Path) -> None:
    """PNG ≤ MAX_BYTES: RGBA → палитра с альфой (tRNS), количество цветов по необходимости."""
    im.save(path, optimize=True)
    colors = 256
    while path.stat().st_size > MAX_BYTES and colors >= 32:
        im.quantize(colors, method=Image.MEDIANCUT).save(path, optimize=True)
        colors //= 2
    if path.stat().st_size > MAX_BYTES:
        raise SystemExit(f'{path}: {path.stat().st_size} байт — больше {MAX_BYTES}')


def preview(items) -> None:
    """Лист 5×4: эмодзи в 4× (400 px) + подпись и id — чтобы видеть детали."""
    from PIL import ImageDraw, ImageFont

    cell, cols, rows = 240, 5, 4
    sheet = Image.new('RGB', (cols * cell + 40, rows * cell + 60), '#eeeafa')
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
    except OSError:
        font = ImageFont.load_default()
    for i, (name, im, label, emoji) in enumerate(items):
        x, y = i % cols, i // cols
        big = im.resize((160, 160), Image.Resampling.NEAREST)
        sheet.paste(big, (20 + x * cell + (cell - 160) // 2, 20 + y * cell), big)
        # Базовые эмодзи (ярлыки для @Stickers) в превью не рисуем: в сборочной
        # песочнице нет эмодзи-шрифта, глифы уедут «квадратами». Соответствие
        # живёт в manifest.json и в README пака.
        draw.text((20 + x * cell + cell // 2, 20 + y * cell + 185),
                  label, font=font, fill='#45406d', anchor='mm')
        draw.text((20 + x * cell + cell // 2, 20 + y * cell + 212),
                  name, font=font, fill='#8a86ad', anchor='mm')
    sheet.save(dest / 'preview.jpg', quality=90)


def main() -> None:
    webp = '--no-webp' not in sys.argv
    dest.mkdir(parents=True, exist_ok=True)
    items, manifest = [], []
    for name, ref, label, emoji in EMOJI:
        src = source(ref)
        if not src.exists():
            raise SystemExit(f'{src}: нет исходника для эмодзи «{name}»')
        im = to_emoji(src)
        assert im.size == (SIZE, SIZE), im.size
        png = dest / f'{name}.png'
        save_png(im, png)
        entry = {'id': name, 'label': label, 'emoji': emoji, 'file': png.name,
                 'source': str(src.relative_to(root))}
        if webp:
            im.save(dest / f'{name}.webp', lossless=True)
            entry['webp'] = f'{name}.webp'
        items.append((name, im, label, emoji))
        manifest.append(entry)

    (dest / 'manifest.json').write_text(
        json.dumps({'title': TITLE, 'short_name_prefix': SHORT_PREFIX,
                    'size': SIZE, 'max_bytes': MAX_BYTES, 'emoji': manifest},
                   ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    preview(items)

    total = sum(p.stat().st_size for p in sorted(dest.glob('*.png')))
    print(f'эмодзи: {len(items)} шт. в {dest.relative_to(root)} · '
          f'100×100 px · PNG {total / 1024:.0f} КБ вместе · '
          f'максимум {max(p.stat().st_size for p in dest.glob("*.png")) / 1024:.1f} КБ')


if __name__ == '__main__':
    main()
