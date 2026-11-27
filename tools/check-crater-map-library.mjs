// Every winning land TED in both installed editions, each primary and saved
// enabled order. Additional installed add-ons are checked for otherwise omitted
// land TEDs, not described as standalone playable conversions. No game writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {readLibrary} from './workshop-library.mjs';
import {scope,installedScopes,openScope,intakeCache,catalog,sha} from './remaster/survey.mjs';
import {parseTED} from '../public/js/ted.js';
import {loadGameData} from '../public/js/gamedata.js';
import {exercise} from './craters/map-exercise.mjs';
const {values:a}=parseArgs({options:{scope:{type:'string',default:'all'},match:{type:'string',default:''},out:{type:'string',default:path.join(os.tmpdir(),'land-crater-map-library.json')}}});
const lib=readLibrary(), scopes=installedScopes(lib), included=new Set(scopes.flatMap(s=>s.split(','))), extras=[...lib.items.keys()].filter(id=>!included.has(id));
const keys=a.scope==='all'?[...scopes,...extras]:[a.scope], stock=openScope(lib,scope(lib,'foc'));
// A constant, real weapon/rig and lane order isolates terrain compatibility.
// Per-profile playable checks separately exercise mod content and full scenes.
globalThis.fetch=async input=>{const url=String(input);if(url.startsWith('api/find?q=')){const re=new RegExp(decodeURIComponent(url.slice(11)),'i');return Response.json([...stock.index.keys()].filter(k=>re.test(k)));}
 const file=stock.resolve(decodeURIComponent(url.replace(/^asset\//,'').split('?')[0]));const b=file&&stock.read(file);return new Response(b?new Uint8Array(b):null,{status:b?200:404});};
await loadGameData();
const cache=intakeCache(),looseIndex=new Map(), hashBySource=new Map();
const report={format:1,coverage:'CPU land simulation + production terrain geometry, reference stock Stormtrooper and weapons. Not full authored mission, roster, textures or GPU readback.',scopes:[],byTED:{},errors:[],complete:false};
function write(){fs.mkdirSync(path.dirname(path.resolve(a.out)),{recursive:true});fs.writeFileSync(a.out+'.tmp',JSON.stringify(report,null,1)+'\n');fs.renameSync(a.out+'.tmp',a.out);}
for(const key of keys){let vfs;const meta=scope(lib,key),extra=extras.includes(key),section={scope:key,name:meta.name,extra,land:[],space:0,unknown:[]};report.scopes.push(section);
 try{vfs=openScope(lib,meta,{looseIndex});
  for(const row of catalog(vfs,cache)){
    const e=vfs.index.get(row.key),src=e.meg||e.file;
    if(extra && !path.resolve(src).toLowerCase().startsWith(path.resolve(lib.items.get(key).folder).toLowerCase()+path.sep))continue;
    if(row.domain==='space'){section.space++;continue;}if(row.domain!=='land'){section.unknown.push(row.key);continue;}
    if(a.match&&!row.key.toUpperCase().includes(a.match.toUpperCase()))continue;
    const phys=JSON.stringify([src,e.off,e.size]), cached=hashBySource.get(phys);let bytes,digest=cached;
    if(!digest){bytes=vfs.read(row.key);digest=sha(bytes);hashBySource.set(phys,digest);}
    section.land.push({file:row.key,sha256:digest,menu:row.headerEligible});
    if(report.byTED[digest])continue;
    const result=report.byTED[digest]={scope:key,file:row.key};
    try {bytes??=vfs.read(row.key);const map=parseTED(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));result.size=[map.terrain?.width,map.terrain?.height];
      result.measure=await exercise(map);result.pass=true;
    }catch(e){result.pass=false;result.error=e.message;console.error('FAIL',key,row.key,e.stack?.split('\n').slice(0,3).join('\n'));}
    const n=Object.keys(report.byTED).length;if(n%100===0){write();console.log('Tested',n,'different TEDs');}
  }
 }catch(e){report.errors.push({scope:key,error:e.message});console.error('SCOPE ERROR',key,e.stack);}
 vfs?.close();
 console.log(key,section.land.length,'land rows,',Object.keys(report.byTED).length,'distinct tested so far');write();
}
stock.close(); report.complete=true;write();const n=Object.values(report.byTED),fail=n.filter(x=>!x.pass);
console.log(report.scopes.reduce((a,s)=>a+s.land.length,0),'scope/map rows;',n.length,'distinct TEDs;',fail.length,'failed;',a.out);
if(!n.length||fail.length||report.errors.length||report.scopes.some(s=>s.unknown.length))process.exitCode=1;
