import assert from 'node:assert/strict';
import {composeGround} from '../public/js/game/ground-composition.js';
import {tatooineRecipe as r} from '../public/js/tatooine-recipe.js';
const width=45,height=35,size=64,layerIndex=new Uint8Array(size*height).fill(r.composition.rockHints[0]),heights=new Float32Array(size*height),used=Object.keys(r.slots).map(Number),zones={built:new Set(),authorized:()=>false};
const rocks=[{modelFile:r.composition.outcrops[0],x:300,y:300}];const build=()=>composeGround({width,height,size,layerIndex,heights},used,r.composition,null,rocks,zones),flat=build();
const sample=(f,x,y)=>Array.from(f.sample(x,y,new Float64Array(7)));
for(const [x,y] of [[300,300],[340,300],[420,300],[600,300]]){const w=sample(flat,x,y);assert(w[0]+w[5]>w[3] && Math.abs(w[0]+w[3]+w[5]-1)<1e-6,'The flat fan is not all loose sediment with fine sand remaining dominant');assert.equal(w[2]+w[4],0,'Paints rock on a flat fan');assert(Math.abs(w.reduce((a,b)=>a+b)-1)<1e-6);}
for(let y=0;y<height;y++)for(let x=0;x<width;x++)heights[y*size+x]=x*20;const slope=sample(build(),300,300);assert(slope[2]+slope[4]>.8,'Genuine steep face buried under sand');assert.equal(layerIndex[0],r.composition.rockHints[0]);console.log('PASS Tatooine: contiguous loose sand across flat rocky hints and outcrop feet, genuine exposed strata on rising faces, normalized draw-only coverage');
