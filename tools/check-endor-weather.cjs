// Test the real launcher/forecast. No fake phase data; speed up the normal sim clock for the wait.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const gl = process.env.LOOK_BACKEND === 'webgl',
  eaw = process.env.LOOK_EDITION === 'eaw',
  out = path.join(os.tmpdir(), 'universal-endor-showers', (eaw ? 'eaw' : 'foc') + '-' + (gl ? 'webgl' : 'webgpu'));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 });
    p.setDefaultTimeout(80000);
    const errors = [];
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (
        /GPUValidationError|Error while (?:parsing WGSL|validating)|Shader Error|INVALID_OPERATION|webgpu pipeline|Endor full landscape: using original/i.test(
          m.text()
        ) &&
        errors.length < 8
      ) {
        errors.push(m.text().slice(0, 1000));
        console.error(errors.at(-1));
      }
    });
    await p.addInitScript(
      ({ gl, eaw }) => {
        if (gl) sessionStorage.setItem('swr-webgpu-dropped', '1');
        if (eaw) localStorage.setItem('swr.game', 'eaw');
      },
      { gl, eaw }
    );
    await p.goto('http://127.0.0.1:8590/#endor-showers');
    const frame = p.frameLocator('#game'),
      body = frame.locator('body');
    await frame.locator('#loading.hidden').waitFor({ state: 'attached' });
    const report = await body.evaluate(async () => {
      const wait = () => new Promise(requestAnimationFrame);
      const timeout = performance.now() + 65000;
      while (!(window.game?.ground?.userData.endorLandscape?.active && game.world.time > 0.1)) {
        if (performance.now() > timeout) throw Error('Endor did not activate');
        await wait();
      }
      const g = game,
        wx = g.world.weather;
      g.modeSuspended = true;
      await wait();
      g.following = null;
      const { gfx } = await import('/js/gfx.js'),
        { lighting } = await import('/js/model.js'),
        { unitDetail } = await import('/js/game/desyncreport.js');
      window.drawWeather = async ({ view, on = true, hud = false }) => {
        gfx.endorWeather = on;
        const r = g.gpuOn ? g.gpu : g.renderer;
        r.domElement.dataset.wxCapture = '';
        let css = document.querySelector('#wxCapture');
        if (!css) {
          css = document.createElement('style');
          css.id = 'wxCapture';
          document.head.append(css);
        }
        css.textContent = hud ? '' : 'body *:not(:has([data-wx-capture])):not([data-wx-capture]){visibility:hidden!important}';
        const cameras = {
          trail: [1900, 4500, 72, 0.2, -Math.PI / 2],
          lake: [1908, 3507, 110, 0.3, -1.93],
          command: [1460, 3120, 580, 0.95, -Math.PI / 2]
        };
        const [x, y, dist, pitch, yaw] = cameras[view];
        Object.assign(g.view, { x, y, dist, pitch, yaw });
        const t = g.world.time,
          w = JSON.stringify(wx),
          units = JSON.stringify(unitDetail(g.world)),
          l = lighting.sunColor.value.toArray();
        for (let i = 0; i < 23; i++) {
          g.modeSuspended = false;
          g.warming = true;
          try {
            g.frame(g.last);
          } finally {
            g.warming = false;
            g.modeSuspended = true;
          }
          await wait();
        }
        await g.gpu?.settle?.();
        if (
          JSON.stringify(l) !== JSON.stringify(lighting.sunColor.value.toArray()) ||
          lighting.forestWeather.value.lengthSq() !== 0 ||
          g.world.time !== t ||
          units !== JSON.stringify(unitDetail(g.world)) ||
          w !== JSON.stringify(wx)
        )
          throw Error('Weather leaked out of a draw');
        const mesh = g.scene.getObjectByName('Endor near rain');
        return {
          time: t,
          i: wx.i,
          phase: wx.name,
          rain: g.forestSky.rain,
          cover: g.forestSky.cover,
          wet: g.groundRain.amount,
          drops: mesh?.visible ? mesh.geometry.drawRange.count / 6 : 0
        };
      };
      window.advanceForecast = async clearing => {
        g.speed = clearing ? 12 : 4;
        g.modeSuspended = false;
        g.frame(performance.now());
        const end = performance.now() + 145000;
        while (
          !(clearing
            ? wx.name === 'clear' && g.forestSky.rain === 0 && g.forestSky.cover < 0.12
            : g.forestSky.rain > 0.97 && g.forestSky.cover > 0.96 && g.groundRain.amount > 0.78)
        ) {
          if (performance.now() > end) throw Error('Missing mounted phase: ' + JSON.stringify(wx));
          await wait();
        }
        g.modeSuspended = true;
        g.speed = 1;
        await wait();
      };
      return {
        backend: g.gpuOn ? 'webgpu' : 'webgl',
        map: g.map.file,
        environment: g.map.environment.name,
        scenario: g.map.environment.weather,
        phases: wx.phases.map(p => [p.name, p.strength, p.seconds])
      };
    });
    assert.equal(report.environment, 'Noon_Rain');
    assert.equal(report.scenario, 'RAIN_RANDOM');
    assert.equal(report.backend, gl ? 'webgl' : 'webgpu');
    const shot = async (name, view, on = true, hud = false) => {
      const st = await body.evaluate((_, o) => drawWeather(o), { view, on, hud });
      await p.screenshot({ path: path.join(out, name + '.png') });
      return st;
    };
    report.clear = await shot('trail-dry', 'trail');
    assert.equal(report.clear.rain, 0);
    await body.evaluate(() => advanceForecast(false));
    report.rain = await shot('trail-rain', 'trail');
    assert(report.rain.drops > 0);
    assert.equal((await shot('trail-rain-legacy', 'trail', false)).drops, 0);
    await shot('lake-rain', 'lake');
    assert.equal((await shot('squads-rain', 'command', true, true)).drops, 0);
    await body.evaluate(() => advanceForecast(true));
    report.clearing = await shot('trail-clearing', 'trail');
    assert(report.clearing.wet > 0.12 && report.clearing.wet < report.rain.wet);
    await shot('squads-clearing', 'command', true, true);
    await body.evaluate(() => game.menus.toggle());
    await frame.locator('[data-id="IDC_INGAME_OPTIONS"]:visible').click();
    const s = frame.getByRole('dialog', { name: 'Settings', exact: true });
    await s.getByRole('tab', { name: 'Graphics Quality' }).click();
    const box = s.getByRole('checkbox', { name: 'Endor forest weather', exact: true });
    assert(await box.isChecked());
    await p.setViewportSize({ width: 390, height: 844 });
    await box.focus();
    await box.press('Space');
    assert(!(await box.isChecked()));
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(report.backend, report.environment, report.clear, report.rain, report.clearing, out);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
