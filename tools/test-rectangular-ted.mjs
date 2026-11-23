import assert from 'node:assert/strict';
import {parseTED} from '../public/js/ted.js';
import {register} from 'node:module';
// Use the same local Three module as the game's browser import map, without WebGL or an install.
const three = new URL('../public/vendor/three/build/three.module.js',import.meta.url).href;
register('data:text/javascript,'+encodeURIComponent(`export function resolve(name,ctx,next){return name==='three'?{url:${JSON.stringify(three)},shortCircuit:true}:next(name,ctx)}`),import.meta.url);
const {buildTerrain,buildWater,heightAt,paveTerrain} = await import('../public/js/game/terrain.js');
const u32 = n => { const b=Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const chunk=(kind,bytes,container=false)=>Buffer.concat([u32(kind),u32(bytes.length+(container?0x80000000:0)),bytes]);
const header=(kind,value)=>Buffer.concat([Buffer.from([kind,4]),u32(value)]);
function fixture(w,h,vertices=w*h) {
  const grid=Buffer.alloc(vertices*4),flags=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,label=10*y+x;
    if(i<vertices){grid.writeInt16LE(label,4*i);grid[i*4+2]=x;grid[i*4+3]=y+1;}
    flags.writeUInt32LE(label,4*(x*h+y));
  }
  const info=chunk(0,Buffer.concat([header(0,w),header(1,h),header(4,w*h)]));
  return Uint8Array.from(chunk(1,Buffer.concat([chunk(0x101,Buffer.concat([info,chunk(5,grid)]),true),chunk(0x10a,flags)]),true)).buffer;
}
for(const [w,h] of [[4,3],[3,4],[4,4]]){
  const m=parseTED(fixture(w,h)),t=m.terrain;assert.ok(t,`decode complete ${w}x${h} terrain`);assert.deepEqual([t.width,t.height,t.size],[w,h,Math.max(w,h)]);
  assert.deepEqual(m.max,[(w-1)*20,(h-1)*20]);assert.deepEqual(m.playMax,m.max);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*t.size+x,label=10*y+x;assert.equal(t.heights[i],label*25/512);assert.equal(t.passability[i],label);assert.equal(t.layerIndex[i],x);assert.equal(t.shade[i],y+1);
  }
  t.water={mode:2,level:100,tint:[1,1,1],glint:[1,1,1],textures:['','',''],ripples:[]};
  const ground=await buildTerrain(t),water=buildWater(t);
  for(const mesh of [ground,water.children[0]]){
    const geo=mesh.geometry;geo.computeBoundingBox();
    assert.deepEqual(geo.boundingBox.min.toArray().slice(0,2),[0,0]);
    assert.deepEqual(geo.boundingBox.max.toArray().slice(0,2),m.max);
    assert.equal(geo.getAttribute('position').count,6*(w-1)*(h-1));
  }
  assert.equal(heightAt(t,20*(w-1.5),20*(h-1.5)),(w-1.5+10*(h-1.5))*25/512);
  const last=(h-1)*t.size+w-1;t.paint.slot.set(t.layerIndex[last],0);t.paint.slot.set(10,1);
  paveTerrain(t,[last],10);const lay=ground.geometry.getAttribute('layers');assert.equal(lay.getW(lay.count-1),1);
  assert.equal(parseTED(fixture(w,h,Math.min(w,h)**2-1)).terrain,null);
}
assert.equal(parseTED(fixture(3,4,9)).terrain,null,'truncated rectangle must not become a square');
console.log('Rectangular TED: both orientations, square regression, authored XY extent, heights/materials/shade, column-major passability, mesh/water extents, edge repaint and truncation OK');
