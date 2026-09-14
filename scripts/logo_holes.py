#!/usr/bin/env python3
"""Логотип «Дибитишка» без подложки: дырки внутри символов — в тон фона.

Как это работает
  • наружный фон PNG уже вырезан (прозрачный), но замкнутые светлые участки
    внутри букв («д», «б», «к», «а», узкие щели между штрихами) остались
    белыми пятнами из исходного рендера;
  • строка надписи (y >= BAND_Y) обрабатывается «капом яркости»:
        rgb = min(rgb, FILL)
    всё, что было белее тона фона, становится ровно в тон фона, а голубое
    тело букв и мягкие внутренние тени у дырок не трогаются вообще;
  • персонаж (голова, руки, мордочка) лежит выше BAND_Y — он не затрагивается;
  • край маски слегка размывается, чтобы не было ступенек.

Запуск:
  python3 tools/logo_holes.py <in.png> <out.png> <#тон-фона> [BAND_Y]
"""
import subprocess
import sys

import numpy as np


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def main():
    src, dst, fill_hex = sys.argv[1], sys.argv[2], sys.argv[3]
    band_y = int(sys.argv[4]) if len(sys.argv) > 4 else 216
    flags = sys.argv[5:]

    wh = subprocess.run(['identify', '-format', '%w %h', src], capture_output=True,
                        check=True, text=True).stdout.split()
    W, H = int(wh[0]), int(wh[1])
    raw = subprocess.run(['convert', src, '-depth', '8', 'RGBA:-'],
                         capture_output=True, check=True).stdout
    img = np.frombuffer(raw, dtype=np.uint8).reshape(H, W, 4).astype(np.float64)
    rgb, alpha = img[:, :, :3], img[:, :, 3]
    gray = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]) / 255.0
    spread = rgb.max(axis=2) - rgb.min(axis=2)

    fill = hexrgb(fill_hex)
    # «выбеленные» пиксели строки: почти белые или почти в тон фону, но нейтральные
    cand = (alpha > 140) & (gray > 0.78) & (spread <= 46)
    cand[:band_y, :] = False

    # плавный край маски (размыв 1 px) — антиалиасинг остаётся
    m = cand.astype(np.float64)
    sm = (m + np.roll(m, 1, 0) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1)) / 5.0
    m = np.maximum(m, sm)
    # силу заливки берём по тому, насколько пиксель белее тона фона
    bright = np.clip((gray - 0.78) / (0.92 - 0.78), 0.0, 1.0)
    w = (m * bright)[:, :, None]

    capped = np.minimum(rgb, fill[None, None, :])
    out = rgb * (1 - w) + capped * w
    res = np.dstack([out, alpha[:, :, None]]).round().astype(np.uint8)

    subprocess.run(['convert', '-size', f'{W}x{H}', '-depth', '8', 'rgba:-', dst],
                   input=res.tobytes(), check=True, capture_output=True)
    print(f'{src} → {dst}: светлых пикселей в строке надписи: {int(cand.sum())}, тон фона {fill_hex}')

    if '--debug' in flags:
        dbg = img.copy()
        dbg[:, :, :3] = rgb * (1 - cand[:, :, None]) + np.array([255, 0, 90]) * cand[:, :, None]
        dbg[:, :, 3] = 255
        subprocess.run(['convert', '-size', f'{W}x{H}', '-depth', '8', 'rgba:-', '/tmp/mask_debug.png'],
                       input=dbg.astype(np.uint8).tobytes(), check=True, capture_output=True)
        print('debug → /tmp/mask_debug.png')


if __name__ == '__main__':
    main()
