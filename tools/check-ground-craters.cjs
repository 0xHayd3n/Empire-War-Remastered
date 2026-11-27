// Mounted integration: stock weapons + the real ground sweep and detonation
// handlers, persistence past a second volley, a save round trip and the actual
// surface drawn under an off-grid impact. No direct calls to TerrainCraters.hit.
const {chromium} = require('playwright-core');
const assert = require('node:assert/strict');
const base = process.env.EW_BASE || 'http://127.0.0.1:8590/';
(async()=>{
  const browser = await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:800}}), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('console',m=>{if(/GPUValidationError|Shader Error|Error while (?:validating|parsing WGSL)/.test(m.text())) errors.push(m.text().slice(0,900));});
    if(process.env.LOOK_BACKEND==='webgl') await page.addInitScript(()=>sessionStorage.setItem('swr-webgpu-dropped','1'));
    await page.goto(base+'#ground-offensive');
    const iframe=await page.waitForSelector('iframe#game'), frame=await iframe.contentFrame();
    await frame.waitForFunction(()=>window.game?.world?.units?.length && window.game?.ui && !game.warming && game.craters,{},{timeout:180000});
    const r=await frame.evaluate(async()=>{
      const {db}=await import('/js/gamedata.js'), {heightAt}=await import('/js/game/terrain.js'), T=await import('three');
      const {blast}=await import('/js/game/landabilities.js');
      const g=game,w=g.world,t=w.terrain,cr=g.craters;
      g.paused=true; w.aiSuspended=true;
      const clean=(x,y)=>!w.viewFogged(x,y) && !w.wet[Math.round(y/20)*t.size+Math.round(x/20)] &&
        w.units.every(u=>Math.hypot(x-u.x,y-u.y)>Math.max(45,(u.hitRadius||0)+25));
      const sites=[];
      for(let y=106; y<20*((t.height||t.size)-3) && sites.length<35; y+=60) for(let x=113;x<20*((t.width||t.size)-3)&&sites.length<35;x+=60)
        if (clean(x,y) && t.paint.triAt[2*(Math.floor(y/20)*((t.width||t.size)-1)+Math.floor(x/20))]>=0) sites.push({x,y});
      if(sites.length<32) throw Error(`only ${sites.length} open firing sites`);
      const direct = (proj, site) => {
        const u=w.units.find(u=>u.weapon?.proj?.name===proj), {x,y}=site, z=heightAt(t,x,y);
        if (!u) throw Error('missing stock weapon '+proj);
        const target={x,y,z,spot:true,dead:false,aimZ:0,side:w.wild,hitRadius:-1,type:u.type};
        const n=w.shots.length; w.fire(u,target,u.weapon);
        const s=w.shots[n]; if (!s) throw Error('no projectile');
        // Aim a real shot straight down into an empty parcel; let flyShot, not
        // the fixture, determine its contact, location, expiry and ground flag.
        Object.assign(s,{sx:x,sy:y,sz:z+8,x,y,z:z+8,vx:0,vy:0,vz:-s.speed,reach:100,total:100,left:100,path:null});
        for (let i=0;i<90&&!s.done;i++) w.flyShot(s,1/60);
        w.shots.splice(n,1);
        if (!s.done||!s.ground||s.expired) throw Error('shot did not meet the ground: '+proj);
      };
      const sample=site=>cr.offsetAt(site.x,site.y);
      direct('Proj_Hand_Blaster_Red',sites[0]);
      const light={depth:sample(sites[0]),marks:g.scars.burns.rows.length};
      direct('Proj_Ground_Laser_Cannon_Red_T4B',sites[1]);
      const shallow=sample(sites[1]);
      const {x,y}=sites[2], baseZ=heightAt(t,x,y,true,null), heights=t.heights.slice();
      const p=db.type('Proj_Ground_SPMAT_Grenade');
      blast(w,p,x,y,g.me); const first=sample(sites[2]);
      for (const {x,y} of sites.slice(3,32)) blast(w,p,x,y,g.me);
      const persisted=sample(sites[2]);
      g.ground.updateMatrixWorld(true);
      const ray=new T.Raycaster(new T.Vector3(x,y,baseZ+1000),new T.Vector3(0,0,-1));
      const contact=ray.intersectObject(g.ground,true)[0];
      const shade=contact?.object.geometry.attributes.shade?.getX(contact.face.a);
      const z=contact?.point.z;
      // Read the same terrain pixels with and without the charcoal mask. Keep
      // the actual scar geometry, camera and terrain material identical.
      const ink=contact?.object.geometry.attributes.shade;
      if (!ink || !(shade>2)) throw Error('No refined scorched surface at the impact: '+JSON.stringify({shallow,first,persisted,shade}));
      const R=g.gpuOn?g.gpu:g.renderer, W=R.domElement.width,H=R.domElement.height;
      g.modeSuspended=true; await new Promise(requestAnimationFrame);
      const eye=new T.PerspectiveCamera(40,W/H,1,1000); eye.up.set(0,1,0); eye.position.set(x,y,z+65); eye.lookAt(x,y,z); eye.updateMatrixWorld();
      const soil=new T.Scene(); soil.add(g.ground);
      if (!g.gpuOn) { R.debug.checkShaderErrors=true; await R.compileAsync(soil,eye); }
      const target=g.gpuOn?null:new T.WebGLRenderTarget(W,H);
      async function luminance() {
        const draw=()=>{R.setRenderTarget(target);R.clear(); R.render(soil,eye); R.endFrame?.();};
        draw(); await R.settle?.(); const read=R.readNext?.(); draw(); let pixels;
        if(read) pixels=(await read).data; else {pixels=new Uint8Array(W*H*4);R.readRenderTargetPixels(target,0,0,W,H,pixels);}
        let sum=0, count=0;
        for(let j=(H>>1)-8;j<(H>>1)+8;j++) for(let i=(W>>1)-8;i<(W>>1)+8;i++) {const k=4*(j*W+i);sum+=.299*pixels[k]+.587*pixels[k+1]+.114*pixels[k+2];count++;}
        return sum/count;
      }
      let soot,cleanSoil;const keep=ink.array.slice();
      try {soot=await luminance();ink.array.fill(2);ink.clearUpdateRanges();ink.needsUpdate=true;cleanSoil=await luminance();}
      finally {ink.array.set(keep);ink.needsUpdate=true;R.setRenderTarget(null);target?.dispose();g.scene.add(g.ground);}
      const save=g.landSnapshot('Craters',{version:1,build:'crater-test'}).battle;
      // Same restore method as LandScars uses before placing saved units.
      const snapshot=JSON.parse(JSON.stringify(save.craters));
      const ok=cr.restore(snapshot); const restored=sample(sites[2]);
      return {map:g.map.file, light,shallow,first,persisted,restored,drawn:z,walkZ:heightAt(t,x,y),baseZ,shade,
        backend:g.gpuOn?'webgpu':'webgl',soot,cleanSoil,outside:cr.offsetAt(x+23,y), saved:save.craterRule===1 && ok!==false, noBaseEdits:t.heights.every((h,i)=>heights[i]===h)};
    });
    console.log(r); assert.ok(r.light.depth===0 && r.light.marks>=1);assert.ok(r.shallow<-.1 && r.shallow>=-1.1);
    assert.ok(r.first<-2 && r.first> -5 && Math.abs(r.outside)<1e-4); assert.ok(r.first===r.persisted && Math.abs(r.restored-r.first)<.03);
    assert.ok(r.noBaseEdits && r.saved && r.shade>2.3 && Math.abs(r.drawn-r.walkZ)<.03 && Math.abs(r.walkZ-r.baseZ-r.first)<.03);
    assert.ok(r.cleanSoil>5 && r.soot/r.cleanSoil<.65, `burnt soil should be visibly darker: ${r.soot}/${r.cleanSoil}`);
    if (process.env.LOOK_BACKEND) assert.equal(r.backend,process.env.LOOK_BACKEND);
    const gait=await frame.evaluate(require('./craters/walk-battle.cjs'));
    console.log(gait); const {deep,shallow}=gait;
    for (const a of [shallow,deep]) assert.ok(a.moved>125 && a.maxDz<1e-3 && a.exitTilt<.01,'crosses, keeps contact and restores upright');
    assert.ok(shallow.depth>.3 && shallow.step && shallow.stepLift>.05 && !shallow.climb,'shallow step');
    assert.ok(deep.depth>2 && deep.climb && deep.tilt>.055 && deep.anim==='move','deep uphill climb on the moving rig');
    assert.deepEqual(errors,[]); console.log('PASS mounted ground impacts, persistence, scorch, and ordered infantry steps/climbs');
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
