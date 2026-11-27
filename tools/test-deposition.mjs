// Can a broad, flat patch of the same natural substrate actually change character?
// A shifted/rotated scan and the legacy layout both keep passing the normalization test.
import assert from 'node:assert/strict';
import { composeGround } from '../public/js/game/ground-composition.js';
import { hothRecipe } from '../public/js/hoth-recipe.js';
import { tatooineRecipe } from '../public/js/tatooine-recipe.js';
for(const [r,other] of [[hothRecipe,1],[tatooineRecipe,5]]){
  const size=128,width=100,height=100,t={size,width,height,layerIndex:new Uint8Array(size*height),heights:new Float32Array(size*height)},
    used=Object.keys(r.slots).map(Number),zones={built:new Set(),authorized:()=>false},field=()=>composeGround(t,used,r.composition,null,[],zones),f=field(),xs=[],steps=[];
  for(let y=10;y<90;y++)for(let x=10;x<90;x++){
    const a=f.corner(y*width+x,0),b=f.corner(y*width+x,other);
    assert(a+b>.60 && f.corner(y*width+x,2)===0,'An open flat acquired bedrock or lost its mantle');
    xs.push(a/(a+b));if(x>10)steps.push(Math.abs(xs.at(-1)-xs.at(-2)));
  }
  const q=(v,p)=>v[Math.floor(v.length*p)];xs.sort((a,b)=>a-b);steps.sort((a,b)=>a-b);
  const span=q(xs,.90)-q(xs,.10);assert(span>.20,`${r.option}: same-substrate p10–90 span ${span.toFixed(3)}; the plain repeats one mix`);
  assert(q(steps,.90)<span*.42,'Confetti instead of connected deposits');assert.deepEqual(f.bytes,field().bytes,'Layout drifted on rebuild');
  assert(t.heights.every(x=>x===0)&&t.layerIndex.every(x=>x===0),'Variation modified authored state');console.log(r.option,{span,neighborP90:q(steps,.9)});
}
