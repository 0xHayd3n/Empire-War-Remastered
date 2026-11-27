import assert from 'node:assert/strict';
import {composeGround} from '../public/js/game/ground-composition.js';
import {buildScenicRing} from '../public/js/game/scenic-ring.js';
import {geonosisRecipe as recipe} from '../public/js/geonosis-recipe.js';
assert.equal(recipe.path,'DATA/ART/MAPS/_MP_LAND_GEONOSIS.TED');assert.equal(recipe.edition,'foc');assert.equal(Object.keys(recipe.slots).length,31);
assert.deepEqual(Object.values(recipe.slots).filter(s=>s.use==='built').map(s=>s.family),['concrete']);assert.equal(recipe.zones[0].slot,62);
assert.equal(recipe.nonLivingProps.length,8);assert.equal(recipe.outskirts.treeClass,null);assert(!recipe.donors.some(d=>d.asset==='cliff_side'),'The crosshatched shelf was restored');
const size=64,width=53,height=49,N=size*size,t={size,width,height,heights:new Float32Array(N),layerIndex:new Uint8Array(N).fill(1)},used=[5,13,2,28,25,1,6,62];
const c=recipe.composition,zones={built:new Set([7]),authorized:(_,s)=>s===7},layout=()=>composeGround(t,used,c,null,[],zones),f=layout();
const sample=(f,x,y)=>Array.from(f.sample(x,y,new Float64Array(7)));
const open=sample(f,300,280);assert(open[0]+open[1]>.8 && !open.slice(3).some(Boolean),'Tower paint placed a floor, salt or cliff on an open flat');assert.equal(f.slotAt(9,7),7);
for(const sign of [1,-1]){
 for(let j=0;j<height;j++)for(let i=0;i<width;i++)t.heights[j*size+i]=sign*26*i;
 const a=sample(layout(),300,280);assert(a[sign===1?6:5]>.85,'Scarp chose the stretching projection');
}
t.heights.fill(0);t.layerIndex.fill(28);const salt=sample(layout(),300,280);assert(salt[3]>.08&&salt[3]<.4 && salt[0]+salt[1]>.60,'Saline hint flooded a dry channel');
const before=t.heights.slice(),ring=buildScenicRing(t,{relief:'benches',seed:934,amplitude:590}),other=buildScenicRing(t,{relief:'foothills',seed:934,amplitude:590});assert(ring.ok && other.ok);assert.notDeepEqual(ring.positions,other.positions);assert.deepEqual(t.heights,before);console.log('PASS Geonosis: dust over flat tower swatches, slope-projected shelves, subordinate salt on dry beds, separate authorized paving and exterior bench relief');
