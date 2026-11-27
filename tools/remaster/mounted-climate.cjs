// Private capture diagnostic, never imported by gameplay. BC3 stores alpha/height in
// bytes 0..7. The control replaces RGB only, at every mip/array slice. The world, normal,
// roughness, displacement, coverage, fog, daylight, weather clock and post pass keep running as drawn.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=async function mountedClimate(body,page,out,report,plan,PNG){
 const draw=async v=>body.evaluate((_,c)=>yavinDraw({c,on:true,warmFrames:12}),report.cameras[v]);
 await draw('command');await body.evaluate(async()=>{const T=await import('three'),g=game,U=g.ground.material.uniforms,A=U.soilColor.value,spec=U.matSpecular.value,env=g.map.environment,vec=new T.Vector3(148/255,134/255,110/255),word=((148>>3)<<11)|((134>>2)<<5)|(110>>3);
  const m=A.mipmaps.map(m=>{const data=m.data.slice();for(let j=8;j<data.length;j+=16){data[j]=data[j+2]=word&255;data[j+1]=data[j+3]=word>>8;data.fill(0,j+4,j+8);}return {...m,data};});
  const neutral=new T.CompressedArrayTexture(m,A.image.width,A.image.height,A.image.depth,A.format);for(const k of ['wrapS','wrapT','magFilter','minFilter','colorSpace','anisotropy'])neutral[k]=A[k];neutral.needsUpdate=true;
  const ns=spec.map(()=>vec);window.climateControl={color(on){U.map.value=U.soilColor.value=on?neutral:A;U.matSpecular.value=on?ns:spec;},async sky(name){const e=g.map.environments.find(x=>x.name===name);if(!e||e.weather!==env.weather)throw Error('Use a separately launched authored weather scenario for '+name);if(g.map.environment!==e)await g.applyEnvironment(e);},async reset(){this.color(false);if(g.map.environment!==env)await g.applyEnvironment(env);neutral.dispose();}};
 });
 const hash=b=>createHash('sha256').update(b).digest('hex'),capture=async(n)=>{const b=await page.screenshot();fs.writeFileSync(path.join(out,n+'.png'),b);return {hash:hash(b),png:PNG.sync.read(b)};};
 const sameGround=(a,b)=>{let changed=0;for(let y=105;y<535;y++)for(let x=115;x<1325;x++){const j=4*(y*a.width+x);if([0,1,2].reduce((s,k)=>s+Math.abs(a.data[j+k]-b.data[j+k]),0)>12)changed++;}if(changed>40)throw Error('Climate probe did not restore mounted pixels: '+changed);};
 await page.locator('#game').contentFrame().locator('#messages > *').first().waitFor({state:'detached',timeout:20000});
 // Scenery LOD is hysteretic. Approach both baseline and restored command views from
 // the same camera, with the same stock props still visible; don't disable LOD or mask them.
 const arrival=plan.pairs.at(-1).view,approach=async()=>{await draw(arrival);await draw('command');};await approach();
 const before=(await capture('climate-start')).png,states=[];
 try{for(const [i,name] of plan.skies.entries()){
  await body.evaluate((_,n)=>climateControl.sky(n),name);await draw('squad');
  const s=await body.evaluate(()=>{const g=game,e=g.map.environment,w=g.world.weather;return {name:e.name,scenario:e.weather||'',phase:w.i,weather:w.name,level:w.level,phases:w.phases.map(p=>[p.name,p.strength]),lights:e.lights.map(l=>[l.color,l.dir]),skyReady:g.skyAtlasState?.left===0&&!!g.landFinish?.daylight&&g.landFinish.sky===g.sky};});s.views={};states.push(s);
  for(const v of new Set(['squad',...plan.pairs.map(p=>p.view)])){await draw(v);const f=`climate-${i}-${v}-`,lit=await capture(f+'lit');s.views[v]={lit:lit.hash};if(!plan.pairs.some(p=>p.view===v))continue;
   await body.evaluate(()=>climateControl.color(true));await draw(v);const ctrl=await capture(f+'control');s.views[v].control=ctrl.hash;
   await body.evaluate(()=>climateControl.color(false));await draw(v);sameGround(lit.png,PNG.sync.read(await page.screenshot()));
  }
 }}finally{await body.evaluate(async()=>{await climateControl.reset();delete window.climateControl;});}
 await approach();sameGround(before,(await capture('climate-restored')).png);return {stamp:report.terrainSources.stamp,states,restored:true};
};
