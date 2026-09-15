#!/usr/bin/env python3
"""Лица эмоций Дибитишки (v25).

Вход:  scripts/art-src/faces-src/face-<ключ>.png — генерации «портрет маскота»,
       сделанные из app/assets/mascot/hello.png (тот же персонаж и рендер).
Выход: app/assets/mascot/faces/<ключ>.png (320×320, прозрачный фон) и зеркало
       в bot/assets/mascot/faces/.

Почему не «-transparent white»: лицо у маскота снежно-белое, глобальный knockout
пробил бы в нём дырки. Поэтому фон убирается заливкой с краёв (flood fill), как
в scripts/postprocess-mascot.py.
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "art-src" / "faces-src"
OUT = ROOT / "app" / "assets" / "mascot" / "faces"
BOT = ROOT / "bot" / "assets" / "mascot" / "faces"
SIZE = 320
PAD = 0.06

# ключи совпадают с MOOD_FACES в app/js/app.js
KEYS = ("hard", "sad", "anxious", "even", "warm", "fun", "joy", "mixed", "unclear")


def is_bg(r: int, g: int, b: int) -> bool:
    """Светлый нейтральный фон генерации (белый/сероватый)."""
    mx, mn = max(r, g, b), min(r, g, b)
    return mn >= 186 and mx - mn <= 34 and mx >= 186


def cut_white(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((0, x)); q.append((h - 1, x))
    for y in range(h):
        q.append((y, 0)); q.append((y, w - 1))
    while q:
        y, x = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, a = px[x, y]
        if a < 10 or is_bg(r, g, b):
            px[x, y] = (0, 0, 0, 0)
            q.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))
    return img


def square(img: Image.Image, size: int = SIZE, pad: float = PAD) -> Image.Image:
    box = img.getbbox()
    if box:
        img = img.crop(box)
    w, h = img.size
    side = int(max(w, h) * (1 + pad * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    BOT.mkdir(parents=True, exist_ok=True)
    for key in KEYS:
        src = SRC / f"face-{key}.png"
        if not src.exists():
            raise SystemExit(f"нет исходника: {src.relative_to(ROOT)}")
        out = square(cut_white(Image.open(src)))
        out.save(OUT / f"{key}.png", optimize=True)
        out.save(BOT / f"{key}.png", optimize=True)
        print(f"faces/{key}.png")


if __name__ == "__main__":
    main()
