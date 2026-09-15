#!/usr/bin/env python3
"""v27: лицо Дибитишки на главной = текущее настроение.

Вход — только уже готовые файлы, новой генерации нет:
  app/assets/mascot/hello.png            единственная поза (тело и голова);
  app/assets/mascot/faces/{key}.png      девять голов, нарезанных
                                         scripts/build-mood-faces.py.

Что делаем: берём лицо выбранной эмоции, приводим его к размеру белого лица
hello.png и переносим внутрь контура лица с размытой маской по краю — шов у
капюшона не читается. Тело, руки, капюшон, альфа-канал и положение персонажа
остаются ровно такими же, как в hello.png: персонаж не дёргается и не плавает.

Выход:
  app/assets/mascot/hero-moods.webp  сетка 4×3 из ОДНИХ ЛИЦ (без тела),
                                     ячейка в натуральную величину 416×314;
  app/assets/mascot/hero-moods.json  индексы, ячейка и геометрия лица;
  app/css/hero-moods.css             где именно лежит лицо внутри позы.

В ячейке лежит только лицо с прозрачным краем, а не вся фигура: тело, руки и
капюшон всегда берутся из hello.png. Ячейка 0 пустая — это спокойное лицо из
hello.png: без отметок персонаж целый, даже если сетка ещё не загрузилась или
`prefers-reduced-motion` отключил слой с лицом. Ячейки 1..9 — девять состояний
дневника в порядке MOOD_FACES (hard, sad, anxious, even, warm, fun, joy, mixed,
unclear), то есть эмоция i занимает ячейку i+1. Ячейки 10 и 11 пустые.

Зависимости: Pillow, numpy (pip install pillow numpy).
"""

from collections import deque
from pathlib import Path
import json

from PIL import Image, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MASCOT = ROOT / "app" / "assets" / "mascot"
FACES = MASCOT / "faces"
CSS = ROOT / "app" / "css" / "hero-moods.css"

KEYS = ("hard", "sad", "anxious", "even", "warm", "fun", "joy", "mixed", "unclear")
NEUTRAL = 0                  # ячейка 0 пустая: спокойное лицо из hello.png
COLS, ROWS = 4, 3

MARGIN = 0.06                # запас вокруг лица: в нём маска сходит на нет
BLUR = 4.0
SHRINK = 0.25


def whiteish(a, low, spread):
    """Пиксели белого лица: светлые и почти без цветного оттенка."""
    r, g, b, alpha = (a[..., i].astype(np.int16) for i in range(4))
    lo = np.minimum(np.minimum(r, g), b)
    hi = np.maximum(np.maximum(r, g), b)
    return (alpha > 200) & (lo > low) & ((hi - lo) < spread)


def largest_component(mask):
    """Самый крупный связный объект: сама голова, а не ресницы, слёзы и т.п."""
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = None
    for sy in range(height):
        for sx in range(width):
            if seen[sy, sx] or not mask[sy, sx]:
                continue
            queue = deque([(sy, sx)])
            seen[sy, sx] = True
            cells = []
            while queue:
                y, x = queue.popleft()
                cells.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            if best is None or len(cells) > len(best):
                best = cells
    out = np.zeros_like(mask, dtype=bool)
    for y, x in best:
        out[y, x] = True
    return out


def grow(seed, allowed):
    """Достраиваем лицо до мягкой тени у подбородка и румянца."""
    out = seed.copy()
    height, width = seed.shape
    queue = deque(zip(*np.where(seed)))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < height and 0 <= nx < width and allowed[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                queue.append((ny, nx))
    return out


def face_mask(img):
    a = np.array(img)
    return grow(largest_component(whiteish(a, 200, 26)), whiteish(a, 178, 55))


def bbox(mask):
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def soft_alpha(mask, size):
    """Маска лица в размере вставки: резкий край поджимаем, потом размываем."""
    scaled = Image.fromarray((mask * 255).astype(np.uint8)).resize(size, Image.Resampling.LANCZOS)
    x = np.asarray(scaled).astype(np.float32) / 255.0
    x = np.clip((x - SHRINK) / (1 - SHRINK), 0, 1)
    blurred = Image.fromarray((x * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(BLUR))
    return np.asarray(blurred).astype(np.float32) / 255.0


def mood_frame(ref, ref_box, key):
    """hello.png + лицо эмоции `key` внутри контура лица."""
    src = Image.open(FACES / f"{key}.png").convert("RGBA")
    mask = face_mask(src)
    x0, y0, x1, y1 = bbox(mask)
    mx, my = int((x1 - x0) * MARGIN), int((y1 - y0) * MARGIN)
    cx0, cy0 = max(0, x0 - mx), max(0, y0 - my)
    cx1, cy1 = min(src.width, x1 + mx), min(src.height, y1 + my)
    crop = src.crop((cx0, cy0, cx1, cy1))
    cmask = mask[cy0:cy1, cx0:cx1]

    rx0, ry0, rx1, ry1 = ref_box
    rw, rh = rx1 - rx0, ry1 - ry0
    pad_x, pad_y = int(rw * MARGIN * 2), int(rh * MARGIN * 2)   # тот же запас, что и в источнике
    tw, th = rw + pad_x, rh + pad_y
    px, py = rx0 - pad_x // 2, ry0 - pad_y // 2

    face = crop.resize((tw, th), Image.Resampling.LANCZOS).convert("RGB")
    alpha = soft_alpha(cmask, (tw, th))[..., None]

    base = np.asarray(ref).astype(np.float32).copy()
    patch = base[py:py + th, px:px + tw, :3] * (1 - alpha) + np.asarray(face).astype(np.float32) * alpha
    base[py:py + th, px:px + tw, :3] = patch          # альфу не трогаем вообще
    return Image.fromarray(base.astype(np.uint8), "RGBA"), (px, py, px + tw, py + th)


def main():
    ref = Image.open(MASCOT / "hello.png").convert("RGBA")
    ref_box = bbox(face_mask(ref))
    ref_arr = np.array(ref)

    frames = [ref]
    touched = None
    for key in KEYS:
        frame, touched = mood_frame(ref, ref_box, key)
        frames.append(frame)

    # Обещание неподвижности: за пределами лица кадры совпадают с hello.png
    # до пикселя, включая альфа-канал. Иначе персонаж «дёргается» при смене эмоции.
    fixed = np.ones(ref_arr.shape[:2], dtype=bool)
    fx0, fy0, fx1, fy1 = touched
    fixed[fy0:fy1, fx0:fx1] = False
    for key, frame in zip(KEYS, frames[1:]):
        frame_arr = np.array(frame)
        assert frame.size == ref.size, f"{key}: размер кадра разошёлся с hello.png"
        assert np.array_equal(frame_arr[fixed], ref_arr[fixed]), f"{key}: сдвинулся силуэт"
        assert np.array_equal(frame_arr[..., 3], ref_arr[..., 3]), f"{key}: изменился альфа-канал"

    # Ячейка ровно по области лица (1:1 с hello.png): в сетке нет ни тела, ни
    # лишних пикселей, а элемент на экране имеет тот же аспект, что и ячейка,
    # поэтому фон не растягивается. Единица запаса — прозрачная.
    cell_w, cell_h = fx1 - fx0 + 1, fy1 - fy0 + 1
    atlas = Image.new("RGBA", (cell_w * COLS, cell_h * ROWS))   # ячейки 0, 10 и 11 пустые
    for i, frame in enumerate(frames[1:], start=1):
        cell = frame.crop((fx0, fy0, fx0 + cell_w, fy0 + cell_h))
        atlas.paste(cell, ((i % COLS) * cell_w, (i // COLS) * cell_h))
    # Лоссless-сетка весит 660 КБ и утяжеляет главную; q92 втрое легче и
    # отличается только внутри мягкой тени лица (проверено сравнением кропа).
    atlas.save(MASCOT / "hero-moods.webp", quality=92, alpha_quality=100, method=6)

    # Геометрия лица внутри позы — в процентах от квадратной картинки персонажа.
    w, h = ref.size
    css = [
        "/* Generated by scripts/build-mascot-moods.py. Где внутри позы лежит лицо,",
        "   которое подменяет слой .live-mascot-face (проценты от картинки персонажа). */",
        f".live-mascot-face{{left:{fx0 / w * 100:.4g}%; top:{fy0 / h * 100:.4g}%;",
        f"  width:{cell_w / w * 100:.4g}%; height:{cell_h / h * 100:.4g}%}}",
        ""
    ]
    CSS.write_text("\n".join(css))
    (MASCOT / "hero-moods.json").write_text(json.dumps({
        "frames": len(frames),
        "columns": COLS,
        "rows": ROWS,
        "cell": [cell_w, cell_h],
        "neutral": NEUTRAL,
        "box": [fx0, fy0, fx1, fy1],
        "keys": list(KEYS)
    }, indent=2) + "\n")
    print(f"лицо = настроение: {len(frames) - 1} лиц эмоций в ячейках 1..{len(frames) - 1}, "
          f"ячейка {NEUTRAL} — спокойное лицо; сетка {COLS}×{ROWS} по {cell_w}×{cell_h} px "
          f"(в каждой ячейке только лицо); тело и альфа-канал неподвижны")


if __name__ == "__main__":
    main()
