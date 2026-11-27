// Optional integration test for the WebGPU Army Painter path, in a real browser.
// It builds the model shader the renderer would build for a painted hull, runs
// it through Chrome's WebGPU with the same bind group layouts and the same
// per-material palette block, draws quads (plain and instanced) and compares the
// pixels with sampleLivery() from the shared table. No retail data is used.
//
// CHROME=<path to chrome> node tools/test-gpu-livery-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const CHROME =
  process.env.CHROME ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].find(f => fs.existsSync(f));

const SIZE = 32;
const C = 0.24; // palette used below; only the shape matters, not the art

const page = (config, ports) => `<!doctype html><meta charset="utf-8"><body><script>
const CONFIG = ${JSON.stringify(config)};
const clamp01 = v => Math.min(1, Math.max(0, v));
const S = CONFIG.size;

window.__done = (async () => {
  const out = { errors: [], frames: {}, stockPixels: null, instanced: null, compiled: {} };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { out.fatal = 'no WebGPU adapter'; return out; }
  out.adapter = true;
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', e => out.errors.push('uncaptured: ' + e.error.message));

  const V = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const moduleOf = (label, code) => {
    const m = device.createShaderModule({ code, label });
    out.compiled[label] = m;
    return m;
  };
  const collect = async label => {
    const info = await out.compiled[label].getCompilationInfo();
    for (const msg of info.messages)
      if (msg.type === 'error') out.errors.push(label + ' ' + msg.lineNum + ':' + msg.linePos + ' ' + msg.message);
  };

  // The three layouts the renderer builds: pass, material (the family's own),
  // draw slot and arena.
  const g0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 1024 } },
      { binding: 1, visibility: V, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: V, sampler: { type: 'comparison' } },
      { binding: 3, visibility: V, texture: { sampleType: 'float' } },
      { binding: 4, visibility: V, sampler: { type: 'filtering' } }
    ]
  });
  const g2 = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 } }]
  });
  const g3 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] });

  const tex1 = rgba => {
    const t = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4, rowsPerImage: 1 }, [1, 1]);
    return t;
  };
  const textures = [tex1([CONFIG.grey, CONFIG.grey, CONFIG.grey, 255]), tex1([128, 128, 255, 255]), tex1([255, 255, 255, 255])];
  const fow = tex1([255, 255, 255, 255]);
  const depthTex = device.createTexture({
    size: [1, 1],
    format: 'depth24plus',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const compare = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });

  // Pass: identity view and projection, flat ambient light, no fog, no shadow.
  const passBuf = device.createBuffer({ size: 1024, usage: UNIFORM });
  const pass = new Float32Array(256);
  pass[0] = pass[5] = pass[10] = pass[15] = 1;
  pass[16] = pass[21] = pass[26] = pass[31] = 1;
  pass[50] = 6; // cameraPosition.z
  pass[52] = 0;
  pass[54] = 1; // sunDir.z
  pass[55] = 0.001; // shadowTexel
  pass[68] = pass[69] = pass[70] = 1; // ambient
  pass[77] = 0; // fogRange.y: haze off
  pass[220] = pass[221] = pass[222] = -1; // shadowTint.x < 0: no map shadow
  device.queue.writeBuffer(passBuf, 0, pass);

  // Draw: diffuse 1, nothing else, so the only colour left is the painted albedo.
  const drawBuf = device.createBuffer({ size: 256, usage: UNIFORM });
  const draw = new Float32Array(64);
  draw[0] = draw[5] = draw[10] = draw[15] = 1;
  draw[16] = draw[21] = draw[26] = draw[31] = 1;
  draw[32] = draw[33] = draw[34] = draw[35] = 1; // colorization
  draw[44] = draw[45] = draw[46] = 1; // diffuse
  draw[47] = 1; // opacity
  draw[60] = draw[61] = draw[62] = 0; // instBase, tintBase, boneBase
  draw[63] = -1; // alphaRef
  device.queue.writeBuffer(drawBuf, 0, draw);

  const liveryBuf = device.createBuffer({ size: CONFIG.blockBytes, usage: UNIFORM });
  const arenaBuf = device.createBuffer({ size: 4096, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const g0Group = device.createBindGroup({
    layout: g0,
    entries: [
      { binding: 0, resource: { buffer: passBuf, offset: 0, size: 1024 } },
      { binding: 1, resource: depthTex.createView() },
      { binding: 2, resource: compare },
      { binding: 3, resource: fow.createView() },
      { binding: 4, resource: sampler }
    ]
  });
  const g3Group = device.createBindGroup({ layout: g3, entries: [{ binding: 0, resource: { buffer: arenaBuf } }] });

  const materialLayout = layout => device.createBindGroupLayout({ entries: layout });
  const materialGroup = (gl, layout) => {
    let n = 0;
    const entries = layout.map(e => {
      if (e.texture) return { binding: e.binding, resource: textures[n++].createView() };
      if (e.sampler) return { binding: e.binding, resource: sampler };
      return { binding: e.binding, resource: { buffer: liveryBuf } };
    });
    return device.createBindGroup({ layout: gl, entries });
  };
  const pipelines = (layout, wgsl, label, depthOnly) => {
    const gl = materialLayout(layout);
    const pl = device.createPipelineLayout({ bindGroupLayouts: [g0, gl, g2, g3] });
    const module = moduleOf(label, wgsl);
    let stride = 0;
    const attributes = CONFIG.attributes.map(([name, n, loc]) => {
      const a = { shaderLocation: loc, offset: stride, format: 'float32x' + n };
      stride += n * 4;
      return a;
    });
    let pipe;
    try {
      pipe = device.createRenderPipeline({
        layout: pl,
        label,
        vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: stride, stepMode: 'vertex', attributes }] },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: depthOnly ? [{ format: 'rgba8unorm', writeMask: 0 }] : [{ format: 'rgba8unorm' }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'cw' },
        multisample: { count: 1 }
      });
    } catch (e) {
      out.errors.push(label + ': ' + e.message);
    }
    return { pipe, g1: materialGroup(gl, layout), stride };
  };

  // Chrome throws on an invalid pipeline; a stock layout without the palette
  // block still has to validate, and the shadow twin has to compile.
  const stock = pipelines(CONFIG.stock.layout, CONFIG.stock.wgsl, 'stock', false);
  const painted = pipelines(CONFIG.layout, CONFIG.wgsl, 'painted', false);
  const shadow = pipelines(CONFIG.layout, CONFIG.depthWgsl, 'paintedDepth', true);
  const instanced = pipelines(CONFIG.layout, CONFIG.instWgsl, 'paintedInstanced', false);

  const stride = painted.stride;
  const quad = (x0, x1) => {
    const v = [];
    for (const [x, y] of [
      [x0, -1],
      [x1, -1],
      [x1, 1],
      [x0, 1]
    ])
      v.push(x, y, 0.5, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0);
    return new Float32Array(v);
  };
  const vertexBuffer = data => {
    const b = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  const indexBuffer = (() => {
    const b = device.createBuffer({ size: 12, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new Uint16Array([0, 1, 2, 0, 2, 3]));
    return b;
  })();
  const full = vertexBuffer(quad(-1, 1));
  const half = vertexBuffer(quad(-0.5, 0.5));
  // Two identity-ish instance matrices, translated: the paint frame must come
  // from the vertex attribute, not from the instance's place in the world.
  const instances = new Float32Array(32);
  for (let i = 0; i < 2; i++) {
    const o = i * 16;
    instances[o] = instances[o + 5] = instances[o + 10] = instances[o + 15] = 1;
    instances[o + 12] = i === 0 ? -0.5 : 0.5;
  }
  device.queue.writeBuffer(arenaBuf, 0, instances);

  const target = device.createTexture({
    size: [S, S],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
  });
  const readBuf = device.createBuffer({ size: 256 * S, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const drawNow = async (setup, block, buffer, count) => {
    device.queue.writeBuffer(liveryBuf, 0, new Float32Array(block));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }
      ]
    });
    pass.setPipeline(setup.pipe);
    pass.setBindGroup(0, g0Group, [0]);
    pass.setBindGroup(1, setup.g1);
    pass.setBindGroup(2, g2Group, [0]);
    pass.setBindGroup(3, g3Group);
    pass.setVertexBuffer(0, buffer);
    pass.setIndexBuffer(indexBuffer, 'uint16');
    pass.drawIndexed(6, count, 0, 0, 0);
    pass.end();
    enc.copyTextureToBuffer({ texture: target }, { buffer: readBuf, bytesPerRow: 256, rowsPerImage: S }, [S, S, 1]);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(readBuf.getMappedRange());
    const pixels = [];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const o = y * 256 + x * 4;
        pixels.push(src[o], src[o + 1], src[o + 2]);
      }
    readBuf.unmap();
    return pixels;
  };
  const g2Group = device.createBindGroup({
    layout: g2,
    entries: [{ binding: 0, resource: { buffer: drawBuf, offset: 0, size: 256 } }]
  });

  if (painted.pipe) {
    for (const pattern of Object.keys(CONFIG.blocks)) out.frames[pattern] = await drawNow(painted, CONFIG.blocks[pattern], full, 1);
    out.stockPixels = await drawNow(painted, CONFIG.stockBlock, full, 1);
  }
  if (instanced.pipe) out.instanced = await drawNow(instanced, CONFIG.blocks[CONFIG.instancedPattern], half, 2);

  for (const label of Object.keys(out.compiled)) await collect(label);
  delete out.compiled;
  return out;
})();
</script></body>`;

const spawnChrome = (file, profile) =>
  spawn(
    CHROME,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--enable-unsafe-swiftshader',
      '--allow-file-access-from-files',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      pathToFileURL(file).href
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

const wait = ms => new Promise(r => setTimeout(r, ms));

// WebGPU work is asynchronous, so the page cannot be read with --dump-dom. Talk
// to it over the DevTools protocol instead and await its result promise.
async function runPage(html) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-livery-'));
  const file = path.join(profile, 'check.html');
  fs.writeFileSync(file, html);
  const child = spawnChrome(file, profile);
  let stderr = '';
  child.stderr.on('data', d => (stderr += d));
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = 0;
    for (let i = 0; i < 300 && !port; i++) {
      try {
        port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]) || 0;
      } catch {}
      if (!port) await wait(100);
    }
    assert(port, 'Chrome did not open a DevTools port: ' + stderr.slice(0, 600));
    let target;
    for (let i = 0; i < 200 && !target; i++) {
      const list = await fetch('http://127.0.0.1:' + port + '/json/list')
        .then(r => r.json())
        .catch(() => []);
      target = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!target) await wait(100);
    }
    assert(target, 'Chrome opened no page target: ' + stderr.slice(0, 600));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = err => rej(new Error('devtools socket: ' + err.message));
    });
    let id = 0;
    const send = (method, params) =>
      new Promise((res, rej) => {
        const mine = ++id;
        const onMsg = e => {
          const m = JSON.parse(e.data);
          if (m.id !== mine) return;
          ws.removeEventListener('message', onMsg);
          if (m.error) rej(new Error(method + ': ' + m.error.message));
          else res(m.result);
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id: mine, method, params }));
        setTimeout(() => rej(new Error(method + ' timed out')), 180000);
      });
    await send('Runtime.enable', {});
    const run = await send('Runtime.evaluate', {
      expression: 'window.__done',
      awaitPromise: true,
      returnByValue: true
    });
    ws.close();
    if (run.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(run.exceptionDetails).slice(0, 1200));
    return run.result.value;
  } finally {
    child.kill();
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
}

(async () => {
  if (!CHROME) {
    console.log('SKIP: Chrome not found; set CHROME=<path> to run the WebGPU paint check.');
    return;
  }
  const livery = await import(pathToFileURL(path.join(__dirname, '../public/js/livery.js')).href);
  const gpu = await import(pathToFileURL(path.join(__dirname, '../public/js/gpu/livery.js')).href);
  const { env } = await import(pathToFileURL(path.join(__dirname, '../public/js/gpu/env.js')).href);
  const { families } = await import(pathToFileURL(path.join(__dirname, '../public/js/gpu/programs.js')).href);

  const palette = [
    [0.24, 0.35, 0.5],
    [0.93, 0.42, 0.3],
    [0.88, 0.98, 0.99],
    [0.16, 0.2, 0.25]
  ];
  const rgb4 = c => ({ x: c[0], y: c[1], z: c[2], w: 1 });
  const uniforms = (pattern, amount) => ({
    liveryColor0: { value: rgb4(palette[0]) },
    liveryColor1: { value: rgb4(palette[1]) },
    liveryColor2: { value: rgb4(palette[2]) },
    liveryColor3: { value: rgb4(palette[3]) },
    liveryCenter: { value: { x: 0, y: 0, z: 0 } },
    liveryHalf: { value: { x: 1, y: 1, z: 1 } },
    liveryParams: { value: { x: pattern, y: amount, z: 0, w: 0 } }
  });
  const block = (pattern, amount) => {
    const f = new Float32Array(gpu.LIVERY_BYTES / 4);
    gpu.packLivery(uniforms(pattern, amount), f);
    return [...f];
  };
  const blocks = {};
  for (const pattern of livery.LIVERY_PATTERNS) blocks[pattern] = block(livery.LIVERY_PATTERNS.indexOf(pattern), 1);

  env.programSources = { VERT: 'vert', FRAG: 'frag gl_FrontFacing', DEPTH_FRAG: 'depth' };
  env.lighting = {};
  const material = (defines, fragmentShader = 'frag gl_FrontFacing') => ({
    isShaderMaterial: true,
    vertexShader: 'vert',
    fragmentShader,
    defines,
    uniforms: uniforms(0, 1)
  });
  const painted = families.find(f => f.match(material({ LIVERY: 1 })));
  const stock = families.find(f => f.match(material({})));
  assert.equal(painted.name, 'modelLivery');
  assert.equal(stock.name, 'model');

  const config = {
    size: SIZE,
    grey: 128,
    blockBytes: gpu.LIVERY_BYTES,
    layout: painted.layout,
    attributes: painted.attributes(material({ LIVERY: 1 }), false).vertex,
    wgsl: painted.code(material({ LIVERY: 1 }), false),
    instWgsl: painted.code(material({ LIVERY: 1 }), true),
    depthWgsl: painted.code(material({ LIVERY: 1 }, 'depth'), false),
    stock: { wgsl: stock.code(material({}), false), layout: stock.layout },
    blocks,
    stockBlock: block(0, 0),
    instancedPattern: 'banded'
  };

  const result = await runPage(page(config));
  assert.deepEqual(result.errors, [], 'the real WGSL compiles and every pipeline validates');
  assert.equal(result.adapter, true, 'WebGPU adapter');
  assert.deepEqual(Object.keys(result.frames).sort(), [...livery.LIVERY_PATTERNS].sort(), 'every pattern rendered');

  const grey = 128 / 255;
  const shade = Math.min(1.65, Math.max(0.14, 0.52 + 1.15 * grey));
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
  const mismatch = [];

  // Predicted pixel: sampleLivery() weights, liveryComposite() colour, the
  // shader's own luma shade, then the amount. The quad covers the whole clip
  // space, so the local paint position is the pixel's place in [-1, 1] per axis.
  const predict = (pattern, amount, qx, qy) => {
    const weights = livery.sampleLivery(pattern, { x: qx, y: qy, z: 0.5 });
    const paint = livery.liveryComposite(palette, weights);
    // The target is unorm: the shade term may brighten past 1 and clamps there.
    return paint.map(v => Math.min(1, Math.max(0, grey * (1 - amount) + v * shade * amount)) * 255);
  };
  const expect = (pattern, amount, x, y) => predict(pattern, amount, ((x + 0.5) / SIZE) * 2 - 1, ((y + 0.5) / SIZE) * 2 - 1);

  for (const pattern of livery.LIVERY_PATTERNS) {
    const pixels = result.frames[pattern];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const want = expect(pattern, 1, x, y);
        const at = (y * SIZE + x) * 3;
        for (let c = 0; c < 3; c++)
          if (!near(pixels[at + c], want[c], 2)) mismatch.push(`${pattern} (${x},${y}) c${c}: ${pixels[at + c]} vs ${want[c].toFixed(2)}`);
      }
    assert.equal(mismatch.length, 0, 'pixels are the JS model of the same table:\n' + mismatch.slice(0, 8).join('\n'));
  }

  // amount 0 is the stock path: the texture must come through untouched.
  for (let i = 0; i < result.stockPixels.length; i++)
    assert(near(result.stockPixels[i], 128, 1), 'amount 0 leaves the albedo alone (' + result.stockPixels[i] + ')');

  // Paint must land on screen: every pattern has to differ from the stock grey.
  for (const pattern of livery.LIVERY_PATTERNS) {
    const pixels = result.frames[pattern];
    let paintedPixels = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (Math.abs(pixels[i] - 128) + Math.abs(pixels[i + 1] - 128) + Math.abs(pixels[i + 2] - 128) > 6) paintedPixels++;
    assert(paintedPixels > pixels.length / 3 / 4, `${pattern} paints most of the hull (${paintedPixels} px)`);
  }
  // ...and the four patterns must not paint the same picture.
  for (let i = 0; i < livery.LIVERY_PATTERNS.length; i++)
    for (let j = i + 1; j < livery.LIVERY_PATTERNS.length; j++) {
      const a = result.frames[livery.LIVERY_PATTERNS[i]],
        b = result.frames[livery.LIVERY_PATTERNS[j]];
      let changed = 0;
      for (let p = 0; p < a.length; p += 3)
        if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 12) changed++;
      assert(changed > (a.length / 3) * 0.15, `${livery.LIVERY_PATTERNS[i]} and ${livery.LIVERY_PATTERNS[j]} paint differently`);
    }

  // Two instances of the same hull, translated a half-screen apart: each shows
  // the pattern of its own local frame, exactly as the WebGL vertex varying does.
  const inst = result.instanced;
  assert(inst, 'the instanced shader drew');
  let instanceMismatch = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const ndc = ((x + 0.5) / SIZE) * 2 - 1;
      // The quad spans -0.5..0.5, so the attribute is the offset from the
      // instance's centre; instance 0 sits left of the origin, instance 1 right.
      const local = ndc < 0 ? ndc + 0.5 : ndc - 0.5;
      const want = predict('banded', 1, local, ((y + 0.5) / SIZE) * 2 - 1);
      const at = (y * SIZE + x) * 3;
      for (let c = 0; c < 3; c++) if (Math.abs(inst[at + c] - want[c]) > 2) instanceMismatch++;
    }
  assert.equal(instanceMismatch, 0, 'instanced hulls paint in their own frame');

  console.log(
    'PASS: Chrome/WebGPU compiled the painted model shader and its shadow twin, every pattern renders the colour sampleLivery() predicts, amount 0 is the stock texture, and instanced hulls keep their own paint frame'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
