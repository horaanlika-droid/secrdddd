#!/usr/bin/env python3
"""v26: 17 кадров мимики; тело/силуэт Дибитишки совершенно неподвижны.

Вход: hello.png + два исходника hero-{blink,smile}.png в scripts/art-src/mascot-src.
Выход: hero-expressions.webp (сетка 5×4, 512px/кадр), hero-animation.css,
hero-frames.json и два опорных PNG. Python: Pillow, numpy, scipy, opencv-python-headless.

Не смешиваем целые сгенерированные фигуры: они никогда не совпадут идеально.
Переносим только глаза и рот на ЕДИНУЮ позу hello.png. Промежуточные кадры —
геометрический морф по контурам глаз/рта (thin-plate spline), а не двойные глаза
при простом crossfade. У каждого состояния одинаковый альфа-канал и положение.
CSS переключает кадры дискретно, не перемещая и не масштабируя персонажа.
"""
from collections import deque
from pathlib import Path
import json
import cv2
import numpy as np
from scipy.interpolate import RBFInterpolator
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts/art-src/mascot-src"
MASCOT = ROOT / "app/assets/mascot"
BOT = ROOT / "bot/assets/mascot"
SIZE, COLS, ROWS, STEPS = 512, 5, 4, 8


def cut_white(img):
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
        if a < 10 or (min(r, g, b) >= 186 and max(r, g, b) - min(r, g, b) <= 34):
            px[x, y] = (0, 0, 0, 0)
            q.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    return img


def align_source(ref, name):
    box = ref.getbbox()
    frame = cut_white(Image.open(SRC / f"hero-{name}.png"))
    crop = frame.crop(frame.getbbox())
    scale = ((box[2] - box[0]) / crop.width + (box[3] - box[1]) / crop.height) / 2
    crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", ref.size)
    out.paste(crop, (round((box[0] + box[2] - crop.width) / 2), round((box[1] + box[3] - crop.height) / 2)))
    return out


EYE_BASE = [(399,442),(406,409),(443,389),(479,407),(495,445),(486,480),(450,500),(414,484)]
EYE_BLINK = [(398,448),(416,462),(441,469),(470,464),(484,451),(481,468),(446,484),(413,475)]
EYE_SMILE = [(400,443),(417,420),(443,414),(466,422),(480,445),(471,454),(443,433),(409,451)]
MOUTH_BASE = [(518,485),(525,486),(542,494),(559,488),(566,490),(559,502),(542,507),(527,501)]
MOUTH_SMILE = [(498,487),(516,490),(541,499),(568,500),(586,497),(571,523),(540,532),(510,514)]
FEATURES = [(380,375,511,516), (583,405,714,546), (482,470,605,552)]


def morph_feature(a, b, box, pa, pb, t):
    x, y, right, bottom = box
    w, h = right - x, bottom - y
    anchors = [(0,0),(w//2,0),(w-1,0),(w-1,h//2),(w-1,h-1),(w//2,h-1),(0,h-1),(0,h//2)]
    pa = np.float32(anchors + [(px-x, py-y) for px, py in pa])
    pb = np.float32(anchors + [(px-x, py-y) for px, py in pb])
    pm = pa * (1-t) + pb * t
    ac, bc = np.array(a.crop(box).convert('RGB')), np.array(b.crop(box).convert('RGB'))
    yy, xx = np.mgrid[0:h,0:w]
    coords = np.column_stack((xx.ravel(), yy.ravel()))
    maps = []
    for points in (pa, pb):
        mapped = RBFInterpolator(pm, points, kernel='thin_plate_spline', smoothing=1)(coords)
        maps.append(mapped.reshape(h,w,2).astype(np.float32))
    wa = cv2.remap(ac, maps[0][:,:,0], maps[0][:,:,1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101)
    wb = cv2.remap(bc, maps[1][:,:,0], maps[1][:,:,1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101)
    dest = wa * (1-t) + wb * t
    patch = Image.fromarray(np.clip(dest,0,255).astype(np.uint8)).convert('RGBA')
    mask = Image.new('L', (w,h))
    ImageDraw.Draw(mask).rounded_rectangle((9,9,w-10,h-10), radius=15, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(4))
    return patch, mask


def expression(ref, target, name, t):
    out = ref.copy()
    eyes = EYE_BLINK if name == 'blink' else EYE_SMILE
    landmarks = [(EYE_BASE, eyes),
                 ([(x+203,y+29) for x,y in EYE_BASE], [(x+207,y+26) for x,y in eyes])]
    if name == 'smile':
        landmarks.append((MOUTH_BASE, MOUTH_SMILE))
    for box, (pa,pb) in zip(FEATURES, landmarks):
        patch, mask = morph_feature(ref, target, box, pa, pb, t)
        out.paste(patch, box[:2], mask)
    out.putalpha(ref.getchannel('A'))
    return out


def main():
    ref = Image.open(MASCOT / 'hello.png').convert('RGBA')
    frames = [ref]
    for name in ('blink', 'smile'):
        source = align_source(ref, name)
        for i in range(1, STEPS + 1):
            frames.append(expression(ref, source, name, i / STEPS))
        frames[-1].save(MASCOT / f'hero-{name}.png', optimize=True)
        frames[-1].save(BOT / f'hero-{name}.png', optimize=True)
    # Проверяем главное обещание: вне области глаз и рта все пиксели одинаковы.
    fixed = np.ones((ref.height, ref.width), dtype=bool)
    for x,y,r,b in FEATURES:
        fixed[y:b,x:r] = False
    for frame in frames:
        assert np.array_equal(np.array(ref)[fixed], np.array(frame)[fixed]), 'Силуэт сдвинулся'
    atlas = Image.new('RGBA', (SIZE*COLS, SIZE*ROWS))
    for i, frame in enumerate(frames):
        atlas.paste(frame.resize((SIZE,SIZE), Image.Resampling.LANCZOS), ((i%COLS)*SIZE,(i//COLS)*SIZE))
    atlas.save(MASCOT / 'hero-expressions.webp', lossless=True, method=6)
    # Спокойный цикл 8 секунд. Моргание 0.45с, улыбка проявляется/уходит за 0.8с.
    timeline = [(0,0),(2400,0)]
    timeline += [(2400+i*25,i) for i in range(1,9)]
    timeline += [(2640+i*25,8-i) for i in range(1,9)]
    timeline += [(4200,0)] + [(4200+i*100,8+i) for i in range(1,9)]
    timeline += [(6000,16)] + [(6000+i*100,16-i if i < 8 else 0) for i in range(1,9)]
    timeline += [(8000,0)]
    css = ['/* Generated by scripts/build-mascot-frames.py. Fixed pose, 17 facial frames. */',
           '@keyframes heroExpressionFrames {']
    for ms, idx in timeline:
        css.append(f'  {ms/80:g}% {{ background-position:{(idx%COLS)*100/(COLS-1):g}% {(idx//COLS)*100/(ROWS-1):.6g}%; }}')
    css.append('}\n')
    (ROOT / 'app/css/hero-animation.css').write_text('\n'.join(css))
    (MASCOT / 'hero-frames.json').write_text(json.dumps({'frames':len(frames),'columns':COLS,'rows':ROWS,'size':SIZE,'duration':8000,'timeline':timeline},indent=2)+'\n')
    print(f'{len(frames)} кадров, тело и альфа-канал неподвижны; {COLS}×{ROWS} atlas')


if __name__ == '__main__':
    main()
