from PIL import Image, ImageDraw, ImageFont
import math, os

W, H = 1600, 1200
canvas = Image.new('RGBA', (W, H), 'white')
d = ImageDraw.Draw(canvas)

CHROME  = (122, 150, 232)
CHROME2 = (100, 130, 220)
PANEL   = (237, 243, 254)
INK     = (10, 10, 12)
F = lambda w, s: ImageFont.truetype(f'/tmp/ttf/Inter-{w}.ttf', s)

# ---------- окно: вплотную к верху и бокам, без теней ----------
wx0, wy0, wx1 = 0, 0, W
bar_h = 112
gap = 12
# панель со скринами
cx0, cy0, cx1 = gap, bar_h, W - gap
shots = []
for r in ('', '-skills', '-chat', '-workbook', '-profile'):
    shots.append(Image.open(f'/tmp/home{r}.png').convert('RGBA'))
n = len(shots)
inner_gap = 10
sw = (cx1 - cx0 - inner_gap * (n - 1)) // n
ph = int(shots[0].height * sw / shots[0].width)
cy1 = cy0 + ph
wy1 = cy1 + gap

d.rectangle((wx0, wy0, wx1, wy1), fill=CHROME)
d.rounded_rectangle((cx0, cy0, cx1, cy1), 18, fill=PANEL)
x = cx0
for s in shots:
    s = s.resize((sw, ph), Image.LANCZOS)
    m = Image.new('L', s.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, sw - 1, ph - 1), 16, fill=255)
    canvas.paste(s, (x, cy0), m)
    x += sw + inner_gap
d = ImageDraw.Draw(canvas)

# лампочки
for i, c in enumerate([(255, 118, 128), (255, 200, 92), (118, 214, 140)]):
    xx = 30 + i * 32
    d.ellipse((xx, 22, xx + 18, 40), fill=c)
# вкладка
tab = (150, 10, 560, 58)
d.rounded_rectangle(tab, 15, fill=PANEL)
icon = Image.open('/home/user/secrdddd/app/assets/mascot/icon.png').convert('RGBA').resize((32, 32), Image.LANCZOS)
canvas.alpha_composite(icon, (tab[0] + 14, tab[1] + 8))
d = ImageDraw.Draw(canvas)
d.text((tab[0] + 56, tab[1] + 12), 'Дибитишка', font=F(600, 22), fill=(40, 60, 120))
d.text((tab[2] - 34, tab[1] + 9), '×', font=F(500, 26), fill=(120, 140, 190))
d.text((tab[2] + 22, tab[1] + 4), '+', font=F(400, 34), fill=(235, 240, 255))
# адресная строка
ab = (150, 66, W - 130, 104)
d.rounded_rectangle(ab, 19, fill=CHROME2)
d.text((ab[0] + 22, ab[1] + 7), 't.me/dbtrobot/dbtishka', font=F(500, 22), fill=(228, 236, 255))
c = (230, 238, 255); yy = 85
d.line((30, yy, 56, yy), fill=c, width=3); d.polygon([(30, yy), (40, yy - 8), (40, yy + 8)], fill=c)
d.line((72, yy, 98, yy), fill=c, width=3); d.polygon([(98, yy), (88, yy - 8), (88, yy + 8)], fill=c)
d.arc((112, yy - 12, 136, yy + 12), 30, 330, fill=c, width=3)
for i in range(3): d.line((W - 60, yy - 10 + i * 10, W - 30, yy - 10 + i * 10), fill=c, width=3)
d.polygon([(W - 95 + (13 if k % 2 == 0 else 5.5) * math.cos(math.radians(-90 + 36 * k)),
            yy + (13 if k % 2 == 0 else 5.5) * math.sin(math.radians(-90 + 36 * k))) for k in range(10)], fill=c)

# ---------- Дибитишка на кромке (без тени) ----------
masc = Image.open('/tmp/mascot-cut.png').convert('RGBA')
mh = 380
masc = masc.resize((int(masc.width * mh / masc.height), mh), Image.LANCZOS)
seat_frac = 0.80
mx = W - masc.width - 10
my = int(wy1 - mh * seat_frac)
canvas.alpha_composite(masc, (mx, my))

# ---------- текст с эмодзи ----------
EMO = '/tmp/chr/node_modules/emoji-datasource-apple/img/apple/64/'
def emoji_img(cp, size):
    return Image.open(EMO + cp + '.png').convert('RGBA').resize((size, size), Image.LANCZOS)
fnt = F(400, 42)
LH = 55
size_e = 40
# токены: ('t', text) / ('e', codepoint)
paras = [
    [('e', '1f44b'), ('t', ' Привет! Я Дибитишка — слезинка, которая помогает дружить с чувствами.')],
    [('e', '1f4a7'), ('t', ' Во мне: пять блоков практик осознанности и ДПТ, практика дня, мягкие альтернативы, дневник эмоций'),
     ('e', '1f4d3'), ('t', ', письменные задания, чат поддержки'), ('e', '1f4ac'), ('t', 'и печатная тетрадь'), ('e', '2728')],
]
tx, maxw = 40, W - 80
d = ImageDraw.Draw(canvas)
def tw(s): return d.textlength(s, font=fnt)
y = wy1 + 60
mascot_right_limit = mx - 20  # первая строка не должна залезать под персонажа
for para in paras:
    # разбиваем на слова с пометкой эмодзи
    items = []
    for kind, v in para:
        if kind == 'e': items.append(('e', v))
        else:
            for w_ in v.split(' '):
                if w_: items.append(('t', w_))
    x = tx; line_limit = mascot_right_limit if y < wy1 + mh * (1 - seat_frac) else maxw + tx
    for kind, v in items:
        if kind == 't':
            if v.startswith(','): x -= tw(' ')*0.6
            wdt = tw(v)
            if x + wdt > line_limit:
                y += LH; x = tx
                line_limit = mascot_right_limit if y < my + mh else maxw + tx
            d.text((x, y), v, font=fnt, fill=INK); x += wdt + tw(' ')
        else:
            if x + size_e > line_limit:
                y += LH; x = tx
            # если предыдущий текст закончился пробелом — убираем лишний
            canvas.alpha_composite(emoji_img(v, size_e), (int(x), y + 8)); x += size_e + (0 if False else tw(' ')*0.6)
    y += LH + 16
print('bottom', y, 'window bottom', wy1)
out = '/home/user/secrdddd/docs/promo/dibitishka-window-4x3.png'
canvas.convert('RGB').save(out); canvas.convert('RGB').save('/tmp/out.png')
