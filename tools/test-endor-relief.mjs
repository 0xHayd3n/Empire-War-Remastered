import * as T from 'three';
import assert from 'node:assert/strict';
import { scatteredHeight } from '../public/js/endor-tiles.js';
import { reliefPatch, sampleHeight } from '../public/js/game/endor-relief.js';
let displacementReads = 0;
const h = {
  size: 64,
  data: Uint8Array.from({ length: 4096 }, (_, i) => Math.round(128 + 100 * Math.sin((2 * Math.PI * (i % 64)) / 64))),
  mean: 0.5,
  get amplitude() { displacementReads++; return 2; }
};
assert(Math.abs(sampleHeight(h, 0.43, 0.25) - sampleHeight(h, 1.43, -1.75)) < 1e-6);
const n = 9,
  geo = new T.BufferGeometry();
geo.setAttribute('normal', new T.BufferAttribute(new Float32Array(3 * 6 * 64), 3));
geo.setAttribute('layers', new T.BufferAttribute(new Float32Array(4 * 6 * 64), 4));
for (let i = 0; i < 6 * 64; i++) geo.attributes.normal.setXYZ(i, 0, 0, 1);
const t = { size: n, heights: new Float32Array(n * n), paint: { geo, triAt: Int32Array.from({ length: 128 }, (_, i) => 3 * i) } };
const u = {
  texU: { value: [new T.Vector4(1 / 40, 0, 0, 0)] },
  texV: { value: [new T.Vector4(0, 1 / 40, 0, 1)] },
  reliefPatch: { value: new T.Vector4() }
};
const ground = new T.Mesh(geo, new T.ShaderMaterial({ uniforms: u })),
  p = reliefPatch(ground, t, [h]);
p.update({ x: 80, y: 80, dist: 22 }, true);
assert.equal(p.triangles, 8 * 8 * 12 * 12 * 2);
assert(p.heightRange > 1);
const mesh = ground.children[0],
  pos = mesh.geometry.attributes.position;
assert(mesh.visible);
assert(displacementReads <= pos.count, `single-slot rebuild evaluated ${displacementReads} donor displacements for ${pos.count} vertices`);
for (let i = 0; i < pos.count; i++)
  if ([0, 160].includes(pos.getX(i)) || [0, 160].includes(pos.getY(i))) assert.equal(Math.abs(pos.getZ(i)), 0);
if (process.env.RELIEF_BENCH) {
  const rebuild = () => {
    geo.attributes.layers.needsUpdate = true;
    const at = performance.now();
    p.update({ x: 80, y: 80, dist: 22 }, true);
    return performance.now() - at;
  };
  for (let i=0;i<10;i++) rebuild();
  const times=Array.from({length:35},rebuild).sort((a,b)=>a-b);
  console.log('Single-material patch rebuild (ms): median',times[17].toFixed(2),'p90',times[31].toFixed(2));
}
// Same donor but different projection: merging by family instead of draw slot would
// distort a rotated layer. Check a fully weighted sample on a shared cell edge too.
u.texU.value.push(new T.Vector4(0,-1/40,0,0));
u.texV.value.push(new T.Vector4(1/40,0,0,1));
const layer=geo.attributes.layers;
for(let i=0;i<layer.count;i++)layer.setXYZW(i,0,1,0,1);
layer.needsUpdate=true;
p.update({x:80,y:80,dist:22},true);
for(const step of [3,6,12]) {
  const x=60+20*step/12,y=70,mix=step/12;
  const height=(u,v)=>(scatteredHeight(sampleHeight,h,u,v,0)-.5)*2;
  const expected=(1-mix)*height(x/40,y/40)+mix*height(-y/40,x/40);
  // Duplicated vertices on the far boundary of this cell must use this cell's slots.
  const i=((3*8+3)*13+6)*13+step;
  assert(Math.abs(pos.getZ(i)-expected)<1e-6);
}
// Hole compaction may move a perimeter fan to a different packed slot. Only
// those indices may change; corners and indices for an unchanged layout stay resident.
const patchGeo=mesh.geometry, index=patchGeo.index, corner=patchGeo.attributes.corner;
const versions=[index.version,corner.version], indices=index.array.slice(), corners=corner.array.slice();
for(let y=0;y<n;y++)for(let x=0;x<n;x++)t.heights[y*n+x]=7*Math.cos(.94*x+.73*y)+4*Math.sin(1.2*x-.4*y);
const originalHeights=t.heights.slice(), absent=3*8+3;
t.paint.triAt[absent*2]=-1; layer.needsUpdate=true;
p.update({x:80,y:80,dist:22},true);
assert.equal(p.triangles,63*12*12*2);
assert.equal(p.surface(70,70,404),404,'missing cell must not cover the coarse surface');
const perCell=12*12*6;
for(let q=0;q<63;q++){
  const cell=q<absent?q:q+1, off=q*perCell, src=cell*perCell;
  for(let k=0;k<perCell;k++)assert.equal(index.array[off+k]-q*169,indices[src+k]-cell*169,'wrong edge stitching after a hole');
}
let area=0;
for(let k=0;k<patchGeo.drawRange.count;k+=3){
  const a=index.array[k],b=index.array[k+1],c=index.array[k+2];
  const ax=pos.getX(a),ay=pos.getY(a),bx=pos.getX(b),by=pos.getY(b),cx=pos.getX(c),cy=pos.getY(c);
  const twice=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
  assert(twice>=0,'back-facing stitch triangle'); if(!twice)continue;
  area+=twice/2;
  for(const [x,y] of [[ax,ay],[bx,by],[cx,cy]]){
    if(x===0||x===160)assert.equal(y%20,0,'T-junction on vertical perimeter');
    if(y===0||y===160)assert.equal(x%20,0,'T-junction on horizontal perimeter');
  }
  const actual=(pos.getZ(a)+pos.getZ(b)+pos.getZ(c))/3;
  assert(Math.abs(p.surface((ax+bx+cx)/3,(ay+by+cy)/3,404)-actual)<.0001,'surface sampler must match drawn fan or subtriangle');
}
assert(Math.abs(area-63*20*20)<.01,'hole kept open and all surrounding cells covered');
assert.deepEqual(corner.array,corners);
assert.equal(corner.version,versions[1]);assert.equal(index.version,versions[0]+1);
const stitched=index.version;layer.needsUpdate=true;p.update({x:80,y:80,dist:22},true);
assert.equal(index.version,stitched,'do not reupload identical stitching');
const saved = pos.version;
p.update({ x: 80.5, y: 80.5, dist: 24 }, true);
assert.equal(pos.version, saved);
p.update({ x: 80, y: 80, dist: 450 }, true);
assert.equal(p.triangles, 0);
assert.deepEqual(u.reliefPatch.value.toArray(), [0, 0, 0, 0]);
// A newly published crater takes the cell even without a camera pan or
// repaint. Close relief must never draw a temporary lid over that depression.
t.craterGeometry={revision:1,ownsCell:(x,y)=>x===5 && y===2};
const beforeScar=displacementReads;
p.update({x:80,y:80,dist:22},true);
assert.equal(p.triangles,62*12*12*2);
assert.equal(p.surface(107,48,-3.2),-3.2);
assert.equal(displacementReads,beforeScar,'scar topology reuses the cached donor heights');
delete t.craterGeometry;
t.paint.triAt.fill(-1); layer.needsUpdate=true;
p.update({x:80,y:80,dist:22},true);
assert.equal(p.triangles,0); assert.equal(p.heightRange,0);
assert.deepEqual([index.version,corner.version],[stitched+1,versions[1]]);
assert.deepEqual(t.heights,originalHeights);
p.dispose();
assert.equal(ground.children.length, 0);
console.log('PASS real displaced triangle heights, zero-displacement seams, unchanged simulation, no patch while zoomed out');
