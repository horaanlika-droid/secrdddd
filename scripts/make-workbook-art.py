#!/usr/bin/env python3
"""Собрать иллюстрацию «Тетрадь» (обложка DBT diary) для приложения и печатной тетради.

Источник — сгенерированная картинка с ровным белым фоном
(`scripts/art-src/dbt-diary-src.png`). Фон убираем заливкой от краёв (flood fill
по связности), а не глобальным порогом: серебристая пружина на обложке тоже
светлая, и глобальный knockout пробил бы в ней дырки.

Результат: app/assets/workbook/dbt-diary.png (1024×1024, прозрачный фон,
персонаж отсутствует — на обложке только наивная бабл-надпись «DBT diary»).

Запуск:  python3 scripts/make-workbook-art.py
"""

from pathlib import Path
import sys
from collections import deque

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "art-src" / "dbt-diary-src.png"
OUT_DIR = ROOT / "app" / "assets" / "workbook"
OUT = OUT_DIR / "dbt-diary.png"
CANVAS = 1024
CONTENT_BOX = 820
FUZZ = 26  # насколько «белым» должен быть пиксель, чтобы считаться фоном


def read_png(path: Path):
    """Минимальный декодер PNG (RGB/RGBA, 8 бит) — без внешних зависимостей."""
    import zlib

    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"Не PNG: {path}")
    pos, idat, width, height, depth, ctype = 8, bytearray(), 0, 0, 8, 6
    while pos < len(raw):
        length = int.from_bytes(raw[pos:pos + 4], "big")
        kind = raw[pos + 4:pos + 8]
        body = raw[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width = int.from_bytes(body[0:4], "big")
            height = int.from_bytes(body[4:8], "big")
            depth, ctype = body[8], body[9]
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + length
    if depth != 8 or ctype not in (2, 6):
        raise SystemExit("Ожидается 8-битный RGB/RGBA PNG")
    channels = 3 if ctype == 2 else 4
    data = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(width * height * 4)
    prev = bytearray(stride)
    at = 0
    for y in range(height):
        filt = data[at]
        at += 1
        line = bytearray(data[at:at + stride])
        at += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            x = line[i]
            if filt == 1:
                x += a
            elif filt == 2:
                x += b
            elif filt == 3:
                x += (a + b) >> 1
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                x += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[i] = x & 0xFF
        prev = line
        for x in range(width):
            s = x * channels
            d = (y * width + x) * 4
            out[d] = line[s]
            out[d + 1] = line[s + 1]
            out[d + 2] = line[s + 2]
            out[d + 3] = line[s + 3] if channels == 4 else 255
    return width, height, out


def write_png(path: Path, width: int, height: int, rgba: bytearray) -> None:
    import zlib

    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += rgba[y * width * 4:(y + 1) * width * 4]

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (len(body).to_bytes(4, "big") + kind + body
                + zlib.crc32(kind + body).to_bytes(4, "big"))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", width.to_bytes(4, "big") + height.to_bytes(4, "big")
                 + bytes([8, 6, 0, 0, 0]))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def is_near_white(px, i) -> bool:
    r, g, b = px[i], px[i + 1], px[i + 2]
    return max(r, g, b) - min(r, g, b) <= FUZZ and min(r, g, b) >= 255 - FUZZ * 3


def cut_background(width: int, height: int, px: bytearray) -> int:
    """Убирает белый фон заливкой от краёв. Возвращает число фоновых пикселей."""
    bg = bytearray(width * height)
    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            i = (y * width + x)
            if not bg[i] and is_near_white(px, i * 4):
                bg[i] = 1
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            i = (y * width + x)
            if not bg[i] and is_near_white(px, i * 4):
                bg[i] = 1
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height and not bg[ny * width + nx] \
                    and is_near_white(px, (ny * width + nx) * 4):
                bg[ny * width + nx] = 1
                queue.append((nx, ny))
    count = 0
    for i in range(width * height):
        if bg[i]:
            px[i * 4 + 3] = 0
            count += 1
    return count


def trim(width: int, height: int, px: bytearray):
    x0, y0, x1, y1 = width, height, -1, -1
    for y in range(height):
        for x in range(width):
            if px[(y * width + x) * 4 + 3] > 12:
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    if x1 < 0:
        raise SystemExit("После вырезания фона не осталось картинки")
    return x0, y0, x1 + 1, y1 + 1


def fit_into_canvas(width: int, height: int, px: bytearray, box) -> bytearray:
    """Вписать вырезанную картинку в 1024×1024 с сохранением пропорций (билинейно)."""
    x0, y0, x1, y1 = box
    sw, sh = x1 - x0, y1 - y0
    scale = min(CONTENT_BOX / sw, CONTENT_BOX / sh)
    dw, dh = max(1, round(sw * scale)), max(1, round(sh * scale))
    ox, oy = (CANVAS - dw) // 2, (CANVAS - dh) // 2
    out = bytearray(CANVAS * CANVAS * 4)
    for dy in range(dh):
        sy = y0 + (dy + 0.5) * sh / dh - 0.5
        y_a, y_b = int(sy // 1), min(int(sy // 1) + 1, height - 1)
        ty = sy - y_a
        if y_a < 0:
            y_a = y_b = 0
            ty = 0
        for dx in range(dw):
            sx = x0 + (dx + 0.5) * sw / dw - 0.5
            x_a, x_b = int(sx // 1), min(int(sx // 1) + 1, width - 1)
            tx = sx - x_a
            if x_a < 0:
                x_a = x_b = 0
                tx = 0
            acc = [0.0, 0.0, 0.0, 0.0]
            for yy, wy in ((y_a, 1 - ty), (y_b, ty)):
                for xx, wx in ((x_a, 1 - tx), (x_b, tx)):
                    w = wy * wx
                    if not w:
                        continue
                    s = (yy * width + xx) * 4
                    for k in range(4):
                        acc[k] += px[s + k] * w
            d = ((dy + oy) * CANVAS + (dx + ox)) * 4
            for k in range(4):
                out[d + k] = max(0, min(255, round(acc[k])))
    return out


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Нет исходника: {SRC.relative_to(ROOT)}")
    width, height, px = read_png(SRC)
    removed = cut_background(width, height, px)
    box = trim(width, height, px)
    art = fit_into_canvas(width, height, px, box)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_png(OUT, CANVAS, CANVAS, art)
    print(f"{SRC.name}: {width}×{height} → фон снят ({removed} px), "
          f"обрезка {box} → {OUT.relative_to(ROOT)} ({CANVAS}×{CANVAS})")


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    main()
