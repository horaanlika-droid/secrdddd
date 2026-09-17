#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор презентации Дибитишка • ДБТ
1920x1080, стиль Air Orb ( app/css/app.css )
Делает два набора:
  - slides/      с небесным фоном и блобами
  - transparent/ с прозрачным внешним фоном (карточка остаётся)
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import pathlib, textwrap, math, os

W, H = 1920, 1080
CARD_W, CARD_H = 1540, 860
CARD_R = 36
CARD_X = (W - CARD_W)//2
CARD_Y = (H - CARD_H)//2

# colors from app.css
BG_TOP = (215,228,250) # #D7E4FA
BG_MID = (235,242,254) # #EBF2FE
BG_BOT = (248,251,255) # #F8FBFF
INK = (11,31,77)
INK2 = (90,107,140)
INK3 = (154,167,199)
ACCENT = (47,125,246)
ACCENT_A = (59,134,247)
ACCENT_B = (36,112,232)
PEONY = (243,220,211)
ROSE = (216,164,175)
SKY = (159,176,207)
LAVENDER = (185,175,203)
LEAF = (183,178,121)

# tint backgrounds
TINTS = {
    "lavender": (239,240,250),
    "leaf": (243,242,228),
    "grass": (240,241,225),
    "sky": (233,239,251),
    "peony": (251,240,234),
    "rose": (250,235,239),
}

FONT_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
FONT_SERIF_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
FONT_SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def load_font(path, size):
    return ImageFont.truetype(path, size)

# Preload fonts at various sizes
fonts = {
    "serif_56": load_font(FONT_SERIF, 56),
    "serif_48": load_font(FONT_SERIF, 48),
    "serif_44": load_font(FONT_SERIF, 44),
    "serif_38": load_font(FONT_SERIF, 38),
    "serif_32": load_font(FONT_SERIF, 32),
    "serif_28": load_font(FONT_SERIF, 28),
    "serif_24": load_font(FONT_SERIF_REG, 24),
    "sans_13": load_font(FONT_SANS, 13),
    "sans_14": load_font(FONT_SANS, 14),
    "sans_15": load_font(FONT_SANS, 15),
    "sans_16": load_font(FONT_SANS, 16),
    "sans_17": load_font(FONT_SANS, 17),
    "sans_18": load_font(FONT_SANS, 18),
    "sans_19": load_font(FONT_SANS, 19),
    "sans_20": load_font(FONT_SANS, 20),
    "sans_22": load_font(FONT_SANS, 22),
    "sans_b_13": load_font(FONT_SANS_BOLD, 13),
    "sans_b_14": load_font(FONT_SANS_BOLD, 14),
    "sans_b_15": load_font(FONT_SANS_BOLD, 15),
    "sans_b_16": load_font(FONT_SANS_BOLD, 16),
    "sans_b_17": load_font(FONT_SANS_BOLD, 17),
    "sans_b_18": load_font(FONT_SANS_BOLD, 18),
    "sans_b_20": load_font(FONT_SANS_BOLD, 20),
}

ASSETS = pathlib.Path("/home/user/secrdddd/app/assets")
MASCOT = {
    "meditate": ASSETS/"mascot/meditate.png",
    "calm": ASSETS/"mascot/calm.png",
    "hello": ASSETS/"mascot/hello.png",
    "hug": ASSETS/"mascot/hug.png",
    "cozy": ASSETS/"mascot/cozy.png",
    "star": ASSETS/"mascot/star.png",
    "proud": ASSETS/"mascot/proud.png",
    "book": ASSETS/"mascot/book.png",
    "splash3d": ASSETS/"brand/splash-mascot-3d.png",
    "wordmark": ASSETS/"brand/splash-wordmark-hq.png",
    "logo_wordmark": ASSETS/"brand/logo-wordmark.png",
}

def gradient_background():
    img = Image.new("RGB", (W,H), BG_BOT)
    draw = ImageDraw.Draw(img)
    # vertical gradient top->mid->bottom
    for y in range(H):
        t = y / H
        if t < 0.45:
            # top to mid
            k = t/0.45
            r = int(BG_TOP[0]*(1-k) + BG_MID[0]*k)
            g = int(BG_TOP[1]*(1-k) + BG_MID[1]*k)
            b = int(BG_TOP[2]*(1-k) + BG_MID[2]*k)
        else:
            k = (t-0.45)/0.55
            r = int(BG_MID[0]*(1-k) + BG_BOT[0]*k)
            g = int(BG_MID[1]*(1-k) + BG_BOT[1]*k)
            b = int(BG_MID[2]*(1-k) + BG_BOT[2]*k)
        draw.line([(0,y),(W,y)], fill=(r,g,b))
    # add soft radial blobs via overlay + blur
    overlay = Image.new("RGBA", (W,H), (0,0,0,0))
    odraw = ImageDraw.Draw(overlay)
    # blob A - top-left
    odraw.ellipse([-220, -320, 760, 620], fill=(143,167,232, 90))
    odraw.ellipse([-180, -220, 680, 540], fill=(143,167,232, 55))
    # blob B - bottom-right
    odraw.ellipse([1180, 520, 2100, 1320], fill=(216,164,175, 70))
    odraw.ellipse([1340, 660, 2000, 1180], fill=(216,164,175, 45))
    # soft light at top center
    odraw.ellipse([400, -200, 1520, 420], fill=(255,255,255, 90))
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=90))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img

def rounded_rect_mask(w,h,r):
    mask = Image.new("L", (w,h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0,0,w,h], radius=r, fill=255)
    return mask

def draw_card(base_rgba, with_shadow=True):
    """return image with card composited onto base_rgba (RGBA)"""
    # shadow
    if with_shadow:
        shadow = Image.new("RGBA", (W,H), (0,0,0,0))
        sdraw = ImageDraw.Draw(shadow)
        # larger shadow offset
        expansion = 24
        sdraw.rounded_rectangle([CARD_X-2, CARD_Y+8, CARD_X+CARD_W+2, CARD_Y+CARD_H+12], radius=CARD_R+6, fill=(11,31,77, 22))
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=28))
        base_rgba = Image.alpha_composite(base_rgba, shadow)
    # card
    card = Image.new("RGBA", (CARD_W, CARD_H), (0,0,0,0))
    cdraw = ImageDraw.Draw(card)
    # main card fill - slightly translucent white
    # use solid white with soft border
    cdraw.rounded_rectangle([0,0,CARD_W,CARD_H], radius=CARD_R, fill=(255,255,255, 210), outline=(255,255,255,180), width=2)
    # inner subtle gradient highlight at top
    # draw a soft white gradient on top 40% via overlay
    grad = Image.new("RGBA", (CARD_W, CARD_H), (0,0,0,0))
    gdraw = ImageDraw.Draw(grad)
    for y in range(int(CARD_H*0.55)):
        alpha = int(18 * (1 - y/(CARD_H*0.55))**1.2)
        gdraw.line([(0,y),(CARD_W,y)], fill=(255,255,255, alpha))
    grad_mask = rounded_rect_mask(CARD_W, CARD_H, CARD_R)
    grad.putalpha(grad_mask)
    # but need to clip grad to card shape — composite with mask
    # simple: paste grad onto card using alpha
    card = Image.alpha_composite(card, grad)
    # subtle inner line
    # paste card onto base
    base_rgba.alpha_composite(card, dest=(CARD_X, CARD_Y))
    return base_rgba

def draw_halo(base, center_x, center_y, rx=280, ry=180, color_a=(190,210,252), color_b=(226,190,228)):
    """draw soft halo under mascot inside card, not outer"""
    halo = Image.new("RGBA", (W,H), (0,0,0,0))
    hdraw = ImageDraw.Draw(halo)
    # two concentric ellipses
    hdraw.ellipse([center_x-rx, center_y-ry, center_x+rx, center_y+ry], fill=(*color_a, 70))
    hdraw.ellipse([center_x-rx+40, center_y-ry+30, center_x+rx-40, center_y+ry-10], fill=(*color_b, 45))
    halo = halo.filter(ImageFilter.GaussianBlur(radius=22))
    base = Image.alpha_composite(base, halo)
    return base

def paste_mascot(base, path, box, anchor="center"):
    """box = (x,y,w,h) fit image inside preserving aspect, centered"""
    if not path.exists():
        print(f"missing {path}")
        return base
    im = Image.open(path).convert("RGBA")
    x,y,w,h = box
    # preserve aspect, fit
    im.thumbnail((w,h), Image.LANCZOS)
    iw, ih = im.size
    if anchor == "center":
        px = x + (w - iw)//2
        py = y + (h - ih)//2
    elif anchor == "bottom":
        px = x + (w - iw)//2
        py = y + h - ih
    else:
        px, py = x, y
    # subtle drop shadow for mascot
    shadow = Image.new("RGBA", (W,H), (0,0,0,0))
    # can't easily shadow with PIL, just paste
    base.alpha_composite(im, dest=(px,py))
    return base, (px,py,iw,ih)

def text_size(draw, text, font):
    bbox = draw.textbbox((0,0), text, font=font)
    return bbox[2]-bbox[0], bbox[3]-bbox[1]

def wrap(text, font, max_w, draw):
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        test = cur + (" " if cur else "") + w
        tw,_ = text_size(draw, test, font)
        if tw <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            # handle long word
            cur = w
            # if single word too long, force split
            tw,_ = text_size(draw, cur, font)
            if tw > max_w:
                # crude char split
                tmp=""
                for ch in w:
                    if text_size(draw, tmp+ch, font)[0] <= max_w:
                        tmp+=ch
                    else:
                        lines.append(tmp)
                        tmp=ch
                cur=tmp
    if cur:
        lines.append(cur)
    return lines

def draw_wrapped(draw, text, font, x, y, max_w, line_h, fill, align="left"):
    lines = wrap(text, font, max_w, draw)
    for line in lines:
        if align == "center":
            tw,_ = text_size(draw, line, font)
            draw.text((x + (max_w - tw)//2, y), line, font=font, fill=fill)
        elif align == "right":
            tw,_ = text_size(draw, line, font)
            draw.text((x + max_w - tw, y), line, font=font, fill=fill)
        else:
            draw.text((x, y), line, font=font, fill=fill)
        y += line_h
    return y

# helpers for icons
def icon_circle(draw, cx, cy, r, bg, fg, letter=None, icon_text=None):
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=bg)
    # inner highlight
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255,255,255,70), width=1)
    if icon_text:
        font = fonts["sans_b_16"] if r>=26 else fonts["sans_b_14"]
        tw,th = text_size(draw, icon_text, font)
        draw.text((cx-tw//2, cy-th//2 -1), icon_text, font=font, fill=fg)

def pill(draw, x,y,w,h, text, font, bg=(228,237,253), fg=INK, border=None):
    draw.rounded_rectangle([x,y,x+w,y+h], radius=h//2, fill=bg, outline=border if border else bg)
    tw,th = text_size(draw, text, font)
    draw.text((x+(w-tw)//2, y+(h-th)//2 -1), text, font=font, fill=fg)


# ------------------------------------------------------------------
# Slide definitions
# ------------------------------------------------------------------

def slide_1(bg_rgba):
    # Cover: large centered, wordmark + mascot
    draw = ImageDraw.Draw(bg_rgba)
    # halo under mascot
    base = draw_halo(bg_rgba, W//2, CARD_Y+ 380, rx=360, ry=200)
    draw = ImageDraw.Draw(base)
    # top eyebrow
    eyebrow = "ДИБИТИШКА  •  НАВЫКИ ДБТ"
    tw,_ = text_size(draw, eyebrow, fonts["sans_b_13"])
    draw.text(((W-tw)//2, CARD_Y+42), eyebrow, font=fonts["sans_b_13"], fill=INK3)
    # wordmark small? we already have mascot, but add title
    title = "Что такое ДБТ"
    subtitle = "простыми словами"
    # use serif for title
    # Title line 1
    draw.text(((W - text_size(draw, title, fonts["serif_56"])[0])//2, CARD_Y+78), title, font=fonts["serif_56"], fill=INK)
    draw.text(((W - text_size(draw, subtitle, fonts["serif_38"])[0])//2, CARD_Y+142), subtitle, font=fonts["serif_38"], fill=INK2)

    # description under title
    desc = "Навыки, которые помогают жить\nс большими чувствами — бережно и по шагам."
    y = CARD_Y+210
    y = draw_wrapped(draw, desc, fonts["sans_18"], W//2 - 320, y, 640, 28, INK2, align="center")

    # mascot central
    base, _ = paste_mascot(base, MASCOT["splash3d"], (W//2 - 220, CARD_Y+300, 440, 440))

    # bottom pill
    pill_y = CARD_Y+CARD_H - 92
    pill_text = "для нейроотличных  •  для чувствительных  •  для каждого, кому бывает трудно"
    # draw pill centered
    pw = text_size(draw, pill_text, fonts["sans_14"])[0] + 48
    px = (W - pw)//2
    pill(draw, px, pill_y, pw, 36, pill_text, fonts["sans_14"], bg=(255,255,255,230), fg=INK2, border=(11,31,77,14))

    # tiny bottom tag
    tag = "5–15 минут в день  •  маленькими шагами"
    tw,_ = text_size(draw, tag, fonts["sans_13"])
    draw.text(((W-tw)//2, pill_y+46), tag, font=fonts["sans_13"], fill=INK3)

    # slide number
    draw.text((CARD_X+28, CARD_Y+CARD_H-28), "01 — 08", font=fonts["sans_13"], fill=INK3)
    draw.text((W - CARD_X - 110, CARD_Y+CARD_H-28), "дибитишка", font=fonts["sans_b_13"], fill=INK3)
    return base

def slide_2(bg_rgba):
    draw = ImageDraw.Draw(bg_rgba)
    bg_rgba = draw_halo(bg_rgba, CARD_X+ 1120, CARD_Y+420, rx=300, ry=220)
    draw = ImageDraw.Draw(bg_rgba)

    # header
    draw.text((CARD_X+42, CARD_Y+36), "01  •  ЧТО ЭТО", font=fonts["sans_b_13"], fill=INK3)
    draw.text((W-CARD_X-120, CARD_Y+36), "02 — 08", font=fonts["sans_13"], fill=INK3)

    # title
    draw.text((CARD_X+42, CARD_Y+68), "Что такое ДБТ?", font=fonts["serif_48"], fill=INK)
    # blue underline accent
    draw.rounded_rectangle([CARD_X+42, CARD_Y+126, CARD_X+138, CARD_Y+132], radius=3, fill=ACCENT)

    # left text
    left_x = CARD_X+42
    max_w = 820
    y = CARD_Y+158
    # definition card
    # first paragraph bold
    para1 = "ДБТ — диалектико-поведенческая терапия."
    draw.text((left_x, y), para1, font=fonts["sans_b_18"], fill=INK)
    y+=30
    para1b = "Её создала психолог Марша Линехан для людей с очень высокой эмоциональной чувствительностью."
    y = draw_wrapped(draw, para1b, fonts["sans_17"], left_x, y, max_w, 26, INK2) + 18

    # bullet list with soft dots
    bullets = [
        ("Научно-подтверждённый метод", "помогает, когда эмоции накрывают, а «просто успокойся» не работает."),
        ("Учит не подавлять чувства", "а замечать их, понимать и выбирать, что делать дальше."),
        ("Сейчас помогает всем", "кому трудно с перепадами настроения, импульсами, отношениями и самокритикой."),
    ]
    for title, desc in bullets:
        # dot
        draw.ellipse([left_x, y+6, left_x+10, y+16], fill=ACCENT)
        # title
        draw.text((left_x+20, y), title, font=fonts["sans_b_16"], fill=INK)
        tw,_ = text_size(draw, title, fonts["sans_b_16"])
        # desc next line
        y+=24
        y = draw_wrapped(draw, desc, fonts["sans_15"], left_x+20, y, max_w-20, 22, INK2) + 14

    # right mascot
    bg_rgba, _ = paste_mascot(bg_rgba, MASCOT["calm"], (CARD_X+920, CARD_Y+110, 560, 560))
    # caption under mascot
    # small card under mascot with quote
    card_x = CARD_X+980
    card_y = CARD_Y+640
    card_w, card_h = 500, 110
    # subtle card
    overlay = Image.new("RGBA", (W,H), (0,0,0,0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([card_x, card_y, card_x+card_w, card_y+card_h], radius=18, fill=(255,255,255, 235), outline=(11,31,77,10))
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=0))
    bg_rgba = Image.alpha_composite(bg_rgba, overlay)
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((card_x+18, card_y+18), "«Бол ьшие чувства — не поломка.", font=fonts["sans_15"], fill=INK)
    draw.text((card_x+18, card_y+40), "Это особенность, с которой можно", font=fonts["sans_15"], fill=INK)
    draw.text((card_x+18, card_y+62), "научиться жить мягче.»", font=fonts["sans_15"], fill=INK2)

    return bg_rgba

def slide_3(bg_rgba):
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((CARD_X+42, CARD_Y+36), "02  •  СЕРДЦЕ МЕТОДА", font=fonts["sans_b_13"], fill=INK3)
    draw.text((W-CARD_X-120, CARD_Y+36), "03 — 08", font=fonts["sans_13"], fill=INK3)

    draw.text((CARD_X+42, CARD_Y+68), "Почему «диа-лектическая»?", font=fonts["serif_48"], fill=INK)
    draw.rounded_rectangle([CARD_X+42, CARD_Y+126, CARD_X+138, CARD_Y+132], radius=3, fill=ACCENT)
    subtitle = "Диалектика — две противоположности могут быть правдой одновременно."
    y = draw_wrapped(draw, subtitle, fonts["sans_17"], CARD_X+42, CARD_Y+150, 900, 26, INK2) + 10

    # two cards + central И
    card_w, card_h = 620, 520
    gap = 60
    left_x = CARD_X + (CARD_W - (card_w*2+gap))//2
    left_y = CARD_Y+220
    right_x = left_x + card_w + gap

    # left card - Принятие
    for idx, (cx, title, bullets, tint, accent) in enumerate([
        (left_x, "Принятие", ["я такой, какой есть", "мои чувства имеют право быть", "я делаю всё, что могу сейчас"], TINTS["peony"], (243,220,211)),
        (right_x, "Изменение", ["я могу научиться по-другому", "маленький шаг всё равно шаг", "поведение можно выбрать"], TINTS["sky"], (233,239,251)),
    ]):
        # card bg
        overlay = Image.new("RGBA", (W,H), (0,0,0,0))
        od = ImageDraw.Draw(overlay)
        od.rounded_rectangle([cx, left_y, cx+card_w, left_y+card_h], radius=24, fill=(*tint, 255), outline=(11,31,77,10))
        bg_rgba = Image.alpha_composite(bg_rgba, overlay)
        draw = ImageDraw.Draw(bg_rgba)
        # top accent line
        draw.rounded_rectangle([cx+22, left_y+22, cx+68, left_y+28], radius=3, fill=accent if idx==0 else ACCENT)
        # icon
        icon_circle(draw, cx+46, left_y+68, 22, (255,255,255,255) if idx==1 else (255,255,255,255), INK, icon_text="♡" if idx==0 else "↗")
        draw.text((cx+76, left_y+56), title, font=fonts["serif_28"], fill=INK)
        by = left_y+108
        for b in bullets:
            draw.ellipse([cx+28, by+8, cx+38, by+18], fill=ACCENT if idx==1 else (208,164,175))
            draw.text((cx+48, by), b, font=fonts["sans_16"], fill=INK2)
            by+=36
        # bottom note
        draw.text((cx+28, left_y+card_h-46), "и это правда" if idx==0 else "и это тоже правда", font=fonts["sans_13"], fill=INK3)

    # central И
    cx = W//2
    cy = left_y + card_h//2
    # vertical line
    draw = ImageDraw.Draw(bg_rgba)
    # circle with И
    draw.ellipse([cx-34, cy-34, cx+34, cy+34], fill=(47,125,246), outline=(255,255,255,220), width=3)
    draw.text((cx-10, cy-14), "И", font=fonts["serif_28"], fill=(255,255,255))
    # bottom caption
    cap = "Баланс: принимаем момент и одновременно меняем то, что можем изменить."
    tw,_ = text_size(draw, cap, fonts["sans_16"])
    draw.text(((W-tw)//2, left_y+card_h+36), cap, font=fonts["sans_16"], fill=INK2)
    # small pill bottom
    pill_y = left_y+card_h+72
    pill_text = "Ты не обязан выбирать между «я ок» и «мне нужна помощь» — можно и то, и другое."
    pw = text_size(draw, pill_text, fonts["sans_14"])[0]+40
    pill(draw, (W-pw)//2, pill_y, pw, 32, pill_text, fonts["sans_14"], bg=(255,255,255,230), fg=INK2)

    return bg_rgba

def slide_4(bg_rgba):
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((CARD_X+42, CARD_Y+36), "03  •  ПЯТЬ ОПОР", font=fonts["sans_b_13"], fill=INK3)
    draw.text((W-CARD_X-120, CARD_Y+36), "04 — 08", font=fonts["sans_13"], fill=INK3)
    draw.text((CARD_X+42, CARD_Y+68), "Пять модулей навыков", font=fonts["serif_44"], fill=INK)
    # subtitle
    draw.text((CARD_X+42, CARD_Y+118), "В Дибитишке — адаптация для нейроотличных, бережно и по шагам.", font=fonts["sans_16"], fill=INK2)

    # grid 5 cards: 3 top, 2 bottom centered? let's do 5 in a row or 3+2
    # We'll create 5 cards in one row with wrapping: top 3, bottom 2 centered
    modules = [
        ("Опора", "забота и\nподдержка", "4 корзины, карта\nподдержки, кризис-план", TINTS["peony"], "♥"),
        ("Осознанность", "замечать\nнастоящее", "заземление, дыхание,\nякоря, благодарность", TINTS["lavender"], "◉"),
        ("Стрессо-\nустойчивость", "пережить\nнакрывает", "холод, прожимка,\nаптечка, восстановление", TINTS["sky"], "≋"),
        ("Эмоции", "понимать и\nрегулировать", "письмо эмоции,\nпроверка фактов, выбор", TINTS["leaf"], "✦"),
        ("Сенсорика", "тело и\nвосприятие", "профиль, гнёзда,\nстимминг как ресурс", TINTS["grass"], "✋"),
    ]
    card_w, card_h = 268, 520
    gap = 20
    # top row 3? actually 5 cards fit: 5*268 +4*20=1420 fits in 1540 with 60 margin
    start_x = CARD_X + (CARD_W - (5*card_w+4*gap))//2
    y0 = CARD_Y+168
    for i, (title, subtitle, desc, tint, icon) in enumerate(modules):
        cx = start_x + i*(card_w+gap)
        overlay = Image.new("RGBA", (W,H), (0,0,0,0))
        od = ImageDraw.Draw(overlay)
        od.rounded_rectangle([cx, y0, cx+card_w, y0+card_h], radius=22, fill=(*tint,255), outline=(11,31,77,7))
        bg_rgba = Image.alpha_composite(bg_rgba, overlay)
        draw = ImageDraw.Draw(bg_rgba)
        # icon circle
        # choose bg for icon
        icon_bg = (255,255,255,255)
        # draw subtle shadow circle
        draw.ellipse([cx+20, y0+20, cx+20+52, y0+20+52], fill=(11,31,77,8))
        icon_circle(draw, cx+46, y0+46, 26, icon_bg, INK, icon_text=icon)
        # title - handle multiline
        # title may contain \n
        title_lines = title.split("\n")
        ty = y0+88
        for line in title_lines:
            draw.text((cx+20, ty), line, font=fonts["sans_b_17"], fill=INK)
            ty+=22
        # subtitle
        sub_lines = subtitle.split("\n")
        ty+=6
        for line in sub_lines:
            draw.text((cx+20, ty), line, font=fonts["sans_14"], fill=INK2)
            ty+=18
        # divider
        draw.line([(cx+20, ty+6),(cx+card_w-20, ty+6)], fill=(11,31,77,12), width=1)
        ty+=18
        # desc
        for line in desc.split("\n"):
            draw.text((cx+20, ty), line, font=fonts["sans_13"], fill=INK2)
            ty+=18
        # bottom progress like XP bar
        bar_y = y0+card_h-28
        draw.rounded_rectangle([cx+20, bar_y, cx+card_w-20, bar_y+8], radius=4, fill=(11,31,77,10))
        # fill portion varied
        fill_w = int((card_w-40)* (0.4 + i*0.12))
        draw.rounded_rectangle([cx+20, bar_y, cx+20+fill_w, bar_y+8], radius=4, fill=ACCENT if i%2==0 else (216,164,175))

    # footer note
    draw.text((CARD_X+42, CARD_Y+CARD_H-34), "Каждый модуль — маленькие практики по 5–15 минут, можно идти в своём темпе.", font=fonts["sans_13"], fill=INK3)
    return bg_rgba

def slide_5(bg_rgba):
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((CARD_X+42, CARD_Y+36), "04  •  КАК ЭТО РАБОТАЕТ", font=fonts["sans_b_13"], fill=INK3)
    draw.text((W-CARD_X-120, CARD_Y+36), "05 — 08", font=fonts["sans_13"], fill=INK3)
    draw.text((CARD_X+42, CARD_Y+68), "Как это выглядит на практике", font=fonts["serif_44"], fill=INK)
    draw.rounded_rectangle([CARD_X+42, CARD_Y+120, CARD_X+138, CARD_Y+126], radius=3, fill=ACCENT)

    # left: steps vertical timeline
    steps = [
        ("Выбираешь навык", "Опора, Осознанность, Эмоции… — что ближе сегодня. 5 уровней, от простого к глубокому."),
        ("Делаешь маленькую практику", "Пошаговая инструкция на 5–15 минут. Не получается — есть мини-версия на 1–2 минуты."),
        ("Замечаешь и записываешь", "Отмечаешь эмоцию, ставишь галочку, пишешь заметку. Всё попадает в дневник."),
        ("Возвращаешься, когда готов", "Нет «опоздал» и «не успел». Темп твой. Дибитишка рядом и не торопит."),
    ]
    lx = CARD_X+42
    max_w = 740
    y = CARD_Y+150
    for idx, (title, desc) in enumerate(steps):
        # number circle
        draw.ellipse([lx, y, lx+36, y+36], fill=ACCENT if idx==0 else (255,255,255,255), outline=(47,125,246, 60) if idx!=0 else (47,125,246), width=2)
        draw.text((lx+11 if idx<9 else lx+7, y+7), str(idx+1), font=fonts["sans_b_15"], fill=(255,255,255) if idx==0 else ACCENT)
        # line down
        if idx < len(steps)-1:
            draw.line([(lx+18, y+40),(lx+18, y+88)], fill=(11,31,77,12), width=2)
        draw.text((lx+52, y+4), title, font=fonts["sans_b_16"], fill=INK)
        y+=32
        # wrap desc
        y = draw_wrapped(draw, desc, fonts["sans_14"], lx+52, y, max_w-52, 20, INK2) + 16
        # adjust y for next iteration (overlap with line)
        # y already advanced; but we need to align circles; set next circle y = current y - 6
        # store? We'll keep y as is, but ensure spacing
        if idx < len(steps)-1:
            # Move next circle to y - 4
            # Actually y is already after desc; we want next circle at y + 8?
            y += 6

    # right side: phone mock or mascot + features
    # big feature card on right
    rx = CARD_X+880
    rw, rh = 620, 640
    y0 = CARD_Y+150
    overlay = Image.new("RGBA", (W,H), (0,0,0,0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([rx, y0, rx+rw, y0+rh], radius=24, fill=(255,255,255,240), outline=(11,31,77,8))
    bg_rgba = Image.alpha_composite(bg_rgba, overlay)
    draw = ImageDraw.Draw(bg_rgba)
    # inside right card content
    # mascot hello at top
    bg_rgba, _ = paste_mascot(bg_rgba, MASCOT["hello"], (rx+ rw//2 - 90, y0+18, 180, 180))
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((rx+24, y0+210), "Внутри тебя ждёт:", font=fonts["sans_b_14"], fill=INK3)
    features = [
        ("◷", "Практики с таймером и паузой"),
        ("☺", "Альтернатива, если нет сил"),
        ("♡", "Дневник эмоций и заметок"),
        ("◍", "Карта поддержки и гнездо"),
        ("♪", "Музыка-настройка и дыхание"),
    ]
    fy = y0+240
    for icon, txt in features:
        draw.rounded_rectangle([rx+24, fy, rx+rw-24, fy+58], radius=14, fill=(244,247,254, 255))
        draw.ellipse([rx+32, fy+14, rx+32+30, fy+14+30], fill=(47,125,246, 14))
        draw.text((rx+37, fy+18), icon, font=fonts["sans_b_14"], fill=ACCENT)
        draw.text((rx+70, fy+18), txt, font=fonts["sans_16"], fill=INK)
        fy+=68

    # bottom hint
    draw.text((CARD_X+42, CARD_Y+CARD_H-32), "Можно заниматься офлайн, возвращаться к любимым практикам и собирать свою копилку навыков.", font=fonts["sans_13"], fill=INK3)
    return bg_rgba

def slide_6(bg_rgba):
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((CARD_X+42, CARD_Y+36), "05  •  ПРИНЦИПЫ", font=fonts["sans_b_13"], fill=INK3)
    draw.text((W-CARD_X-120, CARD_Y+36), "06 — 08", font=fonts["sans_13"], fill=INK3)
    draw.text((CARD_X+42, CARD_Y+68), "Как мы учимся — бережно", font=fonts["serif_44"], fill=INK)
    draw.rounded_rectangle([CARD_X+42, CARD_Y+120, CARD_X+138, CARD_Y+126], radius=3, fill=ACCENT)

    # large quote bubble + mascot cozy?
    # left mascot
    bg_rgba = draw_halo(bg_rgba, CARD_X+280, CARD_Y+460, rx=240, ry=180)
    bg_rgba, _ = paste_mascot(bg_rgba, MASCOT["cozy"], (CARD_X+80, CARD_Y+200, 380, 380))
    draw = ImageDraw.Draw(bg_rgba)
    # speech bubble to right of mascot
    bx, by, bw, bh = CARD_X+460, CARD_Y+250, 460, 140
    overlay = Image.new("RGBA", (W,H), (0,0,0,0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([bx, by, bx+bw, by+bh], radius=20, fill=(255,255,255,240), outline=(11,31,77,8))
    # tail
    od.polygon([(bx+30, by+bh-6),(bx+18, by+bh+18),(bx+52, by+bh-6)], fill=(255,255,255,240), outline=(11,31,77,8))
    bg_rgba = Image.alpha_composite(bg_rgba, overlay)
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((bx+22, by+22), "Не можется — значит,", font=fonts["sans_16"], fill=INK)
    draw.text((bx+22, by+46), "не можется. Есть путь", font=fonts["sans_b_16"], fill=INK)
    draw.text((bx+22, by+72), "помягче. Я подстроюсь.", font=fonts["sans_16"], fill=INK2)
    draw.text((bx+22, by+102), "— Дибитишка", font=fonts["sans_13"], fill=INK3)

    # right side principles as pills
    principles = [
        ("Маленький шаг — тоже шаг", "Не нужно идеально. Нужно достаточно."),
        ("Без стыда и «соберись»", "Объясняем через тело и опыт, а не через вину."),
        ("Практика, а не лекция", "Делаем, замечаем, выбираем — по чуть-чуть каждый день."),
        ("Ты выбираешь темп", "Хочешь — идёшь дальше, хочешь — остаёшься и повторяешь."),
    ]
    px = CARD_X+960
    py = CARD_Y+170
    pw, ph = 540, 128
    for title, desc in principles:
        overlay = Image.new("RGBA", (W,H), (0,0,0,0))
        od = ImageDraw.Draw(overlay)
        od.rounded_rectangle([px, py, px+pw, py+ph], radius=18, fill=(255,255,255,240), outline=(11,31,77,8))
        bg_rgba = Image.alpha_composite(bg_rgba, overlay)
        draw = ImageDraw.Draw(bg_rgba)
        # check icon
        draw.ellipse([px+18, py+18, px+18+28, py+18+28], fill=(47,125,246, 14))
        draw.text((px+25, py+20), "✓", font=fonts["sans_b_14"], fill=ACCENT)
        draw.text((px+52, py+20), title, font=fonts["sans_b_16"], fill=INK)
        # desc
        draw_wrapped(draw, desc, fonts["sans_14"], px+52, py+46, pw-70, 20, INK2)
        py+= ph+16

    draw.text((CARD_X+42, CARD_Y+CARD_H-32), "Если сегодня мало сил — это не откат. Это информация. Берём мини-версию и хвалим себя за неё.", font=fonts["sans_13"], fill=INK3)
    return bg_rgba

def slide_7(bg_rgba):
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((CARD_X+42, CARD_Y+36), "06  •  РЕЗУЛЬТАТЫ", font=fonts["sans_b_13"], fill=INK3)
    draw.text((W-CARD_X-120, CARD_Y+36), "07 — 08", font=fonts["sans_13"], fill=INK3)
    draw.text((CARD_X+42, CARD_Y+68), "Что меняется, если практиковать", font=fonts["serif_44"], fill=INK)
    draw.text((CARD_X+42, CARD_Y+118), "Не «станешь другим человеком», а получишь опоры, которые работают именно у тебя.", font=fonts["sans_16"], fill=INK2)

    # grid 3x2 =6 results
    results = [
        ("Пауза между\nимпульсом и действием", "Есть секунда выбрать, а не\nреагировать на автомате.", "◯"),
        ("Понимаешь, что\nчувствуешь и почему", "Эмоция — письмо с сообщением,\nа не приказ к действию.", "♡"),
        ("Меньше накрывает,\nмягче восстановление", "Знаешь триггеры, сигнал «стоп»\nи как вернуть себя.", "≋"),
        ("Забота без\nистощения", "4 корзины помогают заметить,\nкакой именно заботы не хватает.", "☀"),
        ("Границы и опора\nв отношениях", "Просить, отказывать, сохраняя\nсебя и связь, становится легче.", "✦"),
        ("Тело — союзник,\nа не враг", "Сенсорный комфорт, своё гнездо\nи стимминг как ресурс.", "✋"),
    ]
    card_w, card_h = 480, 260
    gap_x, gap_y = 20, 20
    start_x = CARD_X+42
    start_y = CARD_Y+162
    for i, (title, desc, icon) in enumerate(results):
        row = i // 3
        col = i % 3
        cx = start_x + col*(card_w+gap_x)
        cy = start_y + row*(card_h+gap_y)
        tint = [TINTS["sky"], TINTS["peony"], TINTS["lavender"], TINTS["leaf"], TINTS["rose"], TINTS["grass"]][i]
        overlay = Image.new("RGBA", (W,H), (0,0,0,0))
        od = ImageDraw.Draw(overlay)
        od.rounded_rectangle([cx, cy, cx+card_w, cy+card_h], radius=20, fill=(*tint,255), outline=(11,31,77,7))
        bg_rgba = Image.alpha_composite(bg_rgba, overlay)
        draw = ImageDraw.Draw(bg_rgba)
        icon_circle(draw, cx+30, cy+30, 18, (255,255,255,255), INK, icon_text=icon)
        # title
        ty = cy+22
        for line in title.split("\n"):
            draw.text((cx+60, ty), line, font=fonts["sans_b_16"], fill=INK)
            ty+=20
        # desc
        ty+=8
        for line in desc.split("\n"):
            draw.text((cx+22, ty), line, font=fonts["sans_14"], fill=INK2)
            ty+=18

    # bottom disclaimer pills
    draw = ImageDraw.Draw(bg_rgba)
    # bottom card highlight
    note_y = CARD_Y+CARD_H-56
    # pill
    note = "✦  Это не замена терапии при кризисе. Если тяжело — пожалуйста, обратись к специалисту и близким."
    tw,_ = text_size(draw, note, fonts["sans_13"])
    # background pill
    pill(draw, (W-tw-56)//2, note_y, tw+40, 30, note, fonts["sans_13"], bg=(255,255,255, 230), fg=INK3, border=(11,31,77,10))
    return bg_rgba

def slide_8(bg_rgba):
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((CARD_X+42, CARD_Y+36), "07  •  НАЧНИ СЕГОДНЯ", font=fonts["sans_b_13"], fill=INK3)
    draw.text((W-CARD_X-120, CARD_Y+36), "08 — 08", font=fonts["sans_13"], fill=INK3)

    # halo big
    bg_rgba = draw_halo(bg_rgba, W//2, CARD_Y+380, rx=420, ry=240, color_a=(190,210,252), color_b=(240,210,230))
    draw = ImageDraw.Draw(bg_rgba)

    # title large centered
    title = "Маленький шаг —"
    title2 = "тоже шаг."
    draw.text(((W - text_size(draw, title, fonts["serif_56"])[0])//2, CARD_Y+86), title, font=fonts["serif_56"], fill=INK)
    draw.text(((W - text_size(draw, title2, fonts["serif_56"])[0])//2, CARD_Y+146), title2, font=fonts["serif_56"], fill=ACCENT)

    desc = "Ты уже делаешь важную вещь — замечаешь себя."
    tw,_ = text_size(draw, desc, fonts["sans_18"])
    draw.text(((W-tw)//2, CARD_Y+224), desc, font=fonts["sans_18"], fill=INK2)

    # mascot hug central
    bg_rgba, _ = paste_mascot(bg_rgba, MASCOT["hug"], (W//2 - 200, CARD_Y+270, 400, 400))
    draw = ImageDraw.Draw(bg_rgba)

    # bottom two cards side by side
    card_w, card_h = 620, 150
    gap=30
    left_x = (W - (card_w*2+gap))//2
    by = CARD_Y+680

    # left card - Начни с 5 минут
    overlay = Image.new("RGBA", (W,H), (0,0,0,0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([left_x, by, left_x+card_w, by+card_h], radius=20, fill=(255,255,255,240), outline=(11,31,77,8))
    bg_rgba = Image.alpha_composite(bg_rgba, overlay)
    draw = ImageDraw.Draw(bg_rgba)
    draw.text((left_x+24, by+20), "Начни с 5 минут сегодня", font=fonts["sans_b_17"], fill=INK)
    draw.text((left_x+24, by+48), "Выбери практику «Заземление", font=fonts["sans_15"], fill=INK2)
    draw.text((left_x+24, by+70), "через чувства» или «Дыхание с", font=fonts["sans_15"], fill=INK2)
    draw.text((left_x+24, by+92), "длинным выдохом» — этого достаточно.", font=fonts["sans_15"], fill=INK2)

    # right card - Дибитишка рядом
    rx = left_x+card_w+gap
    overlay = Image.new("RGBA", (W,H), (0,0,0,0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([rx, by, rx+card_w, by+card_h], radius=20, fill=(47,125,246, 255))
    bg_rgba = Image.alpha_composite(bg_rgba, overlay)
    draw = ImageDraw.Draw(bg_rgba)
    # white text
    draw.text((rx+24, by+20), "Дибитишка рядом", font=fonts["sans_b_17"], fill=(255,255,255))
    draw.text((rx+24, by+48), "«Я тихонько похлопаю", font=fonts["sans_15"], fill=(255,255,255, 230))
    draw.text((rx+24, by+70), "в ладошки, когда ты", font=fonts["sans_15"], fill=(255,255,255, 230))
    draw.text((rx+24, by+92), "сделаешь свой шаг.»", font=fonts["sans_15"], fill=(255,255,255, 230))

    # tiny footer
    foot = "Бережно • Без оценки • В своём темпе     •     По мотивам «Навыки ДБТ для нейроотличных людей»"
    tw,_ = text_size(draw, foot, fonts["sans_13"])
    draw.text(((W-tw)//2, CARD_Y+CARD_H-28), foot, font=fonts["sans_13"], fill=INK3)
    return bg_rgba

# ------------------------------------------------------------------
SLIDES = [
    ("01-cover", slide_1, "Титульный — что такое ДБТ простыми словами"),
    ("02-what", slide_2, "Что такое ДБТ"),
    ("03-dialectic", slide_3, "Диалектика — принятие и изменение"),
    ("04-modules", slide_4, "Пять модулей"),
    ("05-how", slide_5, "Как это работает"),
    ("06-principles", slide_6, "Принципы бережности"),
    ("07-results", slide_7, "Результаты"),
    ("08-start", slide_8, "Финал — маленький шаг"),
]

def generate_one(name, fn, transparent=False):
    if transparent:
        base = Image.new("RGBA", (W,H), (0,0,0,0))
        base = draw_card(base, with_shadow=True)
        base = fn(base)
        out = pathlib.Path(f"transparent/{name}.png")
    else:
        bg = gradient_background().convert("RGBA")
        base = draw_card(bg, with_shadow=True)
        base = fn(base)
        out = pathlib.Path(f"slides/{name}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    # ensure high quality
    base.save(out, "PNG", optimize=False)
    print(f"saved {out}  {base.size}")

def main():
    os.chdir(pathlib.Path(__file__).parent)
    for name, fn, desc in SLIDES:
        print(f"-- {name}: {desc}")
        generate_one(name, fn, transparent=False)
        generate_one(name, fn, transparent=True)

if __name__ == "__main__":
    main()
