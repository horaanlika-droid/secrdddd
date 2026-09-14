#!/usr/bin/env python3
"""
Extract new droplet mascot from IMG_0987 (15) and IMG_0988 (45) using
connected components + nearest-small assignment + flood-fill bg removal.
Produces:
- app/assets/mascot/poses/sprite-01..60.png (transparent)
- app/assets/mascot/{hello,calm,hug,proud,peek,splash,icon}.png (1024x1024)
- bot/assets/mascot/* mirrored
"""

from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
from collections import deque, defaultdict

ROOT = Path(__file__).resolve().parents[1]
SRC_0987 = ROOT / "новые правки" / "IMG_0987.png"
SRC_0988 = ROOT / "новые правки" / "IMG_0988.png"

OUT_MASCOT = ROOT / "app" / "assets" / "mascot"
OUT_BOT = ROOT / "bot" / "assets" / "mascot"
OUT_POSES = OUT_MASCOT / "poses"
OUT_POSES.mkdir(parents=True, exist_ok=True)
OUT_MASCOT.mkdir(parents=True, exist_ok=True)
OUT_BOT.mkdir(parents=True, exist_ok=True)

# --- background removal (flood fill from edges) ---
def is_bg_pixel(r,g,b,a):
    if a==0:
        return True
    mx = max(r,g,b)
    mn = min(r,g,b)
    return mn >= 190 and mx - mn <= 30 and mx >= 190

def remove_white_bg_flood(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    w,h = img.size
    arr = np.array(img)  # h,w,4
    visited = np.zeros((h,w), dtype=bool)
    q = deque()
    for x in range(w):
        q.append((0,x))
        q.append((h-1,x))
    for y in range(1,h-1):
        q.append((y,0))
        q.append((y,w-1))
    while q:
        y,x = q.popleft()
        if y<0 or y>=h or x<0 or x>=w:
            continue
        if visited[y,x]:
            continue
        visited[y,x]=True
        r,g,b,a = arr[y,x]
        if a==0:
            if y>0: q.append((y-1,x))
            if y<h-1: q.append((y+1,x))
            if x>0: q.append((y,x-1))
            if x<w-1: q.append((y,x+1))
            if y>0 and x>0: q.append((y-1,x-1))
            if y>0 and x<w-1: q.append((y-1,x+1))
            if y<h-1 and x>0: q.append((y+1,x-1))
            if y<h-1 and x<w-1: q.append((y+1,x+1))
            continue
        if is_bg_pixel(int(r),int(g),int(b),int(a)):
            arr[y,x,3]=0
            if y>0: q.append((y-1,x))
            if y<h-1: q.append((y+1,x))
            if x>0: q.append((y,x-1))
            if x<w-1: q.append((y,x+1))
            if y>0 and x>0: q.append((y-1,x-1))
            if y>0 and x<w-1: q.append((y-1,x+1))
            if y<h-1 and x>0: q.append((y+1,x-1))
            if y<h-1 and x<w-1: q.append((y+1,x+1))
    # second pass halo cleanup
    for _ in range(2):
        alpha = arr[:,:,3]
        trans = (alpha==0)
        has_trans = np.zeros_like(trans, dtype=bool)
        has_trans[1:,:] |= trans[:-1,:]
        has_trans[:-1,:] |= trans[1:,:]
        has_trans[:,1:] |= trans[:,:-1]
        has_trans[:,:-1] |= trans[:,1:]
        has_trans[1:,1:] |= trans[:-1,:-1]
        has_trans[1:,:-1] |= trans[:-1,1:]
        has_trans[:-1,1:] |= trans[1:,:-1]
        has_trans[:-1,:-1] |= trans[1:,1:]
        r = arr[:,:,0].astype(int)
        g = arr[:,:,1].astype(int)
        b = arr[:,:,2].astype(int)
        light = (r>210) & (g>210) & (b>210) & (np.maximum(np.maximum(r,g),b) - np.minimum(np.minimum(r,g),b) < 25) & (alpha>0)
        light2 = (r>200) & (g>200) & (b>200) & (alpha>0) & (np.max(arr[:,:,:3], axis=2) - np.min(arr[:,:,:3], axis=2) < 35)
        to_remove = (light | light2) & has_trans
        arr[to_remove,3]=0
    return Image.fromarray(arr, "RGBA")

def trim_transparent(img: Image.Image, padding=10):
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    alpha = np.array(img.split()[-1])
    coords = np.argwhere(alpha > 10)
    if len(coords)==0:
        return img
    y0,x0 = coords.min(axis=0)
    y1,x1 = coords.max(axis=0)
    y0 = max(0, y0 - padding)
    x0 = max(0, x0 - padding)
    y1 = min(img.height-1, y1 + padding)
    x1 = min(img.width-1, x1 + padding)
    return img.crop((x0,y0,x1+1,y1+1))

def build_1024_canvas(img: Image.Image, content_max=820) -> Image.Image:
    w,h = img.size
    if max(w,h) != 0:
        # Always scale to content_max (upscale or downscale) to fill canvas nicely
        scale = content_max / max(w,h)
        # Avoid extreme upscaling beyond 3x to prevent pixelation, but allow up to 3x
        # For our mascot trimmed ~250-370px, scaling to 820 is ~2-3x, okay
        if scale != 1.0:
            new_w = max(1, int(w*scale))
            new_h = max(1, int(h*scale))
            img = img.resize((new_w,new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (1024,1024), (0,0,0,0))
    x = (1024 - img.width)//2
    y = (1024 - img.height)//2
    canvas.paste(img, (x,y), img)
    return canvas

def resize_to_fit(img: Image.Image, max_size=820):
    w,h = img.size
    if max(w,h) == 0:
        return img
    if max(w,h) != max_size:
        scale = max_size / max(w,h)
        return img.resize((int(w*scale), int(h*scale)), Image.LANCZOS)
    return img

def resize_to_fit_max(img: Image.Image, max_size=512):
    """Only downscale if larger than max_size, keep smaller as is"""
    w,h = img.size
    if max(w,h) > max_size:
        scale = max_size / max(w,h)
        return img.resize((int(w*scale), int(h*scale)), Image.LANCZOS)
    return img

# --- component extraction ---
def extract_components(path, min_large_area, max_dist, padding, y_thresh):
    im = Image.open(path).convert("RGB")
    arr = np.array(im)
    r,g,b = arr[:,:,0].astype(int), arr[:,:,1].astype(int), arr[:,:,2].astype(int)
    mx = np.maximum(np.maximum(r,g),b)
    mn = np.minimum(np.minimum(r,g),b)
    white = (mn>220) & (mx-mn < 25)
    fg = ~white
    labeled, n = ndimage.label(fg, structure=np.ones((3,3)))
    slices = ndimage.find_objects(labeled)
    comps=[]
    for i, sl in enumerate(slices):
        if sl is None: continue
        y_sl,x_sl = sl
        area = np.sum(labeled[y_sl, x_sl]==(i+1))
        comps.append({'id':i+1,'area':area,'y0':y_sl.start,'y1':y_sl.stop,'x0':x_sl.start,'x1':x_sl.stop})
    larges = [c for c in comps if c['area'] >= min_large_area]
    smalls = [c for c in comps if c['area'] < min_large_area]
    larges = sorted(larges, key=lambda c: (c['y0'], c['x0']))
    # assign smalls to nearest large
    small_assign={}
    for S in smalls:
        best=None
        bestd=float('inf')
        for idx,L in enumerate(larges):
            dx=0
            if S['x1'] < L['x0']: dx = L['x0']-S['x1']
            elif S['x0'] > L['x1']: dx = S['x0']-L['x1']
            dy=0
            if S['y1'] < L['y0']: dy = L['y0']-S['y1']
            elif S['y0'] > L['y1']: dy = S['y0']-L['y1']
            d=(dx*dx+dy*dy)**0.5
            if d<bestd:
                bestd=d
                best=idx
        if bestd<=max_dist:
            small_assign[S['id']]=(best,bestd)
    grouped=defaultdict(list)
    for S in smalls:
        if S['id'] in small_assign:
            grouped[small_assign[S['id']][0]].append(S)
    # build bboxes
    bboxes=[]
    for idx,L in enumerate(larges):
        x0,y0,x1,y1 = L['x0'],L['y0'],L['x1'],L['y1']
        for S in grouped[idx]:
            x0=min(x0,S['x0']); y0=min(y0,S['y0']); x1=max(x1,S['x1']); y1=max(y1,S['y1'])
        x0=max(0,x0-padding); y0=max(0,y0-padding); x1=min(im.width,x1+padding); y1=min(im.height,y1+padding)
        bboxes.append((x0,y0,x1,y1))
    # cluster rows
    bboxes_sorted = sorted(bboxes, key=lambda b: b[1])
    rows=[]
    cur=[]
    cur_y=None
    for b in bboxes_sorted:
        y=b[1]
        if cur_y is None or abs(y-cur_y) < y_thresh:
            cur.append(b)
            cur_y = y if cur_y is None else (cur_y*len(cur)+y)/(len(cur)+1)
        else:
            rows.append(sorted(cur, key=lambda b: b[0]))
            cur=[b]
            cur_y=y
    if cur:
        rows.append(sorted(cur, key=lambda b: b[0]))
    flat=[]
    for r in rows:
        flat.extend(r)
    return flat, im

def main():
    print("Extracting 0987 (15)...")
    bboxes_0987, im_0987 = extract_components(SRC_0987, min_large_area=8000, max_dist=50, padding=12, y_thresh=100)
    print(f"0987 bboxes: {len(bboxes_0987)}")
    print("Extracting 0988 (45)...")
    bboxes_0988, im_0988 = extract_components(SRC_0988, min_large_area=4000, max_dist=40, padding=10, y_thresh=80)
    print(f"0988 bboxes: {len(bboxes_0988)}")

    all_bboxes = bboxes_0987 + bboxes_0988
    all_ims = [im_0987]*len(bboxes_0987) + [im_0988]*len(bboxes_0988)
    print(f"Total {len(all_bboxes)}")

    # Extract and clean each
    cleaned_cells=[]
    for idx, (bbox, im) in enumerate(zip(all_bboxes, all_ims)):
        x0,y0,x1,y1 = bbox
        crop = im.crop((x0,y0,x1,y1))
        # remove bg
        crop_rgba = Image.new("RGBA", crop.size, (255,255,255,255))
        crop_rgba.paste(crop, (0,0))
        cleaned = remove_white_bg_flood(crop_rgba)
        cleaned = trim_transparent(cleaned, padding=8)
        cleaned_cells.append(cleaned)

    # Save poses sprites
    for i, cell in enumerate(cleaned_cells, start=1):
        out = cell.copy()
        # keep max 512 for sprite list, don't upscale tiny ones
        out = resize_to_fit_max(out, max_size=512)
        fname = OUT_POSES / f"sprite-{i:02d}.png"
        out.save(fname, "PNG")
        print(f"Saved {fname} {out.size}")

    # Main poses mapping from 0987 (first 15)
    # Indices in cleaned_cells: 0-14 are 0987, 15-59 are 0988
    # 0987 mapping:
    # 0 waving hello
    # 3 heart hug
    # 5 sleeping calm
    # 9 peek
    # 12 star proud
    poses_map = {
        "hello": cleaned_cells[0],
        "calm": cleaned_cells[5],
        "hug": cleaned_cells[3],
        "proud": cleaned_cells[12],
        "peek": cleaned_cells[9],
    }

    # If any of those look wrong, fallback to other candidates
    # Let's also ensure we have alternatives: if needed, generate via AI? For now use extracted

    for name, cell in poses_map.items():
        canvas = build_1024_canvas(cell, content_max=820)
        out_path = OUT_MASCOT / f"{name}.png"
        canvas.save(out_path, "PNG")
        print(f"Saved main pose {out_path} from cell size {cell.size}")
        bot_path = OUT_BOT / f"{name}.png"
        canvas.save(bot_path, "PNG")

    # splash: hello at 690
    splash_canvas = build_1024_canvas(poses_map["hello"], content_max=690)
    splash_canvas.save(OUT_MASCOT / "splash.png", "PNG")
    splash_canvas.save(OUT_BOT / "splash.png", "PNG")
    print("Saved splash")

    # icon: radial gradient + hello 780
    size=1024
    def make_radial_gradient(size, inner=(255,255,255), outer=(219,234,255)):
        arr = np.zeros((size,size,4), dtype=np.uint8)
        cx,cy = size//2, size//2
        max_r = np.sqrt(cx**2 + cy**2)
        y,x = np.ogrid[:size,:size]
        dist = np.sqrt((x-cx)**2 + (y-cy)**2)
        t = np.clip(dist / max_r, 0, 1)
        for i in range(3):
            arr[:,:,i] = (inner[i]*(1-t) + outer[i]*t).astype(np.uint8)
        arr[:,:,3]=255
        return Image.fromarray(arr, "RGBA")

    bg = make_radial_gradient(1024, inner=(255,255,255), outer=(219,234,255))
    icon_mascot = poses_map["hello"].copy()
    # resize to 780 always
    icon_mascot = resize_to_fit(icon_mascot, max_size=780)
    bg.paste(icon_mascot, ((1024-icon_mascot.width)//2, (1024-icon_mascot.height)//2), icon_mascot)
    bg.save(OUT_MASCOT / "icon.png", "PNG")
    bg.save(OUT_BOT / "icon.png", "PNG")
    print("Saved icon")

    # Save _gen
    gen_dir = OUT_MASCOT / "_gen"
    gen_dir.mkdir(parents=True, exist_ok=True)
    for name, cell in poses_map.items():
        cell.save(gen_dir / f"{name}.png", "PNG")

    # Also save hero and side for compatibility (old poses README)
    # hero.png = proud? side.png = hello? Let's create
    hero_cell = poses_map["proud"]
    side_cell = poses_map["hello"]
    # Save as poses/hero.png and side.png
    hero_canvas = build_1024_canvas(hero_cell, content_max=820)
    side_canvas = build_1024_canvas(side_cell, content_max=820)
    # Trim to content? Old hero was 1234x517 etc, but now we save 1024
    hero_canvas.save(OUT_POSES / "hero.png", "PNG")
    side_canvas.save(OUT_POSES / "side.png", "PNG")
    print("Saved hero/side")

    print("Done!")

if __name__ == "__main__":
    main()
