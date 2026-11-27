import assert from 'node:assert/strict';
import {hothRecipe} from '../../public/js/hoth-recipe.js';
import {tatooineRecipe} from '../../public/js/tatooine-recipe.js';
import {checkComposition,measureVariation,validateVariation} from './composition-audit.mjs';
import {scanRepeat} from './scan-repeat.mjs';
const region={name:'control',view:'command',grid:[0,0,32,32],maxBoundary:1,maxSmallShare:1,maxJump:1},base={included:1024,adjacency:{edges:1984,fraction:.1},patches:{smallVertexFraction:0},materials:{distinct:2}},patch={name:'control',grid:region.grid,prior:base,modern:base,jump:{prior:{mean:.01},modern:{mean:.01}},replay:{match:true,changed:1}};
for(const r of [hothRecipe,tatooineRecipe]){
 const c={...r.composition,regions:[region]},v=c.variation,brief={views:c.evidence.map(sha256=>({sha256}))};
 const check=x=>validateVariation({...c,variation:x},r.slots,brief);check(v);assert.throws(()=>check(null));assert.throws(()=>check({...v,pair:[v.pair[0],v.pair[0]]}));assert.throws(()=>check({...v,pair:[v.pair[0],62]}));assert.throws(()=>check({...v,pair:null,uniformReason:'ice',evidence:'missing'}));check({...v,pair:null,uniformReason:'uninterrupted sheet',evidence:c.evidence[0]});
 const run=values=>checkComposition(c,{views:{command:{}},patchAudit:[{...patch,variation:measureVariation(values,32)}]});
 const vals=f=>Array.from({length:1024},(_,i)=>f(i%32,Math.floor(i/32)));assert.throws(()=>run(vals(()=>.52)),/Uniform/);assert.throws(()=>run(vals((x,y)=>(x+y)%2)),/speckled/);assert.throws(()=>run(vals(x=>x===0?0:null)),/connected/);// Broad, smooth stripes pass both range and neighbor-step tests. Reject a return
 // to the same mix after one AND two periods (without rejecting a simple slope).
 assert.throws(()=>run(vals(x=>.5+.36*Math.cos(2*Math.PI*x/10))),/stripes/);
 run(vals((x,y)=>(x+.18*y)/40));
 const rows=r.donors.map(scanRepeat);assert(rows.some(d=>d.aligned && d.corr.every(n=>n>.99))&&rows.some(d=>!d.aligned && d.grain>.8));
}
console.log('PASS material variation: same-substrate controls, uniform/speckled/masked refusals, organic cooked scans preserve grain, aligned paving remains periodic');
