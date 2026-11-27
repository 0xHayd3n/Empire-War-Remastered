"""Produce a local, offline wipe from matched native battle PNGs. No edits to either image."""
import sys, json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
p = Path(sys.argv[1]); rows = {}
for view in ('bark','close','strategy'):
    a,b = [Image.open(p/f'{view}-{mode}.png').convert('RGB') for mode in ('before','after')]
    assert a.size == b.size == (3840,2160), (view,a.size,b.size)
    d=ImageChops.difference(a,b); means=ImageStat.Stat(d).mean
    changed=sum(d.convert('L').histogram()[4:])
    assert changed > a.width*a.height*.015, (view,changed)
    rows[view]={'meanAbsoluteRGB':means,'pixelsChangedBeyond3':changed,'pixels':a.width*a.height}
    for mode,im in [('before',a),('after',b)]:
        thumb=im.resize((920,518),Image.Resampling.LANCZOS); thumb.save(p/f'{view}-{mode}-preview.jpg',quality=91)
        # Native pixels: center the bark inspection on the trunk at this camera pose.
        box=(1450,420,2170,840) if view=='bark' else (1600,900,2320,1320)
        im.crop(box).save(p/f'{view}-{mode}-detail.jpg',quality=96,subsampling=0)
(p/'differences.json').write_text(json.dumps(rows,indent=2)); print(rows)
article = '''<div class="compare"><img src="{v}-before.png" alt="Original {v} capture"><img class="after" src="{v}-after.png" alt="Enhanced {v} capture"><i></i></div><div class="labels"><span>Original</span><span>Forest edition</span></div><input aria-label="Reveal original {v}" type="range" min="0" max="100" value="50" oninput="this.parentNode.style.setProperty('--cut',this.value+'%')"><p><a href="{v}-before.png">Original 4K PNG</a> · <a href="{v}-after.png">Enhanced 4K PNG</a></p>'''
(p/'Compare Endor.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Endor · Native 4K comparison</title><style>*{box-sizing:border-box}body{max-width:1440px;margin:auto;background:#121619;color:#eef2ec;font:16px/1.5 system-ui;padding:20px}h1,h2{font-weight:550}a{color:#bbdccf}section{--cut:50%;margin:3rem 0}input{width:100%;accent-color:#a5ccae}.compare{position:relative}.compare img{width:100%;display:block}.after,.compare i{position:absolute;inset:0}.after{clip-path:inset(0 0 0 var(--cut))}.compare i{left:var(--cut);width:2px;background:white;pointer-events:none}.labels{display:flex;justify-content:space-between}</style><h1>Endor · Native 4K</h1><p>Move each slider to compare the same frozen battle. Open a PNG for the full 3840 × 2160 frame at 100% zoom.</p>'''+''.join('<section><h2>'+title+'</h2>'+article.format(v=v)+'</section>' for v,title in [('bark','At the tree line'),('close','Forest clearing'),('strategy','Strategy camera')]),encoding='utf-8')
