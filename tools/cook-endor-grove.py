"""Pack selected CC0 glTF plants without Blender. Offline cook: Python 3, numpy, Pillow.
Only the finished local geometry, normal/diffuse and cutout maps are used in battle.
"""
from pathlib import Path
import tempfile, hashlib, urllib.request, json, io
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]/'public/art/endor-grove'
CACHE=Path(tempfile.gettempdir())/'endor-grove-inputs'
ROOT.mkdir(parents=True,exist_ok=True); CACHE.mkdir(exist_ok=True)
BASE='https://dl.polyhaven.org/file/ph-assets/Models/'
assets={
 'shrub_02':('8f7254d279c0c49c0b3edfe260aa5c86','683b5475238310899eac1458520903e6','3f4ae281928de030c7d4e41ad5b88a8b','64a1f609d80ea076b43412498a3d2db5'),
 'grass_medium_02':('dd8f166a6399238553bc3b2931677b68','145041ae03fe02783a0adbd1cdcb4988','4bb5230e09358d60dd767331685b2d36','b231cd6a1b5eb7ae21e7c2e626f8318c'),
 'grass_bermuda_01':('a1bdd74118d2387a42dba4f605226f87','2940aa3405004b62983fd70bede8e47f','234be9f52cfcd3380c7f782baaa841c3','274285abb11b3b7a0fd277b9923d1074'),
 'fern_02':('cf276874d37bfb73c299504a6b355b77','c061e9255f7d36ae9ce0e92ef3e100b2','82c18a6cfd5ae91c37c0e078f591181c','1421e5e36946c23a7ddcc907de89025c'),
 'fir_sapling':('7b1a5ceae7be69954510b5a5c719b4fb','b329143a90d95201891afc52daeb9698','cd218269e0b34bd1bdb48a8daf21be67','177123c2b5eaeee068be559ff78e54d0')}
def get(url,h):
 p=CACHE/url.split('/')[-1]
 if not p.exists(): p.write_bytes(urllib.request.urlopen(url,timeout=80).read())
 b=p.read_bytes();assert hashlib.md5(b).hexdigest()==h,url;return b

def simplify_needles(p,n,uv,idx):
 # Model C has >14k separate needle meshes. Retain whole, well-distributed needles (not random faces)
 # plus every structural twig. Broaden retained needles transverse to their long axis for RTS distance.
 parent=list(range(len(p)))
 def root(i):
  while i!=parent[i]: parent[i]=parent[parent[i]];i=parent[i]
  return i
 for a,b,c in idx: r=root(a);parent[root(b)]=r;parent[root(c)]=r
 lab=np.array([root(a) for a in idx[:,0]]); ids,count=np.unique(lab,return_counts=True);small=ids[count==8];rng=np.random.default_rng(1743)
 selected=rng.choice(small,min(625,len(small)),replace=False); mask=np.isin(lab,np.concatenate((ids[count!=8],selected)))
 clusters={i:[] for i in selected};
 for i,tri in zip(lab[mask],idx[mask]):
  if i in clusters:clusters[i].extend(tri)
 for v in clusters.values():
  v=np.unique(v);cen=p[v].mean(0);off=p[v]-cen;axis=np.linalg.svd(off,full_matrices=False)[2][0];side=off-np.outer(off@axis,axis);p[v]+=side*2.8
 return idx[mask]

def material(asset,channel,diff,alpha,normal):
 # Keep glTF top-down UVs and actual RGB. Both backends sample unflipped texture bytes.
 im=Image.open(io.BytesIO(diff)).convert('RGBA');
 if alpha: im.putalpha(Image.open(io.BytesIO(alpha)).convert('L').resize(im.size,Image.Resampling.LANCZOS))
 im.thumbnail((1024,1024),Image.Resampling.LANCZOS);im.save(ROOT/(channel+'.png'),optimize=True)
 # Real plant normal, not a normal fabricated from albedo.
 nm=Image.open(io.BytesIO(normal)).convert('RGB');nm.thumbnail((512,512),Image.Resampling.LANCZOS);nm.save(ROOT/(channel+'-normal.png'),optimize=True)

manifest=[]
for aid,(gpin,bpin,cpin,apin) in assets.items():
 g=json.loads(get(BASE+f'gltf/1k/{aid}/{aid}_1k.gltf',gpin));tier='4k' if aid in ('grass_medium_02','shrub_02') else '8k';buf=get(BASE+f'gltf/{tier}/{aid}/{aid}.bin',bpin)
 twig=aid=='fir_sapling';name='sapling' if twig else 'bush' if aid=='shrub_02' else 'fern' if aid=='fern_02' else 'meadow' if aid=='grass_medium_02' else 'grass'
 chans=['bark','needles'] if twig else [name];
 for channel in chans:
  stem=aid+('_branches' if channel=='bark' else '_twigs' if twig else '')
  tex=BASE+f'jpg/1k/{aid}/{stem}_diff_1k.jpg';nr=BASE+f'jpg/1k/{aid}/{stem}_nor_gl_1k.jpg';mask=None
  if channel!='bark':mask=get(BASE+f'png/1k/{aid}/{stem}_alpha_1k.png',apin)
  npin={'bush':'51a7f2db7e06a207171fd725585241d5','meadow':'90b4c27b0c0ff058bd37b88bb70784c1','bark':'db70c4595cf207cc04a02b49c195b78d','needles':'764771b717c54b86fa7d3eadc4a1ada5','fern':'43aed63dff79554f6064627515afd9d7','grass':'73a585e0963ff6bf3cefa845cbee0645'}[channel]
  material(aid,channel,get(tex,'84f1d40b80a015d65c0ded042a10765b' if channel=='bark' else cpin),mask,get(nr,npin))
 def read(i):
  a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];w={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']];dt=np.dtype({5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]);return np.ndarray((a['count'],w),dt,buf,v.get('byteOffset',0)+a.get('byteOffset',0),(v.get('byteStride',w*dt.itemsize),dt.itemsize)).copy()
 for j in ([7,8] if name=='grass' else [0] if name=='meadow' else [3] if name=='bush' else [2]):
  for prim in g['meshes'][j]['primitives']:
   chan=chans[prim['material']];attr=prim['attributes']; p,n,uv=[read(attr[k]) for k in ['POSITION','NORMAL','TEXCOORD_0']]; idx=read(prim['indices']).reshape(-1,3)
   if chan=='needles':idx=simplify_needles(p,n,uv,idx)
   used,indices=np.unique(idx,return_inverse=True);assert len(used)<65535
   # Convert Y-up glTF to native Z-up, without reversing winding.
   a=np.concatenate([p[:,[0,2,1]]*[1,-1,1],n[:,[0,2,1]]*[1,-1,1],uv],axis=1)[used].astype('<f4')
   out=name+str(j)+'-'+chan+'.bin';binary=a.tobytes()+indices.astype('<u2').tobytes();(ROOT/out).write_bytes(binary)
   manifest.append(dict(asset=aid,kind=name,variant=j,material=chan,file=out,vertices=len(used),triangles=len(idx),sha256=hashlib.sha256(binary).hexdigest()));print(out,len(used),len(idx))
(ROOT/'models.json').write_text(json.dumps(manifest,indent=2)+'\n')
