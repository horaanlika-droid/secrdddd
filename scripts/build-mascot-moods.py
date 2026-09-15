#!/usr/bin/env python3
"""v27: лицо Дибитишки на главной = текущее настроение.

Вход — только уже готовые файлы, новой генерации нет:
  app/assets/mascot/hello.png            единственная поза (тело и голова);
  app/assets/mascot/faces/{key}.png      девять голов, нарезанных
                                         scripts/build-mood-faces.py.

Что делаем: берём лицо выбранной эмоции, приводим его к размеру белого лица
hello.png и ПОЛНОСТЬЮ заменяем им овал лица позы. Маска овала сплошная (дырки
под глазами и ртом залиты), поэтому прежние глаза и улыбка из hello.png не
просвечивают сквозь новое выражение — раньше лица накладывались друг на друга.
Край овала размыт на пару пикселей, чтобы шов у капюшона не читался.
Тело, руки, капюшон, альфа-канал и положение персонажа остаются ровно такими
же, как в hello.png: персонаж не дёргается и не плавает.

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

EDGE_BLUR = 1.5              # мягкость границы овала лица (пиксели)


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


def fill_holes(mask):
    """Заливаем дырки внутри овала: глаза, рот и брови — часть лица.

    Без этого маска описывает только белую кожу, вставка получается дырявой и
    старые глаза с улыбкой из hello.png видны сквозь новую эмоцию.
    """
    height, width = mask.shape
    free = ~mask
    seen = np.zeros_like(mask, dtype=bool)
    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    while queue:                      # заливка фона снаружи внутрь не проходит
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < height and 0 <= nx < width and free[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return mask | (free & ~seen)


def face_mask(img):
    """Сплошной овал лица: белая кожа плюс всё, что внутри неё."""
    a = np.array(img)
    return fill_holes(grow(largest_component(whiteish(a, 200, 26)), whiteish(a, 178, 55)))


def bbox(mask):
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def soft_alpha(mask, blur=EDGE_BLUR):
    """Маска овала с чуть размытым краем: шов у капюшона не читается."""
    img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(img).astype(np.float32) / 255.0


def mood_frame(ref, ref_box, ref_alpha, key):
    """hello.png, у которого овал лица ЦЕЛИКОМ заменён лицом эмоции `key`.

    Лицо источника масштабируется ровно в рамку лица позы, поэтому глаза и рот
    попадают на свои места, а от прежнего выражения не остаётся ничего.
    """
    src = Image.open(FACES / f"{key}.png").convert("RGBA")
    sx0, sy0, sx1, sy1 = bbox(face_mask(src))

    rx0, ry0, rx1, ry1 = ref_box
    rw, rh = rx1 - rx0, ry1 - ry0
    face = src.crop((sx0, sy0, sx1, sy1)).resize((rw, rh), Image.Resampling.LANCZOS).convert("RGB")

    alpha = ref_alpha[..., None]
    base = np.asarray(ref).astype(np.float32).copy()
    patch = base[ry0:ry1, rx0:rx1, :3] * (1 - alpha) + np.asarray(face).astype(np.float32) * alpha
    base[ry0:ry1, rx0:rx1, :3] = patch            # альфу не трогаем вообще
    return Image.fromarray(base.astype(np.uint8), "RGBA"), (rx0, ry0, rx1, ry1)


def main():
    ref = Image.open(MASCOT / "hello.png").convert("RGBA")
    ref_mask = face_mask(ref)
    ref_box = bbox(ref_mask)
    rx0, ry0, rx1, ry1 = ref_box
    ref_alpha = soft_alpha(ref_mask[ry0:ry1, rx0:rx1])   # один овал на все эмоции
    ref_arr = np.array(ref)

    frames = [ref]
    touched = None
    for key in KEYS:
        frame, touched = mood_frame(ref, ref_box, ref_alpha, key)
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
