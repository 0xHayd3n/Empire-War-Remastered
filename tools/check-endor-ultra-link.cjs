// Exercise the two actual launcher links in separate, clean browser contexts. Capture the
// displayed frame (after grading, AA and downsampling), not a terrain-only buffer. OS TEMP only.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const out = path.join(os.tmpdir(), 'universal-endor-ultra'+(process.env.LOOK_BACKEND==='webgl'?'-gl':''));
const views=[['clearing',1482.37,3407.28,163,.5,-1.48],['south',4220,1920,72,.2,-Math.PI/2],['ground',1472.37,3406.28,50,.24,-1.48],['command',1474.37,3389.28,495,.9,-1.48],['trail',1900,4500,72,.2,-Math.PI/2]];
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const gl=process.env.LOOK_BACKEND==='webgl';
  const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    for(const mode of ['original','ultra']){
      const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
      if(gl)await page.addInitScript(()=>sessionStorage.setItem('swr-webgpu-dropped','1'));
      page.setDefaultTimeout(120000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(/GPUValidationError|Shader Error|INVALID_OPERATION|Error while (?:validating|parsing WGSL)|Endor full landscape: using original/.test(m.text()))errors.push(m.text().slice(0,500));});
      await page.goto('http://127.0.0.1:8590/#endor-'+mode);
      const frame=page.frameLocator('#game'),body=frame.locator('body');
      // A normal solo roll chooses among four authored skies. Do not change the game or compare
      // a rainy baseline to a sunny upgrade. Keep only the same clear-noon roll on each side.
      for(let roll=0;;roll++){
        await frame.locator('#loading.hidden').waitFor({state:'attached'});
        const sky=await body.evaluate(async()=>{const end=performance.now()+65000;while(!window.game?.map){if(performance.now()>end)throw Error('Endor did not load');await new Promise(requestAnimationFrame);}return game.map.environment.name;});
        if(sky==='Noon_Clear')break;
        if(roll>=29)throw Error('Could not match Endor weather');
        await page.reload();
      }
      const report=await body.evaluate(async(_,mode)=>{
        const ultra=mode==='ultra',wait=()=>new Promise(requestAnimationFrame),end=performance.now()+85000;
        while(!(window.game?.world?.time>.15 && game.ground && (!ultra || game.ground.userData.endorLandscape?.active) && (!ultra||game.extraFx?.pr))){if(performance.now()>end)throw Error('Battle/renderer not ready');await wait();}
        const {gfx}=await import('/js/gfx.js'),g=game,R=g.gpuOn?g.gpu:g.renderer,stat=g.ground.userData.endorLandscape;
        g.modeSuspended=true;await wait();g.following=null;
        // Fixed walker for scale in both captures; the public links start normal Instant Battles.
        const walker=await g.world.spawn('AT_ST_Walker',1494.37,3405.28,1.5,g.me);if(!walker)throw Error('Missing walker');
        await (await import('/js/dds.js')).texturesReady();
        R.domElement.dataset.sceneCapture='1';
        const style=window.captureSheet=document.createElement('style');style.textContent='body *:not(:has([data-scene-capture])):not([data-scene-capture]){visibility:hidden!important}';document.head.append(style);
        // Keep sim and camera still, allowing asynchronous vegetation/instance pipelines to warm.
        const now=g.last;window.drawEndorView=async([x,y,dist,pitch,yaw])=>{
          Object.assign(g.view,{x,y,dist,pitch,yaw});
          for(let i=0;i<36;i++){
            g.modeSuspended=false;g.warming=true;try{g.frame(now);}finally{g.modeSuspended=true;g.warming=false;}
            if(i%10===9)await g.gpu?.settle?.();await wait();
          }
        };
        return {edition:(await import('/js/edition.js')).edition(),map:g.map.file,environment:g.map.activeEnvironment??0,sky:g.map.environment?.name,backend:g.gpuOn?'WebGPU':'WebGL',teams:g.setup.teamFactions,armies:g.setup.instant.groundArmies,
          profile:(await import('/js/endor-preview.js')).endorPreview,landscape:!!stat.active,textureWidth:stat.width,cinematic:window.extraFx,
          daylight:gfx.groundDaylight,supersampling:gfx.supersample,canvas:[R.domElement.width,R.domElement.height],output:R.domElement.dataset.hdrOutput||'SDR',storedGfx:localStorage.getItem('swr-gfx')};
      },mode);
      assert.equal(report.map,'_MP_LAND_ENDOR.TED');assert.equal(report.profile,mode);assert.equal(report.landscape,mode==='ultra');assert.equal(report.cinematic,mode==='ultra');assert.equal(report.supersampling,mode==='ultra'?2:1);assert.equal(report.storedGfx,null);
      for(const [key,...camera] of views){await body.evaluate((_,camera)=>window.drawEndorView(camera),camera);await page.screenshot({path:path.join(out,mode+'-'+key+'.png')});}
      assert.equal(report.backend,gl?'WebGL':'WebGPU');
      if(mode==='ultra'){
        // Both reproductions use actual deployed squads, not the staged walker, and keep the live HUD.
        await body.evaluate(()=>window.captureSheet.remove());
        for(const [key,d,pitch] of [['squads',130,.34],['high-command',910,1.08]]){
          await body.evaluate((_,[d,pitch])=>window.drawEndorView([1460,3120,d,pitch,-Math.PI/2]),[d,pitch]);
          await page.screenshot({path:path.join(out,report.backend+'-'+key+'.png')});
        }
        await body.evaluate(()=>game.menus.toggle());
        await frame.locator('[data-id="IDC_INGAME_OPTIONS"]:visible').click({timeout:10000});
        const settings=frame.getByRole('dialog',{name:'Settings',exact:true});
        await settings.getByRole('tab',{name:'Graphics Quality'}).click();
        const labels=['Unit highlight protection','Shallow water clarity','Endor canopy shade','Endor distant haze','Foreground foliage fade'];
        for(const label of labels)assert(await settings.getByRole('slider',{name:label,exact:true}).isEnabled());
        await page.setViewportSize({width:390,height:844});
        const shade=settings.getByRole('slider',{name:labels[2]});await shade.focus();await shade.press('Home');
        assert.equal(await body.evaluate(async()=> (await import('/js/gfx.js')).gfx.endorShade),0);
        const fade=settings.getByRole('slider',{name:'Foreground foliage fade',exact:true});await fade.focus();await fade.press('Home');
        assert.equal(await body.evaluate(async()=> (await import('/js/gfx.js')).gfx.canopyFade),0);
        assert(await settings.evaluate(e=>e.scrollWidth<=e.clientWidth));
      }
      fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify({report,views,errors},null,2));assert.deepEqual(errors,[]);
      console.log(mode,report.map,report.backend,report.canvas,report.landscape,out);await page.context().close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
