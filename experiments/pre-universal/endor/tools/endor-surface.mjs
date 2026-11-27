/**
 * Endor forest surface detail for the Universal texture builder.
 *
 *   import { forestPixel } from './endor-surface.mjs';
 *   const [r, g, b] = forestPixel('endorBark', x / side, y / side, srcR, srcG, srcB, side);
 *
 * Pure, deterministic per-pixel detailing pass. The source texel seeds the palette and
 * the masking decisions; the structure comes from periodic value noise and jittered cell
 * fields, so every role reads as a close-up surface instead of a screen grain:
 *
 *   endorBark   old redwood bark: fissures that flow and braid, lit and sheltered plate
 *               faces, moss on the shaded faces, thin lips of lifted plate catching light
 *   endorLeaves ferns and leafy canopy: overlapping leaves of mixed size with midribs and
 *               chevron veins, light-catching clusters, silhouette left alone
 *   endorSoil   forest floor: fallen needles at every angle, leaf litter with visible ribs,
 *               cool moss patches against warmer bare earth
 *
 * Guarantees
 *  - deterministic: no randomness, clock or state carried between calls
 *  - tiles on both axes: every field is periodic with period 1 in u and v, including the
 *    pixel-scaled offsets, so u = 1 equals u = 0 exactly
 *  - bounded: the result is finite and inside 0..255; each feature contributes a bounded
 *    multiplier or tint, and roles that touch silhouettes fade out over dark texels
 *  - pure: no texture, buffer or alpha writes; the caller owns the destination
 *  - budgeted for about a megapixel in a couple of seconds on a normal desktop engine
 */

// ---- small math helpers -------------------------------------------------------------

const INV32 = 1 / 4294967296;

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a, b, t) => a + (b - a) * t;

function smooth(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// tanh without the transcendental: monotone, bounded to -1..1, cheap.
const softsat = x => x / (1 + (x < 0 ? -x : x));

// ---- hashing and periodic noise -----------------------------------------------------

// 32 bit integer hash: stable across engines, no tables, no allocation.
function hash32(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Cheap re-scramble, so one lattice hash can feed several independent choices.
function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

const unit = h => h * INV32;
const lane = (h, k) => ((h >>> (k * 8)) & 255) * (1 / 255);

// Value noise on a lattice whose period is a power of two, so wrapping is a mask instead
// of a modulo. Sampling u * period makes the field periodic in u with period 1, which is
// what keeps the whole result tileable. mx / my are the period masks (period - 1).
function noise(x, y, mx, my, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ix & mx;
  const x1 = (ix + 1) & mx;
  const y0 = iy & my;
  const y1 = (iy + 1) & my;
  const a = unit(hash32(x0, y0, seed));
  const b = unit(hash32(x1, y0, seed));
  const c = unit(hash32(x0, y1, seed));
  const d = unit(hash32(x1, y1, seed));
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

// Sum of octaves. fx / fy are power-of-two cell counts for the first octave and every
// octave doubles them, so the sum stays periodic in u and v.
function fbm(u, v, fx, fy, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * fx * f, v * fy * f, fx * f - 1, fy * f - 1, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

// ---- jittered cell fields -----------------------------------------------------------

// Shared scratch objects keep the sampler allocation free. They are only read right after
// being filled, so forestPixel stays a pure function from the caller's point of view.
const cell = { d1: 0, gap: 0, dx: 0, dy: 0, h: 0 };

// Jittered Feature Points on a power-of-two cell grid, searched over the 3x3 neighbourhood.
function voronoi(u, v, cx, cy, seed, jitter) {
  const x = u * cx;
  const y = v * cy;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const mx = cx - 1;
  const my = cy - 1;
  let d1 = 4;
  let d2 = 4;
  let px = 0;
  let py = 0;
  let hh = 0;
  for (let oy = -1; oy <= 1; oy++) {
    const yy = iy + oy;
    const wy = yy & my;
    for (let ox = -1; ox <= 1; ox++) {
      const xx = ix + ox;
      const h = hash32(xx & mx, wy, seed);
      const fx = xx + 0.5 + (lane(h, 0) - 0.5) * jitter;
      const fy = yy + 0.5 + (lane(h, 1) - 0.5) * jitter;
      const dx = fx - x;
      const dy = fy - y;
      const dd = dx * dx + dy * dy;
      if (dd < d1) {
        d2 = d1;
        d1 = dd;
        px = fx;
        py = fy;
        hh = h;
      } else if (dd < d2) d2 = dd;
    }
  }
  cell.d1 = Math.sqrt(d1);
  cell.gap = Math.sqrt(d2) - cell.d1;
  cell.dx = x - px;
  cell.dy = y - py;
  cell.h = hh;
  return cell;
}

// One elliptical leaf around a cell centre. Writes into el so several leaf scales can be
// layered without allocating. veinStep is the vein half width in cell units.
const el = { inside: 0, rr: 0, light: 0, vein: 0, rim: 0, tone: 0 };

function leafShape(dx, dy, h, lenMin, lenRange, widMin, widRange, veinStep) {
  const h2 = mix32(h);
  const ang = lane(h2, 2) * Math.PI;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const a = dx * ca + dy * sa;
  const p = -dx * sa + dy * ca;
  const len = lenMin + lane(h2, 3) * lenRange;
  const wid = widMin + lane(h2, 0) * widRange;
  // Pointed lens rather than an ellipse: it tapers to a tip at both ends, which is what
  // makes the shape read as a leaf instead of a capsule.
  const rr = Math.abs(a) / len + (p * p) / (wid * wid);
  el.rr = rr;
  el.tone = lane(h2, 1);
  el.inside = 1 - smooth(0.72, 1.02, rr);
  // Surface normal of the leaf bump against light from the upper left: the upper rim of
  // every leaf catches light, the lower rim falls away into the canopy.
  const nx = a / (len * len);
  const ny = p / (wid * wid);
  el.light = softsat((nx * 0.5 + ny * 0.95) * 2.6) * smooth(0.3, 0.95, rr) + (1 - rr) * 0.16;
  // Midrib plus chevron side veins, kept hairline by scaling off the output width. Vein
  // spacing and phase differ per leaf so they are not a ruled feather pattern.
  const h3 = mix32(h2);
  const vw = veinStep;
  const mid = 1 - smooth(vw * 0.45, vw * 1.9, Math.abs(p));
  const chev =
    smooth(0.94, 1, Math.abs(Math.sin(a * (18 + lane(h3, 0) * 22) - Math.abs(p) * (16 + lane(h3, 1) * 14) + lane(h3, 2) * 6))) *
    (1 - smooth(wid * 0.25, wid * 0.75, Math.abs(p)));
  el.vein = clamp01(mid * 0.9 + chev * 0.55) * el.inside;
  // A slightly darker margin keeps neighbouring leaves readable when they overlap.
  el.rim = smooth(0.62, 0.88, rr) * (1 - smooth(0.88, 1.02, rr)) * el.inside;
  return el;
}

// ---- bark ---------------------------------------------------------------------------

function bark(u, v, r, g, b, side) {
  // Domain warp: this is what makes the fissures and fibres flow and braid instead of
  // reading as generated lines.
  const wa = fbm(u, v, 2, 2, 2, 311);
  const wb = fbm(u, v, 4, 2, 2, 733);
  const wu = u + (wa - 0.5) * 0.2;
  const wv = v + (wb - 0.5) * 0.14;

  // Two pixels towards the light, used for every slope and for the shifted masks.
  const ox = 2 / side;
  const oy = 2.8 / side;

  // Plates: coarse across the trunk, strongly stretched along it. Only the fissure network
  // and its lifted lip come from here; the surface tone is left to the fibres and mottling.
  const H = fbm(wu, wv, 16, 4, 3, 911);
  const H2 = fbm(wu + ox, wv + oy, 16, 4, 3, 911);

  // Fibres: many thin ridges along the trunk, eight times finer across than along, which is
  // what the close-up actually reads. The shifted sample lights every ridge.
  const F = fbm(wu, wv, 64, 8, 2, 2609);
  const F2 = fbm(wu + ox, wv + oy, 64, 8, 2, 2609);
  // Ridges break into short segments instead of running the full height of the trunk.
  const breaks = 0.45 + 0.85 * fbm(u, v, 2, 8, 2, 3307);
  const flit = softsat(((F2 - F) / (ox * 64)) * 0.7 * breaks);
  const ridge = 1 - Math.abs(2 * F - 1);
  const ridgeSq = ridge * ridge;
  const Ff = 1 - Math.abs(2 * fbm(wu, wv, 128, 16, 1, 2903) - 1);

  // crest is 1 on a plate top and falls towards 0 in a fissure (measured range ~0.35..1).
  const crest = 1 - Math.abs(2 * H - 1);
  const crest2 = 1 - Math.abs(2 * H2 - 1);
  // Weathering: patchy rather than a smooth gradient, so the surface never looks melted.
  const mott = fbm(u, v, 16, 16, 2, 1777) - 0.5;
  // Fissure width breathes along the trunk, so some cracks are gouges and others hairs, and
  // fissure strength fades in places so the furrows do not ring the trunk evenly.
  const wide = (wb - 0.5) * 0.12;
  const fissure = (1 - smooth(0.38 + wide, 0.64 + wide, crest)) * (0.55 + 0.75 * (mott + 0.5));
  const fissure2 = 1 - smooth(0.38 + wide, 0.64 + wide, crest2);

  // A second, finer furrow set: short cracks between the big ones.
  const Hf = fbm(wu, wv, 64, 16, 1, 1223);
  const fineCrack = 1 - smooth(0.16, 0.34, 1 - Math.abs(2 * Hf - 1));
  const valley = 1 - smooth(0.42, 0.8, crest);
  const face = 1 - fissure;
  // Lip: outside a fissure, but with a fissure a couple of pixels towards the light.
  const lip = face * fissure2;

  // Fine grit and hairlines that crack across the plate tops.
  const fine = (fbm(wu, wv, 64, 64, 2, 2143) - 0.5) * (1 - fissure * 0.7);
  const crack = (1 - smooth(0, 0.024, Math.abs(fbm(wu, wv, 16, 8, 2, 1501) - 0.5))) * face;

  // Moss: patchy, favouring faces turned away from the light and the recesses. Its edge is
  // ragged from the fine field so it reads as growth, not a painted blob.
  const patch = fbm(u, v, 8, 4, 3, 4409) + (ridge - 0.5) * 0.4 + fine * 0.3;
  const sheltered = clamp01(0.5 - flit * 0.45 + valley * 0.6);
  const greenish = clamp01((g - (r + b) * 0.5) / 24);
  const moss = clamp01(
    clamp01((patch - 0.5) * 3.8) * (0.12 + 1.15 * sheltered * sheltered) * (0.6 + 0.75 * greenish) * (1 - fissure * 0.2)
  );

  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  let R = r;
  let G = g;
  let B = b;

  // Relief: lit fibre ridges, occlusion in the recesses and a thin lifted lip that catches
  // light just above a fissure.
  const rel = flit * face * 0.3 - valley * 0.28 + lip * clamp01(flit + 0.15) * 0.85;
  R *= 1 + rel;
  G *= 1 + rel * 0.95;
  B *= 1 + rel * 0.85;

  // Fibrous ridges: sharp crests with shaded troughs, plus grit and hairlines. The break
  // field fades ridges in and out so they do not read as continuous drawn lines.
  const tex = (ridgeSq - 0.42) * 0.85 * breaks + (Ff - 0.5) * 0.28 + fine * 0.34 - crack * 0.4 - fineCrack * 0.22 + mott * 0.2;
  R *= 1 + tex;
  G *= 1 + tex * 0.9;
  B *= 1 + tex * 0.72;

  // Weathered grey-brown patches over the reddish heartwood.
  R += mott * 9;
  G += mott * 10;
  B += mott * 6;

  // Fissures: deep red brown, not flat ink, and never a black hole.
  if (fissure > 0.002) {
    const depth = clamp01(fissure * (0.85 + 0.5 * fine));
    R = mix(R, 26 + L * 0.26 + fine * 26, depth * 0.9);
    G = mix(G, 17 + L * 0.19 + fine * 18, depth * 0.9);
    B = mix(B, 14 + L * 0.15 + fine * 14, depth * 0.9);
  }

  // Moss grows over everything at the end, granular rather than a smooth smudge, with a
  // ragged edge from the same speckle field.
  if (moss > 0.01) {
    const speck = fbm(u, v, 64, 32, 2, 5039) - 0.5;
    const rag = clamp01(0.72 + speck * 1.5) * clamp01(0.8 + fine * 1.2);
    const k = moss * rag * 0.94;
    // A stain rather than a flat blob: the fibres keep showing through the growth.
    R *= 1 - k * 0.52;
    G *= 1 + k * 0.1;
    B *= 1 - k * 0.44;
    R += speck * 26 * k;
    G += speck * 32 * k;
    B += speck * 12 * k;
  }

  return [R, G, B];
}

// ---- canopy leaves ------------------------------------------------------------------

function leaves(u, v, r, g, b, side) {
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  // Dark texels are the silhouette rim of the model: leave almost all of them alone.
  const guard = smooth(4, 24, L);

  let cov = 0;
  let lightAcc = 0;
  let veinAcc = 0;
  let rimAcc = 0;
  let toneAcc = 0;
  let wsum = 0;

  // Three overlapping leaf scales, back to front: broad fronds, leaves, then leaflets. The
  // leaves are deliberately larger than their cells so the canopy closes over itself and
  // only small dark gaps remain.
  // cellsX, cellsY, seed, len base, len range, wid base, wid range, vein scale.
  const layers = [
    [4, 4, 1301, 0.8, 0.3, 0.38, 0.16, 1.25],
    [8, 8, 1607, 0.46, 0.26, 0.22, 0.12, 1.0],
    [16, 16, 1901, 0.34, 0.22, 0.16, 0.1, 0.85]
  ];
  for (let i = 0; i < 3; i++) {
    const ly = layers[i];
    const c = voronoi(u, v, ly[0], ly[1], ly[2], 0.95);
    // Cells whose nearest feature is far away cannot hold this leaf: skip the trig work.
    if (c.d1 > 1.3) continue;
    const shape = leafShape(c.dx, c.dy, c.h, ly[3], ly[4], ly[5], ly[6], (ly[7] * ly[0]) / side);
    if (shape.inside > 0.002) {
      if (shape.inside > cov) cov = shape.inside;
      lightAcc += shape.inside * shape.light;
      veinAcc += shape.inside * shape.vein;
      rimAcc += shape.inside * shape.rim;
      toneAcc += shape.inside * shape.tone;
      wsum += shape.inside;
    }
  }

  // Light through the canopy plus each leaf's own highlight, and the depth behind leaves.
  const dapple = fbm(u, v, 2, 2, 3, 1709);
  const gap = 1 - cov;
  // Leaf light is compressed so a shaded leaf keeps its colour instead of going black.
  const rawLight = (wsum > 0 ? lightAcc / wsum : -1) * (0.5 + dapple);
  const light = rawLight < -0.7 ? -0.7 : rawLight > 1.1 ? 1.1 : rawLight;
  const tone = wsum > 0 ? toneAcc / wsum : 0.5;
  const vein = wsum > 0 ? veinAcc / wsum : 0;
  const rim = wsum > 0 ? rimAcc / wsum : 0;

  let R = r;
  let G = g;
  let B = b;

  // Canopy depth between the leaves: cool and dark instead of a flat seam grid, but never
  // a black hole.
  R *= 1 - gap * 0.3;
  G *= 1 - gap * 0.17;
  B *= 1 - gap * 0.23;
  R += gap * 4;
  G += gap * 5;
  B += gap * 3;

  // Fresh yellow-green leaves against deeper blue-green ones, with the odd dead brown leaf.
  R *= 0.84 + tone * 0.46;
  G *= 0.95 + tone * 0.22;
  B *= 0.84 + tone * 0.3;
  const dead = clamp01((0.14 - tone) * 7) * cov;
  R = mix(R, R * 1.15 + 16, dead * 0.8);
  G = mix(G, G * 0.92 + 6, dead * 0.8);
  B = mix(B, B * 0.7, dead * 0.8);

  // Leaf shading with a warm sunlit rim.
  R *= 1 + light * 0.42;
  G *= 1 + light * 0.5;
  B *= 1 + light * 0.3;
  R += clamp01(light) * (10 + L * 0.18);
  G += clamp01(light) * (13 + L * 0.22);
  B += clamp01(light) * (3 + L * 0.06);

  // Veins: a light-catching rib with a soft shaded flank.
  const vk = vein * guard;
  R = mix(R, R * 1.2 + 14, vk * 0.95);
  G = mix(G, G * 1.26 + 18, vk * 0.95);
  B = mix(B, B * 1.04 + 5, vk * 0.95);
  R *= 1 - vk * 0.16;
  G *= 1 - vk * 0.08;

  // Dark leaf margins separate overlapping leaves without a seam grid.
  R *= 1 - rim * 0.3;
  G *= 1 - rim * 0.24;
  B *= 1 - rim * 0.26;

  // Fine leaf texture so clusters are not flat cards.
  const tex = (fbm(u, v, 32, 16, 2, 2011) - 0.5) * (0.35 + 0.65 * cov);
  R += tex * 13;
  G += tex * 15;
  B += tex * 9;

  return [r + (R - r) * guard, g + (G - g) * guard, b + (B - b) * guard];
}

// ---- soil ---------------------------------------------------------------------------

const needles = { cover: 0, tone: 0 };

function segDist2(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const t = clamp01(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey));
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  return dx * dx + dy * dy;
}

// Fallen needles: one jittered segment per cell where the density field allows it, angled
// per needle. Every needle differs in length, thickness and colour, so the floor never
// turns into a uniform straw mat.
function needleField(u, v, side) {
  const G = 32;
  const x = u * G;
  const y = v * G;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const dens = fbm(u, v, 4, 4, 2, 6101);
  const drift = (dens - 0.5) * 1.7;
  // Needles come in drifts: some cells get none, others several.
  const pick = clamp01((dens - 0.34) * 2.8);
  let cover = 0;
  let tone = 0;
  for (let oy = -1; oy <= 1; oy++) {
    const yy = iy + oy;
    const wy = yy & (G - 1);
    for (let ox = -1; ox <= 1; ox++) {
      const xx = ix + ox;
      const h = hash32(xx & (G - 1), wy, 3301);
      if (lane(h, 3) > pick) continue;
      const h2 = mix32(h);
      const cx = xx + 0.5 + (lane(h2, 0) - 0.5) * 0.85;
      const cy = yy + 0.5 + (lane(h2, 1) - 0.5) * 0.85;
      const a = drift + lane(h2, 2) * Math.PI;
      const half = 0.42 + lane(h2, 3) * 0.34;
      const ex = Math.cos(a) * half;
      const ey = Math.sin(a) * half;
      const thick = ((0.7 + lane(mix32(h2), 0) * 1.3) * G) / side;
      const t2 = thick * thick;
      const c = 1 - smooth(t2 * 0.5, t2 * 4, segDist2(x, y, cx - ex, cy - ey, cx + ex, cy + ey));
      if (c > cover) {
        cover = c;
        tone = 0.3 + lane(mix32(h2), 1) * 0.7;
      }
    }
  }
  needles.cover = cover;
  needles.tone = tone;
}

function soil(u, v, r, g, b, side) {
  const clim = fbm(u, v, 2, 2, 3, 2203);
  const mott = fbm(u, v, 8, 4, 3, 2909) - 0.5;

  // Leaf litter: broad fallen leaves with real outlines, plus a scatter of broken fragments
  // between them so the mat of leaves never falls into a visible lattice.
  const litter = voronoi(u, v, 4, 4, 2411, 0.95);
  const l1 = leafShape(litter.dx, litter.dy, litter.h, 0.44, 0.24, 0.22, 0.12, (1.0 * 4) / side);
  const litterInside = l1.inside;
  const litterLight = l1.light;
  const litterVein = l1.vein;
  const litterTone = l1.tone;
  const litterRr = l1.rr;
  const frag = voronoi(u, v, 16, 16, 2419, 0.95);
  const l2 = leafShape(frag.dx, frag.dy, frag.h, 0.4, 0.24, 0.2, 0.14, (1.0 * 16) / side);
  const fragInside = l2.inside;
  const fragTone = l2.tone;
  const fragRr = l2.rr;

  needleField(u, v, side);

  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  const warmOrig = clamp01((r - b) / 80);
  const coolOrig = clamp01((g - (r + b) * 0.5) / 22);
  // Two climates with fairly crisp edges: damp mossy pockets and dry warm earth.
  const cool = smooth(0.54, 0.68, clim) * (0.65 + 0.55 * coolOrig);
  const warm = (1 - smooth(0.36, 0.5, clim)) * (0.55 + 0.7 * warmOrig);

  let R = r;
  let G = g;
  let B = b;

  // Bare earth: warm grains against cool damp soil.
  R *= (1 + warm * 0.32 - cool * 0.14) * (1 + mott * 0.45);
  G *= (1 - warm * 0.06 + cool * 0.24) * (1 + mott * 0.38);
  B *= (1 - warm * 0.34 + cool * 0.04) * (1 + mott * 0.36);

  // Broken fragments first: darker, half buried in the earth.
  if (fragInside > 0.002) {
    const fi = fragInside;
    const fw = 0.2 + fragTone * 0.5;
    R = mix(R, R * 0.9 + 8 * fw, fi * 0.36);
    G = mix(G, G * 0.86 + 5 * fw, fi * 0.36);
    B = mix(B, B * 0.74 + 2 * fw, fi * 0.36);
    const fringe = smooth(0.5, 0.85, fragRr) * (1 - smooth(0.85, 1.02, fragRr));
    R -= fringe * 10;
    G -= fringe * 9;
    B -= fringe * 7;
  }

  // Fallen leaves: dull browns that sit on the ground, with a lit upper face, a rib and a
  // soft shadow along the lower edge.
  if (litterInside > 0.002) {
    const li = litterInside;
    const warmLeaf = 0.25 + litterTone * 0.5;
    R = mix(R, R * 1.05 + 12 * warmLeaf, li * 0.8);
    G = mix(G, G * 0.99 + 7 * warmLeaf, li * 0.8);
    B = mix(B, B * 0.84 + 3 * warmLeaf, li * 0.8);
    const shade = 1 + litterLight * 0.24;
    R *= mix(1, shade, li);
    G *= mix(1, shade * 0.97, li);
    B *= mix(1, shade * 0.9, li);
    const rib = litterVein * li;
    R = mix(R, R * 1.16 + 12, rib * 0.9);
    G = mix(G, G * 1.13 + 8, rib * 0.9);
    B = mix(B, B * 1.0 + 3, rib * 0.9);
    // dark rim where the leaf lifts off the ground, heavier on the shaded side
    const rim = smooth(0.5, 0.84, litterRr) * (1 - smooth(0.84, 1.02, litterRr));
    R -= rim * 20;
    G -= rim * 19;
    B -= rim * 13;
  }

  // Needles rest on top: browned, thin, some pale and some half buried.
  if (needles.cover > 0.01) {
    const t = needles.tone;
    const c = needles.cover;
    const nR = mix(L * 0.62, L * 1.06 + 24, t);
    const nG = mix(L * 0.44, L * 0.84 + 15, t);
    const nB = mix(L * 0.3, L * 0.52 + 4, t);
    R = mix(R, nR, c * 0.8);
    G = mix(G, nG, c * 0.8);
    B = mix(B, nB, c * 0.76);
    const edge = smooth(0.15, 0.55, c) * (1 - smooth(0.55, 0.9, c));
    R -= edge * 12;
    G -= edge * 11;
    B -= edge * 9;
  }

  // Cool moss creeps over needles and earth, granular and a little fuzzy, with a ragged
  // edge so it grows instead of looking painted on.
  if (cool > 0.02) {
    const speck = fbm(u, v, 64, 32, 2, 3701) - 0.5 + (fbm(u, v, 128, 128, 1, 3907) - 0.5) * 0.7;
    const k = cool * clamp01(0.6 + speck * 1.9);
    R *= 1 - k * 0.38;
    G *= 1 - k * 0.02;
    B *= 1 - k * 0.32;
    R += speck * 18 * k;
    G += speck * 24 * k;
    B += speck * 10 * k;
  }

  // Fine grain, gated by structure so it never becomes a flat screen noise.
  const texMask = clamp01((needles.cover + litterInside * 0.45 + cool * 0.6) * 0.9);
  if (texMask > 0.02) {
    const tex = (fbm(u, v, 32, 16, 2, 2707) - 0.5) * texMask;
    R += tex * 15;
    G += tex * 16;
    B += tex * 11;
  }

  return [R, G, B];
}

// ---- entry point --------------------------------------------------------------------

/**
 * Detail one texel of an Endor surface.
 *
 * @param {'endorBark'|'endorLeaves'|'endorSoil'} role surface being detailed
 * @param {number} u horizontal position, normalized (periodic, so 1 wraps to 0)
 * @param {number} v vertical position, normalized (periodic)
 * @param {number} r source red, 0..255
 * @param {number} g source green, 0..255
 * @param {number} b source blue, 0..255
 * @param {number} side output width in texels, used for needle width and veil scale
 * @returns {[number, number, number]} detailed colour in byte scale, floats allowed
 */
export function forestPixel(role, u, v, r, g, b, side) {
  const w = side > 0 ? side : 256;
  // Normalising here makes the function exactly periodic in u and v, and tolerant of
  // positions outside 0..1.
  u -= Math.floor(u);
  v -= Math.floor(v);
  let out;
  if (role === 'endorBark') out = bark(u, v, r, g, b, w);
  else if (role === 'endorLeaves') out = leaves(u, v, r, g, b, w);
  else if (role === 'endorSoil') out = soil(u, v, r, g, b, w);
  else out = [r, g, b];
  const R = out[0];
  const G = out[1];
  const B = out[2];
  return [R > 0 ? (R < 255 ? R : 255) : 0, G > 0 ? (G < 255 ? G : 255) : 0, B > 0 ? (B < 255 ? B : 255) : 0];
}
