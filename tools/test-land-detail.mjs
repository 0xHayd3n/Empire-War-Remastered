import assert from 'node:assert/strict';
import * as T from 'three';
import { readFileSync } from 'node:fs';
import { landIndexLod } from '../public/js/game/land-index-lod.js';
import { projectedDiameter, worldDiameter, landDetailLevel } from '../public/js/game/land-detail.js';
const cam = new T.PerspectiveCamera(55, 16/9, 1, 12000);
const levels = [];
for (const [y,z] of [[-180,60],[-740,650],[-2200,1950],[-740,650],[-180,60]]) {
  cam.position.set(40,y,z); cam.up.set(0,0,1); cam.lookAt(40,0,0); cam.updateMatrixWorld();
  const px=worldDiameter(cam,720,40,0,0,40);
  levels.push(landDetailLevel(px,levels.at(-1)));
}
assert.deepEqual(levels,[0,1,2,1,0]);
assert.equal(projectedDiameter(8,-50,720,2),0);
assert.equal(projectedDiameter(8,100,720,2,false),projectedDiameter(8,200,720,2,false));
assert(landDetailLevel(36,2)===2 && landDetailLevel(36,1)===1);
assert.equal(landDetailLevel(104,1),1);assert.equal(landDetailLevel(104,0),0);
assert(worldDiameter(cam,1080,40,0,0,40)>worldDiameter(cam,720,40,0,0,40));
const art = new URL('../public/art/yavin-jungle/',import.meta.url);
const proxy=JSON.parse(readFileSync(new URL('models.json',art))).find(r=>r.file==='jacaranda-far.bin');
const bytes=readFileSync(new URL(proxy.file,art)), xyz=new Float32Array(3*proxy.vertices), uv=new Float32Array(2*proxy.vertices);
for(let i=0;i<proxy.vertices;i++){
  for(let j=0;j<3;j++)xyz[i*3+j]=bytes.readFloatLE(32*i+4*j);
  for(let j=0;j<2;j++)uv[i*2+j]=bytes.readFloatLE(32*i+24+4*j);
}
const idx=new Uint16Array(bytes.buffer,bytes.byteOffset+proxy.vertices*32,3*proxy.triangles);
const low=await landIndexLod(idx,xyz,uv,.3,.025);
assert(low && low.length<idx.length/2 && low.every(i=>i<proxy.vertices));
// Check that the tree still spans the original height and horizontal silhouette.
for(let a=0;a<3;a++){
 const span=indices=>{const v=Array.from(indices,i=>xyz[3*i+a]);return Math.max(...v)-Math.min(...v)};
 assert(span(low)>=.94*span(idx));
}
console.log('PASS land LOD: projection, return to high geometry, resize, hysteresis; Yavin crown',idx.length/3,'→',low.length/3,'triangles');
