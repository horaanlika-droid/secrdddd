"""Compose original preload wordmark onto generated blank product photography.
Usage: .venv/bin/python scripts/build-merch.py _source/merch-products.png
Requires Pillow + numpy. Generated source stays outside Git.
"""
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from pathlib import Path
import sys
root=Path(__file__).resolve().parent.parent
im=Image.open(sys.argv[1]).convert('RGBA')
# Coordinates on the 1536x1024 source; exact existing brand, not AI typography.
im=im.resize((1536,1024))
logo=Image.open(root/'app/assets/brand/splash-wordmark-hq.png').convert('RGBA')
logo.thumbnail((410,250),Image.Resampling.LANCZOS)
im.alpha_composite(logo,(1000,325))
d=ImageDraw.Draw(im)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',23)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
d.text((1202,555),'РАБОЧАЯ ТЕТРАДЬ',font=font,fill='#756382',anchor='mm')
d.text((1202,610),'маленькие шаги к себе',font=small,fill='#8e7897',anchor='mm')
d.text((1202,815),'by @vasmedoljno',font=small,fill='#8e7897',anchor='mm')
outdir=root/'app/assets/merch'; outdir.mkdir(parents=True,exist_ok=True)
for name,box in [('cap',(0,0,865,1024)),('notebook',(880,0,1536,1024))]:
    a=np.array(im.crop(box)); rgb=a[:,:,:3].astype(float)
    excess=rgb[:,:,1]-np.maximum(rgb[:,:,0],rgb[:,:,2])
    alpha=np.clip((85-excess)/65,0,1)
    a[:,:,3]=(alpha*255).astype('uint8')
    edge=(alpha>0)&(alpha<1)
    a[:,:,1][edge]=np.minimum(a[:,:,1][edge],np.maximum(a[:,:,0][edge],a[:,:,2][edge]))
    tile=Image.fromarray(a); tile=tile.crop(tile.getbbox()); tile.thumbnail((800,800),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',(840,840)); canvas.alpha_composite(tile,((840-tile.width)//2,(840-tile.height)//2))
    canvas.save(outdir/f'{name}.webp',quality=95)
