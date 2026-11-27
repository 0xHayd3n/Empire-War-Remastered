// Army Painter on the WebGPU battlefield: the WGSL half of ../livery.js.
//
// ../livery.js owns the palette table (LIVERY_TERMS) and the maths. This module
// reads the same table and emits the same statements, because both renderers
// must paint the same hull the same way: the term text below is byte-identical
// to liveryPatternSource(), which is why a test can compare the two directly.
//
// The paint frame is the mesh's own local bounding box, exactly as WebGL uses
// it: the varying carries the vertex position attribute, before skinning and
// before the instance matrix, so pooled and instanced hulls share one frame.
import { LIVERY_PATTERNS, LIVERY_TERMS } from '../livery.js';

// Group 1 holds each texture at an even binding and its sampler at the next
// odd one. The model family owns 0..5 (map, normal, gloss) and 6..7 when it
// reflects the sky, so the palette block lands on 8, like terrain's and the
// galactic model's own block.
export const LIVERY_BINDING = 8;

// colours (4 x vec4 = 64) + centre (vec3 + pad) + half size (vec3 + pad) +
// params (vec4) = 112 bytes, all 16-byte aligned.
export const LIVERY_BYTES = 112;

const float = v => {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
};

const NL = String.fromCharCode(10);

const coordinate = t => (t.warp ? `(q.${t.axis} + abs(q.x) * ${float(t.warp)})` : `q.${t.axis}`);
const wave = t => (t.frequency ? `liveryTri(${coordinate(t)} * ${float(t.frequency)} + ${float(t.offset)})` : coordinate(t));

function term(t) {
  const w = `${float(t.centre)}, ${float(t.width)}`;
  if (t.op === 'band') return `liverySoft(${wave(t)}, ${w})`;
  if (t.op === 'step') {
    const step = `liveryStep(${wave(t)}, ${w})`;
    return t.invert ? `1.0 - ${step}` : step;
  }
  throw new Error('livery: unknown op ' + t.op);
}

// One pattern's statements. Same shape and same text as the GLSL in livery.js.
export const liveryPatternWGSL = pattern =>
  (LIVERY_TERMS[pattern] || LIVERY_TERMS.standard).map(t => `${t.channel} = ${term(t)};`).join(' ');

const patternBlock = () =>
  LIVERY_PATTERNS.map((pattern, i) => {
    const terms = LIVERY_TERMS[pattern].map(t => `    ${t.channel} = ${term(t)};`).join(NL);
    const head =
      i === 0 ? `if (pattern < ${float(0.5)})` : i === LIVERY_PATTERNS.length - 1 ? 'else' : `else if (pattern < ${float(i + 0.5)})`;
    return `  ${head} {${NL}${terms}${NL}  }`;
  }).join(NL);

// The four-pattern ladder, in table order. livery.js exports the same block as
// GLSL (LIVERY_FRAG_BODY); both must stay byte-identical.
export const LIVERY_PATTERN_BLOCK = patternBlock();

// Declarations and the paint function. Appended to the model shader only when
// the material defines LIVERY, so stock pixels and the stock program are the
// same as before.
export const LIVERY_WGSL = `
struct Livery {
  colors: array<vec4f, 4>,
  center: vec3f, centerPad: f32,
  extent: vec3f, extentPad: f32,
  params: vec4f,
}
@group(1) @binding(${LIVERY_BINDING}) var<uniform> LV: Livery;
fn liverySoft(v: f32, c: f32, w: f32) -> f32 { return 1.0 - smoothstep(w * 0.6, w, abs(v - c)); }
fn liveryStep(v: f32, c: f32, w: f32) -> f32 { return smoothstep(c - w, c + w, v); }
fn liveryTri(v: f32) -> f32 { return abs(fract(v) * 2.0 - 1.0); }
fn liveryPaint(albedo: vec3f, at: vec3f) -> vec3f {
  let q = (at - LV.center) / max(LV.extent, vec3f(0.001));
  let pattern = LV.params.x;
  var secondary = 0.0;
  var accent1 = 0.0;
  var accent2 = 0.0;
${LIVERY_PATTERN_BLOCK}
  var paint = mix(LV.colors[0].rgb, LV.colors[1].rgb, secondary);
  paint = mix(paint, LV.colors[2].rgb, accent1);
  paint = mix(paint, LV.colors[3].rgb, accent2);
  let luma = dot(albedo, vec3f(0.299, 0.587, 0.114));
  let shade = clamp(0.52 + 1.15 * luma, 0.14, 1.65);
  return mix(albedo, paint * shade, clamp(LV.params.y, 0.0, 1.0));
}`;

const copy = (f, o, v, n) => {
  for (let i = 0; i < n; i++) {
    const x = v ? [v.x, v.y, v.z, v.w][i] : 0;
    f[o + i] = Number.isFinite(x) ? x : 0;
  }
};

// model.js's liveryUniformSet() uniforms -> the block the WGSL reads. A
// material without them packs an amount of 0, which leaves the texture alone,
// so a LIVERY define can never blank a hull.
export function packLivery(uniforms, f, o = 0) {
  const at = k => (uniforms && uniforms[k] && uniforms[k].value) || null;
  for (let i = 0; i < 4; i++) copy(f, o + i * 4, at('liveryColor' + i), 4);
  copy(f, o + 16, at('liveryCenter'), 3);
  f[o + 19] = 0;
  copy(f, o + 20, at('liveryHalf'), 3);
  f[o + 23] = 0;
  copy(f, o + 24, at('liveryParams'), 4);
}
