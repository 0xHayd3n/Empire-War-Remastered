// 203 nits is a reference white, not a measurement of the panel or the OS brightness setting.
export const HDR_WHITE = 203;
export const hdrDefaults = { hdrMode: 'off', hdrPaper: HDR_WHITE, hdrPeak: 1000, hdrShadows: 0 };
export const hdrDisplay = globalThis.matchMedia?.('(dynamic-range: high)');
const bounded = (v, min, max, fallback) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
export function calibration(p) {
  return {
    hdrPaper: bounded(p.hdrPaper, 80, 300, HDR_WHITE),
    hdrPeak: bounded(p.hdrPeak, 400, 4000, 1000),
    hdrShadows: bounded(p.hdrShadows, -1, 1, 0)
  };
}

// A successful configure() alone isn't a check: older engines ignore unknown dictionary members.
export function configureExtended(context, device) {
  if (!context?.getConfiguration) return false;
  try {
    context.configure({
      device,
      format: 'rgba16float',
      colorSpace: 'srgb',
      alphaMode: 'opaque',
      toneMapping: { mode: 'extended' },
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const c = context.getConfiguration();
    return c?.format === 'rgba16float' && c.toneMapping?.mode === 'extended';
  } catch {
    return false;
  }
}

// Legacy shaders write display-referred sRGB-like values. Decode before scaling luminance,
// anchor diffuse white and roll brighter values toward peak without changing their linear RGB ratios.
// The extended sRGB canvas takes sRGB signal values, not PQ codes or linear light.
const vertex = `@vertex fn vs(@builtin(vertex_index) i:u32) -> @builtin(position) vec4f {
  return vec4f(vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0, 0.0, 1.0);
}`;
const curve = `
@group(0) @binding(0) var<uniform> cal: vec4f; // paper, peak (multiples of reference white), shadow exponent, unused
fn encode(x:vec3f) -> vec3f { return select(1.055*pow(x,vec3f(1.0/2.4))-0.055, 12.92*x, x <= vec3f(0.0031308)); }
fn displayColor(rgb:vec3f) -> vec3f {
  let c = max(rgb, vec3f(0.0));
  let lin = select(pow((c+0.055)/1.055, vec3f(2.4)), c/12.92, c <= vec3f(0.04045));
  let m = max(max(lin.r,lin.g),lin.b);
  let range = cal.y - cal.x;
  let above = max(m-1.0,0.0)*cal.x;
  let n = select(cal.x + range * above/(range+above), cal.x*pow(min(m,1.0),cal.z), m<=1.0);
  return encode(lin * (n / max(m,1e-8)));
}`;

// Same transform for the calibration strip and the frame presenter.
export function createHDRPass(device, pattern = false) {
  const code =
    vertex +
    curve +
    (pattern
      ? `
@fragment fn fs(@builtin(position) p:vec4f) -> @location(0) vec4f {
  let x = p.x / 600.0;
  var c = select(0.0, select(0.035, 0.08, x > 0.22), x > 0.11);
  if (x >= 0.3333) { c = select(1.0, select(2.0, 16.0, x > 0.84), x >= 0.6667); }
  return vec4f(displayColor(vec3f(c)),1.0);
}`
      : `
@group(0) @binding(1) var scene:texture_2d<f32>;
@fragment fn fs(@builtin(position) p:vec4f) -> @location(0) vec4f {
  return vec4f(displayColor(textureLoad(scene,vec2i(p.xy),0).rgb),1.0);
}`);
  const module = device.createShaderModule({ label: 'HDR display transform', code });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] }
  });
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let source, group, lastValues;
  return {
    draw(encoder, output, input, prefs) {
      if (!group || source !== input) {
        source = input;
        const entries = [{ binding: 0, resource: { buffer } }];
        if (input) entries.push({ binding: 1, resource: input });
        group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      }
      if (!lastValues || lastValues[0] !== prefs.hdrPaper || lastValues[1] !== prefs.hdrPeak || lastValues[2] !== prefs.hdrShadows) {
        const p = calibration(prefs);
        device.queue.writeBuffer(
          buffer,
          0,
          new Float32Array([p.hdrPaper / HDR_WHITE, p.hdrPeak / HDR_WHITE, 2 ** (-p.hdrShadows * 0.5), 0])
        );
        lastValues = [prefs.hdrPaper, prefs.hdrPeak, prefs.hdrShadows];
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: output, loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    },
    dispose() {
      buffer.destroy();
    }
  };
}
