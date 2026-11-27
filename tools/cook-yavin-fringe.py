"""Bake three complete crown silhouettes for distant scenic trees, not a new plant.
Each row in the verified Jacaranda atlas holds four depth slices of one projection.
Collapse them in depth order before minification, keeping transparent RGB bled into gutters.
"""
from pathlib import Path
import hashlib
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
ROOT=Path(__file__).resolve().parents[1]; ART=ROOT/'public/art'; OUT=ART/'yavin-fringe'; OUT.mkdir(exist_ok=True)
raw=(ART/'yavin-jungle/jacaranda.png').read_bytes();pin='7805b6a8d78db836e44b91f951fcae9f4de680ef125cacd6b158565bfd97a641';assert hashlib.sha256(raw).hexdigest()==pin
im=Image.open(ART/'yavin-jungle/jacaranda.png').convert('RGBA');assert im.size==(2048,1536)
out=Image.new('RGBA',(768,256));
for side in range(3):
    view=Image.new('RGBA',(512,512));
    for k in range(4):view.alpha_composite(im.crop((512*k,512*side,512*k+512,512*side+512)))
    pane=Image.new('RGBA',(256,256));pane.paste(view.resize((246,246),Image.Resampling.LANCZOS),(5,5));a=np.array(pane);holes=a[:,:,3]<4;assert .05<1-holes.mean()<.9
    nearest=distance_transform_edt(holes,return_distances=False,return_indices=True);a[:,:,:3]=a[nearest[0],nearest[1],:3];out.paste(Image.fromarray(a),(256*side,0))
out.save(OUT/'jacaranda-horizon.png',optimize=True)
