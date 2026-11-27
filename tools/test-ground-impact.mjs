import test from 'node:test';
import assert from 'node:assert/strict';
import { groundImpact, wreckImpact, walkableCraters } from '../public/js/game/ground-impact.js';
const shot = (damage,blastR=0,blastD=0) => ({ground:true,damage,z:10,w:{blastR,blastD,proj:{num:()=>0}}});

test('mounted stock weapon values produce a pinprick, shallow cannon scar, then a deeper artillery bowl',()=>{
  const samples=[shot(2),shot(18),shot(50,30,90),shot(425,85,375)].map(s=>groundImpact(s,10));
  assert.ok(samples[0].radius<2 && samples[0].depth===0);
  assert.ok(samples[1].depth>0 && samples[1].depth<1);
  assert.ok(samples[2].depth>2 && samples[2].radius<15);
  for(let i=1;i<4;i++)assert.ok(samples[i].radius>samples[i-1].radius && samples[i].depth>samples[i-1].depth);
  const absurd=groundImpact(shot(1e12,1e12,1e12),10);
  assert.ok(absurd.radius<=26 && absurd.depth<=5.5);
});
test('effective weapon overrides win; only a confirmed ground hit or sufficiently close damaging blast disturbs soil',()=>{
  let s=shot(2); s.w.proj.num=()=>10000;
  assert.equal(groundImpact(s,10).depth,0);
  assert.equal(groundImpact({...s,ground:false},10),null);
  s=shot(5,25,4);
  assert.ok(groundImpact({...s,ground:false,z:11},10).depth<groundImpact(s,10).depth);
  for(const flags of [{expired:true},{dud:true},{ground:false,z:25},{ground:false,z:NaN}])assert.equal(groundImpact({...s,...flags},10),null);
  assert.equal(groundImpact(shot(0),10),null);
  const narrow=shot(25); narrow.w.proj.num=key=>key==='Projectile_Width' ? .3 : 0;
  assert.equal(groundImpact(narrow,10).depth,0,'a narrow high-damage bolt is a burn');
  narrow.w.proj.num=key=>key==='Projectile_Width' ? 1 : 0;
  assert.ok(groundImpact(narrow,10).depth>0,'the same damage on a wide bolt leaves a shallow scar');
});
test('only grounded exploding vehicles excavate a wreck bowl',()=>{
  const tank={kind:'VEHICLE',hitRadius:11,type:{list:()=>['boom']}};
  assert.ok(wreckImpact(tank).radius<11);
  for (const flags of [{foot:true},{flies:true},{inside:true},{type:{list:()=>[]}}]) assert.equal(wreckImpact({...tank,...flags}),null);
});
test('physical soil is versioned: new solo and marked resumes only',()=>{
  for(const s of [{},{restore:{battle:{craterRule:1}}}]) assert.equal(walkableCraters(s),true);
  for(const s of [{net:{}},{shooterNet:{}},{restore:{battle:{}}},{attract:true},{headless:{}},{replay:true}])assert.equal(walkableCraters(s),false);
});
