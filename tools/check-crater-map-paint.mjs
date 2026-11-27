// Render a measured scar on each distinct installed (TED, ordered terrain art)
// combination, using the Universal window's production WebGL terrain shader.
// No game assets or pixels are persisted; saved orders need not be server ports.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {parseArgs} from 'node:util';
import {readLibrary} from './workshop-library.mjs';import {scope,openScope,fingerprint,sha} from './remaster/survey.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright-core'),paint=require('./craters/painted-map.cjs');
const {values:a}=parseArgs({options:{plan:{type:'string'},terrain:{type:'string',default:path.join(os.tmpdir(),'land-crater-map-library.json')},out:{type:'string',default:path.join(os.tmpdir(),'land-crater-map-pixels.json')},match:{type:'string',default:''},resume:{type:'boolean'}}});
if(!a.plan)throw Error('Supply --plan <report from map-remaster.mjs plan --scope all>');
const read=f=>JSON.parse(fs.readFileSync(f)), home=path.dirname(a.plan),plan=read(a.plan),lib=readLibrary(),looseIndex=new Map();
const proof=read(a.terrain), results={},receipt={coverage:'Paired WebGL crop: identical excavated mesh, actual pinned map and terrain art, fixed probe lighting; no mission props or live weather.',match:a.match,results,complete:false};
const code=fingerprint(['game/terrain.js','game/terrain-craters.js','game/terrain-cell.js','game/land-scars.js','game/crater-field.js','dds.js'].map(k=>sha(fs.readFileSync(new URL('../public/js/'+k,import.meta.url)))).concat(sha(fs.readFileSync(new URL('./craters/painted-map.cjs',import.meta.url))),sha(fs.readFileSync(new URL(import.meta.url)))));
receipt.check=code;if(a.resume&&fs.existsSync(a.out)){const old=read(a.out);if(old.check!==code||old.match!==a.match)throw Error('Evidence belongs to different code or scope');Object.assign(results,old.results);}
function write(){fs.mkdirSync(path.dirname(path.resolve(a.out)),{recursive:true});fs.writeFileSync(a.out+'.tmp',JSON.stringify(receipt,null,1)+'\n');fs.renameSync(a.out+'.tmp',a.out);}
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});let vfs;
try{const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage();
  await p.goto(process.env.EW_BASE||'http://127.0.0.1:8590/');const owner=p.frameLocator('#game');await owner.locator('[data-id="TITLE_PLAY"]').waitFor({timeout:120000});
  // Only serve the current load order's winning map and texture files to a
  // private fixture frame; do not intercept the UI, production code, or shaders.
  let wanted=new Map(),verified=new Map(),assetErrors=[];
  await ctx.route('**/__crater_inputs/asset/**',async route=>{try{
    const key=decodeURIComponent(new URL(route.request().url()).pathname.split('/__crater_inputs/asset/')[1]);
    if(!/^data[\\/](art[\\/](maps|textures)|custommaps)[\\/]/i.test(key))return route.fulfill({status:404,body:''});
    const win=vfs.resolve(key),b=win&&vfs.read(win);
    if(win&&wanted.has(win)){
      if(!verified.has(win))verified.set(win,sha(b));
      if(verified.get(win)!==wanted.get(win))throw Error('changed winning asset '+win);
    }
    await route.fulfill({status:b?200:404,body:b||'',contentType:'application/octet-stream'});
  }catch(e){assetErrors.push(e.message);await route.abort().catch(()=>{});}});
  let frame,passed=0,count=0,ctxNumber=0;const seen=new Set();
  async function reset(){ctxNumber++;await owner.locator('body').evaluate((body,i)=>{document.getElementById('crater-audit')?.remove();const f=document.createElement('iframe');f.id='crater-audit';f.name='crater-audit-'+i;f.style.cssText='width:96px;height:96px;position:fixed;left:-150px;top:0';f.srcdoc=`<base href="${location.origin}/"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script><script>window.SWR_BASE=location.origin==="null"?parent.location.origin+"/__crater_inputs/":location.origin+"/__crater_inputs/";<\/script>`;body.append(f);},ctxNumber);
    frame=p.frame({name:'crater-audit-'+ctxNumber});if(!frame){await p.waitForEvent('frameattached',{timeout:5000}).catch(()=>{});frame=p.frame({name:'crater-audit-'+ctxNumber});}await frame.waitForFunction(()=>!!window.SWR_BASE);}
  for(const group of plan.scopes){const key=group.scope.key;vfs?.close();vfs=null;verified=new Map();let local=0;
    for(const id of group.jobs){const j=read(path.join(home,'jobs',id+'.json'));if(a.match&&!j.identity.path.includes(a.match.toUpperCase()))continue;
      const k=fingerprint([j.identity.ted,j.identity.slots]);if(seen.has(k))continue;seen.add(k);count++;if(a.resume&&results[k]?.pass){passed++;continue;}
      const record=results[k]={scope:key,file:j.identity.path,ted:j.identity.ted};
      try{const measure=proof.byTED[j.identity.ted]?.measure;if(!measure)throw Error('missing independently qualified traversal site');
        if(measure.excluded){record.notApplicable=measure.excluded;continue;}
        vfs??=openScope(lib,scope(lib,key),{looseIndex});
        if(local++%40===0)await reset();wanted=new Map(j.identity.slots.flatMap(s=>[[s[1],s[2]],[s[3],s[4]]]).filter(([k,h])=>k&&h));assetErrors=[];
        record.pixels=await frame.evaluate(paint,{file:record.file,digest:record.ted,at:measure.at});
        if(assetErrors.length)throw Error(assetErrors.join('; '));record.pass=true;passed++;
      }catch(e){record.pass=false;record.error=e.message.split('\n').slice(0,3).join('\n');console.error('FAIL',key,record.file,record.error);}
      if(count%25===0){write();console.log(count,'distinct painted maps;',passed,'passed');}
    }write();console.log(key,count,passed);
  }
  receipt.complete=true;receipt.distinct=count;receipt.passed=passed;receipt.notApplicable=Object.values(results).filter(s=>s.notApplicable).length;write();if(passed+receipt.notApplicable!==count||!count)process.exitCode=1;
}finally{vfs?.close();await browser.close();}
