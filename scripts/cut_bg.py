#!/usr/bin/env python3
"""Чистое вырезание фона вокруг artwork (логотип-буквы, коллаж доски, маскоты).

Как это работает:
  1. «фон» = пиксели, близкие к белому (логотип) или к модели фона
     (квадратичная аппроксимация по краю картинки) — для цветных фонов;
  2. flood fill идёт ТОЛЬКО снаружи: затравка = фон, прилегающий к уже
     прозрачным пикселям, дальше маска несколько раз «разъедается» на 1 px,
     так что белые блики и лицо маскота внутри artwork остаются целыми;
  3. край маски сглаживается gaussian blur → нет «лесенки» и белой обводки.

Запуск:
  python3 cut_bg.py <in> <out> [--white|--model] [--dmax N] [--adj-rounds N] [--feather F]
"""
import argparse
import collections
import os

import numpy as np
from PIL import Image, ImageFilter


def poly_features(y, x, H, W):
    ny = y / max(H - 1, 1)
    nx = x / max(W - 1, 1)
    return np.stack([np.ones_like(nx), nx, ny, nx * nx, nx * ny, ny * ny], axis=-1)


def fit_bg(rgb, known, H, W):
    y, x = np.nonzero(known)
    if y.size < 400:
        return np.median(rgb[known], axis=0)
    A = poly_features(y.astype(float), x.astype(float), H, W)
    coef, *_ = np.linalg.lstsq(A, rgb[y, x].astype(np.float64), rcond=None)
    Y, X = np.mgrid[0:H, 0:W]
    return poly_features(Y.astype(float), X.astype(float), H, W) @ coef


def flood(mask):
    """связные компоненты mask, стартуя с его же пикселей (маска уже содержит край)"""
    H, W = mask.shape
    seen = mask.copy()
    q = collections.deque(zip(*np.nonzero(mask)))
    nb = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
    while q:
        py, px = q.popleft()
        for dy, dx in nb:
            ny_, nx_ = py + dy, px + dx
            if 0 <= ny_ < H and 0 <= nx_ < W and mask[ny_, nx_] and not seen[ny_, nx_]:
                seen[ny_, nx_] = True
                q.append((ny_, nx_))
    return seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--white", action="store_true", help="фон белый/пастельная дымка (логотип)")
    mode.add_argument("--model", action="store_true", help="фон цветной, модель по краю (коллаж)")
    ap.add_argument("--dmax", type=float, default=26.0, help="дистанция цвета до фона")
    ap.add_argument("--satmax", type=float, default=40.0, help="макс. насыщенность для «белого» фона")
    ap.add_argument("--adj-rounds", type=int, default=24, help="насколько глубоко разъедать фон от края")
    ap.add_argument("--feather", type=float, default=1.1)
    ap.add_argument("--out-preview", default=None)
    ap.add_argument("--preview-bg", default="#EDF3FE")
    a = ap.parse_args()

    im = Image.open(a.inp).convert("RGBA")
    arr = np.asarray(im).astype(np.float64)
    H, W = arr.shape[:2]
    rgb, alpha = arr[..., :3], arr[..., 3]

    if a.white:
        B = np.broadcast_to(np.array([255.0, 255.0, 255.0]), (H, W, 3)).copy()
    else:
        border = np.concatenate([
            rgb[:2].reshape(-1, 3), rgb[-2:].reshape(-1, 3),
            rgb[:, :2].reshape(-1, 3), rgb[:, -2:].reshape(-1, 3)], axis=0)
        bg0 = np.median(border, axis=0)
        d0 = np.sqrt(((rgb - bg0) ** 2).sum(-1))
        B = fit_bg(rgb, (alpha > 8) & (d0 <= 2.4 * a.dmax), H, W)

    dist = np.sqrt(((rgb - B) ** 2).sum(-1))
    near_bg = dist <= a.dmax
    if a.white:
        cand = near_bg & ((255.0 - rgb.min(-1)) <= a.satmax)
    else:
        cand = near_bg

    # снаружи внутрь: фон, который касается уже прозрачного, + разъедание на 1 px
    outside = np.zeros((H, W), dtype=bool)   # рамка — затравка для полностью непрозрачных исходников
    outside[:4] = outside[-4:] = True
    outside[:, :4] = outside[:, -4:] = True
    bg = (cand & (alpha < 200)) | (cand & outside)
    transp = bg
    for _ in range(max(1, a.adj_rounds)):
        grow = np.asarray(Image.fromarray((transp.astype(np.uint8)) * 255).filter(ImageFilter.MaxFilter(3))) > 40
        bg |= cand & grow
        transp = bg
    bg = flood(bg | (alpha < 8))

    soft = (bg.astype(np.uint8)) * 255
    if a.feather > 0:
        soft = np.asarray(Image.fromarray(soft).filter(ImageFilter.GaussianBlur(a.feather)), dtype=np.float64) / 255.0
    else:
        soft = soft.astype(np.float64) / 255.0
    keep = np.clip(1.0 - soft, 0.0, 1.0) * (alpha / 255.0)

    out = arr.copy()
    out[..., 3] = keep * 255.0
    out[out[..., 3] < 1, :3] = 0.0            # обнуляем RGB в прозрачном — меньше вес
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    ext = os.path.splitext(a.out)[1].lower()
    kw = {"quality": 90, "method": 6} if ext in (".webp",) else {"optimize": True}
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA").save(a.out, **kw)
    print(f"{os.path.basename(a.inp)}: убрано фона {bg.mean()*100:.1f}% (dmax={a.dmax}, rounds={a.adj_rounds})")

    if a.out_preview:
        bgc = np.array([int(a.preview_bg[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)
        src = np.asarray(Image.open(a.inp).convert("RGBA")).astype(np.float64)
        A = keep[..., None]
        comp = src[..., :3] * A + bgc * (1 - A)
        Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8)).save(a.out_preview)


if __name__ == "__main__":
    main()
