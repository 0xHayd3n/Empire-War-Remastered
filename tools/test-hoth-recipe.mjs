import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hothRecipe as r} from '../public/js/hoth-recipe.js';
import {composeGround} from '../public/js/game/ground-composition.js';
import {decodeDXT} from '../public/js/ddsdecode.js';
import {parseDDS} from '../public/js/dds.js';
import {auditDonors} from './remaster/surface-audit.mjs';
const root=new URL('../public/art/',import.meta.url);assert.equal(r.path,'DATA/ART/MAPS/_MP_LAND_HOTH.TED');assert.equal(r.edition,'foc');assert.equal(Object.keys(r.slots).length,28);assert.equal(r.outskirts.treeClass,null);assert.deepEqual(Object.keys(r.retainedPlants),[]);assert(r.nonLivingProps.includes('RB_IONCANNON.ALO'));
for(const d of r.donors){for(const k of ['color','surface']){const file=fs.readFileSync(new URL(`${d.pack||'endor-terrain'}/${d.id}-${k}.dds`,root));assert.equal(createHash('sha256').update(file).digest('hex'),d[k+'Hash']);const a=parseDDS(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength));assert.equal(a.width,2048);assert.equal(a.mipmaps.length,12);if(k!=='surface'||!['wind-snow','tracked-firn','frost-rubble'].includes(d.id))continue;
 // A rotated scan must not rotate a tilted average plane. Retain the variance of its local slopes.
 const m=a.mipmaps.find(m=>m.width===128),px=decodeDXT(m.data,128,128,5),N=128*128;let sx=0,sy=0,power=0;for(let i=0;i<px.length;i+=4){const z=Math.max(20,px[i+2]-127.5),x=(px[i]-127.5)/z,y=(px[i+1]-127.5)/z;sx+=x;sy+=y;power+=x*x+y*y;}assert(Math.hypot(sx,sy)/N<.035,`Biased tangent plane in ${d.id}`);assert(Math.sqrt(power/N)>.08,`Grain flattened in ${d.id}`);}}
for(const d of Object.values(auditDonors(r.donors)))assert(d.normalCorrelation.every(x=>x>0));
const size=64,width=35,height=33,layerIndex=new Uint8Array(size*size).fill(3),heights=new Float32Array(size*size),t={size,width,height,layerIndex,heights},used=Object.keys(r.slots).map(Number),zones={built:new Set(),authorized:()=>false},field=()=>composeGround(t,used,r.composition,null,[],zones),get=f=>Array.from(f.sample(260,250,new Float64Array(7)));
const flat=get(field());assert(flat[0]>.8 && flat[2]+flat[3]===0,'A rocky TED swatch cut a hole in the snow mantle');for(let y=0;y<height;y++)for(let x=0;x<width;x++)heights[y*size+x]=26*x;const steep=get(field());assert(steep[3]>.6,'Real exposed face was buried');assert.equal(layerIndex[0],3);console.log('PASS Hoth: exact stock binding, complete native scans, measured level normals with grain, continuous mantle, slope-driven exposure, treeless surroundings');
