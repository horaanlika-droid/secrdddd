#!/usr/bin/env python3
"""v26: 16 голов Дибитишки из ОДНОГО сгенерированного листа 4×4.

python3 scripts/build-mood-faces.py
Зависимость: Pillow (pip install pillow).
Вход: scripts/art-src/mood-heads-sheet.webp — единственная генерация.
Выход: app/assets/mascot/faces/{key}.png, sheet.webp, sprite.webp и PNG для бота.
Первые 9 ключей совпадают с MOOD_FACES. Остальные — готовый резерв.
Фон убираем от краёв, а не глобальным knockout: белое лицо остаётся белым.
Оставляем самый крупный связный объект ячейки (голову), убирая подписи,
которые модель иногда добавляет вопреки промпту. Все головы нормализованы
в одну сетку: 256×256, одинаковая высота, целая макушка, никаких плеч.
"""
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts/art-src/mood-heads-sheet.webp"
OUT = ROOT / "app/assets/mascot/faces"
BOT = ROOT / "bot/assets/mascot/faces"
KEYS = ("hard", "sad", "anxious", "even", "warm", "fun", "joy", "mixed",
        "unclear", "angry", "surprised", "calm", "sleepy", "curious", "proud", "love")
SIZE, INSET = 256, 20


def head_only(img):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    q = deque([(x, y) for x in range(w) for y in (0, h - 1)] +
              [(x, y) for y in range(h) for x in (0, w - 1)])
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        r, g, b, a = px[x, y]
        if a == 0 or (min(r, g, b) >= 220 and max(r, g, b) - min(r, g, b) < 22):
            px[x, y] = (0, 0, 0, 0)
            q.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    # Связные компоненты: буквы не должны стать частью эмодзи.
    seen = bytearray(w * h)
    largest = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x] or not px[x, y][3]:
                continue
            component = []
            q = deque([(x, y)])
            while q:
                a, b = q.popleft()
                if not (0 <= a < w and 0 <= b < h) or seen[b * w + a] or not px[a, b][3]:
                    continue
                seen[b * w + a] = 1
                component.append((a, b))
                q.extend(((a - 1, b), (a + 1, b), (a, b - 1), (a, b + 1)))
            if len(component) > len(largest):
                largest = component
    out = Image.new("RGBA", (w, h))
    outpx = out.load()
    for x, y in largest:
        outpx[x, y] = px[x, y]
    # Буква подписи иногда касается макушки. Ограничиваем каждую строку
    # синим контуром головы; белое лицо внутри контура сохраняем целиком.
    for y in range(h):
        blue = [x for x in range(w) if outpx[x, y][3] and
                outpx[x, y][2] - outpx[x, y][0] > 8 and outpx[x, y][2] - outpx[x, y][1] > 8]
        left, right = (max(0, min(blue) - 1), min(w - 1, max(blue) + 1)) if blue else (w, -1)
        for x in range(w):
            if x < left or x > right:
                outpx[x, y] = (0, 0, 0, 0)
    box = out.getbbox()
    if not box:
        raise ValueError("Пустая ячейка")
    return out.crop(box)


def main():
    sheet = Image.open(SRC)
    OUT.mkdir(parents=True, exist_ok=True)
    BOT.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (SIZE * 4, SIZE * 4))
    for i, key in enumerate(KEYS):
        col, row = i % 4, i // 4
        cell = sheet.crop((round(col * sheet.width / 4), round(row * sheet.height / 4),
                           round((col + 1) * sheet.width / 4), round((row + 1) * sheet.height / 4)))
        head = head_only(cell)
        scale = (SIZE - INSET * 2) / max(head.size)
        head = head.resize((round(head.width * scale), round(head.height * scale)), Image.Resampling.LANCZOS)
        out = Image.new("RGBA", (SIZE, SIZE))
        out.paste(head, ((SIZE - head.width) // 2, (SIZE - head.height) // 2))
        out.save(OUT / f"{key}.png", optimize=True)
        out.save(BOT / f"{key}.png", optimize=True)
        atlas.paste(out, (col * SIZE, row * SIZE))
        print(f"{key}: ячейка {row + 1}:{col + 1} → {SIZE}×{SIZE}")
    atlas.save(OUT / "sheet.webp", lossless=True, method=6)
    # Для интерфейса достаточно ячеек 128×128 (иконка 34px даже при DPR 3).
    # Один лёгкий файл на все эмоции; PNG-нарезка остаётся для бота/экспорта.
    atlas.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "sprite.webp", quality=90, method=6)


if __name__ == "__main__":
    main()
