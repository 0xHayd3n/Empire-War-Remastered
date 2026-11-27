import assert from 'node:assert/strict';
import {forestPlan} from '../public/js/game/endor-thicket.js';
const size=65,n=size*size,t={size,heights:new Float32Array(n),layerIndex:new Uint8Array(n),water:{mode:0}},ids=[0,3,7];
// A path goes NORTH-SOUTH through every row; an adjacent construction strip and a reserved site.
for(let j=0;j<size;j++)for(let i=29;i<=34;i++)t.layerIndex[j*size+i]=i===34?2:1;
const before=t.layerIndex.slice(),safe=[{x:180,y:540,r:55}],a=forestPlan(t,ids,safe),b=forestPlan(t,ids,safe);
assert.deepEqual(a,b);assert.deepEqual(t.layerIndex,before);assert(a.quadrants.every(n=>n>20));assert(a.totals.bracken>a.totals.redwood);
for(const c of a.chunks)for(const p of c.plants){assert(p.x<29*20||p.x>34*20);assert(Math.hypot(p.x-180,p.y-540)>55);assert.equal(p.z,0);}
t.layerIndex.fill(2);assert(forestPlan(t,ids,safe).chunks.length===0);
console.log('PASS persistent multi-level population in every quadrant, path/pad exclusion, repaint and deterministic rollback');
