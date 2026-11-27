import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainCraters } from '../public/js/game/terrain-craters.js';
import { makeMap } from './craters/fixture.mjs';
const make=(opts={})=>{const {terrain,mesh}=makeMap(30);return new TerrainCraters(terrain,mesh,{fixedGrid:10,...opts});};

test('visibility, publication and save reload do not change any walkable height',()=>{
  const live=make(), fog=make(), loaded=make();
  for(const [x,y,r] of [[103,106,16],[111,109,6],[126,108,9]]) {
    assert.ok(live.hit(x,y,r)); assert.ok(fog.hit(x,y,r,{concealed:true}));
  }
  assert.ok(loaded.restore(JSON.parse(JSON.stringify(fog.snapshot()))));
  assert.equal(fog.drawnOffsetAt(103,106),0);
  function check() {for(let x=81.7;x<141;x+=1.5)for(let y=86.8;y<130;y+=1.5) {
    const z=live.offsetAt(x,y); assert.equal(fog.offsetAt(x,y),z);assert.equal(loaded.offsetAt(x,y),z);
    assert.ok(Math.abs(live.drawnOffsetAt(x,y)-z)<2e-5);
  }}
  check(); assert.equal(fog.reveal((x)=>x>120),1);check(); assert.equal(fog.reveal(()=>true),2);check();
});
test('concealed and displayed hits reserve the same finite ground area',()=>{
  const live=make({maxPatchVerts:1000}), fog=make({maxPatchVerts:1000});
  let accepted=0,missed=0;
  for(let y=50;y<340;y+=40) for(let x=50;x<300;x+=40) {
    const ok=!!live.hit(x,y,5); assert.equal(!!fog.hit(x,y,5,{concealed:true}),ok); if(ok)accepted++;else missed++;
  }
  assert.ok(accepted && missed); assert.equal(fog.reveal(()=>true),accepted); assert.equal(fog.offsetAt(50,50),live.offsetAt(50,50));
});
