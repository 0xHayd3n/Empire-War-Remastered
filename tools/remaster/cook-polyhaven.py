"""Build-time only: lock native 2K channels from the Poly Haven API, then cook *locked* bytes.
Usage: python tools/remaster/cook-polyhaven.py {lock,cook} tools/remaster/terrain/<job>.json
       [--force] [--art DIR] [--receipts DIR]
lock is an explicit re-review operation; cook never refreshes an input pin. Originals stay in temp.
cook is incremental per colour/surface DDS: an existing output is reused only when its relevant locked
source bytes, its transform (recipe, levelTangent, channel ops, texconv flags), the toolchain identity
(texconv binary + banner, Pillow, numpy, Python) and the actual bytes on disk still match a private,
atomically written receipt. Source bytes are hashed on hits too. --force recooks everything (baseline).
A validation or encoding failure publishes nothing: stage every recooked DDS before publishing any;
replace each file atomically and write the material index last. One writer owns a pack.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.parse import urlsplit
import numpy as np
from PIL import Image
import PIL
ROOT=Path(__file__).resolve().parents[2]; ART=ROOT/'public/art'; CACHE=Path(os.environ.get('COOK_CACHE') or (Path(tempfile.gettempdir())/'polyhaven-terrain-inputs')); CACHE.mkdir(exist_ok=True)
RECEIPTS=CACHE/'cook-receipts'
channels={'color':'diffuse','normal':'nor_gl','roughness':'rough','height':'displacement'}
RECIPE='cook-polyhaven/2'  # bump with any pixel-recipe change below
FLAGS=('-nologo','-y','-bc','u','-f','BC3_UNORM','-if','BOX','-m','0')
DDS_SIZE=5592560  # 2048 BC3_UNORM, 12 mips
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def token(s):
 if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,80}',s): raise ValueError('Invalid asset or pack: '+s)
 return s
def fetch(url,dest,limit):
 subprocess.run(['curl','--fail','--silent','--show-error','--retry','2','--max-time','75','--max-filesize',str(limit),'-A','SWR-Map-Remaster/1.0',url,'-o',str(dest)],check=True)
def catalog(api):
 with tempfile.TemporaryDirectory() as tmp:
  f=Path(tmp)/'api.json';fetch('https://api.polyhaven.com/'+api,f,4*1024*1024);return json.loads(f.read_bytes())
def allowed(asset,url):
 u=urlsplit(url);return u.scheme=='https' and u.netloc=='dl.polyhaven.org' and re.fullmatch(r'/file/ph-assets/Textures/(png|jpg)/2k/'+re.escape(asset)+r'/[\w.-]+\.(png|jpg)',u.path) and not u.query and not u.fragment

def source(asset,r):
 if not allowed(asset,r['url']) or not 0<r['size']<=64*1024*1024 or not re.fullmatch('[0-9a-f]{32}',r['md5']):raise ValueError('Not a bounded first-party 2K texture: '+asset)
 p=CACHE/(r['md5']+Path(urlsplit(r['url']).path).suffix)
 if not p.exists():
  tmp=p.with_suffix('.part');fetch(r['url'],tmp,r['size']);tmp.replace(p)
 b=p.read_bytes()
 if len(b)!=r['size'] or hashlib.md5(b).hexdigest()!=r['md5'] or ('sha256' in r and hashlib.sha256(b).hexdigest()!=r['sha256']):raise ValueError('Changed Poly Haven bytes: '+r['url'])
 with Image.open(p) as im:
  if im.size!=(2048,2048):raise ValueError('Not native square 2K: '+asset+' '+str(im.size))
 return p

def lock(review):
 lib=catalog('assets?t=textures');rows={}
 for d in review['families']:
  a=token(d['asset']);meta=lib[a];assert meta['type']==1
  files={k.lower():v for k,v in catalog('files/'+a).items()};inputs={}
  for key,field in channels.items():
   kind='png' if key=='height' or d.get('reuse')=='endor-terrain' else 'jpg';options=files[field]['2k'];s=options.get(kind) or options['png'];r={k:s[k] for k in ['url','size','md5']};p=source(a,r);r['sha256']=sha(p);inputs[key]=r
  dims=meta.get('dimensions') or [];rows[a]={'page':'https://polyhaven.com/a/'+a,'license':'https://polyhaven.com/license','api':'https://api.polyhaven.com/files/'+a,'authors':list(meta['authors']),'dimensionsMm':dims,'inputs':inputs}
 return rows

def level_tangent(im):
 # Remove only the constant slope of the scanned plane, before stochastic rotations.
 # Keep local slopes about that mean; geometry supplies the actual mounted incline.
 v=np.asarray(im,dtype=np.float32)/127.5-1
 slope=v[:,:,:2]/np.maximum(v[:,:,2:],.15)
 slope-=np.mean(slope,axis=(0,1),dtype=np.float64).astype(np.float32)
 n=np.concatenate((slope,np.ones_like(v[:,:,2:])),axis=2);n/=np.linalg.norm(n,axis=2,keepdims=True)
 return Image.fromarray(np.rint((n+1)*127.5).clip(0,255).astype('uint8'))

# ---------------------------------------------------------------- incremental cook
TEXCONV=None
def texconv():
 global TEXCONV
 if TEXCONV is None:
  exe=os.environ.get('COOK_TEXCONV') or shutil.which('texconv')
  if not exe: raise RuntimeError('texconv is not on PATH')
  TEXCONV=str(Path(exe).resolve());texconv.identity=tool_identity(TEXCONV)
 return TEXCONV
def tool_identity(exe):
 p=Path(exe);b=p.read_bytes();v=subprocess.run([exe,'-h'],capture_output=True,text=True,errors='replace')
 banner=next((l.strip() for l in ((v.stdout or '')+'\n'+(v.stderr or '')).splitlines() if l.strip()),'unknown')
 return {'texconv':{'name':p.name,'size':len(b),'sha256':hashlib.sha256(b).hexdigest(),'banner':banner,'flags':list(FLAGS)},
         'pillow':PIL.__version__,'numpy':np.__version__,'python':sys.version.split()[0],'recipe':RECIPE,'cookerSHA256':sha(Path(__file__))}
def tools(): texconv();return texconv.identity
def texconv_cmd(f,stage): return [texconv()]+list(FLAGS)+['-o',str(stage),str(f)]
def key(pack,name,asset,k,inputs,level):
 body={'pack':pack,'id':name,'asset':asset,'output':k,'tools':tools(),
       'transform':{'recipe':RECIPE,'levelTangent':(level is True) if k=='surface' else None,'alpha':('height' if k=='color' else 'roughness'),
                    'rgb':('color' if k=='color' else 'normal'),'ops':('rgba' if k=='color' else 'rgba+flipGreen')},
       'inputs':inputs}
 return hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def receipt(rec,pack,name,k): return rec/pack/(name+'-'+k+'.json')
def known(p,tgt,kk):
 """Return the authenticated sha256 of an existing output, else None (treat as a miss)."""
 try: r=json.loads(p.read_bytes())
 except (OSError,ValueError): return None
 if not isinstance(r,dict) or r.get('key')!=kk or r.get('dds')!=tgt.name: return None
 try: b=tgt.read_bytes()
 except OSError: return None
 h=hashlib.sha256(b).hexdigest()
 if len(b)!=DDS_SIZE or b[84:88]!=b'DXT5' or h!=r.get('sha256'): return None
 return h
def sward_samples(color):
 # A denser stand of the photographed live blades, not a hue adjustment. Select entire
 # green blade silhouettes at the original texel scale and use the SAME native pixel
 # index for albedo, normal, roughness and height. Translation keeps tangent axes valid.
 from PIL import ImageFilter
 rgb=np.asarray(Image.open(color).convert('RGB'),dtype=np.int16);g=rgb[:,:,1]
 mask=Image.fromarray(((g-rgb[:,:,0]>7)&(g-rgb[:,:,2]>24)).astype('uint8')*255).filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.MaxFilter(3))
 mask=np.asarray(mask)>0;h,w=mask.shape;src=np.arange(h*w,dtype=np.int32).reshape(h,w);idx=src.copy()
 for x,y in [(257,991),(1123,659),(1811,331),(453,1373),(1367,1711),(733,91),(169,1879),(945,1201),(1583,907),(1979,1439),(1213,277),(651,1663)]:
  off=(y,x);sel=np.roll(mask,off,axis=(0,1));other=np.roll(src,off,axis=(0,1));idx[sel]=other[sel]
 return idx

def render(maps,name,k,level,stage,samples=None):
 im=Image.open(maps['color' if k=='color' else 'normal']).convert('RGB');ch=Image.open(maps['height' if k=='color' else 'roughness']);v=np.asarray(ch)
 if v.dtype.itemsize>1:ch=Image.fromarray((v/257).clip(0,255).astype('uint8'))
 if k=='surface':
  if level is True:im=level_tangent(im)
  red,green,blue=im.split();im=Image.merge('RGB',(red,green.point(lambda x:255-x),blue))
 im.putalpha(ch.convert('L'))
 if samples is not None:im=Image.fromarray(np.asarray(im).reshape(-1,4)[samples])
 f=stage/(name+'-'+k+'.png');im.save(f)
 subprocess.run(texconv_cmd(f,stage),check=True)
 cooked=f.with_suffix('.dds');b=cooked.read_bytes()[84:88]
 if b!=b'DXT5' or cooked.stat().st_size!=DDS_SIZE: raise ValueError('texconv did not write a 12-mip BC3 DDS: '+cooked.name)
 f.unlink();return cooked
def publish(staged,tgt,h):
 tmp=tgt.with_name(tgt.name+'.part');shutil.copyfile(staged,tmp)
 if sha(tmp)!=h: tmp.unlink();raise ValueError('Torn staged copy: '+tgt.name)
 os.replace(tmp,tgt)
def write_atomic(f,text):
 f.parent.mkdir(parents=True,exist_ok=True);tmp=f.with_name(f.name+'.part');tmp.write_text(text,encoding='utf8');os.replace(tmp,f)

def cook(review,rows,out,force=False,art=None,rec=None):
 art=Path(art or ART);rec=Path(rec or RECEIPTS);out=Path(out);t0=time.monotonic();mats=[];staged=[]
 names=[token(d['id']) for d in review['families']];token(review['pack'])
 if len(set(names))!=len(names): raise ValueError('Duplicate material id in terrain cook')
 with tempfile.TemporaryDirectory() as tmp:
  stage=Path(tmp)
  for d in review['families']:
   a=token(d['asset']);name=token(d['id']);r=rows[a];pins=r['inputs']
   if set(pins)!=set(channels) or any(not re.fullmatch('[0-9a-f]{64}',str(v.get('sha256',''))) for v in pins.values()):raise ValueError('Need four locked source hashes for '+a)
   maps={k:source(a,v) for k,v in pins.items()}  # validates each actual file against both hashes on hits too
   hashed={k:v['sha256'] for k,v in pins.items()}
   if d.get('reuse'):
    pack=token(d['reuse']);idx=art/pack/'materials.json';existing=json.loads(idx.read_bytes());paving=idx.with_name('paving.json')
    if paving.exists():existing.append(json.loads(paving.read_bytes()))
    row=next(x for x in existing if x['id']==name and x['asset']==a)
    for k in ['color','surface']:
     if sha(art/pack/(name+'-'+k+'.dds'))!=row[k+'Hash']:raise ValueError('Changed reusable '+name)
    print('cook: reuse %s from %s'%(name,pack),file=sys.stderr);continue
   m={'pack':review['pack'],'id':name,'asset':a,'role':d['role'],'tileMeters':d['tileMeters']};level=d.get('levelTangent');samples=None
   dense=d.get('liveBlades') is True
   if dense and a!='forrest_ground_01':raise ValueError('Blade coverage not reviewed for '+a)
   for k in ['color','surface']:
    inputs={'rgb':hashed['color' if k=='color' else 'normal'],'alpha':hashed['height' if k=='color' else 'roughness']}
    if dense:inputs['liveBladeMask']=hashed['color']
    kk=key(review['pack'],name,a,k,inputs,level);rp=receipt(rec,review['pack'],name,k);tgt=out/(name+'-'+k+'.dds')
    h=None if force else known(rp,tgt,kk)
    if h is not None:m[k+'Hash']=h;print('cook: keep %s (%s)'%(name+'-'+k,'forced' if force else 'unchanged'),file=sys.stderr);continue
    if dense and samples is None:samples=sward_samples(maps['color'])
    f=render(maps,name,k,level,stage,samples) if dense else render(maps,name,k,level,stage);h=sha(f);m[k+'Hash']=h;staged.append((f,tgt,rp,h,kk,name+'-'+k));print('cook: make %s'%(name+'-'+k),file=sys.stderr)
   mats.append(m)
  # Nothing below runs unless every family above validated.
  for f,tgt,rp,h,kk,label in staged:
   publish(f,tgt,h)
   write_atomic(rp,json.dumps({'key':kk,'dds':tgt.name,'sha256':h,'size':DDS_SIZE,'pack':tgt.parent.name},indent=2,sort_keys=True)+'\n')
   print('cook: published %s'%label,file=sys.stderr)
  text=json.dumps(mats,indent=2)+'\n';mf=out/'materials.json'
  if not mf.exists() or mf.read_text(encoding='utf8')!=text:
   mf.parent.mkdir(parents=True,exist_ok=True);write_atomic(mf,text)
 print('cook summary: pack=%s cooked=%d skipped=%d seconds=%.2f'%(review['pack'],len(staged),2*len(mats)-len(staged),time.monotonic()-t0),file=sys.stderr)
 return {'cooked':len(staged),'skipped':2*len(mats)-len(staged)}

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('mode',choices=['lock','cook']);ap.add_argument('review',type=Path)
 ap.add_argument('--force',action='store_true',help='recook every DDS (full baseline)')
 ap.add_argument('--art',type=Path,default=ART,help='art root containing the pack directories')
 ap.add_argument('--receipts',type=Path,default=RECEIPTS,help='private receipt directory')
 args=ap.parse_args();review=json.loads(args.review.read_bytes());out=args.art/token(review['pack']);out.mkdir(parents=True,exist_ok=True);f=out/'sources.json'
 if args.mode=='lock':
  if args.force: raise SystemExit('lock does not take --force')
  f.write_text(json.dumps(lock(review),indent=2,ensure_ascii=True)+'\n',encoding='utf8')
 else:cook(review,json.loads(f.read_bytes()),out,args.force,args.art,args.receipts)
