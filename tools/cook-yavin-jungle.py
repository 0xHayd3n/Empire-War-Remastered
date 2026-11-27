"""Build-time only. CC0 inputs verified against the checked-in Poly Haven bill of materials.
Uses Pillow/numpy/scipy, node and DirectXTex texconv. Full originals and bake scratch live in temp.
"""
import hashlib, json, os, subprocess, tempfile, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'public/art/yavin-jungle'; TMP=Path(tempfile.gettempdir())/'yavin-direction'; SRC=TMP/'sources'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for asset,files in json.loads((OUT/'sources.json').read_text()).items():
 for name,r in files.items():
  p=SRC/asset/name;p.parent.mkdir(exist_ok=True,parents=True)
  if not p.exists():urllib.request.urlretrieve(r['url'],p)
  if p.stat().st_size!=r['size'] or hashlib.md5(p.read_bytes()).hexdigest()!=r['md5']:raise ValueError('Changed donor '+str(p))
rows=[]
for asset,ident,role,meters in [('mud_forest','forest-earth','mud',2.5),('leaves_forest_ground','fallen-leaves','litter',2.1)]:
 p=SRC/asset;r=dict(id=ident,asset=asset,role=role,tileMeters=meters,pack='yavin-jungle');
 for k,rgb,a in [('color','color.jpg','height.png'),('surface','normal.jpg','rough.jpg')]:
  im=Image.open(p/rgb).convert('RGB');ch=Image.open(p/a)
  if ch.mode.startswith('I'):ch=Image.fromarray((np.asarray(ch)/257).clip(0,255).astype('uint8'))
  # Our terrain samples raw top-down rows: positive texture V increases image row.
  # Poly Haven nor_gl uses the opposite bitangent; convert once before BC3/mips.
  if k=='surface':
   rr,gg,bb=im.split();im=Image.merge('RGB',(rr,gg.point(lambda v:255-v),bb))
  im.putalpha(ch.convert('L'));f=TMP/(ident+'-'+k+'.png');im.save(f);subprocess.run(['texconv','-nologo','-y','-bc','u','-f','BC3_UNORM','-m','0','-if','BOX','-o',str(OUT),str(f)],check=True);d=OUT/(f.stem+'.dds');assert d.read_bytes()[84:88]==b'DXT5';r[k+'Hash']=sha(d)
 rows.append(r)
(OUT/'materials.json').write_text(json.dumps(rows,indent=2)+'\n')
def writegeo(name,p,n,uv,faces):
 a=np.concatenate([p,n,uv],axis=1).astype('<f4');i=np.asarray(faces,dtype='<u2').ravel();assert len(a)<65536;(OUT/(name+'.bin')).write_bytes(a.tobytes()+i.tobytes());return dict(file=name+'.bin',vertices=len(a),triangles=len(i)//3)
p=SRC/'jacaranda_tree';g=json.loads((p/'model.gltf').read_text());
for i,m in enumerate(g['materials']):
 f=g['images'][g['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]['uri'];im=Image.open(p/f).convert('RGBA').resize((1024,1024));
 if i==2:im.putalpha(Image.open(p/'alpha.png').convert('L').resize(im.size))
 (p/(str(i)+'.rgba')).write_bytes(im.tobytes())
subprocess.run(['node',str(ROOT/'tools/remaster/crown-slices.mjs'),str(p),str(TMP)],check=True)
N=512;img=np.fromfile(TMP/'crown.rgba','u1').reshape(N*3,N*4,4);z=np.fromfile(TMP/'crown-depth.bin','<f4').reshape(N*3,N*4);bounds=[[-14,13],[-11,11],[-.4,21]];geos=[]
for res,name in [(8,'jacaranda'),(4,'jacaranda-far')]:
 P=[];V=[];UV=[];I=[]
 for side,(u,v,w) in enumerate([(0,2,1),(1,2,0),(0,1,2)]):
  for sl in range(4):
   d=z[side*N:(side+1)*N,sl*N:(sl+1)*N];base=len(P)
   for j in range(res+1):
    for i in range(res+1):
     x=i/res;y=j/res;rad=N//res;region=d[max(0,round(y*N)-rad):min(N,round(y*N)+rad),max(0,round(x*N)-rad):min(N,round(x*N)+rad)];ds=region[np.isfinite(region)];q=[0.,0.,0.];q[u]=x;q[v]=1-y;q[w]=float(ds.mean()) if len(ds) else (sl+.5)/4;pt=np.array([a+(b-a)*k for (a,b),k in zip(bounds,q)]);P.append(pt);n=np.array([pt[0]/11,pt[1]/10,max(.25,(pt[2]-9)/7)]);V.append(n/np.linalg.norm(n));UV.append(((sl+(.5+x*(N-1))/N)/4,(side+(.5+y*(N-1))/N)/3))
   for j in range(res):
    for i in range(res):
     if not np.isfinite(d[j*N//res:(j+1)*N//res,i*N//res:(i+1)*N//res]).any():continue
     a=base+j*(res+1)+i;b=a+res+1;I.extend([a,b,a+1,b,b+1,a+1]);
 geos.append(writegeo(name,np.array(P),np.array(V),np.array(UV),I))
# Bleed nearest opaque RGB into the alpha margins, so foliage mips don't pick up black fringes.
for j in range(3):
 for i in range(4):
  tile=img[j*N:(j+1)*N,i*N:(i+1)*N];mask=tile[:,:,3]==0
  if (~mask).any():idx=distance_transform_edt(mask,return_distances=False,return_indices=True);tile[:,:,:3]=tile[idx[0],idx[1],:3]
Image.fromarray(img).save(OUT/'jacaranda.png')
p=SRC/'anthurium_botany_01';g=json.loads((p/'model.gltf').read_text());buf=(p/g['buffers'][0]['uri']).read_bytes();pr=g['meshes'][3]['primitives'][0]
def accessor(i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];n={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']];typ={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']];return np.frombuffer(buf,typ,count=n*a['count'],offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
for variant,name in [(3,'anthurium'),(0,'anthurium-wide'),(5,'anthurium-young')]:
 pr=g['meshes'][variant]['primitives'][0];pts,norm,uv=[accessor(pr['attributes'][s]) for s in ['POSITION','NORMAL','TEXCOORD_0']];idx=accessor(pr['indices']).reshape(-1,3);keys=np.concatenate([np.round(pts/.022),np.round(uv*26)],axis=1);_,first,inv=np.unique(keys,axis=0,return_index=True,return_inverse=True);idx=inv[idx];idx=idx[(idx[:,0]!=idx[:,1])&(idx[:,1]!=idx[:,2])&(idx[:,2]!=idx[:,0])];geos.append(writegeo(name,pts[first][:,[0,2,1]]*[1,-1,1],norm[first][:,[0,2,1]]*[1,-1,1],uv[first],idx));
im=Image.open(next((p/'textures').glob('*diff*'))).convert('RGBA');im.putalpha(Image.open(p/'alpha.png').convert('L').resize(im.size));im.thumbnail((1024,1024));im.save(OUT/'anthurium.png');im=Image.open(next((p/'textures').glob('*nor_gl*'))).convert('RGB');im.thumbnail((512,512));im.save(OUT/'anthurium-normal.png');(OUT/'models.json').write_text(json.dumps(geos,indent=2)+'\n');print(rows,geos)
