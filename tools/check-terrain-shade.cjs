// Read a pair of lighting samples through the mounted terrain fragment shader. Use identical
// gray surfaces with opposing tangent normals, a directional sky, and no direct sun.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const mixed = process.env.MIXED_SURFACES === '1';
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
    const errors = [];
    page.on('console', m => {
      if (/WebGL:|Shader Error|GPUValidationError|INVALID_OPERATION|THREE.WebGLRenderer/.test(m.text())) {
        console.error(m.text().slice(0, 600));
        errors.push(m.text());
      }
    });
    await page.goto('http://127.0.0.1:8590/#' + (mixed ? 'yavin-remaster' : 'endor-ultra'));
    const body = page.frameLocator('#game').locator('body');
    const samples = await body.evaluate(async (_, mixed) => {
      const start = performance.now();
      while (!window.game?.ground?.userData[mixed ? 'reviewedLandscape' : 'endorLandscape']?.active) {
        if (performance.now() - start > 75000) throw Error('Endor Ultra did not load');
        await new Promise(requestAnimationFrame);
      }
      game.modeSuspended = true;
      const T = await import('three'),
        base = game.ground.material,
        R = new T.WebGLRenderer({ alpha: true }),
        rt = new T.WebGLRenderTarget(4, 4),
        U = Object.fromEntries(Object.entries(base.uniforms).map(([k, v]) => [k, { value: v.value }]));
      const v = (x, y = x, z = x) => new T.Vector3(x, y, z);
      const array = (r, g, b, a) => {
        const t = new T.DataArrayTexture(
          Uint8Array.from({ length: 32 }, (_, i) => [r, g, b, a][i % 4]),
          1,
          1,
          8
        );
        t.needsUpdate = true;
        return t;
      };
      const tex = (r, g, b) => {
        const t = new T.DataTexture(Uint8Array.of(r, g, b, 255), 1, 1);
        t.needsUpdate = true;
        return t;
      };
      const gray = array(160, 160, 160, 255),
        front = array(230, 128, 204, 255),
        back = array(25, 128, 204, 255),
        white = tex(255, 255, 255),
        black = tex(0, 0, 0);
      const depthRT = new T.WebGLRenderTarget(4, 4);
      depthRT.depthTexture = new T.DepthTexture(4, 4, T.UnsignedIntType);
      depthRT.depthTexture.compareFunction = T.LessEqualCompare;
      R.setRenderTarget(depthRT);
      R.clear();
      const planes = y => Array.from({ length: 64 }, () => new T.Vector4(y ? 0 : 1, y ? 1 : 0, 0, y ? 1 : 7));
      const settings = {
        texU: planes(false),
        texV: planes(true),
        map: gray,
        clouds: white,
        fog: white,
        canopyMap: black,
        matDiffuse: Array(64).fill(v(1)),
        matSpecular: Array(64).fill(v(0)),
        terrainLayers: 0,
        detail: 0,
        forestSlot: 0,
        textureCubic: 0,
        groundWet: 0,
        waterLine: -1e20,
        landProbeOn: 1,
        landGround: new T.Vector4(0, 0, 0, 1),
        orbitPos: new T.Matrix3().fromArray([1, 1, 1, 0.1, 0.1, 0.1, 0.18, 0.18, 0.18]),
        orbitNeg: new T.Matrix3().fromArray([0.03, 0.03, 0.03, 0.1, 0.1, 0.1, 0, 0, 0]),
        ambient: v(0),
        sunColor: v(0),
        fillColor: v(0),
        fillColor2: v(0),
        sunDir: v(0, 0, 1),
        shadowOn: 0,
        shadowMap: depthRT.depthTexture,
        hullShadowMap: depthRT.depthTexture,
        reliefPatch: new T.Vector4(),
        fieldLook: new T.Vector4(),
        landStyle: new T.Vector4(),
        forestWeather: new T.Vector4(),
        fogRange: new T.Vector2(),
        glowAt: Array(8).fill(new T.Vector4()),
        occAt: Array(16).fill(new T.Vector4())
      };
      for (const [k, x] of Object.entries(settings)) U[k].value = x;
      const mat = new T.ShaderMaterial({
        fragmentShader: base.fragmentShader,
        vertexShader: base.vertexShader,
        glslVersion: base.glslVersion,
        uniforms: U
      });
      const geo = new T.PlaneGeometry(2, 2),
        count = geo.attributes.position.count;
      for (const [k, w] of [
        ['layers', 4],
        ['corner', 2],
        ['shade', 1]
      ])
        geo.setAttribute(k, new T.Float32BufferAttribute(new Float32Array(w * count).fill(k === 'shade' ? 1 : 0), w));
      const sc = new T.Scene(),
        cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 4);
      cam.position.z = 2;
      sc.add(new T.Mesh(geo, mat));
      R.setRenderTarget(rt);
      R.setClearColor(0xff00ff, 0);
      const out = {};
      if (mixed) {
        const rgba = geo.attributes.layers,
          uv = geo.attributes.corner,
          shade = geo.attributes.shade;
        U.soilColor.value = gray;
        U.soilSurface.value = front;
        U.bump.value = back;
        U.fullTerrain.value = 0;
        U.texU.value[0].w = 2;
        U.texU.value[1].w = 3;
        U.texU.value[2].w = 0.3;
        gray.image.data.set([34, 34, 34, 16], 4);
        gray.needsUpdate = true;
        const px = (layers, x, y, s) => {
          for (let i = 0; i < count; i++) {
            rgba.setXYZW(i, ...layers);
            uv.setXY(i, x, y);
            shade.setX(i, s);
          }
          for (const a of [rgba, uv, shade]) a.needsUpdate = true;
          R.render(sc, cam);
          const c = new Uint8Array(4);
          R.readRenderTargetPixels(rt, 2, 2, 1, 1, c);
          if (c[3] !== 255 || R.getContext().getError()) throw Error('No mixed sample');
          return c[0];
        };
        // Same world point and shared edge (donors 0/1). Opposite corners of the right cell are stock.
        out.edge = [0.22, 0.43, 0.71].map(y => [px([1, 0, 0, 1], 1, y, 1), px([0, 2, 1, 2], 0, y, 1)]);
        out.baked = [px([2, 2, 2, 2], 0, 0, 0), px([2, 2, 2, 2], 0, 0, 1)];
        for (const o of [rt, depthRT, mat, geo, gray, front, back, white, black, R]) o.dispose();
        return out;
      }
      for (const [k, full] of [
        ['stock', 0],
        ['ultra', 2]
      ]) {
        U.fullTerrain.value = full;
        out[k] = [front, back].map(normal => {
          U.bump.value = normal;
          R.render(sc, cam);
          const px = new Uint8Array(4);
          R.readRenderTargetPixels(rt, 2, 2, 1, 1, px);
          if (px[3] !== 255 || R.getContext().getError()) throw Error('Probe failed to draw: ' + px);
          return px[0];
        });
      }
      // At mid-bank compare a dry quad and a neighboring quad whose *opposite* edge
      // contains a bed slot. The common edge has identical paint and world elevation.
      U.bump.value = front;
      gray.image.data.set([20, 20, 20, 255], 4 * 4);
      gray.needsUpdate = true;
      U.texU.value[63].w = 4;
      const bankPixel = (level, mixed) => {
        U.waterLine.value = level;
        const layers = geo.attributes.layers;
        for (let i = 0; i < layers.count; i++) layers.setXYZW(i, 0, mixed ? 63 : 0, 0, mixed ? 63 : 0);
        layers.needsUpdate = true;
        R.render(sc, cam);
        const px = new Uint8Array(4);
        R.readRenderTargetPixels(rt, 2, 2, 1, 1, px);
        return px[0];
      };
      out.bank = [bankPixel(-4, false), bankPixel(1, false), bankPixel(-1.4, false), bankPixel(-1.4, true)];
      for (const obj of [rt, depthRT, mat, geo, gray, front, back, white, black, R]) obj.dispose();
      return out;
    }, mixed);
    if (mixed) {
      console.log('Shared edge pixels and zero/full baked shade:', samples);
      assert.deepEqual(errors, []);
      assert(
        samples.baked[0] >= samples.baked[1] * 0.42 && samples.baked[0] < samples.baked[1],
        'baked terrain byte extinguished visible ground'
      );
      assert(
        samples.edge.every(([l, r]) => Math.abs(l - r) <= 1),
        'distant stock corner changed this edge'
      );
      require('node:fs').writeFileSync(require('./remaster/ground-evidence.cjs').mixedProbeFile(), JSON.stringify(samples));
      return;
    }
    console.log('Directional sky only, facing / facing away:', samples);
    assert.deepEqual(errors, []);
    for (const name of ['stock', 'ultra'])
      assert(samples[name][0] > samples[name][1] + 16, `${name}: the shaded material ignored its normal`);
    const [dry, wet, left, right] = samples.bank,
      linear = v => (v <= 10 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    assert(Math.abs(left - right) <= 1, 'bank color jumps at the dry cell boundary');
    assert(Math.abs(linear(left) - (linear(dry) + linear(wet)) / 2) < 0.006, 'bank blend loses light between the materials');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
