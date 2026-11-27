import assert from 'node:assert/strict';
import fs from 'node:fs';
import {climatePlan,sandPair,verifyClimate} from './climate.mjs';
const file=new URL('./directions/801c35a32439b92bb81d9f45c3aa6b405dc260362096156eb42e25ae84acd9e5.json',import.meta.url),d=JSON.parse(fs.readFileSync(file)),job={id:d.job,environments:d.climate.skies.map(name=>({name,weather:'SANDSTORM_RANDOM'}))};
climatePlan(job,d);for(const patch of [{skies:d.climate.skies.slice(1)},{exceptions:''},{evidence:['not an inspected reference']},{pairs:[d.climate.pairs[0],d.climate.pairs[0]]}])assert.throws(()=>climatePlan(job,{...d,climate:{...d.climate,...patch}}));
const im=(left,right)=>{const data=new Uint8Array(96*64*4);for(let y=0;y<64;y++)for(let x=0;x<96;x++)data.set([...(x<48?left:right),255],4*(96*y+x));return {width:96,height:64,data};},pts=[[20,30],[70,30]];
// The neutral-diffuse control keeps true warm light / shade. The previous mounted western sand did not.
const light=im([149,121,70],[156,127,73]),old=im([188,127,65],[153,126,83]);assert(sandPair(old,light,pts).residual>.19);assert(sandPair(light,light,pts).residual===0);assert(sandPair(im([108,84,63],[180,144,108]),im([90,70,50],[150,120,85]),pts).residual<.02);assert.throws(()=>sandPair(old,light,[[3,3],pts[1]]));assert.throws(()=>sandPair(im([0,0,0],[70,70,70]),light,pts),/Clipped/);
await assert.rejects(verifyClimate(job,d,{job:d.job},'.'),/Missing matching/);console.log('PASS climate: exact skies, local evidence, separate regions, old Tatooine cast, real lighting, clipped windows and missing audit');
