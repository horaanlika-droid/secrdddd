#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор презентации Дибитишка — в стиле лендинга IMG_1043.png
1920x1080, светлый небесный фон с облаками, 3D маскот, закруглённые пилюли.
Делает два набора: slides/ с фоном и transparent/ с прозрой.
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import pathlib

W, H = 1920, 1080

# палитра лендинга
BG_TOP = (218, 230, 251)  # верх #DAE6FB
BG_BOT = (236, 241, 254)  # низ #ECF1FE
CLOUD_WHITE = (255,255,255)
INK = (12, 32, 77)        # заголовки #0C204D
INK2 = (88, 106, 142)     # подтекст
INK3 = (155, 168, 200)    # мелкие подписи
ACCENT = (46, 112, 232)   # синяя кнопка
ACCENT_DARK = (31, 90, 200)
PINK_SOFT = (242, 210, 220)
BLUE_SOFT = (218, 228, 248)

FONT_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
FONT_SERIF_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
FONT_SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def lf(path, size):
    return ImageFont.truetype(path, size)

fonts = {
    "s64": lf(FONT_SERIF, 64),
    "s52": lf(FONT_SERIF, 52),
    "s46": lf(FONT_SERIF, 46),
    "s40": lf(FONT_SERIF, 40),
    "s34": lf(FONT_SERIF, 34),
    "s28": lf(FONT_SERIF, 28),
    "s24": lf(FONT_SERIF_REG, 24),
    "r13": lf(FONT_SANS, 13),
    "r14": lf(FONT_SANS, 14),
    "r15": lf(FONT_SANS, 15),
    "r16": lf(FONT_SANS, 16),
    "r17": lf(FONT_SANS, 17),
    "r18": lf(FONT_SANS, 18),
    "r19": lf(FONT_SANS, 19),
    "r20": lf(FONT_SANS, 20),
    "b13": lf(FONT_SANS_B, 13),
    "b14": lf(FONT_SANS_B, 14),
    "b15": lf(FONT_SANS_B, 15),
    "b16": lf(FONT_SANS_B, 16),
    "b17": lf(FONT_SANS_B, 17),
    "b18": lf(FONT_SANS_B, 18),
    "b20": lf(FONT_SANS_B, 20),
    "b22": lf(FONT_SANS_B, 22),
    "b28": lf(FONT_SANS_B, 28),
}

ASSETS = pathlib.Path("/home/user/secrdddd/app/assets")
MASCOT_HELLO = ASSETS/"mascot/hello.png"
MASCOT_HUG = ASSETS/"mascot/hug.png"
MASCOT_MEDITATE = ASSETS/"mascot/meditate.png"
MASCOT_CALM = ASSETS/"mascot/calm.png"
MASCOT_COZY = ASSETS/"mascot/cozy.png"
MASCOT_BOOK = ASSETS/"mascot/book.png"
MASCOT_STAR = ASSETS/"mascot/star.png"
MASCOT_PROUD = ASSETS/"mascot/proud.png"
WORDMARK = ASSETS/"brand/splash-wordmark-hq.png"
LOGO_W = ASSETS/"brand/logo-wordmark.png"

# ---------- helpers ----------
def text_size(draw, txt, font):
    bbox = draw.textbbox((0,0), txt, font=font)
    return bbox[2]-bbox[0], bbox[3]-bbox[1]

def wrap(text, font, max_w, draw):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        test = cur + (" " if cur else "") + w
        if text_size(draw, test, font)[0] <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            # split long word
            if text_size(draw, w, font)[0] > max_w:
                tmp=""
                for ch in w:
                    if text_size(draw, tmp+ch, font)[0] <= max_w:
                        tmp+=ch
                    else:
                        lines.append(tmp)
                        tmp=ch
                cur=tmp
            else:
                cur=w
    if cur:
        lines.append(cur)
    return lines

def draw_wrapped(draw, text, font, x, y, max_w, line_h, fill, align="left"):
    lines = wrap(text, font, max_w, draw)
    for line in lines:
        tw,_ = text_size(draw, line, font)
        if align=="center":
            draw.text((x+(max_w-tw)//2, y), line, font=font, fill=fill)
        elif align=="right":
            draw.text((x+max_w-tw, y), line, font=font, fill=fill)
        else:
            draw.text((x, y), line, font=font, fill=fill)
        y += line_h
    return y

def rounded_shadow(img, box, radius, color=(11,31,77,18), blur=24, offset=(0,8)):
    # box = [x1,y1,x2,y2]
    shadow = Image.new("RGBA", (W,H), (0,0,0,0))
    d = ImageDraw.Draw(shadow)
    x1,y1,x2,y2 = box
    d.rounded_rectangle([x1+offset[0], y1+offset[1], x2+offset[0], y2+offset[1]], radius=radius, fill=color)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(img, shadow)

def draw_pill(draw, x, y, w, h, bg, outline=None):
    draw.rounded_rectangle([x,y,x+w,y+h], radius=h//2, fill=bg, outline=outline if outline else bg)

def icon_dot(draw, cx, cy, r, bg, fg, char):
    # white circle with soft shadow
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=bg, outline=(11,31,77,10), width=1)
    # centered char
    tw,th = text_size(draw, char, fonts["b14"])
    draw.text((cx-tw//2, cy-th//2 -1), char, font=fonts["b14"], fill=fg)

def make_background(transparent=False):
    if transparent:
        return Image.new("RGBA", (W,H), (0,0,0,0))
    # gradient
    img = Image.new("RGBA", (W,H), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        r = int(BG_TOP[0]*(1-t) + BG_BOT[0]*t)
        g = int(BG_TOP[1]*(1-t) + BG_BOT[1]*t)
        b = int(BG_TOP[2]*(1-t) + BG_BOT[2]*t)
        draw.line([(0,y),(W,y)], fill=(r,g,b,255))
    # soft blobs (behind clouds)
    blob = Image.new("RGBA", (W,H), (0,0,0,0))
    bd = ImageDraw.Draw(blob)
    bd.ellipse([-260,-300, 780, 620], fill=(190,210,252, 38))
    bd.ellipse([1180, 480, 2100, 1100], fill=(230,200,220, 32))
    blob = blob.filter(ImageFilter.GaussianBlur(90))
    img = Image.alpha_composite(img, blob)
    # clouds at bottom
    cloud = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(cloud)
    def fluffy(x, y, s):
        # 4 overlapping ellipses
        w, h = 680*s, 300*s
        # shadow slightly darker below
        # main white
        cd.ellipse([x - w*0.45, y - h*0.35, x + w*0.05, y + h*0.45], fill=(255,255,255,255))
        cd.ellipse([x - w*0.18, y - h*0.55, x + w*0.38, y + h*0.35], fill=(255,255,255,255))
        cd.ellipse([x + w*0.18, y - h*0.32, x + w*0.52, y + h*0.48], fill=(255,255,255,255))
        cd.ellipse([x - w*0.32, y - h*0.08, x + w*0.32, y + h*0.58], fill=(255,255,255,255))
    fluffy(320, 1030, 1.25)
    fluffy(1380, 1040, 1.15)
    fluffy(900, 1060, 0.75)
    # top right small cloud
    fluffy(1660, 170, 0.55)
    # blur clouds very slightly for softness
    cloud = cloud.filter(ImageFilter.GaussianBlur(1.2))
    # add subtle inner shadow under clouds (soft)
    # composite
    img = Image.alpha_composite(img, cloud)
    # sparkles / stars (tiny 4-point)
    spark = Image.new("RGBA", (W,H), (0,0,0,0))
    sd = ImageDraw.Draw(spark)
    def star(x,y, col, s=1):
        # 4-point star
        pts = [(x, y-8*s),(x+3*s, y-3*s),(x+8*s, y),(x+3*s, y+3*s),(x, y+8*s),(x-3*s, y+3*s),(x-8*s, y),(x-3*s, y-3*s)]
        sd.polygon(pts, fill=col)
    star(74, 662, (255,200,210, 180), 1.0)
    star(1060, 668, (255,214,120, 160), 0.9)
    star(1848, 360, (255,210,160, 190), 1.0)
    star(980, 364, (180,210,255, 170), 0.85)
    star(1890, 642, (190,215,255, 150), 0.8)
    star(960, 864, (185,210,248, 130), 0.7)
    img = Image.alpha_composite(img, spark)
    return img

def paste_mascot(base, path, x, y, w, h, shadow=True):
    if not path.exists():
        return base
    im = Image.open(path).convert("RGBA")
    im.thumbnail((w,h), Image.LANCZOS)
    iw, ih = im.size
    # optional soft halo under mascot
    if shadow:
        halo = Image.new("RGBA", (W,H), (0,0,0,0))
        hd = ImageDraw.Draw(halo)
        # oval halo
        hd.ellipse([x+iw*0.15, y+ih*0.78, x+iw*0.85, y+ih*0.98], fill=(11,31,77,14))
        halo = halo.filter(ImageFilter.GaussianBlur(14))
        base = Image.alpha_composite(base, halo)
    base.alpha_composite(im, dest=(x + (w-iw)//2, y + (h-ih)//2))
    return base

def draw_phone_mock(base, x, y, w=420, h=860):
    # shadow
    base = rounded_shadow(base, [x, y, x+w, y+h], radius=48, color=(11,31,77,20), blur=32, offset=(0,14))
    # phone body
    card = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([x, y, x+w, y+h], radius=48, fill=(255,255,255,255), outline=(225,232,245,255), width=2)
    # inner screen area with light gray
    # top notch
    cd.rounded_rectangle([x+110, y+10, x+w-110, y+28], radius=10, fill=(11,31,77,255))
    base = Image.alpha_composite(base, card)
    draw = ImageDraw.Draw(base)
    # screen content simplified
    # inner margin
    ix, iy = x+18, y+44
    iw = w-36
    # header pill inside phone
    draw.rounded_rectangle([ix, iy, ix+iw, iy+78], radius=18, fill=(240,243,252,255))
    # little wordmark placeholder
    draw.text((ix+iw//2 - 44, iy+12), "Дибитишка", font=fonts["b13"], fill=(160,175,210))
    # status time
    draw.text((ix+8, iy-18), "9:41", font=fonts["r13"], fill=(11,31,77))
    # title inside
    title_y = iy+32
    draw.text((ix+14, title_y), "Сегодня трудный день? Тогда", font=fonts["b14"], fill=INK)
    draw.text((ix+14, title_y+18), "особенно медленно.", font=fonts["b14"], fill=INK)
    draw.text((ix+14, title_y+40), "Вторник, 16 сентября", font=fonts["r13"], fill=INK3)
    # xp bar
    bar_y = iy+98
    draw.text((ix+6, bar_y), "Уровень 1", font=fonts["b13"], fill=ACCENT)
    draw.text((ix+iw-70, bar_y), "24 / 120 XP", font=fonts["r13"], fill=INK3)
    draw.rounded_rectangle([ix+6, bar_y+16, ix+iw-6, bar_y+22], radius=3, fill=(225,232,245,255))
    draw.rounded_rectangle([ix+6, bar_y+16, ix+6+ (iw-12)*0.20, bar_y+22], radius=3, fill=ACCENT)
    # emotion section
    ey = bar_y+38
    draw.text((ix+6, ey), "ОТМЕТЬ ЭМОЦИЮ", font=fonts["b13"], fill=INK3)
    # emotion icons row
    for i in range(7):
        cx = ix+26 + i*52
        cy = ey+34
        # select 5th (center) active
        if i==4:
            draw.ellipse([cx-22, cy-22, cx+22, cy+22], fill=(225,232,245,255), outline=ACCENT, width=2)
            draw.ellipse([cx-9, cy-7, cx-9+18, cy-7+12], fill=(11,31,77,255))  # placeholder face
        else:
            draw.ellipse([cx-18, cy-18, cx+18, cy+18], fill=(240,243,252,255), outline=(225,232,245,255), width=1)
        # hint text below some?
    # practice card
    py = ey+72
    draw.rounded_rectangle([ix+6, py, ix+iw-6, py+112], radius=16, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
    draw.ellipse([ix+18, py+14, ix+18+36, py+14+36], fill=(255,237,228,255))
    draw.text((ix+18+9, py+22), "♥", font=fonts["b14"], fill=(210,120,130))
    draw.text((ix+62, py+14), "Четыре корзины заботы", font=fonts["b14"], fill=INK)
    draw.text((ix+62, py+34), "5 шагов  •  7 мин", font=fonts["r13"], fill=INK3)
    # tiny text
    draw.text((ix+18, py+58), "Пол, на котором держится всё остальное: забота,", font=fonts["r13"], fill=INK2)
    draw.text((ix+18, py+74), "поддержка, безопасное место.", font=fonts["r13"], fill=INK2)
    draw.rounded_rectangle([ix+18, py+90, ix+18+170, py+100], radius=4, fill=(230,240,220,255))
    draw.text((ix+22, py+91), "есть и путь помягче • можно пропустить", font=fonts["r13"], fill=(90,120,90))
    # two small cards below
    sy = py+124
    for idx, title in enumerate(["Ночное море", "Доски"]):
        cx = ix+6 + idx*( (iw-12)//2 + 6)
        card_w = (iw-18)//2
        draw.rounded_rectangle([cx, sy, cx+card_w, sy+78], radius=14, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        draw.ellipse([cx+10, sy+10, cx+30, sy+30], fill=(220,230,250,255) if idx==0 else (242,222,230,255))
        draw.text((cx+10, sy+44), title, font=fonts["b13"], fill=INK)
        draw.text((cx+10, sy+58), "живой эмбиент • 6 сцен" if idx==0 else "впечатления • 5 плиток", font=fonts["r13"], fill=INK3)
    # tabbar bottom
    ty = y+h -44
    draw.rounded_rectangle([ix+6, ty-6, ix+iw-6, ty+28], radius=16, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
    tabs = ["Сегодня","Навыки","Чат","Тетрадь","Профиль"]
    for i, t in enumerate(tabs):
        tx = ix+18 + i*78
        col = ACCENT if i==0 else INK3
        draw.text((tx, ty+4), t, font=fonts["b13"] if i==0 else fonts["r13"], fill=col)
    return base

# ---------- slide builders ----------

def slide_1_cover(base):
    # wordmark top left
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((340, 140), Image.LANCZOS)
        base.alpha_composite(wm, dest=(68, 44))
    except:
        pass
    draw = ImageDraw.Draw(base)
    # subtitle near wordmark? like in landing: already in image? We'll add tagline below wordmark (skip iteration text for user)
    # Headline
    hx, hy = 68, 186
    # line 1
    draw.text((hx, hy), "Навыки ДПТ", font=fonts["s64"], fill=INK)
    draw.text((hx, hy+72), "и осознанности —", font=fonts["s64"], fill=INK)
    draw.text((hx, hy+144), "бережно, по шагам,", font=fonts["s64"], fill=INK)
    draw.text((hx, hy+216), "в медленном ритме.", font=fonts["s64"], fill=INK)
    # description
    desc = "Дибитишка — приложение для тех, кого накрывает: пять блоков\nпрактик, дневник эмоций, чат поддержки, живой эмбиент\nи печатная тетрадь. Всё остаётся только на твоём телефоне."
    draw_wrapped(draw, desc, fonts["r17"], hx, hy+322, 780, 26, INK2)
    # three pill tags
    pill_y = hy+432
    pills = [
        ("♥", "Ближе к себе", "29 практик в 5 блоках", (255,240,232)),
        ("✦", "Увереннее в будущем", "шкалы роста и XP", (255,250,230)),
        ("◐", "Легче каждый день", "эмбиент и тетрадь", (230,245,235)),
    ]
    px = hx
    for icon, title, sub, bg in pills:
        w = 258
        h = 72
        # shadow
        base = rounded_shadow(base, [px, pill_y, px+w, pill_y+h], radius=18, color=(11,31,77,10), blur=12, offset=(0,4))
        card = Image.new("RGBA", (W,H), (0,0,0,0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([px, pill_y, px+w, pill_y+h], radius=18, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        base = Image.alpha_composite(base, card)
        draw = ImageDraw.Draw(base)
        # icon circle
        draw.ellipse([px+14, pill_y+14, px+14+42, pill_y+14+42], fill=bg, outline=(255,255,255,255), width=1)
        draw.text((px+27, pill_y+22), icon, font=fonts["b14"], fill=(90, 70, 80) if "♥" in icon else (110,90,40) if "✦" in icon else (70,110,80))
        draw.text((px+68, pill_y+14), title, font=fonts["b15"], fill=INK)
        draw.text((px+68, pill_y+36), sub, font=fonts["r13"], fill=INK3)
        px += w+14
    # CTA buttons
    btn_y = pill_y+92
    # blue button
    bw, bh = 360, 56
    base = rounded_shadow(base, [hx, btn_y, hx+bw, btn_y+bh], radius=28, color=(46,112,232, 28), blur=18, offset=(0,8))
    card = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([hx, btn_y, hx+bw, btn_y+bh], radius=28, fill=ACCENT)
    base = Image.alpha_composite(base, card)
    draw = ImageDraw.Draw(base)
    draw.text((hx+28, btn_y+16), "✈", font=fonts["b16"], fill=(255,255,255))
    draw.text((hx+56, btn_y+16), "Открыть в Telegram", font=fonts["b17"], fill=(255,255,255))
    # white link pill
    lw = 320
    draw.rounded_rectangle([hx+bw+14, btn_y+6, hx+bw+14+lw, btn_y+44], radius=22, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
    draw.text((hx+bw+34, btn_y+14), "↓  t.me/dbtrobot/dibitishka", font=fonts["b15"], fill=INK)
    # footer note
    draw.text((hx, btn_y+bh+18), "первая неделя бесплатно  •  дальше — минимальный донат через Tribute", font=fonts["r13"], fill=INK3)
    # arrow annotation
    # "твой помощник в саморазвитии" with arrow to phone
    ax, ay = 1010, 420
    draw.text((ax, ay), "твой помощник", font=lf(FONT_SANS, 20), fill=ACCENT)
    draw.text((ax, ay+24), "в саморазвитии", font=lf(FONT_SANS, 20), fill=ACCENT)
    # curved arrow
    draw.line([(980, 492),(1180, 532)], fill=ACCENT, width=2)
    draw.polygon([(1180,532),(1164,524),(1164,540)], fill=ACCENT)
    # mascot hello at bottom near phone
    base = paste_mascot(base, pathlib.Path(MASCOT_HELLO), 1040, 620, 360, 360, shadow=False)
    # phone mock on right
    base = draw_phone_mock(base, 1270, 92, 420, 860)
    # bottom dots pagination
    draw = ImageDraw.Draw(base)
    # 8 dots bottom left
    dx, dy = hx, 1026
    for i in range(8):
        if i==0:
            draw.rounded_rectangle([dx+i*14, dy, dx+i*14+18, dy+6], radius=3, fill=(180,200,240,255))
        else:
            draw.ellipse([dx+i*14+5, dy, dx+i*14+11, dy+6], fill=(200,215,240, 180))
    draw.text((W-140, H-30), "01 — 08", font=fonts["r13"], fill=INK3)
    return base

def slide_2_dbt(base):
    draw = ImageDraw.Draw(base)
    # top bar
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((180, 70), Image.LANCZOS)
        base.alpha_composite(wm, dest=(64, 32))
    except:
        draw.text((64, 36), "Дибитишка", font=fonts["b18"], fill=INK)
    draw.text((W-140, 40), "02 — 08", font=fonts["r13"], fill=INK3)
    draw.text((64, 110), "Что такое ДБТ?", font=fonts["s52"], fill=INK)
    draw.text((64, 172), "Диалектико-поведенческая терапия — простыми словами.", font=fonts["r18"], fill=INK2)
    # big soft underline?
    draw.rounded_rectangle([64, 204, 164, 210], radius=3, fill=ACCENT)
    # left text block
    # white card backdrop for text?
    lx, ly = 64, 234
    lw, lh = 780, 760
    base = rounded_shadow(base, [lx, ly, lx+lw, ly+lh], radius=24, color=(11,31,77,10), blur=16, offset=(0,6))
    card = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([lx, ly, lx+lw, ly+lh], radius=24, fill=(255,255,255, 242), outline=(225,232,245,255), width=1)
    base = Image.alpha_composite(base, card)
    draw = ImageDraw.Draw(base)
    y = ly+28
    # definition
    draw.text((lx+28, y), "ДБТ придумала психолог Марша Линехан", font=fonts["b18"], fill=INK)
    y+=28
    y = draw_wrapped(draw, "для людей с очень высокой чувствительностью. Когда эмоции\nбыстро накрывают и долго не отпускают, а совет «просто успокойся»\nне работает.", fonts["r16"], lx+28, y, lw-56, 24, INK2) + 18
    # bullets
    bullets = [
        ("Научно подтверждено", "помогает снижать импульсивность и самокритику,\nулучшает отношения и устойчивость к стрессу."),
        ("Учит замечать чувство", "и выбирать, что делать, а не подавлять эмоции\nили действовать на автомате."),
        ("Баланс принятия и изменений", "ты делаешь всё, что можешь сейчас, и можешь\nнаучиться по-другому — обе фразы правдивы."),
    ]
    for title, desc in bullets:
        # dot
        draw.ellipse([lx+28, y+6, lx+28+10, y+16], fill=ACCENT)
        draw.text((lx+48, y), title, font=fonts["b16"], fill=INK)
        y+=26
        y = draw_wrapped(draw, desc, fonts["r15"], lx+48, y, lw-76, 21, INK2) + 14
    # bottom quote inside card
    # pinkish quote pill
    qy = ly+lh - 78
    draw.rounded_rectangle([lx+22, qy, lx+lw-22, qy+54], radius=14, fill=(255,240,235,255), outline=(245,220,215,255), width=1)
    draw.text((lx+34, qy+14), "«Большие чувства — не поломка. Это особенность, с которой можно жить мягче.»", font=fonts["r14"], fill=(120,80,85))
    # right side - two cards: Принятие и Изменение with И in centre
    rx, ry = 920, 234
    rw, rh = 430, 340
    gap = 30
    # left card Принятие
    for idx, (card_x, title, items, bg) in enumerate([
        (rx, "Принятие", ["я такой, какой есть", "чувства имеют право быть", "делаю всё, что могу сейчас"], (255,240,232)),
        (rx+rw+gap, "Изменение", ["могу научиться по-другному", "маленький шаг — тоже шаг", "могу выбрать поведение"], (230,239,252)),
    ]):
        base = rounded_shadow(base, [card_x, ry, card_x+rw, ry+rh], radius=22, color=(11,31,77,10), blur=14, offset=(0,6))
        c = Image.new("RGBA", (W,H), (0,0,0,0))
        cd = ImageDraw.Draw(c)
        cd.rounded_rectangle([card_x, ry, card_x+rw, ry+rh], radius=22, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        # top color strip
        cd.rounded_rectangle([card_x+16, ry+16, card_x+64, ry+22], radius=3, fill=ACCENT if idx==1 else (230,160,170))
        base = Image.alpha_composite(base, c)
        draw = ImageDraw.Draw(base)
        # icon
        draw.ellipse([card_x+18, ry+36, card_x+18+42, ry+36+42], fill=bg, outline=(255,255,255,255), width=1)
        ic = "♡" if idx==0 else "↗"
        draw.text((card_x+30, ry+44), ic, font=fonts["b16"], fill=(120,80,85) if idx==0 else ACCENT)
        draw.text((card_x+72, ry+46), title, font=fonts["b20"], fill=INK)
        by = ry+92
        for it in items:
            draw.ellipse([card_x+22, by+7, card_x+22+8, by+7+8], fill=ACCENT if idx==1 else (220,160,170))
            draw.text((card_x+40, by), it, font=fonts["r15"], fill=INK2)
            by+=30
        draw.text((card_x+22, ry+rh-24), "и это правда", font=fonts["r13"], fill=INK3)
    # central И circle overlapping
    cx = rx+rw + gap//2
    cy = ry + rh//2
    draw = ImageDraw.Draw(base)
    draw.ellipse([cx-30, cy-30, cx+30, cy+30], fill=ACCENT, outline=(255,255,255,255), width=3)
    draw.text((cx-10, cy-14), "И", font=fonts["b22"], fill=(255,255,255))
    # bottom card on right: dialectic definition
    by = ry+rh+22
    bw, bh = rw*2+gap, 260
    base = rounded_shadow(base, [rx, by, rx+bw, by+bh], radius=22, color=(11,31,77,10), blur=14, offset=(0,6))
    c = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(c)
    cd.rounded_rectangle([rx, by, rx+bw, by+bh], radius=22, fill=(255,255,255, 242), outline=(225,232,245,255), width=1)
    base = Image.alpha_composite(base, c)
    draw = ImageDraw.Draw(base)
    draw.text((rx+24, by+22), "Диалектика — две противоположности", font=fonts["b18"], fill=INK)
    draw.text((rx+24, by+48), "могут быть правдой одновременно.", font=fonts["b18"], fill=INK)
    y = by+84
    y = draw_wrapped(draw, "Принимаем момент таким, какой он есть, и одновременно меняем\nто, что можем изменить. Не нужно выбирать между «я ок» и «мне\nнужна помощь» — можно и то, и другое.", fonts["r16"], rx+24, y, bw-48, 24, INK2)
    # small pill at bottom
    py = by+bh+18
    note = "Именно поэтому в ДБТ всегда есть путь помягче, если сейчас не можется."
    tw,_ = text_size(draw, note, fonts["r14"])
    draw.rounded_rectangle([(W-tw)//2+420, py, (W-tw)//2+420+tw+28, py+28], radius=14, fill=(255,255,255,220), outline=(225,232,245,255), width=1)
    draw.text(((W-tw)//2+434, py+6), note, font=fonts["r14"], fill=INK3)
    # mascot small cozy on right bottom near card? add meditate at right top for balance
    base = paste_mascot(base, MASCOT_MEDITATE, rx+bw-160, ry-18, 220, 220, shadow=False)
    draw = ImageDraw.Draw(base)
    draw.text((W-140, H-30), "02 — 08", font=fonts["r13"], fill=INK3)
    return base

def slide_3_forwhom(base):
    draw = ImageDraw.Draw(base)
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((180,70), Image.LANCZOS)
        base.alpha_composite(wm, dest=(64,32))
    except:
        pass
    draw.text((W-140,40), "03 — 08", font=fonts["r13"], fill=INK3)
    draw.text((64,110), "Для кого Дибитишка?", font=fonts["s52"], fill=INK)
    draw.text((64,172), "Для тех, кого накрывает. Кому «просто возьми себя в руки» не помогает.", font=fonts["r18"], fill=INK2)
    # 4 cards grid 4x1? Or 2x2
    cards = [
        ("Когда накрывает", "Эмоции приходят быстро и сильно,\nдолго не отпускают, трудно\nостановиться.", "≋", (230,239,252)),
        ("Высокая\nчувствительность", "Тонко замечаешь детали, глубоко\nпроживаешь, легко перегружаешься.", "◉", (255,240,232)),
        ("Нейроотличность", "Мир не всегда собран под твою\nпроводку. Нужны свои опоры\nи бережные стратегии.", "✦", (230,245,235)),
        ("Усталость от советов", "Хочется не лекций, а маленьких\nпрактик, которые реально\nпомогают в моменте.", "♥", (242,230,240)),
    ]
    cx0, cy0 = 64, 236
    cw, ch = 430, 300
    gap = 28
    for i, (title, desc, icon, bg) in enumerate(cards):
        col = i % 4
        x = cx0 + col*(cw+gap)
        y = cy0
        base = rounded_shadow(base, [x, y, x+cw, y+ch], radius=22, color=(11,31,77,10), blur=14, offset=(0,6))
        c = Image.new("RGBA", (W,H), (0,0,0,0))
        cd = ImageDraw.Draw(c)
        cd.rounded_rectangle([x, y, x+cw, y+ch], radius=22, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        base = Image.alpha_composite(base, c)
        draw = ImageDraw.Draw(base)
        draw.ellipse([x+18, y+18, x+18+44, y+18+44], fill=bg)
        draw.text((x+30, y+26), icon, font=fonts["b16"], fill=INK)
        # title multiline
        ty = y+74
        for line in title.split("\n"):
            draw.text((x+18, ty), line, font=fonts["b18"], fill=INK)
            ty+=24
        ty+=8
        for line in desc.split("\n"):
            draw.text((x+18, ty), line, font=fonts["r14"], fill=INK2)
            ty+=19
    # center quote below grid
    qy = cy0+ch+28
    # big centered pill with mascot
    # mascot cozy + hug? use hello for greeting
    base = paste_mascot(base, MASCOT_HELLO, 64, qy+20, 300, 300, shadow=False)
    # speech bubble
    bx, by, bw, bh = 380, qy+60, 980, 140
    base = rounded_shadow(base, [bx, by, bx+bw, by+bh], radius=20, color=(11,31,77,10), blur=14, offset=(0,6))
    c = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(c)
    cd.rounded_rectangle([bx, by, bx+bw, by+bh], radius=20, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
    # tail
    cd.polygon([(bx+40, by+bh-4),(bx+24, by+bh+18),(bx+64, by+bh-4)], fill=(255,255,255,255), outline=(225,232,245,255))
    base = Image.alpha_composite(base, c)
    draw = ImageDraw.Draw(base)
    draw.text((bx+28, by+20), "Ты не «слишком чувствительный». Ты — внимательный к миру.", font=fonts["b18"], fill=INK)
    draw.text((bx+28, by+50), "Дибитишка помогает подобрать опоры именно под тебя — без стыда и оценок.", font=fonts["r16"], fill=INK2)
    draw.text((bx+28, by+86), "Можно идти медленно. Маленький шаг — тоже шаг.", font=fonts["r15"], fill=INK3)
    # bottom small pills row
    py = qy+bh+56
    tags = ["бережно", "без оценок", "в своём темпе", "маленькими шагами", "с поддержкой"]
    tx = 380
    for t in tags:
        tw,_ = text_size(draw, t, fonts["b14"])
        w = tw+28
        draw.rounded_rectangle([tx, py, tx+w, py+30], radius=15, fill=(255,255,255,230), outline=(225,232,245,255), width=1)
        draw.text((tx+14, py+6), t, font=fonts["b14"], fill=INK3)
        tx += w+10
    draw.text((W-140, H-30), "03 — 08", font=fonts["r13"], fill=INK3)
    return base

def slide_4_modules(base):
    draw = ImageDraw.Draw(base)
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((180,70), Image.LANCZOS)
        base.alpha_composite(wm, dest=(64,32))
    except:
        pass
    draw.text((W-140,40), "04 — 08", font=fonts["r13"], fill=INK3)
    draw.text((64,110), "Пять блоков — 29 практик", font=fonts["s52"], fill=INK)
    draw.text((64,172), "В Дибитишке — адаптация ДБТ для нейроотличных. Можно идти в своём темпе, выбирать то, что ближе сегодня.", font=fonts["r17"], fill=INK2)
    modules = [
        ("Опора", "забота и поддержка", "4 корзины, карта поддержки,\nкризис-план, гнёздышко", "♥", (255,240,232), "120 / 300 XP"),
        ("Осознанность", "замечать настоящее", "заземление, дыхание, якорь,\nблагодарность", "◉", (232,234,248), "240 / 500 XP"),
        ("Стрессоуст-\nойчивость", "пережить «накрывает»", "холод, прожимка, аптечка,\nвосстановление", "≋", (220,235,250), "180 / 400 XP"),
        ("Эмоции", "понимать и\nрегулировать", "письмо эмоции, факты,\nвыбор действия", "✦", (230,240,225), "60 / 250 XP"),
        ("Сенсорика", "тело и\nвосприятие", "профиль, гнёзда,\nстимминг как ресурс", "✋", (240,238,225), "40 / 250 XP"),
    ]
    x0, y0 = 64, 238
    cw, ch = 336, 520
    gap = 20
    for i, (title, sub, desc, icon, bg, xp) in enumerate(modules):
        x = x0 + i*(cw+gap)
        y = y0
        base = rounded_shadow(base, [x, y, x+cw, y+ch], radius=22, color=(11,31,77,10), blur=14, offset=(0,6))
        c = Image.new("RGBA", (W,H), (0,0,0,0))
        cd = ImageDraw.Draw(c)
        cd.rounded_rectangle([x, y, x+cw, y+ch], radius=22, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        # top tint strip?
        base = Image.alpha_composite(base, c)
        draw = ImageDraw.Draw(base)
        # icon
        draw.ellipse([x+18, y+18, x+18+48, y+18+48], fill=bg, outline=(255,255,255,255), width=1)
        draw.text((x+30, y+26), icon, font=fonts["b16"], fill=INK)
        ty = y+80
        for line in title.split("\n"):
            draw.text((x+18, ty), line, font=fonts["b18"], fill=INK)
            ty+=22
        ty+=4
        for line in sub.split("\n"):
            draw.text((x+18, ty), line, font=fonts["r14"], fill=INK2)
            ty+=18
        # divider
        draw.line([(x+18, ty+6),(x+cw-18, ty+6)], fill=(225,232,245,255), width=1)
        ty+=18
        for line in desc.split("\n"):
            draw.text((x+18, ty), line, font=fonts["r13"], fill=INK2)
            ty+=18
        # xp bar at bottom
        by = y+ch-36
        draw.text((x+18, by-18), xp, font=fonts["r13"], fill=INK3)
        draw.rounded_rectangle([x+18, by, x+cw-18, by+8], radius=4, fill=(225,232,245,255))
        # fill portion
        pct = [0.4, 0.48, 0.45, 0.24, 0.16][i]
        fw = int((cw-36)*pct)
        col = ACCENT if i%2==0 else (210, 170, 180)
        draw.rounded_rectangle([x+18, by, x+18+fw, by+8], radius=4, fill=col)
        # level badge
        draw.rounded_rectangle([x+cw-78, y+18, x+cw-18, y+36], radius=10, fill=(240,243,252,255))
        draw.text((x+cw-68, y+20), f"Ур. {i+1 if i<3 else i-1}", font=fonts["b13"], fill=INK3)
    # footer
    draw.text((64, y0+ch+22), "Каждый модуль — маленькие практики по 5–15 минут. Есть мини-версия на 1–2 минуты, если сегодня мало сил.", font=fonts["r14"], fill=INK3)
    # mascot meditate tiny bottom right?
    base = paste_mascot(base, MASCOT_MEDITATE, 1580, y0+ch+40, 180, 180, shadow=False)
    draw = ImageDraw.Draw(base)
    draw.text((W-140, H-30), "04 — 08", font=fonts["r13"], fill=INK3)
    return base

def slide_5_practice(base):
    draw = ImageDraw.Draw(base)
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((180,70), Image.LANCZOS)
        base.alpha_composite(wm, dest=(64,32))
    except:
        pass
    draw.text((W-140,40), "05 — 08", font=fonts["r13"], fill=INK3)
    draw.text((64,110), "Как устроена практика", font=fonts["s52"], fill=INK)
    draw.text((64,172), "Пошагово, с заботой и правом пропустить. Без «правильно / неправильно».", font=fonts["r17"], fill=INK2)
    # left timeline card
    lx, ly, lw, lh = 64, 224, 820, 760
    base = rounded_shadow(base, [lx, ly, lx+lw, ly+lh], radius=24, color=(11,31,77,10), blur=16, offset=(0,6))
    c = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(c)
    cd.rounded_rectangle([lx, ly, lx+lw, ly+lh], radius=24, fill=(255,255,255,242), outline=(225,232,245,255), width=1)
    base = Image.alpha_composite(base, c)
    draw = ImageDraw.Draw(base)
    steps = [
        ("Выбираешь, что ближе сегодня", "Опора, Осознанность, Эмоции — любой блок. 5 уровней: от простого к глубокому."),
        ("Делаешь маленькую практику", "5–15 минут, пошаговая инструкция. Не идёт — бери мини-версию на 1–2 минуты."),
        ("Замечаешь и отмечаешь", "Ставишь галочку, отвечаешь на вопрос, пишешь заметку. Всё попадает в дневник."),
        ("Возвращаешься когда готов", "Нет «опоздал». Можешь повторить, пропустить, выбрать другое. Темп — твой."),
    ]
    y = ly+28
    for idx, (title, desc) in enumerate(steps):
        # number circle
        is_first = idx==0
        draw.ellipse([lx+28, y, lx+28+36, y+36], fill=ACCENT if is_first else (255,255,255,255), outline=ACCENT, width=2)
        draw.text((lx+38 if idx<9 else lx+34, y+7), str(idx+1), font=fonts["b14"], fill=(255,255,255) if is_first else ACCENT)
        if idx < len(steps)-1:
            # vertical line
            draw.line([(lx+46, y+40),(lx+46, y+86)], fill=(225,232,245,255), width=2)
        draw.text((lx+80, y+6), title, font=fonts["b16"], fill=INK)
        y+=38
        y = draw_wrapped(draw, desc, fonts["r15"], lx+80, y, lw-108, 21, INK2) + 18
        y+=8
    # right side: example practice card + phone detail
    rx, ry, rw, rh = 920, 224, 860, 760
    # card for example
    base = rounded_shadow(base, [rx, ry, rx+rw, ry+rh], radius=24, color=(11,31,77,10), blur=16, offset=(0,6))
    c = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(c)
    cd.rounded_rectangle([rx, ry, rx+rw, ry+rh], radius=24, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
    base = Image.alpha_composite(base, c)
    draw = ImageDraw.Draw(base)
    # top: practice header inside right card
    # icon
    draw.rounded_rectangle([rx+24, ry+24, rx+24+420, ry+86], radius=16, fill=(255,240,232,255))
    draw.ellipse([rx+38, ry+36, rx+38+38, ry+36+38], fill=(255,255,255,255))
    draw.text((rx+48, ry+44), "♥", font=fonts["b16"], fill=(210,120,130))
    draw.text((rx+86, ry+36), "Четыре корзины заботы", font=fonts["b16"], fill=INK)
    draw.text((rx+86, ry+58), "5 шагов  •  7 мин  •  Опора, Ур. 1", font=fonts["r13"], fill=INK3)
    # steps inside card
    steps_in = [
        "Нарисуй четыре корзины: тело, чувства, люди, сенсорика.",
        "В каждую положи то, что уже делаешь: сон, музыка, человек в чате.",
        "Отметь по одной пустоте в каждой — только по одной.",
        "Выбери по одному шагу на 5–15 минут на эту неделю.",
    ]
    y = ry+106
    for i, s in enumerate(steps_in):
        draw.ellipse([rx+24, y+4, rx+24+22, y+4+22], fill=(240,243,252,255), outline=ACCENT, width=1)
        draw.text((rx+30, y+6), str(i+1), font=fonts["b13"], fill=ACCENT)
        draw.text((rx+56, y+6), s, font=fonts["r14"], fill=INK)
        y+=34
    # divider
    draw.line([(rx+24, y+8),(rx+rw-24, y+8)], fill=(225,232,245,255), width=1)
    y+=22
    # alternative mini version
    draw.rounded_rectangle([rx+24, y, rx+rw-24, y+78], radius=14, fill=(240,245,235,255), outline=(220,232,210,255), width=1)
    draw.text((rx+38, y+12), "Мини-версия: одна корзина", font=fonts["b14"], fill=(70,100,70))
    draw.text((rx+38, y+34), "Выбери одну корзину, которая сейчас громче всех звучит.", font=fonts["r14"], fill=INK2)
    draw.text((rx+38, y+54), "Один шаг на пять минут — и уже достаточно.", font=fonts["r14"], fill=INK2)
    # bottom progress
    by = ry+rh-42
    draw.rounded_rectangle([rx+24, by, rx+rw-24, by+8], radius=4, fill=(225,232,245,255))
    draw.rounded_rectangle([rx+24, by, rx+24+ (rw-48)*0.35, by+8], radius=4, fill=ACCENT)
    draw.text((rx+24, by-18), "прогресс: 35%  •  можно пропустить любой шаг", font=fonts["r13"], fill=INK3)
    # tiny mascot star near bottom?
    base = paste_mascot(base, MASCOT_STAR, rx+rw-120, ry+rh-140, 120, 120, shadow=False)
    draw = ImageDraw.Draw(base)
    draw.text((W-140, H-30), "05 — 08", font=fonts["r13"], fill=INK3)
    return base

def slide_6_inside(base):
    draw = ImageDraw.Draw(base)
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((180,70), Image.LANCZOS)
        base.alpha_composite(wm, dest=(64,32))
    except:
        pass
    draw.text((W-140,40), "06 — 08", font=fonts["r13"], fill=INK3)
    draw.text((64,110), "Что ещё внутри", font=fonts["s52"], fill=INK)
    draw.text((64,172), "Не только практики — поддержка каждый день.", font=fonts["r17"], fill=INK2)
    # 5 feature cards in grid 3+2? Let's do 5 cards: top 3, bottom 2 centered large
    features = [
        ("Дневник эмоций", "Отмечаешь эмоцию и заметку —\nвсё сохраняется в ленте. Видно\nдинамику и триггеры.", "♥", (255,240,232)),
        ("Поговорить с Дибитишкой", "Бережный чат: подсказки, мини-\nпрактики, альтернативы, когда\nне можется.", "✦", (232,234,248)),
        ("Музыка-настройка", "Живой эмбиент: 6 сцен — море,\nдождь, очаг, лес, колыбельная,\nкосмос. Собирается здесь.", "♪", (220,235,250)),
        ("Доска впечатлений", "Коллаж из фото, билетов, заметок.\nТвоё «мне было хорошо» на виду.", "◉", (242, 230, 240)),
        ("Печатная тетрадь", "Можно распечатать как книгу:\nтвоя тетрадь пахнет чаем\nи живёт на бумаге.", "📖", (240,238,225)),
    ]
    # top row 3
    x0, y0 = 64, 224
    cw, ch = 580, 300
    gap = 24
    for i in range(3):
        x = x0 + i*(cw+gap)
        y = y0
        title, desc, icon, bg = features[i]
        base = rounded_shadow(base, [x, y, x+cw, y+ch], radius=20, color=(11,31,77,10), blur=14, offset=(0,6))
        c = Image.new("RGBA", (W,H), (0,0,0,0))
        cd = ImageDraw.Draw(c)
        cd.rounded_rectangle([x, y, x+cw, y+ch], radius=20, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        base = Image.alpha_composite(base, c)
        draw = ImageDraw.Draw(base)
        draw.ellipse([x+18, y+18, x+18+46, y+18+46], fill=bg)
        draw.text((x+30, y+26), icon, font=fonts["b16"], fill=INK)
        draw.text((x+76, y+22), title, font=fonts["b18"], fill=INK)
        ty = y+72
        for line in desc.split("\n"):
            draw.text((x+18, ty), line, font=fonts["r14"], fill=INK2)
            ty+=19
    # bottom row 2 larger
    bw, bh = 880, 300
    for i in range(2):
        idx = 3+i
        x = x0 + i*(bw+gap)
        y = y0+ch+20
        title, desc, icon, bg = features[idx]
        base = rounded_shadow(base, [x, y, x+bw, y+bh], radius=20, color=(11,31,77,10), blur=14, offset=(0,6))
        c = Image.new("RGBA", (W,H), (0,0,0,0))
        cd = ImageDraw.Draw(c)
        cd.rounded_rectangle([x, y, x+bw, y+bh], radius=20, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        base = Image.alpha_composite(base, c)
        draw = ImageDraw.Draw(base)
        draw.ellipse([x+18, y+18, x+18+46, y+18+46], fill=bg)
        draw.text((x+30, y+26), icon, font=fonts["b16"], fill=INK)
        draw.text((x+76, y+22), title, font=fonts["b18"], fill=INK)
        ty = y+72
        for line in desc.split("\n"):
            draw.text((x+18, ty), line, font=fonts["r14"], fill=INK2)
            ty+=19
        # add mascot for last card (book)
        if idx==4:
            base = paste_mascot(base, MASCOT_BOOK, x+bw-170, y+bh-170, 170, 170, shadow=False)
            draw = ImageDraw.Draw(base)
    # footer note about privacy
    # pill at bottom
    note = "Всё хранится только на твоём телефоне  •  можно заниматься офлайн  •  без оценки и сравнений"
    tw,_ = text_size(draw, note, fonts["r14"])
    draw.rounded_rectangle([(W-tw)//2-14, y0+ch+bh+44, (W-tw)//2+tw+14, y0+ch+bh+72], radius=14, fill=(255,255,255,230), outline=(225,232,245,255), width=1)
    draw.text(((W-tw)//2, y0+ch+bh+50), note, font=fonts["r14"], fill=INK3)
    draw.text((W-140, H-30), "06 — 08", font=fonts["r13"], fill=INK3)
    return base

def slide_7_results(base):
    draw = ImageDraw.Draw(base)
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((180,70), Image.LANCZOS)
        base.alpha_composite(wm, dest=(64,32))
    except:
        pass
    draw.text((W-140,40), "07 — 08", font=fonts["r13"], fill=INK3)
    draw.text((64,110), "Что меняется, если практиковать", font=fonts["s46"], fill=INK)
    draw.text((64,168), "Не «станешь другим человеком», а получишь опоры, которые работают именно у тебя.", font=fonts["r17"], fill=INK2)
    results = [
        ("Пауза между\nимпульсом и действием", "Есть секунда выбрать,\nа не реагировать на автомате.", "◯", (232,234,248)),
        ("Понимаешь, что\nчувствуешь и почему", "Эмоция — письмо с сообщением,\nа не приказ.", "♥", (255,240,232)),
        ("Меньше накрывает,\nмягче восстановление", "Знаешь триггеры и как\nвернуть себя.", "≋", (220,235,250)),
        ("Забота без\nистощения", "4 корзины помогают заметить,\nкакой именно заботы не хватает.", "☀", (255,250,230)),
        ("Границы и опора\nв отношениях", "Просить и отказывать, сохраняя\nсебя и связь.", "✦", (230,245,235)),
        ("Тело — союзник", "Своё гнёздышко, сенсорный\nкомфорт и стимминг как ресурс.", "✋", (240,238,225)),
    ]
    x0, y0 = 64, 220
    cw, ch = 560, 260
    gapx, gapy = 24, 20
    for i, (title, desc, icon, bg) in enumerate(results):
        row, col = divmod(i, 3)
        x = x0 + col*(cw+gapx)
        y = y0 + row*(ch+gapy)
        base = rounded_shadow(base, [x, y, x+cw, y+ch], radius=18, color=(11,31,77,10), blur=12, offset=(0,6))
        c = Image.new("RGBA", (W,H), (0,0,0,0))
        cd = ImageDraw.Draw(c)
        cd.rounded_rectangle([x, y, x+cw, y+ch], radius=18, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
        base = Image.alpha_composite(base, c)
        draw = ImageDraw.Draw(base)
        draw.ellipse([x+18, y+18, x+18+36, y+18+36], fill=bg)
        draw.text((x+27, y+24), icon, font=fonts["b14"], fill=INK)
        ty = y+20
        for line in title.split("\n"):
            draw.text((x+66, ty), line, font=fonts["b16"], fill=INK)
            ty+=20
        ty+=8
        for line in desc.split("\n"):
            draw.text((x+18, ty), line, font=fonts["r14"], fill=INK2)
            ty+=19
        # check at bottom right?
    # disclaimer pill
    note = "✦  Это не замена терапии при кризисе. Если тяжело — пожалуйста, обратись к специалисту и близким."
    tw,_ = text_size(draw, note, fonts["r13"])
    draw.rounded_rectangle([(W-tw)//2 -16, y0+2*ch+2*gapy+28, (W-tw)//2 + tw+16, y0+2*ch+2*gapy+56], radius=14, fill=(255,255,255,230), outline=(225,232,245,255), width=1)
    draw.text(((W-tw)//2, y0+2*ch+2*gapy+34), note, font=fonts["r13"], fill=INK3)
    # mascot hug at bottom right near results? small
    base = paste_mascot(base, MASCOT_HUG, 1640, 820, 200, 200, shadow=False)
    draw = ImageDraw.Draw(base)
    draw.text((W-140, H-30), "07 — 08", font=fonts["r13"], fill=INK3)
    return base

def slide_8_start(base):
    draw = ImageDraw.Draw(base)
    try:
        wm = Image.open(WORDMARK).convert("RGBA")
        wm.thumbnail((180,70), Image.LANCZOS)
        base.alpha_composite(wm, dest=(64,32))
    except:
        pass
    draw.text((W-140,40), "08 — 08", font=fonts["r13"], fill=INK3)
    # big halo behind mascot
    # draw halo
    halo = Image.new("RGBA", (W,H), (0,0,0,0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse([W//2-360, 260, W//2+360, 700], fill=(190,210,252, 54))
    hd.ellipse([W//2-260, 300, W//2+260, 640], fill=(240,210,230, 46))
    halo = halo.filter(ImageFilter.GaussianBlur(30))
    base = Image.alpha_composite(base, halo)
    draw = ImageDraw.Draw(base)
    # title centered
    draw.text((W//2 - text_size(draw, "Маленький шаг —", fonts["s52"])[0]//2, 132), "Маленький шаг —", font=fonts["s52"], fill=INK)
    draw.text((W//2 - text_size(draw, "тоже шаг.", fonts["s52"])[0]//2, 194), "тоже шаг.", font=fonts["s52"], fill=ACCENT)
    draw.text((W//2 - text_size(draw, "Ты уже делаешь важную вещь — замечаешь себя.", fonts["r19"])[0]//2, 272), "Ты уже делаешь важную вещь — замечаешь себя.", font=fonts["r19"], fill=INK2)
    # mascot hug center
    base = paste_mascot(base, MASCOT_HUG, W//2 -200, 308, 400, 400, shadow=False)
    draw = ImageDraw.Draw(base)
    # two cards bottom
    card_w, card_h = 620, 200
    gap = 28
    lx = (W - (card_w*2+gap))//2
    by = 740
    # left white card
    base = rounded_shadow(base, [lx, by, lx+card_w, by+card_h], radius=20, color=(11,31,77,10), blur=14, offset=(0,6))
    c = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(c)
    cd.rounded_rectangle([lx, by, lx+card_w, by+card_h], radius=20, fill=(255,255,255,255), outline=(225,232,245,255), width=1)
    base = Image.alpha_composite(base, c)
    draw = ImageDraw.Draw(base)
    draw.text((lx+24, by+20), "Начни с 5 минут сегодня", font=fonts["b18"], fill=INK)
    draw.text((lx+24, by+50), "Выбери практику «Заземление", font=fonts["r16"], fill=INK2)
    draw.text((lx+24, by+74), "через чувства» или «Дыхание с", font=fonts["r16"], fill=INK2)
    draw.text((lx+24, by+98), "длинным выдохом» — этого достаточно.", font=fonts["r16"], fill=INK2)
    draw.rounded_rectangle([lx+24, by+128, lx+24+170, by+148], radius=10, fill=(240,243,252,255))
    draw.text((lx+32, by+132), "можно пропустить шаг", font=fonts["r13"], fill=INK3)
    # right blue card
    rx = lx+card_w+gap
    base = rounded_shadow(base, [rx, by, rx+card_w, by+card_h], radius=20, color=(46,112,232,22), blur=18, offset=(0,8))
    c = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(c)
    cd.rounded_rectangle([rx, by, rx+card_w, by+card_h], radius=20, fill=ACCENT, outline=(60,130,250,255), width=1)
    base = Image.alpha_composite(base, c)
    draw = ImageDraw.Draw(base)
    draw.text((rx+24, by+20), "Дибитишка рядом", font=fonts["b18"], fill=(255,255,255))
    draw.text((rx+24, by+50), "«Я тихонько похлопаю в ладошки,", font=fonts["r16"], fill=(230,240,255))
    draw.text((rx+24, by+74), "когда ты сделаешь свой шаг.»", font=fonts["r16"], fill=(230,240,255))
    # button inside blue card
    bw, bh = 300, 42
    draw.rounded_rectangle([rx+24, by+108, rx+24+bw, by+108+bh], radius=21, fill=(255,255,255,255))
    draw.text((rx+38, by+118), "✈  t.me/dbtrobot/dibitishka", font=fonts["b15"], fill=ACCENT)
    # footer
    foot = "Бережно  •  Без оценки  •  В своём темпе          По мотивам «Навыки ДБТ для нейроотличных людей»"
    tw,_ = text_size(draw, foot, fonts["r13"])
    draw.text(((W-tw)//2, H-34), foot, font=fonts["r13"], fill=INK3)
    # pagination dots bottom left
    dx, dy = 64, 1036
    for i in range(8):
        if i==7:
            draw.rounded_rectangle([dx+i*14, dy, dx+i*14+18, dy+6], radius=3, fill=(180,200,240,255))
        else:
            draw.ellipse([dx+i*14+5, dy, dx+i*14+11, dy+6], fill=(200,215,240,180))
    draw.text((W-140, H-30), "08 — 08", font=fonts["r13"], fill=INK3)
    return base

SLIDES = [
    ("01-cover", slide_1_cover),
    ("02-dbt", slide_2_dbt),
    ("03-forwhom", slide_3_forwhom),
    ("04-modules", slide_4_modules),
    ("05-practice", slide_5_practice),
    ("06-inside", slide_6_inside),
    ("07-results", slide_7_results),
    ("08-start", slide_8_start),
]

def generate_one(name, fn, transparent=False):
    base = make_background(transparent=transparent)
    base = fn(base)
    out_dir = pathlib.Path("transparent" if transparent else "slides")
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{name}.png"
    base.save(out, "PNG")
    print(f"saved {out} {base.size}")

def main():
    import os
    os.chdir(pathlib.Path(__file__).parent)
    for name, fn in SLIDES:
        print(f"-- {name}")
        generate_one(name, fn, transparent=False)
        generate_one(name, fn, transparent=True)

if __name__ == "__main__":
    main()
