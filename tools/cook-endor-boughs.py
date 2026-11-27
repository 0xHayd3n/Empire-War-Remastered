"""Build camera-independent branch material panels from CC0 photographic cutouts in endor-plants.
Run `node tools/endor-plants-assets.mjs` first. Build only: Pillow, Python 3."""
from pathlib import Path
from PIL import Image,ImageDraw
import math,random
root=Path(__file__).resolve().parents[1]/'public/art';src=Image.open(root/'endor-plants/leaf-atlas.png').convert('RGBA');out=root/'endor-thicket';out.mkdir(exist_ok=True)
def crop(box): return src.crop(tuple(round(v*2048/450) for v in box))
twig=crop((228,226,274,323));leaf=crop((226,0,272,56));fern=crop((105,4,143,197));N=700
# Stick base at px,py, pointing dx,dy rather than rotating around an arbitrary image corner.
def spray(im,part,x,y,dx,dy,width):
 h=max(2,round(math.hypot(dx,dy)));pic=part.resize((max(2,round(width)),h),Image.Resampling.LANCZOS);pic=pic.rotate(-math.degrees(math.atan2(dx,-dy)),expand=True,resample=Image.Resampling.BICUBIC);im.alpha_composite(pic,(round(x+dx/2-pic.width/2),round(y+dy/2-pic.height/2)))
def pine(r):
 im=Image.new('RGBA',(N,N)); d=ImageDraw.Draw(im);d.line((346,658,354,62),fill=(91,76,44,245),width=6)
 for k in range(29):
  t=k/30;y=645-t*547;w=(.45+.55*math.sin(t*math.pi))*(1-t*.48)*304
  for sign in [-1,1]:
   dx=sign*w*r.uniform(.72,1);dy=-r.uniform(70,137);spray(im,twig,350+r.uniform(-9,9),y,dx,dy,r.uniform(52,97));
 spray(im,twig,348,164,13,-133,74);return im
r=random.Random(78912);branch=pine(r);shrub=Image.new('RGBA',(N,N));d=ImageDraw.Draw(shrub)
for j in range(28):
 a=r.uniform(-1.22,1.22);l=r.uniform(218,574);ex=350+math.sin(a)*l*.6;ey=670-math.cos(a)*l;d.line((350,676,ex,ey),fill=(86,76,46,255),width=4)
 for i in range(2,10):
  t=i/10;x=350+(ex-350)*t;y=670+(ey-670)*t;ang=a+(-1 if i%2 else 1)*r.uniform(.65,1.13);ln=r.uniform(47,112);spray(shrub,leaf,x,y,math.sin(ang)*ln,-math.cos(ang)*ln,ln*.65)
fernbed=Image.new('RGBA',(N,N));
for i in range(22):
 a=r.uniform(-1.44,1.44);l=r.uniform(240,490);spray(fernbed,fern,351+r.uniform(-35,35),665,math.sin(a)*l*.76,-math.cos(a)*l*.93,85+r.uniform(0,49))
fir=Image.new('RGBA',(N,N));ImageDraw.Draw(fir).line((350,686,355,48),fill=(83,65,45,255),width=12)
for i in range(20):
 t=i/20; y=560-t*455;w=(1-t*.74)*292
 for s in [-1,1]:spray(fir,branch,351,y,s*w*r.uniform(.78,1.06),r.uniform(-20,90),w*.55)
spray(fir,branch,350,195,8,-155,96)
atlas=Image.new('RGBA',(2048,2048));
for i,im in enumerate([fir,shrub,fernbed,branch]):
 box=im.getbbox();f=im.crop(box);f.thumbnail((996,996),Image.Resampling.LANCZOS);f=f.resize((996,996),Image.Resampling.LANCZOS);atlas.alpha_composite(f,(i%2*1024+14,i//2*1024+14))
atlas.save(out/'boughs.png',optimize=True)
