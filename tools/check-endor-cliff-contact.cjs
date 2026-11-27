// Mounted Endor Ultra, three reproduced rocky banks. LOOK_BACKEND=webgl for the fallback.
// Compare the exact same depth attachment and camera; all captures stay in OS temp.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core')), 'lib/utilsBundle.js'));
const gl = process.env.LOOK_BACKEND === 'webgl', out = path.join(os.tmpdir(), 'endor-cliff-contact', gl ? 'gl' : 'gpu');
const views = [[300,1940,.69933], [620,1700,.71409], [3860,2760,2.14759]];

function darkerPixels(on, off) {
  let n = 0;
  for (let y = Math.floor(on.height * .15); y < on.height * .9; y++) for (let x = 10; x < on.width - 10; x++) {
    const i = 4 * (y * on.width + x);
    if (off.data[i]-on.data[i] + off.data[i+1]-on.data[i+1] + off.data[i+2]-on.data[i+2] > 24) n++;
  }
  return n;
}

(async () => {
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({channel:'chrome', args:['--enable-unsafe-swiftshader']});
  try {
    const p = await browser.newPage({viewport:{width:1080,height:640}, deviceScaleFactor:1}), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (/Shader Error|INVALID_OPERATION|GPUValidationError|Error while (?:validating|parsing WGSL)/.test(m.text())) errors.push(m.text().slice(0,1000)); });
    if (gl) await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped','1'));
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const root = p.frameLocator('#game').locator('body');
    const {backend,boots} = await root.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame), end = performance.now()+75000;
      while (!window.game?.ground?.userData.endorLandscape?.active || !game.extraFx?.pr) {
        if (performance.now() > end) throw Error('Endor not ready');
        await wait();
      }
      const g = game, fx = g.extraFx, R = g.gpuOn ? g.gpu : g.renderer;
      g.modeSuspended = true; await wait(); g.following = null;
      const env = g.map.environments.find(e => e.name === 'Noon_Clear');
      await g.applyEnvironment(env); g.world.setWeather(env.weather); g.forestSky.cover = g.forestSky.wet = g.groundRain.amount = 0;
      // Remaster activation can precede GL linking. Without a warm terrain program the
      // first comparison photographs sky under unloaded ground rather than a rocky bank.
      if (R.isWebGLRenderer) {
        const {shaderScene} = await import('/js/game/landinstances.js');
        await R.compileAsync(g.ground, g.camera, shaderScene(g.scene));
      }
      const pass = fx.pass, render = R.render, now = g.last;
      let gain = 1, bare = false, legacy = false;
      fx.pass = function(m, target) {
        if (m.defines?.CONTACT_SHADE) {
          m.uniforms.contactParams.value.w *= gain;
          if (legacy) m.uniforms.terrainContactMask.value = 1;
        }
        return pass.call(this,m,target);
      };
      R.render = function(scene, eye) {
        if (!bare || scene !== g.scene || eye !== g.camera) return render.call(this,scene,eye);
        const hidden = scene.children.filter(o => o !== g.ground && o.visible);
        for (const o of hidden) o.visible = false;
        try { return render.call(this,scene,eye); } finally { for (const o of hidden) o.visible = true; }
      };
      window.cliffShot = async ([x,y,yaw,dist=270,pitch=.63], k, onlyGround, oldReceiver=false) => {
        gain = k; bare = onlyGround; legacy = oldReceiver; Object.assign(g.view,{x,y,yaw,pitch,dist});
        for (let i=0; i<5; i++) {
          g.modeSuspended = false; g.warming = true;
          try { g.frame(now); } finally { g.warming = false; g.modeSuspended = true; }
          await wait();
        }
        await R.settle?.();
      };
      R.domElement.dataset.cliffFrame = '1';
      const style = document.createElement('style');
      style.textContent = 'body *:not(:has([data-cliff-frame])):not([data-cliff-frame]){visibility:hidden!important}';
      document.head.append(style);
      const squad=g.world.units.find(u=>u.foot && u.side===g.me && u.holder?.visible);
      return {backend:g.gpuOn?'gpu':'gl',boots:[squad.x,squad.y,-1.5,125,.82]};
    });
    assert.equal(backend, gl ? 'gl' : 'gpu');
    const stats = [];
    for (const [idx,v] of [...views,boots].entries()) {
      const frames = {};
      for (const [name,k,bare] of [['scene',1,false], ['scene-off',0,false], ['bare',1,true], ['no-contact',0,true], ['old-receiver',1,false]]) {
        await root.evaluate((_,args) => cliffShot(...args), [v,k,bare,name==='old-receiver']);
        frames[name] = PNG.sync.read(await p.screenshot({path:path.join(out,`${idx}-${name}.png`)}));
      }
      stats.push({ground:darkerPixels(frames.bare,frames['no-contact']), withObjects:darkerPixels(frames.scene,frames['scene-off']), oldReceiver:darkerPixels(frames['old-receiver'],frames['scene-off'])});
    }
    console.log(backend,stats,out); assert.deepEqual(errors,[]);
    assert(stats.every(s => s.ground < 500), 'Bare terrain is casting strong screen-space crease shadows');
    // These mostly bare banks used to pass by drawing more than 500 strong pixels
    // *on the models*. Keep the old rule as a positive control, not a target look.
    for(const s of stats.slice(0,3)){
      assert(s.oldReceiver-s.ground>500,'Old-receiver control did not exercise the populated bank');
      assert(s.withObjects<s.oldReceiver*.4,'Contact pass still traces the forest canopy and cliff faces');
    }
    assert(stats[3].withObjects-stats[3].ground>100,'No resolved contact under the deployed squad');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
