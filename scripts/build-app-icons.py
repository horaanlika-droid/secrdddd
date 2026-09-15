#!/usr/bin/env python3
"""дибитишка · иконки приложения для экрана «Домой» (PWA / iOS).

Зачем: гайд «иконка на экран Домой» (экран #/install) обещает красивую иконку,
а браузеры берут её из manifest.webmanifest и apple-touch-icon. Один источник —
app/assets/mascot/icon.png (1024×1024, маскот на фирменном небе), из него
нарезаются все нужные размеры, чтобы иконка везде была одной и той же.

Что собирается (app/assets/icons/):
  icon-192.png          — manifest, «any» (Android, десктоп);
  icon-512.png          — manifest, «any», для крупных плиток и сторов;
  icon-maskable-512.png — manifest, purpose=maskable: маскот уменьшен до ~76 %
                          и стоит на сплошном фоне, поэтому круглые/скруглённые
                          маски.launcher'ов не режут капюшон и лапку;
  apple-touch-180.png   — apple-touch-icon: iOS игнорирует альфу и кладёт
                          PNG на чёрную подложку, поэтому альфа снята, фон —
                          фирменное небо источника.

Запуск:  python3 scripts/build-app-icons.py   (нужен Pillow)
Проверка размеров и отсутствия альфы у apple-touch — в scripts/check-project.mjs.
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'app', 'assets', 'mascot', 'icon.png')
OUT = os.path.join(ROOT, 'app', 'assets', 'icons')

# Маскот в maskable-иконке занимает ~76 % стороны: маски лаунчеров срезают
# до 20 % края, а капюшон и поднятая лапка должны остаться внутри круга.
MASKABLE_FIT = 0.76


def main() -> int:
    src = Image.open(SRC).convert('RGBA')
    if src.width != src.height:
        print('источник должен быть квадратным, а не %dx%d' % (src.width, src.height))
        return 1
    # фон иконки — фирменное небо: берём угол источника, им же заливаем maskable
    bg = src.getpixel((2, 2))[:3]
    os.makedirs(OUT, exist_ok=True)

    def save(img: Image.Image, name: str) -> None:
        img.save(os.path.join(OUT, name), 'PNG', optimize=True)
        print('  ✓ %s %dx%d' % (name, img.width, img.height))

    for size in (192, 512):
        save(src.resize((size, size), Image.LANCZOS), 'icon-%d.png' % size)

    # iOS: альфы быть не должно вовсе — иначе иконка ляжет на чёрный квадрат
    small180 = src.resize((180, 180), Image.LANCZOS)
    flat = Image.new('RGB', (180, 180), bg)
    flat.paste(small180, (0, 0), small180)
    save(flat, 'apple-touch-180.png')

    inner = int(round(512 * MASKABLE_FIT))
    maskable = Image.new('RGB', (512, 512), bg)
    small = src.resize((inner, inner), Image.LANCZOS)
    maskable.paste(small, ((512 - inner) // 2, (512 - inner) // 2), small)
    save(maskable, 'icon-maskable-512.png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
