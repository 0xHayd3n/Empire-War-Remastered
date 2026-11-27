// Army Painter: a shared four-channel paint treatment for model materials.
//
// One palette (primary, secondary, accent1, accent2) and one of four patterns.
// The pattern is sampled in the mesh's own normalised bounding box, so a hull
// that has no native team-color mask still gets a readable paint job: solid
// channels are units of coverage, not decals. The treatment multiplies the
// texture's own luminance so panel detail, decals and lighting survive.
//
// Deliberately THREE-free and browser-free: model.js owns the uniforms and the
// Node tests own the math. The GLSL below is generated from `LIVERY_TERMS` and
// `sampleLivery` evaluates the same table, so there is one source of truth.

export const LIVERY_PATTERNS = ['standard', 'banded', 'split', 'chevron'];

// How far the paint replaces the underlying albedo. 1 erases the texture hue,
// so keep some of it. Lighting, transparency and emissive terms are untouched.
export const LIVERY_AMOUNT = 0.82;

// Shaders whose colour is not hull paint: skies, shields, planar effects,
// terrain batches and the glow-only gloss pass. Their texture and blending win.
const PROTECTED = /^(skydome|nebula|planet|meshshield|batch|grass|tree|terrainmesh|lightvisualize|meshheat|shadowvolume|collision)/i;

export function liveryPaintable(
  shader,
  { additive = false, unlit = false, nativeAdditive = false, nebula = false, emissiveOnly = false } = {}
) {
  if (!shader || PROTECTED.test(shader)) return false;
  return !(additive || unlit || nativeAdditive || nebula || emissiveOnly);
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};

export const liverySoft = (v, c, w) => 1 - smoothstep(w * 0.6, w, Math.abs(v - c));
export const liveryStep = (v, c, w) => smoothstep(c - w, c + w, v);
export const liveryTri = v => Math.abs((v - Math.floor(v)) * 2 - 1);

// Pattern table. `axis`/`warp` pick the coordinate, `frequency`/`offset` wrap it
// into a triangle wave, `centre`/`width` place the channel, and `invert` flips a
// step so the secondary covers the other side. Every pattern names all three
// non-primary channels so a palette's accents always land somewhere visible.
export const LIVERY_TERMS = {
  standard: [
    { channel: 'secondary', axis: 'z', op: 'step', centre: -0.3, width: 0.05, invert: true },
    { channel: 'accent1', axis: 'z', op: 'band', centre: -0.3, width: 0.08 },
    { channel: 'accent2', axis: 'z', op: 'band', centre: 0.62, width: 0.07 }
  ],
  banded: [
    { channel: 'secondary', axis: 'z', op: 'step', frequency: 1.5, offset: 0.25, centre: 0.5, width: 0.07 },
    { channel: 'accent1', axis: 'z', op: 'band', frequency: 1.5, offset: 0.25, centre: 0.5, width: 0.07 },
    { channel: 'accent2', axis: 'z', op: 'band', frequency: 1.5, offset: 0.25, centre: 0.92, width: 0.05 }
  ],
  split: [
    { channel: 'secondary', axis: 'x', op: 'step', centre: 0, width: 0.025 },
    { channel: 'accent1', axis: 'x', op: 'band', centre: 0, width: 0.045 },
    { channel: 'accent2', axis: 'z', op: 'band', frequency: 1.5, offset: 0.25, centre: 1, width: 0.12 }
  ],
  chevron: [
    { channel: 'secondary', axis: 'z', op: 'step', warp: 0.55, frequency: 0.8, offset: 0.5, centre: 0.5, width: 0.09 },
    { channel: 'accent1', axis: 'z', op: 'band', warp: 0.55, frequency: 0.8, offset: 0.5, centre: 0.5, width: 0.1 },
    { channel: 'accent2', axis: 'z', op: 'band', warp: 0.55, frequency: 0.8, offset: 0.5, centre: 0.93, width: 0.05 }
  ]
};

const float = v => {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
};

const NL = String.fromCharCode(10);

const coordinate = t => (t.warp ? `(q.${t.axis} + abs(q.x) * ${float(t.warp)})` : `q.${t.axis}`);
const wave = t => (t.frequency ? `liveryTri(${coordinate(t)} * ${float(t.frequency)} + ${float(t.offset)})` : coordinate(t));

function termGlsl(t) {
  const w = `${float(t.centre)}, ${float(t.width)}`;
  if (t.op === 'band') return `liverySoft(${wave(t)}, ${w})`;
  if (t.op === 'step') {
    const step = `liveryStep(${wave(t)}, ${w})`;
    return t.invert ? `1.0 - ${step}` : step;
  }
  throw new Error('livery: unknown op ' + t.op);
}

function termJs(t, q) {
  const raw = t.warp ? q[t.axis] + Math.abs(q.x) * t.warp : q[t.axis];
  const value = t.frequency ? liveryTri(raw * t.frequency + t.offset) : raw;
  if (t.op === 'band') return liverySoft(value, t.centre, t.width);
  if (t.op === 'step') return t.invert ? 1 - liveryStep(value, t.centre, t.width) : liveryStep(value, t.centre, t.width);
  throw new Error('livery: unknown op ' + t.op);
}

// Generated statements for one pattern. Exported so a test can evaluate the
// shader text itself and compare it with sampleLivery().
export const liveryPatternSource = pattern =>
  (LIVERY_TERMS[pattern] || LIVERY_TERMS.standard).map(t => `${t.channel} = ${termGlsl(t)};`).join(' ');

const patternBlock = () =>
  LIVERY_PATTERNS.map((pattern, i) => {
    const terms = LIVERY_TERMS[pattern].map(t => `    ${t.channel} = ${termGlsl(t)};`).join(NL);
    const head =
      i === 0 ? `if (pattern < ${float(0.5)})` : i === LIVERY_PATTERNS.length - 1 ? 'else' : `else if (pattern < ${float(i + 0.5)})`;
    return `  ${head} {${NL}${terms}${NL}  }`;
  }).join(NL);

export const LIVERY_FRAG_BODY = patternBlock();

// One declaration block per program; the statements are no-ops unless LIVERY.
export const LIVERY_VERT_DECL = `
#ifdef LIVERY
varying vec3 vLiveryPos;
#endif`;

export const LIVERY_VERT_SET = `
#ifdef LIVERY
  vLiveryPos = position;
#endif`;

export const LIVERY_FRAG_DECL = `
#ifdef LIVERY
uniform vec4 liveryColor0, liveryColor1, liveryColor2, liveryColor3;
uniform vec3 liveryCenter, liveryHalf;
uniform vec4 liveryParams;
varying vec3 vLiveryPos;
float liverySoft(float v, float c, float w) { return 1.0 - smoothstep(w * 0.6, w, abs(v - c)); }
float liveryStep(float v, float c, float w) { return smoothstep(c - w, c + w, v); }
float liveryTri(float v) { return abs(fract(v) * 2.0 - 1.0); }
vec3 liveryPaint(vec3 albedo) {
  vec3 q = (vLiveryPos - liveryCenter) / max(liveryHalf, vec3(0.001));
  float pattern = liveryParams.x;
  float secondary = 0.0, accent1 = 0.0, accent2 = 0.0;
${LIVERY_FRAG_BODY}
  vec3 paint = mix(liveryColor0.rgb, liveryColor1.rgb, secondary);
  paint = mix(paint, liveryColor2.rgb, accent1);
  paint = mix(paint, liveryColor3.rgb, accent2);
  float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
  float shade = clamp(0.52 + 1.15 * luma, 0.14, 1.65);
  return mix(albedo, paint * shade, clamp(liveryParams.y, 0.0, 1.0));
}
#endif`;

export const LIVERY_FRAG_APPLY = `
#ifdef LIVERY
  albedo = liveryPaint(albedo);
#endif`;

// Channel weights for a normalised point in [-1, 1] per axis. Mirrors the GLSL.
export function sampleLivery(pattern, q) {
  const terms = LIVERY_TERMS[pattern] || LIVERY_TERMS.standard;
  const out = { secondary: 0, accent1: 0, accent2: 0 };
  for (const t of terms) out[t.channel] = termJs(t, q);
  return out;
}

// Final paint colour before luminance modulation; same order as the GLSL.
export function liveryComposite(colors, weights) {
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  let rgb = colors[0].slice(0, 3);
  rgb = mix(rgb, colors[1], clamp01(weights.secondary));
  rgb = mix(rgb, colors[2], clamp01(weights.accent1));
  rgb = mix(rgb, colors[3], clamp01(weights.accent2));
  return rgb;
}

const parseChannel = c => {
  const n = typeof c === 'string' ? Number(c) : c;
  return Number.isFinite(n) ? clamp01(n > 1 ? n / 255 : n) : null;
};

// '#rrggbb' (also '#rgb', 0xrrggbb, [r, g, b] and {r, g, b}) to a 0..1 triple.
export function parseLiveryColor(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const v = value.slice(0, 3).map(parseChannel);
    return v.length === 3 && v.every(x => x != null) ? v : null;
  }
  if (typeof value === 'object') return parseLiveryColor([value.r, value.g, value.b]);
  if (typeof value === 'number')
    return Number.isFinite(value) ? [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(x => clamp01(x / 255)) : null;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!hex) return null;
  const digits = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
  const n = parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(x => clamp01(x / 255));
}

const scale = (rgb, k) => rgb.map(v => clamp01(v * k));
const lift = (rgb, k) => rgb.map(v => clamp01(v + (1 - v) * k));

// Resolve anything a caller can hand over into one stable palette. The primary
// colour may come from the team colour, so a livery without colours still
// paints; a livery with no primary and no team colour keeps the stock path.
export function normalizeLivery(livery, fallback = null) {
  if (!livery || typeof livery !== 'object') return null;
  const colors = Array.isArray(livery.colors) ? livery.colors : [];
  const primary = parseLiveryColor(colors[0]) || parseLiveryColor(livery.primary) || parseLiveryColor(fallback);
  if (!primary) return null;
  const pick = (i, make) => parseLiveryColor(colors[i]) || make(primary);
  return Object.freeze({
    pattern: LIVERY_PATTERNS.includes(livery.pattern) ? livery.pattern : 'standard',
    colors: Object.freeze([primary, pick(1, p => scale(p, 0.5)), pick(2, p => lift(p, 0.6)), pick(3, p => scale(p, 0.22))])
  });
}

const hex2 = v =>
  Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0');

export function liveryColorHex(rgb) {
  return '#' + rgb.map(hex2).join('');
}

// Cache identity for materials and pools. Colours are rounded to 8 bits, which
// is also the precision a caller can express, so equivalent palettes share.
export function liveryKey(normalized) {
  return normalized ? normalized.pattern + ':' + normalized.colors.map(liveryColorHex).join('') : '';
}

// Mesh-local paint frame: centre and half size of the geometry's bounding box.
// Patterns are placed per axis, so long hulls and tall walkers both read.
export function liveryBounds(min, max) {
  const center = [],
    half = [],
    axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const a = Number(min?.[axis]),
      b = Number(max?.[axis]),
      lo = Number.isFinite(a) ? a : -1,
      hi = Number.isFinite(b) && b > lo ? b : lo + 2;
    center.push((lo + hi) / 2);
    half.push(Math.max(1e-3, (hi - lo) / 2));
  }
  const key = [...center, ...half].map(v => (Math.round(v * 1000) / 1000).toFixed(3)).join(',');
  return { center, half, key };
}

// Plain values for model.js to wrap in THREE uniforms.
export function liveryUniformValues(normalized, bounds, amount = LIVERY_AMOUNT) {
  return {
    colors: normalized.colors.map(rgb => [rgb[0], rgb[1], rgb[2], 1]),
    center: bounds.center.slice(),
    half: bounds.half.slice(),
    pattern: Math.max(0, LIVERY_PATTERNS.indexOf(normalized.pattern)),
    amount
  };
}
