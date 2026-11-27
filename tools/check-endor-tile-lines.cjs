// Mounted Endor, real lakebed material. Compare grain in the regularly spaced scan
// overlaps with grain in the centres. Identical orthographic footprint on both APIs.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core')), 'lib/utilsBundle.js'));
const gl = process.env.LOOK_BACKEND === 'webgl';
const out = path.join(os.tmpdir(), 'endor-tile-lines', gl ? 'gl' : 'gpu');
async function main() {
  fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:1}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(/Shader Error|INVALID_OPERATION|GPUValidationError|Error while (?:validating|parsing WGSL)/.test(m.text()))errors.push(m.text().slice(0,700));});
    if(gl) await page.addInitScript(()=>sessionStorage.setItem('swr-webgpu-dropped','1'));
    await page.goto('http://127.0.0.1:8590/#endor-ultra');
    const root=page.frameLocator('#game').locator('body');
    const setup=await root.evaluate(async()=>{
      const T=await import('three'),{heightAt}=await import('/js/game/terrain.js'),wait=()=>new Promise(requestAnimationFrame), end=performance.now()+80000;
      while(!window.game?.ground?.userData.endorLandscape?.active || !game.extraFx?.pr){if(performance.now()>end)throw Error('Endor not ready');await wait();}
      const g=game,R=g.gpuOn?g.gpu:g.renderer, U=g.ground.material.uniforms;
      g.modeSuspended=true;await wait();g.following=null;
      if(R.isWebGLRenderer)R.debug.checkShaderErrors=true;
      const env=g.map.environments.find(e=>e.name==='Noon_Clear');await g.applyEnvironment(env);g.world.setWeather(env.weather);
      g.forestSky.cover=g.forestSky.wet=g.groundRain.amount=0;
      R.domElement.dataset.tileTest='1'; const style=document.createElement('style');
      style.textContent='body *:not(:has([data-tile-test])):not([data-tile-test]){visibility:hidden!important}';document.head.append(style);
      const cam=new T.OrthographicCamera(-120,120,80,-80,1,6000);
      const draw=R.render, fx=g.extraFx, pass=fx.pass;
      let player=true;
      R.render=function(s,e){
        if(player||s!==g.scene||e!==g.camera)return draw.call(this,s,e);
        const hidden=s.children.filter(o=>o!==g.ground&&o.visible);for(const o of hidden)o.visible=false;
        try{return draw.call(this,s,cam);}finally{for(const o of hidden)o.visible=true;}
      };
      fx.pass=function(m,target){if(!player&&m.defines?.CONTACT_SHADE)m.uniforms.contactParams.value.w=0;return pass.call(this,m,target);};
      const time=g.last;
      window.tileView=async mode=>{player=mode==='player';const [x,y]=mode==='forest'?[3440,1680]:[1920,3260], z=heightAt(g.terrain,x,y);
        cam.position.set(x,y,z+160);cam.lookAt(x,y,z);cam.updateMatrixWorld();
        Object.assign(g.view,{x,y,dist:mode==='coarse'?480:115,pitch:player?.81:1.36,yaw:-1.55});
        for(let i=0;i<6;i++) {g.modeSuspended=false;g.warming=true;try{g.frame(time);}finally{g.modeSuspended=true;g.warming=false;}await wait();}
        await R.settle?.();
      };
      const planes=i=>({u:U.texU.value[i].toArray(),v:U.texV.value[i].toArray()});
      return {backend:g.gpuOn?'gpu':'gl',mud:planes(63),forest:planes(61)};
    });
    assert.equal(setup.backend,gl?'gl':'gpu');
    const {tileFootprint}=await import('../public/js/endor-tiles.js');
    const grain=(image,mode)=>{
      const bins=[{n:0,l:0,e:0},{n:0,l:0,e:0}];
      const l=(x,y)=>{const i=4*(y*image.width+x),d=image.data;return .2126*d[i]+.7152*d[i+1]+.0722*d[i+2];};
      // Pure sediment above the centre of the shore view; pure leaf litter in the middle of the forest view.
      const dry=mode==='forest',{u,v}=dry?setup.forest:setup.mud;
      for(let y=dry?160:8;y<(dry?480:192);y++)for(let x=240;x<(dry?720:580);x++){
        const X=(dry?3440:1920)+(x+.5-480)/4,Y=(dry?1680:3260)-(y+.5-320)/4;
        const w=tileFootprint((X*u[0]+Y*u[1])*v[3],(X*v[0]+Y*v[1])*v[3],u[3]);
        const power=w.reduce((s,v)=>s+v[2]**2,0),b=power<.44?bins[0]:power>.92?bins[1]:null;
        if(!b)continue;
        const lum=l(x,y),res=lum-(l(x-2,y)+l(x+2,y)+l(x,y-2)+l(x,y+2))/4;
        b.n++;b.l+=lum;b.e+=res*res;
      }
      const [overlap,centre]=bins.map(b=>({pixels:b.n,mean:b.l/b.n,grain:Math.sqrt(b.e/b.n)}));
      return {overlap,centre,ratio:overlap.grain/centre.grain};
    };
    const stats={};
    for(const mode of ['player','coarse','near','forest']){
      const end=Date.now()+65000;
      do {
        await root.evaluate((_,mode)=>tileView(mode),mode);
        const bytes=await page.screenshot({path:path.join(out,mode+'.png')});
        if(mode==='player')break;
        stats[mode]=grain(PNG.sync.read(bytes),mode);
      } while(stats[mode].centre.grain<4&&Date.now()<end);
    }
    console.log(setup.backend,JSON.stringify(stats),out);assert.deepEqual(errors,[]);
    for(const m of Object.values(stats)){
      assert(m.overlap.pixels>2000&&m.centre.pixels>5000&&m.centre.grain>4,'insufficient textured coverage');
      assert(m.ratio>.86&&m.ratio<1.15,'visible grid of smooth strips or oversharpened outlines');
      assert(Math.abs(m.overlap.mean-m.centre.mean)<2,'brightness grid at the texture joins');
    }
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
