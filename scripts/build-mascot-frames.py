#!/usr/bin/env python3
"""Кадры живой анимации маскота (v25).

Вход:  scripts/art-src/mascot-src/hero-blink.png  — та же поза, глаза закрыты
       scripts/art-src/mascot-src/hero-smile.png  — та же поза, улыбка
Выход: app/assets/mascot/hero-blink.png, app/assets/mascot/hero-smile.png

Зачем скрипт: кадры должны совпадать с app/assets/mascot/hello.png попиксельно,
иначе при переключении слоёв персонаж «дёргается». Генерация даёт чуть другой
масштаб/кадрирование, поэтому мы:
  1) берём bbox непрозрачной части hello.png;
  2) вырезаем тот же прямоугольник из кадра генерации;
  3) убираем светлый фон заливкой с краёв (лицо белое — глобальный knockout нельзя);
  4) кладём результат на 1024×1024 ровно на то место, где стоит hello.png.
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "art-src" / "mascot-src"
MASCOT = ROOT / "app" / "assets" / "mascot"
BOT = ROOT / "bot" / "assets" / "mascot"
FRAMES = {"hero-blink": "hero-blink.png", "hero-smile": "hero-smile.png"}


def is_bg(r: int, g: int, b: int) -> bool:
    mx, mn = max(r, g, b), min(r, g, b)
    return mn >= 186 and mx - mn <= 34 and mx >= 186


def cut_white(img: Image.Image) -> Image.Image:
    """Убирает светлый фон заливкой от краёв, не трогая белое лицо внутри контура."""
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


def main() -> None:
    ref = Image.open(MASCOT / "hello.png").convert("RGBA")
    box = ref.getbbox()
    if not box:
        raise SystemExit("hello.png пустой — нечего выравнивать")
    ref_w, ref_h = box[2] - box[0], box[3] - box[1]
    ref_cx, ref_cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    canvas_size = ref.size
    for key, fname in FRAMES.items():
        src = SRC / fname
        if not src.exists():
            raise SystemExit(f"нет исходника: {src.relative_to(ROOT)}")
        # 1) фон — заливкой с краёв (лицо белое: глобальный knockout нельзя)
        frame = cut_white(Image.open(src).convert("RGBA"))
        fbox = frame.getbbox()
        if not fbox:
            raise SystemExit(f"{fname}: после удаления фона ничего не осталось")
        crop = frame.crop(fbox)
        # 2) генерация даёт свой масштаб — подгоняем силуэт к опорной позе
        scale = ((ref_w / crop.width) + (ref_h / crop.height)) / 2
        crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.LANCZOS)
        # 3) ставим так, чтобы центры силуэтов совпали с hello.png
        out = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
        out.paste(crop, (round(ref_cx - crop.width / 2), round(ref_cy - crop.height / 2)), crop)
        out.save(MASCOT / fname, optimize=True)
        out.save(BOT / fname, optimize=True)
        print(f"mascot/{fname}  scale={scale:.3f}")


if __name__ == "__main__":
    main()
