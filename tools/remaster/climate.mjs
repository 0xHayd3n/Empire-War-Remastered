// A local same-substrate test, not a planet-wide hue or exposure target.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {decodePNG} from '../../public/js/png.js';
const safe=s=>typeof s==='string'&&/^[a-z][a-z0-9-]{0,40}$/.test(s);
const prose=s=>typeof s==='string'&&s.trim().length>=20;
export function climatePlan(job,d){
  const c=d.climate,envs=(job.environments||[]).map(e=>e.name);
  if(!c||!prose(c.substrate)||!prose(c.lighting)||!prose(c.exceptions)||!Array.isArray(c.evidence)||new Set(c.evidence).size<2||c.evidence.some(h=>!d.views.some(v=>v.sha256===h)))throw Error('Review substrate, light/weather, intentional exceptions and cite two inspected place views');
  if(!envs.length||!Array.isArray(c.skies)||new Set(c.skies).size!==c.skies.length||envs.some(n=>!c.skies.includes(n))||c.skies.some(n=>!envs.includes(n)))throw Error('Account for the mounted authored environments by name');
  if(!Array.isArray(c.pairs)||c.pairs.length<2||new Set(c.pairs.map(p=>p.view)).size!==c.pairs.length)throw Error('Need same-substrate controls in two different regions');
  for(const p of c.pairs){if(!safe(p.view)||!prose(p.basis)||!Number.isFinite(p.limit)||p.limit<=0||p.limit>=1||p.points?.length!==2||p.points.some(pt=>pt.length!==2||!pt.every(Number.isInteger))||Math.hypot(...p.points[0].map((x,i)=>x-p.points[1][i]))<=25)throw Error('Invalid ground-only sample pair or chroma tolerance');}
  return c;
}
function windowRGB(im,[x,y]){
  const r=12,cs=[[],[],[]];if(x-r<0||y-r<0||x+r>=im.width||y+r>=im.height)throw Error('Ground sample outside mounted image');
  for(let j=y-r;j<=y+r;j++)for(let i=x-r;i<=x+r;i++){const off=4*(j*im.width+i);for(let k=0;k<3;k++)cs[k].push(im.data[off+k]);}
  return cs.map(a=>{a.sort((x,y)=>x-y);return a[a.length>>1];});
}
// Difference of display log-chromaticities; subtract that difference with only BC3 diffuse RGB held constant.
// Light color, slope, shade, weather, normals, roughness and visibility remain free to differ.
export function sandPair(lit,control,points){
  if(lit.width!==control.width||lit.height!==control.height)throw Error('Different climate viewports');
  function sample(im){const rgb=points.map(p=>windowRGB(im,p));if(rgb.flat().some(n=>n<=6||n>=249))throw Error('Clipped ground sample is not a color control');const [a,b]=rgb;return {rgb,delta:[0,2].map(i=>Math.log(a[i]/a[1])-Math.log(b[i]/b[1]))};}
  const a=sample(lit),b=sample(control);return {lit:a.rgb,control:b.rgb,residual:Math.max(...a.delta.map((x,i)=>Math.abs(x-b.delta[i])))};
}
export const needsClearInterval=states=>states.some(s=>s.phases.some(([n,v])=>n==='clear'&&v===0)&&s.phases.some(([,v])=>v>=.5));
export async function verifyClimate(job,d,r,dir){
  const c=climatePlan(job,d),rows=[];
  async function verify(report,folder,primary){
    const audit=report.climateAudit;
    if(audit?.states?.length!==c.skies.length||audit.stamp!==r.terrainSources?.stamp||audit.restored!==true||report.job!==r.job||report.backend!==r.backend||report.textureMip!==r.textureMip)throw Error('Missing matching mounted climate audit');
    for(const [i,name] of c.skies.entries()){
      const s=audit.states[i],env=job.environments.find(e=>e.name===name);
      if(s?.name!==name||s.scenario!==(env.weather||'')||!Number.isFinite(s.level)||!Number.isInteger(s.phase)||!s.weather||!s.lights?.length||!s.skyReady||!s.views?.squad||!Array.isArray(s.phases))throw Error('Missing actual authored sky/light/weather receipt: '+name);
      if(!primary){const other=r.climateAudit.states[i];if(JSON.stringify(s.phases)!==JSON.stringify(other.phases)||other.level<.5||s.weather!=='clear'||s.level!==0)throw Error('Need strong weather and its natural clear interval');}
      for(const view of new Set(['squad',...c.pairs.map(p=>p.view)])){
        if(!report.cameras?.[view]||String(report.cameras[view])!==String(r.cameras[view]))throw Error('Climate control moved cameras: '+view);
        const read=async pass=>{const f=`climate-${i}-${view}-${pass}.png`,bytes=fs.readFileSync(path.join(folder,f));if(createHash('sha256').update(bytes).digest('hex')!==s.views[view]?.[pass])throw Error('Changed climate image '+f);return decodePNG(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
        const lit=await read('lit'),p=c.pairs.find(p=>p.view===view);if(!p)continue;
        if(s.views[view].lit===s.views[view].control)throw Error('Albedo control did not draw');
        const m=sandPair(lit,await read('control'),p.points);if(m.residual>p.limit)throw Error(`${name} ${view}: material chroma disagreement ${m.residual.toFixed(3)} > ${p.limit}`);
        rows.push({sky:name,weather:s.weather,view,...m});
      }
    }
  }
  await verify(r,dir,true);
  if(needsClearInterval(r.climateAudit.states)){
    const folder=path.join(dir,'climate-clear'),f=path.join(folder,'report.json');if(!fs.existsSync(f))throw Error('Review the actual clear interval of the authored weather schedule');
    const other=JSON.parse(fs.readFileSync(f));if(other.kind!=='partial-climate')throw Error('Not a mounted climate capture');await verify(other,folder,false);
  }
  return rows;
}
