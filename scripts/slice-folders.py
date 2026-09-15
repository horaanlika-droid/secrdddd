#!/usr/bin/env python3
"""Папки навыков (v25).

Вход:  scripts/art-src/folders-src/folders-sheet.png — один лист с пятью
       папками (сгенерированы в стиле маскота: мягкий 3D-пластилин).
Выход: app/assets/folders/<ключ>.png (прозрачный фон, 512×512) и зеркало в бот.

Ключи совпадают с FOLDER_ART в app/js/app.js:
       opora · osoznannost · stress · emotions · sensorika
Раскладка листа — слева направо, порядок совпадает с content.json
(Опора · Осознанность · Стрессоустойчивость · Эмоции · Сенсорика).
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "scripts" / "art-src" / "folders-src" / "folders-sheet.png"
OUT = ROOT / "app" / "assets" / "folders"
BOT = ROOT / "bot" / "assets" / "folders"
KEYS = ("opora", "osoznannost", "stress", "emotions", "sensorika")
SIZE = 512
PAD = 0.06


def is_bg(r: int, g: int, b: int) -> bool:
    mx, mn = max(r, g, b), min(r, g, b)
    return mn >= 190 and mx - mn <= 26 and mx >= 190


def transparent(img: Image.Image) -> Image.Image:
    """Светлый фон → прозрачный, без заливки: папки не имеют белых внутренностей."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and is_bg(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    return img


def columns(img: Image.Image):
    """Границы папок по пустым вертикалям (лист — ровный ряд)."""
    px = img.load()
    w, h = img.size
    filled = [any(px[x, y][3] for y in range(h)) for x in range(w)]
    spans, start = [], None
    for x, f in enumerate(filled):
        if f and start is None:
            start = x
        elif not f and start is not None:
            if x - start > w * 0.02:
                spans.append((start, x))
            start = None
    if start is not None:
        spans.append((start, w))
    return spans


def square(img: Image.Image) -> Image.Image:
    box = img.getbbox()
    if box:
        img = img.crop(box)
    w, h = img.size
    side = int(max(w, h) * (1 + PAD * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    if not SHEET.exists():
        raise SystemExit(f"нет исходника: {SHEET.relative_to(ROOT)}")
    sheet = transparent(Image.open(SHEET))
    spans = columns(sheet)
    if len(spans) != len(KEYS):
        raise SystemExit(f"на листе нашлось {len(spans)} папок, ожидалось {len(KEYS)}")
    OUT.mkdir(parents=True, exist_ok=True)
    BOT.mkdir(parents=True, exist_ok=True)
    w, h = sheet.size
    for key, (x0, x1) in zip(KEYS, spans):
        icon = square(sheet.crop((x0, 0, x1, h)))
        icon.save(OUT / f"{key}.png", optimize=True)
        icon.save(BOT / f"{key}.png", optimize=True)
        print(f"folders/{key}.png  ({x0}–{x1})")


if __name__ == "__main__":
    main()
