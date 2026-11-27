// Mounted Universal only. Isolated player storage; public report contains no game files.
const {chromium} = require('playwright-core'), assert = require('node:assert/strict'), path=require('node:path'), fs=require('node:fs');
const land = process.env.LOOK_DOMAIN === 'land', gl = process.env.LOOK_BACKEND === 'webgl';
const out=path.join(process.env.LOOK_SHOTS || require('node:os').tmpdir()+'/universal-battle-realism',land?'land':'space',gl?'webgl':'webgpu');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    const p=await browser.newPage({viewport:{width:1120,height:680}, reducedMotion:'reduce'}), bad=[];
    p.setDefaultTimeout(85000);
    p.on('pageerror',e=>{bad.push(e.message);console.error(e.message)});
    p.on('console',m=>{if(/GPUValidationError|Error while parsing WGSL|Error while validating|invalid.*pipeline|THREE.WebGLProgram: Shader Error|INVALID_OPERATION|render worker:/.test(m.text())){bad.push(m.text().slice(0,800));console.error(bad.at(-1));}});
    if(gl) await p.addInitScript(()=>sessionStorage.setItem('swr-webgpu-dropped','1'));
    await p.goto('http://127.0.0.1:8590/');
    const f=p.frameLocator('#game'), body=f.locator('body'), s=f.getByRole('dialog',{name:'Settings',exact:true});
    const open=async()=>{await f.getByRole('button',{name:'System menu'}).click();await f.getByRole('button',{name:'Settings',exact:true}).click();await s.getByRole('tab',{name:'Graphics Quality'}).click()};
    const mode=s.getByRole('combobox',{name:'Battle realism',exact:true}), custom=s.getByRole('combobox',{name:'Space battle look',exact:true});
    await open(); assert.equal(await mode.inputValue(),'custom'); await custom.selectOption('linear');
    await mode.selectOption('on'); assert(!(await custom.isVisible()));
    await p.waitForFunction(()=>localStorage.getItem('universal-battle-realism')==='on');
    // A freshly mounted profile may not have a local switch yet. Isolate the host's choice from it.
    await body.evaluate(()=>{const g=JSON.parse(localStorage.getItem('swr-gfx'));g.battleRealism='off';localStorage.setItem('swr-gfx',JSON.stringify(g))});
    await p.reload(); await open();
    assert.equal(await mode.inputValue(),'on'); await mode.focus(); await p.screenshot({path:path.join(out,'settings.png')});
    await p.setViewportSize({width:390,height:844}); await s.evaluate(e=>e.style.backgroundImage='none');
    await mode.focus(); await mode.press('End'); assert.equal(await mode.inputValue(),'off'); await mode.press('Home'); assert.equal(await custom.inputValue(),'linear');
    await mode.selectOption('on'); await mode.focus(); assert(await s.evaluate(e=>e.scrollWidth<=e.clientWidth)); await p.screenshot({path:path.join(out,'narrow.png')});
    await p.setViewportSize({width:1120,height:680}); await s.getByRole('button',{name:'Back',exact:true}).click();
    for(const id of ['TITLE_PLAY','IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`.title-menu [data-id="${id}"]`).click();
    const b=f.locator('.op-setup'); await b.getByRole('searchbox').fill(land?'Kuat':'Abregado Forces of Corruption space');
    await b.locator(`[data-world="${land?'Kuat':'Abregado_Rae'}"][data-domain="${land?'land':'space'}"][data-source="stock"]`).first().click(); await b.locator('.op-go').click();
    await f.locator('#loading.hidden').waitFor({state:'attached'});
    const picked=await body.evaluate(async(_, {land,vehicle})=>{
      const start=performance.now(); while(!(window.game?.world?.time>2)){if(performance.now()-start>120000)throw Error('Battle did not start'); await new Promise(r=>setTimeout(r,100))}
      const g=game,{visibleSubject}=await import('/js/game/close-subject.js');
      // Kuat's starter force can be all infantry. Add a stock walker in this isolated test only.
      if (land && vehicle) await g.world.spawn('AT_ST_Walker',g.view.x,g.view.y,0,g.me);
      let units,u;
      do {
        units=g.world.units.filter(u=>visibleSubject(u,g.world));
        u=land ? units.find(u=>u.side===g.me && (vehicle ? /^AT_ST_Walker$/i.test(u.type.name) : u.foot) && u.squad && !u.structure) : units.find(u=>!u.isFighter && u.player===g.human && !/Star_Destroyer/i.test(u.type.name));
        if(!u)await new Promise(r=>setTimeout(r,150));
      }while(!u && performance.now()-start<25000);
      if(!u && land && !vehicle) u=units.find(u=>u.side===g.me && !u.structure && u.squad);
      if(!u)throw Error('No test unit: '+JSON.stringify(g.world.units.slice(0,12).map(u=>[u.type.name,u.kind,u.visualRadius,u.obj?.visible,!!u.model,!!u.hyper,u.haze?.color.w,u.seenBy,u.player?.id,g.human?.id])));
      g.ui.select([land?u.squad:u],false); g.menus.main(); return u.type.name;
    },{land, vehicle:process.env.LOOK_VEHICLE==='1'}); console.log('Selected',picked);
    await f.locator('[data-id="IDC_INGAME_OPTIONS"]').click(); await s.getByRole('tab',{name:'Graphics Quality'}).click();
    await s.getByRole('button',{name:'Play unit flyby',exact:true}).click();
    const report=await body.evaluate(async(_, {land,gl,picked})=>{
      const g=game,r=land?g:g.renderer,R=land?(g.gpuOn?g.gpu:g.renderer):r.renderer,cam=r.camera;
      if(!g.cine.on || !g.cine.sequence || !!R.isWebGLRenderer!==gl)throw Error('Wrong camera/backend');
      const subject=r.flybySubject; if(!subject)throw Error('No flyby subject');
      g.modeSuspended=true; await new Promise(requestAnimationFrame); await (await import('/js/dds.js')).texturesReady();
      const {gfx}=await import('/js/gfx.js'),{lighting}=await import('/js/model.js');
      if(!land && r.instances){r.instances.jobs=null;for(const u of g.world.units)if(u.obj&&!u.dead)r.instances.scan(u);r.post.flare=false;}
      const now=g.last; g.cine.frame(0);cam.updateMatrixWorld();
      let stage=0; const render=R.render.bind(R); R.render=(scene,eye)=>{if(scene===r.scene&&eye===cam)stage=lighting.orbitalKey.value;return render(scene,eye)};
      function draw(){if(land){g.modeSuspended=false;try{g.warming=true;g.frame(now)}finally{g.modeSuspended=true;g.warming=false}}else r.draw(g.world,R,0)}
      async function shot(mode){gfx.battleRealism=mode;for(let i=0;i<5;i++){draw();await R.settle?.();await new Promise(requestAnimationFrame)}
        const req=R.readNext?.();draw(); let data;
        if(req)data=(await req).data;else {const ctx=R.getContext();data=new Uint8Array(ctx.drawingBufferWidth*ctx.drawingBufferHeight*4);ctx.readPixels(0,0,ctx.drawingBufferWidth,ctx.drawingBufferHeight,ctx.RGBA,ctx.UNSIGNED_BYTE,data)}
        const fx=land?g.extraFx:r.post;return {data,stage,focus:r.closeShadow?.focus?.type.name||null,near:r.closeSubject?.last?.type.name||null,density:fx?.targets?.resolved?fx.closeDensity:1,wide:fx?.targets?.resolved?fx.fleetDensity:1};}
      function count(a,b){let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])n++;return n}
      const orig=await shot('off'),on=await shot('on'),again=await shot('off');
      const {data,...active}=on;return {subject:subject.type.name,picked,active,offStage:again.stage,offShadow:again.focus,offDensity:again.density,changed:count(orig.data,data),reset:count(orig.data,again.data),total:data.length/4,stored:JSON.parse(localStorage.getItem('swr-gfx')).spacePresentation};
    },{land,gl,picked});
    console.log(JSON.stringify(report,null,2)); fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    assert.equal(report.subject,picked); assert.equal(report.active.near,report.subject); assert.equal(report.active.focus,report.subject); assert(report.active.stage>=2 && report.active.density>1);assert.equal(report.offStage,0);assert.equal(report.offShadow,null);assert.equal(report.offDensity,1);assert(report.changed>1000);assert(report.reset<Math.max(20,report.changed*.002));assert.equal(report.stored,'linear');assert.deepEqual(bad,[]);
    if(process.env.LOOK_PROFILE==='1') {
      async function mount(id) {
        const old=await body.evaluate(()=>location.origin);
        await body.evaluate((_,id)=>parent.postMessage({kind:'universal-select',id,mode:id==='stock'?'title':'profile-play'},new URL(document.referrer).origin),id);
        await p.waitForFunction(old=>!document.querySelector('#game').src.startsWith(old+'/'),old);
        return p.waitForEvent('framenavigated',{predicate:f=>f.parentFrame()===p.mainFrame() && f.url().startsWith('http://') && !f.url().startsWith(old+'/'),timeout:20000}).catch(()=>p.frames().find(f=>f.parentFrame()===p.mainFrame() && !f.url().startsWith(old+'/')));
      }
      const mod=await mount('1976399102'); assert(mod && !mod.url().includes(':8591/'));
      assert.equal(await mod.evaluate(async()=>{const {gfx,setBattleRealism}=await import('/js/gfx.js');const got=gfx.battleRealism;setBattleRealism('off');return got}),'on');
      await p.waitForFunction(()=>localStorage.getItem('universal-battle-realism')==='off');
      await mount('stock'); await open(); assert.equal(await mode.inputValue(),'off'); await mode.selectOption('custom'); assert.equal(await custom.inputValue(),'linear');
      console.log('Stock → Fall of the Republic → stock: shared switch, preserved individual look');
    }
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
