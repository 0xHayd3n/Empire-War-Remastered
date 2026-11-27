// Compare the same frozen Endor battle, not two playthroughs. PNGs stay outside the repo.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const scout = !!process.env.ENDOR_SCOUT, gl = process.env.LOOK_BACKEND === 'webgl';
const W = +(process.env.ENDOR_WIDTH || 3840), H = W * 9 / 16;
const out = process.env.ENDOR_OUT || path.join(os.tmpdir(), 'eaw-endor-' + (gl ? 'gl' : 'gpu'));
(async () => {
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({channel:'chrome', args:['--enable-unsafe-swiftshader']});
  try {
    const p = await browser.newPage({ viewport:{width:1400,height:800},deviceScaleFactor:1,reducedMotion:'reduce' });
    p.setDefaultTimeout(100000);
    const errors=[];
    p.on('pageerror', e=>{errors.push(e.message); console.error(e.message)});
    p.on('console', m=>{if(/GPUValidationError|Error while validating|Error while parsing WGSL|Shader Error|INVALID_OPERATION/.test(m.text())) errors.push(m.text().slice(0,300));});
    if(gl) await p.addInitScript(()=>sessionStorage.setItem('swr-webgpu-dropped','1'));
    await p.goto('http://127.0.0.1:8590/');
    const f=p.frameLocator('#game'), body=f.locator('body'), settings=f.getByRole('dialog',{name:'Settings',exact:true});
    if(!scout) {
      await f.getByRole('button',{name:'System menu'}).click(); await f.getByRole('button',{name:'Settings',exact:true}).click();
      await settings.getByRole('tab',{name:'Graphics Quality'}).click();
      await p.setViewportSize({width:390,height:844});
      await settings.getByRole('combobox',{name:'Texture edition'}).selectOption('stock-endor');
      assert(await settings.evaluate(e=>e.scrollWidth<=e.clientWidth));
      await p.setViewportSize({width:1400,height:800});
      await settings.getByRole('button',{name:'Build local pack'}).click();
      const toggle=settings.getByRole('checkbox',{name:'Use enhanced textures'});
      const outcome=settings.locator('fieldset').filter({has:toggle}).locator('[role=status]').last();
      await Promise.race([toggle.check(),outcome.filter({hasText:/changed:|not the reviewed|could not|failed|missing:|unavailable/i}).waitFor({state:'visible'}).then(async()=>{throw Error(await outcome.textContent())})]);
      await settings.getByRole('button',{name:'Reopen profile'}).click();
      await settings.waitFor({state:'detached'});
    }
    for(const n of ['TITLE_PLAY','IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`[data-id="${n}"]:visible`).click();
    const board=f.locator('.op-setup'); await board.getByRole('searchbox').fill('Endor');
    await board.locator('[data-world="Endor"][data-domain="land"][data-source="stock"]').first().click();
    await f.locator('.op-setup[data-profile="stock"] .op-go:enabled').click();
    await f.locator('#loading.hidden').waitFor({state:'attached'});
    const report=await body.evaluate(async (_,{gl,scout})=>{
      const wait=()=>new Promise(requestAnimationFrame),deadline=performance.now()+100000;
      while(!(window.game?.world?.time>0.6 && game.ground)){if(performance.now()>deadline)throw Error('No Endor battle');await wait()}
      const g=game,w=g.world,t=g.terrain,R=g.gpuOn?g.gpu:g.renderer;
      if(!!g.gpuOn===gl||R.isMirror) throw Error('Unexpected renderer');
      const {heightAt}=await import('/js/game/terrain.js'),dds=await import('/js/dds.js'), T=await import('three'),{gfx}=await import('/js/gfx.js');
      const tree=g.map.objects.filter(o=>/^W_Tree_Ever_0[01]_HI/i.test(o.type?.str('Land_Model_Name')||''));
      const anchor=w.units.find(u=>u.foot && u.side===g.me && u.holder?.visible);
      if(!anchor) throw Error('No army');
      const x0=anchor.x,y0=anchor.y, cell=g.ground.material.uniforms.side.value/(t.size-1);
      function layer(x,y){return t.layers[t.layerIndex[Math.round(y/cell)*t.size+Math.round(x/cell)]]?.texture||''}
      // Select an authored evergreen at a forest edge with open ground on its camera-facing side.
      const score=o=>{const [x,y]=o.pos;const nearest=Math.min(...tree.filter(a=>a!==o).map(a=>Math.hypot(a.pos[0]-x-12,a.pos[1]-y+46)));return Math.hypot(x-x0,y-y0)*.08-Math.min(100,nearest)+(/Moss|TempGrnd08|Forest_Grass/i.test(layer(x+16,y-30))?0:45)};
      const ref=tree.map(o=>[score(o),o]).sort((a,b)=>a[0]-b[0])[0][1], [x,y]=ref.pos;
      const walker=await w.spawn('AT_ST_Walker',x+32,y-15,0.55,g.me);
      const inf=await w.spawn('Stormtrooper',x+13,y-17,-.55,g.me);
      await dds.texturesReady();
      for(let i=0;i<90;i++) await wait();
      g.modeSuspended=true;
      const state=await import('/js/texture-showcase/store.js');const {digest,recipes,endorID}=await import('/js/texture-showcase/recipes.js');
      const maps=[],trees=[],recs=recipes[endorID];
      if(!scout){
        if(!state.active || state.edition!==endorID)throw Error('Endor edition not active after reopening');
        const {fetchBinary}=await import('/js/vfs.js');
        const atlas=g.ground.material.uniforms.map,enh=atlas.value;
        const dp=enh.image.depth,levels=enh.mipmaps.map(m=>({...m,data:m.data.slice()}));
        for(const r of recs){
          const uri='Data/Art/Textures/'+r.file, stock=await(await fetch('/asset/'+uri)).arrayBuffer();
          if(await digest(stock)!==r.source || await digest(await fetchBinary(uri,{keep:false}))!==r.output)throw Error('Wrong source or output: '+r.file);
          if(r.role==='endorAtlas'){
            const value=dds.loadTexture(r.file.replace('.DDS','.TGA')),original=await dds.textureFromBytes(stock,true);
            if(value.image.width!==r.side*r.scale || original.image.width!==r.side) throw Error('Unexpected live texture resolution for '+r.file+': '+value.image.width+' / '+original.image.width);
            trees.push({value,original});
          }else{
            const orig=dds.parseDDS(stock);
            for(const [i,slot] of t.paint.slot){
              const file=t.layers[i]?.texture.toUpperCase().replace(/\.(DDS|TGA)$/,'')+'.DDS';
              if(file!==r.file)continue;
              orig.mipmaps.forEach((m,k)=>levels[k].data.set(m.data,slot*m.data.length));
            }
          }
        }
        const old=new T.CompressedArrayTexture(levels,enh.image.width,enh.image.height,dp,enh.format);
        for(const k of ['wrapS','wrapT','anisotropy','colorSpace','minFilter','magFilter','flipY'])old[k]=enh[k];old.needsUpdate=true;
        maps.push([atlas,old,enh]);
        const seen=new Set();g.scene.traverse(o=>{for(const m of [].concat(o.material||[])){const u=m.uniforms?.map;if(!u||seen.has(u))continue;seen.add(u);const pair=trees.find(z=>u.value===z.value);if(pair)maps.push([u,pair.original,pair.value]);}});
        if(maps.length<3)throw Error('Tree materials not found: '+maps.length);
      }
      const now=g.last;
      window.forestShot=async function(view,on){
        const pose=view==='bark'?{x:x+1.4,y:y-.5,dist:25,pitch:.30,yaw:-2.60}:view==='close'?{x:x+13,y:y-7,dist:97,pitch:.30,yaw:-1.47}: {x:x+33,y:y-10,dist:410,pitch:.88,yaw:-1.48};
        Object.assign(g.view,pose);
        for(const [u,a,b]of maps)u.value=on?b:a;
        function draw(){g.modeSuspended=false;g.warming=true;try{g.frame(now)}finally{g.modeSuspended=true;g.warming=false;}}
        for(let j=0;j<3;j++){draw();await g.gpu?.settle()}
        const W=R.domElement.width,H=R.domElement.height,cv=document.createElement('canvas');cv.width=W;cv.height=H;
        let bytes;if(g.gpuOn){const promise=g.gpu.readNext();draw();bytes=(await promise).data;}else{draw();const ctx=R.getContext(),raw=new Uint8Array(W*H*4);bytes=new Uint8Array(raw.length);ctx.readPixels(0,0,W,H,ctx.RGBA,ctx.UNSIGNED_BYTE,raw);for(let y=0;y<H;y++) bytes.set(raw.subarray((H-1-y)*W*4,(H-y)*W*4),y*W*4);}
        for(let i=3;i<bytes.length;i+=4)bytes[i]=255;
        cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),W,H),0,0);
        return {W,H,worldTime:w.time,debug:[...g.camera.position.toArray(),...(walker?.members||[]).slice(0,1).flatMap(u=>[u.x,u.y,u.z,u.holder.visible,...u.holder.position.clone().project(g.camera).toArray()])],png:cv.toDataURL('image/png').split(',')[1]};
      };
      return {map:g.setup.mapFile,clock:w.time,backend:g.gpuOn?'WebGPU':'WebGL',bindings:maps.length,layer:layer(x+16,y-30),tree:ref.type.name,x,y,walker:!!walker,infantry:!!inf};
    },{gl,scout});
    console.log('scene',report);await p.setViewportSize({width:W,height:H});
    await body.evaluate(async()=>{game.fit();await new Promise(requestAnimationFrame)});
    for(const view of ['bark','close','strategy']) for(const on of scout?[false]:[false,true,false]){
      const file=view+'-'+(on?'after':'before')+'.png';
      if(!report[file] && !on) await body.evaluate(async(_,v)=>{await window.forestShot(v,false);await new Promise(r=>setTimeout(r,400));},view);
      const {W:w,H:h,worldTime,debug,png}=await body.evaluate((_,q)=>window.forestShot(q[0],q[1]),[view,on]);
      assert.equal(w,W);assert.equal(h,H);assert.equal(worldTime,report.clock);
      const img=Buffer.from(png,'base64'),where=path.join(out,file);
      if(report[file]){const same=fs.readFileSync(where).equals(img);report[view+'ResetIdentical']=same; if (!same) { fs.writeFileSync(path.join(out,view+'-reset.png'),img); console.warn('Non-identical reset in',view); }}else{fs.writeFileSync(where,img);report[file]=img.length;}
      console.log(file,w,h,img.length,debug);
    }
    report.errors=errors;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));assert.deepEqual(errors,[]);
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
