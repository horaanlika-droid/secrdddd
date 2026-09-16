#!/usr/bin/env python3
"""Build Telegram WebP files from the generated 3×2 green-screen sheet.
Usage: .venv/bin/python scripts/build-stickers.py path/to/sheet.png
Requires Pillow and numpy. The source sheet is kept outside Git in _source/.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

root = Path(__file__).resolve().parent.parent
dest = root / 'bot/assets/stickers'
dest.mkdir(parents=True, exist_ok=True)
im = Image.open(sys.argv[1]).convert('RGBA')
w, h = im.size
names = ['sleepy', 'running', 'spa', 'flowers', 'kitten']
labels = ['Ещё пять минуточек', 'На пробежке', 'Время для себя', 'Выращиваю радость', 'Обнимаю котёнка']
preview = Image.new('RGB', (1500, 1050), '#eeeafa')
draw = ImageDraw.Draw(preview)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 25)
for i, name in enumerate(names):
    x, y = i % 3, i // 3
    tile = im.crop((round(x*w/3)+5, round(y*h/2)+5, round((x+1)*w/3)-5, round((y+1)*h/2)-5))
    a = np.array(tile)
    rgb = a[:, :, :3].astype(float)
    excess = rgb[:, :, 1] - np.maximum(rgb[:, :, 0], rgb[:, :, 2])
    alpha = np.clip((100-excess)/65, 0, 1)
    a[:, :, 3] = (alpha*255).astype('uint8')
    edge = (alpha > 0) & (alpha < 1)
    a[:, :, 1][edge] = np.minimum(a[:, :, 1][edge], np.maximum(a[:, :, 0][edge], a[:, :, 2][edge]))
    tile = Image.fromarray(a)
    tile = tile.crop(tile.getbbox())
    tile.thumbnail((480, 480), Image.Resampling.LANCZOS)
    out = Image.new('RGBA', (512, 512))
    out.alpha_composite(tile, ((512-tile.width)//2, (512-tile.height)//2))
    target = dest / f'{name}.webp'
    out.save(target, lossless=True)
    assert target.stat().st_size <= 512*1024
    out.thumbnail((420, 420))
    preview.paste(out, (x*500+40, y*510+15), out)
    draw.text((x*500+250, y*510+460), labels[i], font=font, fill='#45406d', anchor='mm')
preview.save(dest / 'preview.jpg', quality=90)
