#!/usr/bin/env python3
"""Доводка мерча: «без фона» и без генерированной типографики.

Правки от 16 сентября 2026:

  1. кепка. У сгенерированного мокапа «прозрачный» фон был дорисован клеткой
     прямо в пикселях — файл лежал в RGB вообще без альфы, поэтому в карточке
     на белом и на голубом фоне видна шахматная доска. Клетка срезается честно:
     фон = нейтральные по цвету пиксели, связанные с краем кадра (flood fill
     снаружи, как в scripts/cut_bg.py), дальше морфологическое «открывание»
     выбрасывает тонкие огрызки клетки, а дырки внутри заливаются — белая
     вышивка капли и «:(:» по боку остаются целыми.

  2. тетрадь. Надпись на обложке рисовала модель: буквы «поехали», вместо «ДПТ»
     осталась латиница «dbt». Зона текста заливается гладким продолжением
     обложки (гармоническое заполнение 5-точечного лапласиана + зерно глянца),
     сверху кладётся НАСТОЯЩИЙ лого `app/assets/brand/splash-wordmark-hq.png`,
     а подпись «ДПТ дневник» набирается шрифтом. Ровно то, что обещает
     docs/SETUP.md: логотип на блокноте — исходный, а не сгенерированная имитация.

Оба шага идемпотентны: повторный запуск на уже готовом файле ничего не портит
(клетки уже нет, зона текста перечищается и закрашивается заново).

Запуск:
  .venv/bin/python scripts/fix-merch.py                     # правит app/assets/merch/*.webp
  .venv/bin/python scripts/fix-merch.py --preview /tmp/merch  # + превью на фоне приложения
Нужны Pillow и numpy (`.venv/bin/pip install pillow numpy`), как в build-merch.py.
"""
from __future__ import annotations

import argparse
import collections
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MERCH = ROOT / 'app' / 'assets' / 'merch'
LOGO = ROOT / 'app' / 'assets' / 'brand' / 'splash-wordmark-hq.png'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

# --- тетрадь: зона сгенерированной надписи и посадка настоящего лого ---
ERASE = (272, 330, 806, 612)     # x0, y0, x1, y1 — обе строки генерированной надписи и её мягкая тень
LOGO_W = 500                     # ширина логопакета на обложке
LOGO_BOTTOM = 505                # нижний край лого = низ строчной зоны, как было
SUB_Y = 528                      # верх подписи «ДПТ дневник»
PRINT_INK = (38, 68, 102)        # цвет печати по голубому глянце


# ---------- мелкая геометрическая помощь (только numpy, как в соседних скриптах) ----------
def gblur(arr, r):
    """Гаусс в два прохода: PIL GaussianBlur не умеет режим F, а scipy тут не нужен."""
    if r <= 0:
        return arr
    k = max(1, int(round(r * 3)))
    xs = np.arange(-k, k + 1)
    w = np.exp(-(xs ** 2) / (2 * r * r))
    w /= w.sum()
    out = np.apply_along_axis(lambda m: np.convolve(m, w, mode='same'), 0, arr)
    return np.apply_along_axis(lambda m: np.convolve(m, w, mode='same'), 1, out)


def shift(mask, dy, dx, pad=0):
    H, W = mask.shape
    p = ((max(dy, 0), max(-dy, 0)), (max(dx, 0), max(-dx, 0)))
    q = np.pad(mask, p, constant_values=pad)
    return q[p[0][0]:p[0][0] + H, p[1][0]:p[1][0] + W]


def dilate(mask, r=1):
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if abs(dy) + abs(dx) <= r:
                out |= shift(mask, dy, dx)
    return out


def erode(mask, r=1):
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if abs(dy) + abs(dx) <= r:
                out &= shift(mask, -dy, -dx, pad=1)
    return out


def flood_from_border(mask):
    """Связные компоненты, которые касаются края кадра — ровно как в cut_bg.py."""
    H, W = mask.shape
    out = np.zeros((H, W), bool)
    q = collections.deque()
    seeds = list(zip([0] * W, range(W))) + list(zip([H - 1] * W, range(W))) \
            + list(zip(range(H), [0] * H)) + list(zip(range(H), [W - 1] * H))
    for y, x in seeds:
        if mask[y, x] and not out[y, x]:
            out[y, x] = True
            q.append((y, x))
    nb = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
    while q:
        py, px = q.popleft()
        for dy, dx in nb:
            ny_, nx_ = py + dy, px + dx
            if 0 <= ny_ < H and 0 <= nx_ < W and mask[ny_, nx_] and not out[ny_, nx_]:
                out[ny_, nx_] = True
                q.append((ny_, nx_))
    return out


def fill_holes(mask):
    return ~flood_from_border(~mask)


def preview(rgba, out_dir, name, size=840, bg=(255, 255, 255)):
    os.makedirs(out_dir, exist_ok=True)
    tile = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')
    card = Image.new('RGBA', (size, size), (*bg, 255))
    t = tile.crop(tile.getbbox())
    t.thumbnail((int(size * .86), int(size * .86)), Image.Resampling.LANCZOS)
    card.alpha_composite(t, ((size - t.width) // 2, (size - t.height) // 2))
    card.convert('RGB').save(Path(out_dir) / f'{name}-preview.png')


# ---------- 1. кепка: настоящая прозрачность вместо дорисованной клетки ----------
def fix_cap(path, preview_dir=None):
    src = Image.open(path)
    raw = np.asarray(src.convert('RGBA')).astype(np.float64)
    if raw[..., 3].min() < 200:
        print('cap: альфа уже есть — клетки в пикселях нет, оставляю как есть')
        return
    rgb = raw[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    neutral = (mx - mn <= 20) & ((mx + mn) / 2 >= 90)     # клетки + тень под кепкой
    bg = flood_from_border(neutral)
    keep = ~bg
    keep = dilate(erode(keep, 2), 2)                       # тонкие огрызки клетки и дуги — долой
    keep = fill_holes(keep)
    keep = gblur(keep.astype(np.float64), 0.9) > 0.42     # край без «лесенки» и без белой обводки
    out = np.dstack([rgb, keep * 255.0])
    out[out[..., 3] < 1, :3] = 0.0
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').save(path, quality=95, method=6)
    print(f'cap: убрал нарисованную клетку с {bg.mean() * 100:.1f}% кадра, фон теперь настоящий')
    if preview_dir:
        preview(out, preview_dir, 'cap')


# ---------- 2. тетрадь: убираем генерированные буквы, кладём живой лого ----------
def harmonic_fill(chan, box):
    """Гармоническое заполнение прямоугольника: внутри — гладкое продолжение
    границ (тучи, блик и фактура обложки не рвутся), а сами буквы и их мягкая
    «тень» исчезают целиком. Решаем 5-точечный лапласиан с дирихлевыми краями
    предобусловленным CG; граница входа не касается, поэтому спирель и край
    страниц в заплатку не «затекают».
    """
    x0, y0, x1, y1 = box
    h, w = y1 - y0 + 1, x1 - x0 + 1
    top = chan[y0 - 1, x0:x1 + 1].astype(np.float64)
    bot = chan[y1 + 1, x0:x1 + 1].astype(np.float64)
    lef = chan[y0:y1 + 1, x0 - 1].astype(np.float64)
    rig = chan[y0:y1 + 1, x1 + 1].astype(np.float64)
    b = np.zeros((h, w))
    b[0, :] += top
    b[-1, :] += bot
    b[:, 0] += lef
    b[:, -1] += rig

    def matvec(u):
        out = 4.0 * u
        out[1:, :] -= u[:-1, :]
        out[:-1, :] -= u[1:, :]
        out[:, 1:] -= u[:, :-1]
        out[:, :-1] -= u[:, 1:]
        return out

    u = np.zeros((h, w))
    r = b.copy()
    z = r / 4.0
    p = z.copy()
    rz = float(r.ravel() @ z.ravel())
    scale = max(float(np.abs(b).max()), 1.0)
    for _ in range(6000):
        Ap = matvec(p)
        a = float(p.ravel() @ Ap.ravel())
        if a <= 1e-12:
            break
        alpha = rz / a
        u += alpha * p
        r -= alpha * Ap
        if float(np.abs(r).max()) < 1e-4 * scale:
            break
        z = r / 4.0
        rz_new = float(r.ravel() @ z.ravel())
        p = z + (rz_new / rz) * p
        rz = rz_new
    lo = min(top.min(), bot.min(), lef.min(), rig.min()) - 6
    hi = max(top.max(), bot.max(), lef.max(), rig.max()) + 6
    if not (u.min() >= lo and u.max() <= hi):
        raise SystemExit(f'harmonic_fill: решение вышло за границы поля ({u.min():.0f}..{u.max():.0f} vs {lo:.0f}..{hi:.0f}) — проверь ERASE')
    out = chan.copy()
    out[y0:y1 + 1, x0:x1 + 1] = u
    return out


def fix_notebook(path, preview_dir=None):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)
    rgb, alpha = a[..., :3].copy(), a[..., 3]
    x0, y0, x1, y1 = ERASE
    lum0 = rgb.mean(-1)

    # заплатка получается гладкой, а обложка — с живым зерном печати: меряем
    # амплитуду зерна по чистой обложке ВНЕ заплатки и сыплем ровно столько же
    hi = lum0 - gblur(lum0, 2.0)
    clean = (alpha > 200) & (np.arange(alpha.shape[1])[None, :] >= 268) \
            & (np.arange(alpha.shape[1])[None, :] < 808)
    clean[y0 - 6:y1 + 7, :] = False
    amp = float(np.clip(1.4826 * np.median(np.abs(hi[clean])), 0.5, 2.0))
    grain = np.random.default_rng(11).normal(0.0, amp, alpha.shape)

    for c in range(3):
        rgb[..., c] = harmonic_fill(rgb[..., c], ERASE)

    # к краю заплатки зерно сходится на нет, чтобы не подчёркивать границу заливки
    yy, xx = np.mgrid[0:alpha.shape[0], 0:alpha.shape[1]]
    ramp = np.minimum.reduce([
        np.clip((yy - (y0 - 1)) / 16.0, 0, 1), np.clip(((y1 + 1) - yy) / 16.0, 0, 1),
        np.clip((xx - (x0 - 1)) / 16.0, 0, 1), np.clip(((x1 + 1) - xx) / 16.0, 0, 1)])
    patch = np.zeros(alpha.shape)
    patch[y0:y1 + 1, x0:x1 + 1] = ramp[y0:y1 + 1, x0:x1 + 1]   # к краю заплатки зерно гаснет
    rgb = rgb + grain[..., None] * patch[..., None]

    comp = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8), 'RGBA')

    # --- настоящий лого: та же строчная зона, что была, без генерированных букв ---
    logo = Image.open(LOGO).convert('RGBA')
    logo = logo.crop(logo.getbbox())
    la = np.asarray(logo).astype(np.float64)
    la[..., 3] = np.clip((la[..., 3] - 14.0) * (255.0 / 241.0), 0, 255)   # сдуваем мягкое свечение
    lw = LOGO_W
    lh = int(round(lw * logo.height / logo.width))
    art = Image.fromarray(np.clip(la, 0, 255).astype(np.uint8), 'RGBA').resize((lw, lh), Image.Resampling.LANCZOS)
    ax, ay = int(round((x0 + x1) / 2 - lw / 2)), LOGO_BOTTOM - lh
    A = np.asarray(art).astype(np.float64)
    shadow = Image.fromarray(np.clip(gblur(A[..., 3], 1.5) * 0.18, 0, 255).astype(np.uint8), 'L')
    layer = Image.new('RGBA', comp.size, (0, 0, 0, 0))
    blank = Image.new('RGBA', art.size, (14, 34, 62, 0))
    blank.putalpha(shadow)
    layer.alpha_composite(blank, (ax + 1, ay + 3))
    layer.alpha_composite(art, (ax, ay))
    comp.alpha_composite(layer)

    # подпись набираем шрифтом (3x + даунскейл — сглаживание честное, а не «поехавшее»)
    d = ImageDraw.Draw(comp)
    sub = 'ДПТ дневник'
    f = ImageFont.truetype(FONT, 26 * 3)
    tb = d.textbbox((0, 0), sub, font=f)
    txt = Image.new('RGBA', (tb[2] - tb[0] + 24, tb[3] - tb[1] + 24), (0, 0, 0, 0))
    ImageDraw.Draw(txt).text((12 - tb[0], 12 - tb[1]), sub, font=f, fill=(*PRINT_INK, 235))
    txt = txt.resize((txt.width // 3, txt.height // 3), Image.Resampling.LANCZOS)
    comp.alpha_composite(txt, (int(round((x0 + x1) / 2 - txt.width / 2)), SUB_Y - 12))

    out = np.asarray(comp).astype(np.float64)
    out[out[..., 3] < 1, :3] = 0.0
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').save(path, quality=95, method=6)
    covered = ((yy >= y0) & (yy <= y1) & (xx >= x0) & (xx <= x1)).sum()
    print(f'notebook: зона {x0}..{x1}×{y0}..{y1} ({covered} px) залита гладкой обложкой, '
          f'положил живой лого {lw}×{lh} и «{sub}»')
    if preview_dir:
        preview(out, preview_dir, 'notebook')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', default=None, help='папка для превью на фоне приложения')
    a = ap.parse_args()
    fix_cap(MERCH / 'cap.webp', a.preview)
    fix_notebook(MERCH / 'notebook.webp', a.preview)


if __name__ == '__main__':
    main()
