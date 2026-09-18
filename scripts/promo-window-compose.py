from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np, textwrap

W, H = 1600, 1200
canvas = Image.new('RGBA', (W, H), 'white')
d = ImageDraw.Draw(canvas)

# ---------- «наше» окно: пастельная палитра приложения ----------
CHROME  = (122, 150, 232)
CHROME2 = (100, 130, 220)
PANEL   = (237, 243, 254)
wx0, wy0, wx1, wy1 = 70, 34, W - 70, 720
R = 36

sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((wx0, wy0 + 22, wx1, wy1 + 22), R, fill=(70, 95, 180, 80))
canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30)))

d.rounded_rectangle((wx0, wy0, wx1, wy1), R, fill=CHROME)
bar_h = 118
cx0, cy0, cx1, cy1 = wx0 + 12, wy0 + bar_h, wx1 - 12, wy1 - 12
d.rounded_rectangle((cx0, cy0, cx1, cy1), 24, fill=PANEL)

# лампочки
for i, c in enumerate([(255, 118, 128), (255, 200, 92), (118, 214, 140)]):
    x = wx0 + 36 + i * 34
    d.ellipse((x, wy0 + 26, x + 20, wy0 + 46), fill=c)

# вкладка с иконкой-каплей
tab = (wx0 + 170, wy0 + 12, wx0 + 600, wy0 + 62)
d.rounded_rectangle(tab, 16, fill=PANEL)
icon = Image.open('/home/user/secrdddd/app/assets/mascot/icon.png').convert('RGBA').resize((34, 34), Image.LANCZOS)
canvas.alpha_composite(icon, (tab[0] + 14, tab[1] + 8))
fnt_tab = ImageFont.truetype('/tmp/ttf/Inter-600.ttf', 22)
d = ImageDraw.Draw(canvas)
d.text((tab[0] + 58, tab[1] + 13), 'Дибитишка', font=fnt_tab, fill=(40, 60, 120))
d.text((tab[2] - 34, tab[1] + 10), '×', font=ImageFont.truetype('/tmp/ttf/Inter-500.ttf', 26), fill=(120, 140, 190))
d.text((tab[2] + 24, tab[1] + 6), '+', font=ImageFont.truetype('/tmp/ttf/Inter-400.ttf', 34), fill=(235, 240, 255))

# адресная строка
ab = (wx0 + 150, wy0 + 70, wx1 - 150, wy0 + 108)
d.rounded_rectangle(ab, 19, fill=CHROME2)
fnt_url = ImageFont.truetype('/tmp/ttf/Inter-500.ttf', 22)
d.text((ab[0] + 22, ab[1] + 7), 'dibitishka.app', font=fnt_url, fill=(228, 236, 255))
nav = ImageFont.truetype('/tmp/ttf/Inter-500.ttf', 30)
c=(230,238,255)
yy=wy0+89
d.line((wx0+36,yy,wx0+62,yy),fill=c,width=3); d.polygon([(wx0+36,yy),(wx0+46,yy-8),(wx0+46,yy+8)],fill=c)
d.line((wx0+78,yy,wx0+104,yy),fill=c,width=3); d.polygon([(wx0+104,yy),(wx0+94,yy-8),(wx0+94,yy+8)],fill=c)
d.arc((wx0+118,yy-12,wx0+142,yy+12),30,330,fill=c,width=3)
for i in range(3): d.line((wx1-70,yy-10+i*10,wx1-40,yy-10+i*10),fill=c,width=3)
import math
d.polygon([(wx1-105+13*math.cos(math.radians(-90+72*i))*(1 if i%2==0 else .45)*1, yy+13*math.sin(math.radians(-90+72*i))*(1 if i%2==0 else .45)) for i in range(10)] if False else [(wx1-105+ (13 if k%2==0 else 5.5)*math.cos(math.radians(-90+36*k)), yy+(13 if k%2==0 else 5.5)*math.sin(math.radians(-90+36*k))) for k in range(10)], fill=c)

# ---------- скриншот приложения, вписанный в панель ----------
ph = cy1 - cy0
shots=[]
for f in ('/tmp/home.png','/tmp/home-skills.png'):
    im_=Image.open(f).convert('RGBA'); sw=int(im_.width*ph/im_.height); shots.append(im_.resize((sw,ph),Image.LANCZOS))
gap=28
shot=Image.new('RGBA',(sw*2+gap,ph),(0,0,0,0)); shot.alpha_composite(shots[0],(0,0)); shot.alpha_composite(shots[1],(sw+gap,0))
sw=shot.width
# три «телефона» рядом? нет — один по центру, по бокам мягкий фон приложения
bg = Image.new('RGBA', (cx1 - cx0, ph), PANEL)
# растянутый размытый фон из скрина по бокам
blur = shot.resize((cx1 - cx0, ph), Image.LANCZOS).filter(ImageFilter.GaussianBlur(40))
bg.alpha_composite(blur)
bg = Image.blend(bg, Image.new('RGBA', bg.size, PANEL), 0.35)
sx = (bg.width - sw) // 2
sx -= 150
bg.alpha_composite(shot, (sx, 0))
# маска со скруглением
m = Image.new('L', bg.size, 0)
ImageDraw.Draw(m).rounded_rectangle((0, 0, bg.width - 1, bg.height - 1), 24, fill=255)
canvas.paste(bg, (cx0, cy0), m)

# ---------- Дибитишка сидит на нижней кромке окна ----------
masc = Image.open('/tmp/mascot-cut.png').convert('RGBA')
mh = 470
masc = masc.resize((int(masc.width * mh / masc.height), mh), Image.LANCZOS)
# линия «сиденья» у него ~ там, где ноги переламываются (примерно 78% высоты)
seat_frac = 0.80
mx = W // 2 - masc.width // 2 + 520      # смещаем вправо, чтобы не закрывать экран целиком
my = int(wy1 - mh * seat_frac)
# тень на кромке и на белом фоне
shd = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shd)
sd.ellipse((mx + 60, wy1 - 30, mx + masc.width - 60, wy1 + 40), fill=(60, 80, 160, 90))
canvas.alpha_composite(shd.filter(ImageFilter.GaussianBlur(22)))
canvas.alpha_composite(masc, (mx, my))

# ---------- текст на белом ----------
d = ImageDraw.Draw(canvas)
fnt = ImageFont.truetype('/tmp/ttf/Inter-400.ttf', 44)
text1 = 'Привет! Я Дибитишка — слезинка, которая помогает дружить с чувствами.'
text2 = ('Во мне: пять блоков практик осознанности и ДПТ, практика дня, мягкие альтернативы, '
         'дневник эмоций, письменные задания, чат поддержки и печатная тетрадь.')
tx, ty = 70, wy1 + 110
maxw = W - 140 - 60
def wrap(t):
    words, lines, cur = t.split(), [], ''
    for w_ in words:
        test = (cur + ' ' + w_).strip()
        if d.textlength(test, font=fnt) <= maxw: cur = test
        else: lines.append(cur); cur = w_
    lines.append(cur); return lines
y = ty
for para in (text1, text2):
    for ln in wrap(para):
        d.text((tx, y), ln, font=fnt, fill=(10, 10, 12))
        y += 57
    y += 18
print('text bottom', y)
canvas.convert('RGB').save('/home/user/secrdddd/docs/promo-dibitishka-4x3.png', quality=95)
canvas.convert('RGB').save('/tmp/out.png')
