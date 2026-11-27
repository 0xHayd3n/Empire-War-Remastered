// Analytic crater field: the *only* source of truth for how deep a crater is and
// where its rim is. Nothing here touches a mesh, a height grid or a save file, so
// it is cheap to evaluate for every sub-vertex of a replacement patch, for the
// physical sampler `offsetAt` and for a whole-map "does this cell matter" test.
//
// Support contract (relied on by the mesh replacement, do not change casually):
//   * every crater's displacement is EXACTLY 0 at and beyond its radius, and its
//     gradient is 0 there too (C1 at the rim). That is what makes a locally
//     subdivided patch watertight against the untouched coarse triangles beside
//     it: the patch boundary samples land on the coarse edge's own linear
//     interpolation, so the two meshes share the edge exactly.
//   * displacement(z) is a pure function of the local sum, so evaluating it over
//     the craters that intersect one quad gives the same numbers as over all of
//     them. That is what lets a patch be recomputed from its members alone.

export const CELL = 20; // world units per coarse TED cell (terrain-cell.js)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Hermite smoothstep with zero value AND slope at both ends.
function smooth(a, b, x) {
  if (!(b > a)) return x < a ? 0 : 1;
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// Cheap deterministic per-crater harmonics (no Math.random at sample time, so a
// snapshot replays bit-identically).
function harmonic(seed, k) {
  const x = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Fill in the shape constants of a crater record. Idempotent. */
export function seedCrater(cr) {
  const s = cr.seed ?? harmonic(cr.x ?? 0, cr.y ?? 0) * 997;
  cr.seed = s;
  cr.p1 = harmonic(s, 1) * Math.PI * 2;
  cr.p2 = harmonic(s, 2) * Math.PI * 2;
  cr.p3 = harmonic(s, 3) * Math.PI * 2;
  cr.p4 = harmonic(s, 4) * Math.PI * 2;
  cr.lobe = 0.13 + 0.07 * harmonic(s, 5); // 0.13 .. 0.20 of radius
  return cr;
}

// Local coordinates of a world point inside one crater.
// `u` is 0 at the centre and 1 at the (irregular) rim; `u >= 1` means "outside".
export function craterLocal(cr, px, py) {
  const dx = px - cr.x,
    dy = py - cr.y,
    r = cr.radius,
    d2 = dx * dx + dy * dy;
  if (!(d2 < r * r)) return -1;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return 0;
  const th = Math.atan2(dy, dx),
    // The rim radius only ever shrinks inside `radius`, so support is a subset of
    // the disc and the C1 rim contract above still holds.
    re = r * (1 - cr.lobe * (0.5 + 0.5 * Math.sin(3 * th + cr.p1)) - (cr.lobe * 0.55) * (0.5 + 0.5 * Math.sin(5 * th + cr.p2)));
  return d / re;
}

/** Displacement of one crater at a world point: negative floor, positive lip, else 0. */
export function craterHeight(cr, px, py) {
  const u = craterLocal(cr, px, py);
  if (u < 0 || u >= 1) return 0;
  const th = Math.atan2(py - cr.y, px - cr.x);
  // Bowl: flat floor, steep wall, flat shoulder. Zero value and slope from 0.92u.
  const bowl = 1 - smooth(0.06, 0.92, u);
  // Rim: a ring bump that peaks at 0.8u and is C1-zero at the rim.
  const ring = smooth(0.5, 0.8, u) * (1 - smooth(0.8, 1, u));
  const lip = cr.lip * (0.62 + 0.38 * Math.sin(4 * th + cr.p3)) * ring;
  return -cr.depth * bowl + lip;
}

/** Char intensity 0..1 for scorch colouring (peaks on the floor, fades by the rim). */
export function craterChar(cr, px, py) {
  if (!(cr.scorch > 0)) return 0;
  const u = craterLocal(cr, px, py);
  if (u < 0) return 0;
  return cr.scorch * (1 - smooth(0.1, 0.95, u));
}

/**
 * Composed depression/lip of a crater set at a world point.
 * `maxDepth` softly saturates stacked bowls instead of clamping them, so the
 * surface stays C1 even when a dozen shells land in the same square metre.
 */
export function fieldHeight(list, x, y, maxDepth) {
  let neg = 0, press = 0,
    pos = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].pad) {press=Math.min(press,padHeight(list[i],x,y));continue;}
    const h = craterHeight(list[i], x, y);
    if (h < 0) neg += h;
    else if (h > 0) pos += h;
  }
  // -M*(1-exp(s/M)) : f(0)=0, f'(0)=1, f(-inf)=-M. Smooth, monotone, cheap.
  const bowl = neg === 0 ? 0 : -maxDepth * (1 - Math.exp(neg / maxDepth));
  // Overlapping lips aren't a way to build a tower: keep the maximum rise
  // small relative to the maximum pit depth, even under sustained bombardment.
  const lipMax = maxDepth * 0.25;
  return Math.max(-maxDepth,bowl+press) + (pos === 0 ? 0 : -lipMax * Math.expm1(-pos/lipMax));
}

/** Central-difference slope of fieldHeight (only used for replacement normals). */
export function fieldSlope(list, x, y, maxDepth, out) {
  const e = 0.125;
  out[0] = (fieldHeight(list, x + e, y, maxDepth) - fieldHeight(list, x - e, y, maxDepth)) / (2 * e);
  out[1] = (fieldHeight(list, x, y + e, maxDepth) - fieldHeight(list, x, y - e, maxDepth)) / (2 * e);
  return out;
}

/** Composed char intensity 0..1 (clamped). */
export function fieldChar(list, x, y) {
  let c = 0;
  for (let i = 0; i < list.length; i++) c += craterChar(list[i], x, y);
  return c > 1 ? 1 : c;
}

// ---------------------------------------------------------------- foot pads
//
// A footfall is a much smaller, deliberately non-round stamp: an elongated pad
// whose support and height fall to exactly 0 (value and slope) at the rim, so it
// obeys the same C1 support contract as a crater without touching crater code.
// Every shape constant comes from `seed`, so a snapshot replays bit-identically.
// These records are NOT craters: no scorch, no blast radius, no crater budget.

function padAngle(pad, px, py, c, s) {
  const dx = px - pad.x,
    dy = py - pad.y;
  return Math.atan2((-dx * s + dy * c) / pad.halfWidth, (dx * c + dy * s) / pad.halfLength);
}

/** Fill in the shape constants of a pad record. Idempotent. */
export function seedPad(pad) {
  const s = pad.seed ?? harmonic(pad.x ?? 0, pad.y ?? 0) * 991;
  pad.seed = s;
  pad.p1 = harmonic(s, 1) * Math.PI * 2;
  pad.p2 = harmonic(s, 2) * Math.PI * 2;
  pad.lobe = clamp(Number.isFinite(pad.lobe) ? pad.lobe : 0.21, 0, 0.42);
  pad.lobe2 = clamp(Number.isFinite(pad.lobe2) ? pad.lobe2 : 0.09, 0, 0.25);
  pad.lip = Number.isFinite(pad.lip) ? pad.lip : 0;
  return pad;
}

/** Local pad coordinate: 0 at the centre, 1 at the irregular rim, <0 outside. */
export function padLocal(pad, px, py) {
  const c = Math.cos(pad.yaw || 0),
    s = Math.sin(pad.yaw || 0),
    dx = px - pad.x,
    dy = py - pad.y,
    a = (dx * c + dy * s) / pad.halfLength,
    b = (-dx * s + dy * c) / pad.halfWidth,
    r = Math.hypot(a, b);
  if (!(r < 1)) return -1; // support never exceeds the half extents
  if (r < 1e-6) return 0;
  const th = Math.atan2(b, a),
    wob = 1 - pad.lobe * (0.5 + 0.5 * Math.sin(2 * th + pad.p1)) - pad.lobe2 * (0.5 + 0.5 * Math.sin(3 * th + pad.p2));
  return r / wob;
}

/** Depression/rim height of one pad at a world point (0 outside its support). */
export function padHeight(pad, px, py) {
  const q = padLocal(pad, px, py);
  if (q < 0 || q >= 1) return 0;
  const c = Math.cos(pad.yaw || 0),
    s = Math.sin(pad.yaw || 0),
    th = padAngle(pad, px, py, c, s),
    // Reach zero only at the rim: a broad flat annulus coplanar with the coarse
    // ground would z-fight, so the shallow fringe stays just below it.
    bowl = 1 - smooth(0.15, 1, q),
    ring = smooth(0.55, 0.82, q) * (1 - smooth(0.82, 1, q));
  // No char and only a token pressed rim: a boot is not a small explosion.
  return -(pad.depth || 0) * bowl + (pad.lip || 0) * (0.65 + 0.35 * Math.sin(2 * th + pad.p1)) * ring;
}

/** Composed pad field with the same smooth saturation as `fieldHeight`. */
export function padField(list, x, y, maxDepth) {
  let neg = 0,
    pos = 0;
  for (let i = 0; i < list.length; i++) {
    const h = padHeight(list[i], x, y);
    if (h < 0) neg += h;
    else if (h > 0) pos += h;
  }
  // Pads are individual press marks, not explosive stacking: a single pad is
  // exactly `depth` deep. Only actual overlap (a forced crush pile) reaches the
  // hard bound, so the common case never reads shallower than it was authored.
  const bowl = neg > -maxDepth ? neg : -maxDepth;
  const lip = pos < maxDepth * 0.2 ? pos : maxDepth * 0.2;
  return bowl + lip;
}

/** Distance from the pad centre to its rim along a world-space angle. */
export function padRimRadius(pad, angle) {
  const c = Math.cos(pad.yaw || 0),
    s = Math.sin(pad.yaw || 0),
    ux = Math.cos(angle),
    uy = Math.sin(angle),
    a = (ux * c + uy * s) / pad.halfLength,
    b = (-ux * s + uy * c) / pad.halfWidth,
    k = Math.hypot(a, b);
  if (!(k > 1e-9)) return 0;
  const th = Math.atan2(b, a),
    wob = 1 - pad.lobe * (0.5 + 0.5 * Math.sin(2 * th + pad.p1)) - pad.lobe2 * (0.5 + 0.5 * Math.sin(3 * th + pad.p2));
  return wob / k;
}

function rectHitsDisc(ax, ay, bx, by, cx, cy, r) {
  const nx = cx < ax ? ax : cx > bx ? bx : cx,
    ny = cy < ay ? ay : cy > by ? by : cy;
  return (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) < r * r;
}

/**
 * Every coarse quad whose rect intersects the crater's support disc, clamped to a
 * map of `quadsW x quadsH` quads. A blast strictly inside one triangle returns
 * exactly that one quad - the whole point of this module.
 */
export function footprintQuads(cell, x, y, r, quadsW, quadsH) {
  const x0 = clamp(Math.floor((x - r) / cell), 0, quadsW - 1),
    x1 = clamp(Math.floor((x + r) / cell), 0, quadsW - 1),
    y0 = clamp(Math.floor((y - r) / cell), 0, quadsH - 1),
    y1 = clamp(Math.floor((y + r) / cell), 0, quadsH - 1);
  const out = [];
  for (let qy = y0; qy <= y1; qy++)
    for (let qx = x0; qx <= x1; qx++) {
      const ax = qx * cell,
        ay = qy * cell;
      if (rectHitsDisc(ax, ay, ax + cell, ay + cell, x, y, r)) out.push({ qx, qy });
    }
  return out;
}

export default {
  CELL,
  seedCrater,
  craterLocal,
  craterHeight,
  craterChar,
  fieldHeight,
  fieldSlope,
  fieldChar,
  footprintQuads,
  seedPad,
  padLocal,
  padHeight,
  padField,
  padRimRadius
};
