// Deterministic footfall planning: who leaves a boot/walker pad, how deep it is,
// and where the next stride lands. Pure math over the unit records already used
// by the land runtime; no three.js, no DOM, no simulation writes.
//
// STRIDE CONTRACT
//   A pad is placed from the unit's *accepted* world position, never from its
//   intent, velocity estimate or animation. `planFootfall` consumes the distance
//   between two accepted positions and emits pads at whole strides along that
//   segment, alternating left/right. The same path and starting state therefore
//   produce the same pads on replay; no Math.random and no wall clock is read.
//
// AVOIDANCE
//   Stationary units do not accumulate distance. Flight, hover/repulsor, water,
//   authored holes, raised building pads, hidden units, scripted/garrisoned
//   units and teleports are rejected before a pad is offered to the field.

import { CELL } from './crater-field.js';

export const FOOTFALL = Object.freeze({
  // At most four refined 20-unit cells per pad, separately from shell holes.
  maxPads: 96,
  maxDepth: 0.8,
  minHalfWidth: 0.26,
  maxHalfWidth: 2.6,
  minHalfLength: 0.4,
  maxHalfLength: 4,
  // Movement gates.
  speed: 0.55,
  jump: 22,
  // Pads are placed at whole strides, alternating sides.
  strideMin: 1.6,
  strideMax: 13,
  lateralMax: 2.4,
  maxStamps: 2,
  // A new pad is not laid on top of an existing one: coplanar fans would z-fight.
  overlap: 0.78,
  // Dominant per-tick work bound for the whole battlefield.
  maxPerTick: 8
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Small deterministic integer hash (FNV-1a style) for seeds and shape phases. */
export function hashFootfall(text, salt = 0) {
  let h = 2166136261 ^ (salt | 0);
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/** True for units the viewer must not reveal with a fresh physical mark. */
export function footfallHidden(u) {
  return !!(u && (u.scriptHidden || u.netHidden || u.seen === false || u.cloaked || u.hidden));
}

/**
 * 'infantry' or 'walker' when this unit is grounded and leaves real foot pads;
 * null for tanks, repulsors, fliers, structures, garrisoned or hidden units.
 * Walkers are identified by the type's MovementClass (`Walker`, stock AT-ST and
 * AT-AT) with the authored walk-transition animation as the Workshop fallback.
 */
export function footfallKind(u, now = 0) {
  if (!u || u.dead || u.gone || u.dying || u.structure || u.kind === 'STRUCTURE') return null;
  if (u.inside || u.insideTransport || u.garrisonSlot >= 0) return null;
  if (u.flies || u.flight || u.bomber || u.rope || u.cinematicTransport || u.airborne) return null;
  if (u.scriptHidden || u.netHidden || u.hidden || u.cloaked) return null; // fog affects publication, not physical ground
  if (u.scriptZ !== undefined || u.scripted || u.rooted) return null;
  if (Math.abs(finite(u.hoverZ)) > 0.5 || finite(u.lift) > 1.5) return null;
  if ((u.stunUntil || 0) > now) return null;
  if (u.foot || u.kind === 'INFANTRY') return 'infantry';
  if (u.kind !== 'VEHICLE' || !u.type) return null;
  const mc = String(u.type.str ? u.type.str('MovementClass') || '' : '');
  if (/hover|repuls|flying|speeder|tank|track|wheel|boat|sub|space|air/i.test(mc)) return null;
  if (/walker|leg|strider|mech|at_?st|at_?at/i.test(mc)) return 'walker';
  // Workshop fallback: an authored walk transition on a vehicle that is not a
  // hover/tracked class. Stock tanks do not set it; modded walkers do.
  const walk = u.type.bool ? u.type.bool('Walk_Transition') : false;
  const anim = u.type.num ? u.type.num('Movement_Animation_Speed', 0) : 0;
  return walk && anim > 0 ? 'walker' : null;
}

/** Horizontal/vertical model size in world units, scale included. */
export function footfallSize(u) {
  const sc = Math.abs(finite(u && u.holder && u.holder.scale && u.holder.scale.x, 0)) || 1,
    box = u && u.inst && u.inst.box;
  const empty = typeof box?.isEmpty === 'function' ? box.isEmpty() : false;
  if (box && box.min && box.max && !empty) {
    const x = Math.abs(finite(box.max.x) - finite(box.min.x)) * sc,
      y = Math.abs(finite(box.max.y) - finite(box.min.y)) * sc,
      z = Math.abs(finite(box.max.z) - finite(box.min.z)) * sc;
    if (x > 0.05 && y > 0.05 && z > 0.05) return { x, y, z };
  }
  const h = Math.abs(finite(u && u.body, 10)) || 10,
    r = Math.abs(finite(u && u.hitRadius, h * 0.35)) || h * 0.35;
  return { x: r * 2, y: r * 2, z: h };
}

/**
 * Pad shape and stride for a unit. Heavier/larger models get a larger pad and a
 * deeper shallow depression; the mapping is monotone in model size.
 */
export function footfallProfile(u, now = 0) {
  const kind = footfallKind(u, now);
  if (!kind) return null;
  const size = footfallSize(u),
    seed = hashFootfall((u.type && u.type.name ? u.type.name : 'unit') + '|' + finite(u.id, 0) + '|' + kind);
  const rnd = k => (hashFootfall(seed, k) % 1000) / 1000;
  if (kind === 'infantry') {
    const height = clamp(size.z, 6, 18),
      scale = clamp(height / 10, 0.6, 1.9),
      weight = Math.pow(scale, 1.25),
      halfWidth = clamp(0.055 * height, 0.3, 0.82),
      halfLength = halfWidth * 1.62;
    return {
      kind,
      weight,
      depth: clamp(0.12 * weight, 0.07, 0.24),
      lip: 0,
      halfLength,
      halfWidth,
      stride: clamp(height * 0.44, 1.9, 6.4),
      lateral: halfWidth * 0.95,
      lobe: 0.17 + rnd(1) * 0.08,
      lobe2: 0.06 + rnd(2) * 0.05,
      seed
    };
  }
  const span = Math.max(size.x, size.y, size.z, (u.hitRadius || 0) * 2),
    sizeU = clamp(span, 8, 96),
    weight = Math.pow(sizeU / 12, 1.55),
    halfWidth = clamp(sizeU * 0.075, 0.7, FOOTFALL.maxHalfWidth),
    halfLength = halfWidth * 1.5;
  return {
    kind,
    weight,
    depth: clamp(0.1 + 0.045 * weight, 0.12, 0.72),
    lip: 0,
    halfLength,
    halfWidth,
    stride: clamp(sizeU * 0.56, 3.5, FOOTFALL.strideMax),
    lateral: halfWidth * 0.72,
    lobe: 0.18 + rnd(3) * 0.09,
    lobe2: 0.06 + rnd(4) * 0.05,
    seed
  };
}

export function freshFootfall(u, x = 0, y = 0, yaw = 0) {
  return {
    x,
    y,
    yaw: finite(yaw),
    dist: 0,
    side: 1,
    seq: 0,
    ready: true,
    profile: footfallProfile(u)
  };
}

function retarget(st, x, y, yaw) {
  st.x = x;
  st.y = y;
  st.yaw = finite(yaw);
  st.dist = 0;
  st.ready = true;
  return st;
}

/**
 * Advance one unit's stride and return pad requests for this tick.
 * `st` is the unit's persistent plain state; `st.ready === false` or a jump
 * larger than FOOTFALL.jump means the unit teleported and is re-anchored.
 */
export function planFootfall(st, x, y, yaw, profile, opts = {}) {
  if (!st || !profile || !Number.isFinite(x) || !Number.isFinite(y)) return [];
  if (!st.ready || !Number.isFinite(st.x)) {
    retarget(st, x, y, yaw);
    return [];
  }
  const dx = x - st.x,
    dy = y - st.y,
    d = Math.hypot(dx, dy),
    jump = finite(opts.jump, FOOTFALL.jump);
  st.yaw = finite(yaw, st.yaw);
  if (d > jump) {
    retarget(st, x, y, yaw);
    return [];
  }
  if (d < 1e-4) return [];
  st.dist += d;
  const stride = Math.max(0.5, finite(profile.stride, 4)),
    lateral = clamp(finite(profile.lateral, 0), 0, FOOTFALL.lateralMax),
    max = Math.max(1, Math.min(FOOTFALL.maxStamps, opts.maxStamps | 0 || FOOTFALL.maxStamps)),
    ux = dx / d,
    uy = dy / d,
    out = [];
  while (st.dist >= stride && out.length < max) {
    const back = st.dist - stride,
      f = (d - back) / d;
    st.side = -st.side;
    const px = st.x + dx * f - uy * lateral * st.side,
      py = st.y + dy * f + ux * lateral * st.side;
    out.push({
      x: px,
      y: py,
      yaw: (Number.isFinite(yaw) ? yaw : Math.atan2(uy, ux)) + st.side * 0.06,
      side: st.side,
      seq: ++st.seq
    });
    st.dist -= stride;
  }
  // A very long accepted step (or a slow frame) must not release a burst of
  // pads later; drop the surplus instead of banking it.
  if (st.dist >= stride) st.dist %= stride;
  st.x = x;
  st.y = y;
  return out;
}

function terrainHeight(t, x, y) {
  const n = t.size,
    gx = Math.min((t.width ?? n) - 1.001, Math.max(0, x / CELL)),
    gy = Math.min((t.height ?? n) - 1.001, Math.max(0, y / CELL)),
    ix = gx | 0,
    iy = gy | 0,
    fx = gx - ix,
    fy = gy - iy,
    h = t.heights,
    a = h[iy * n + ix],
    b = h[iy * n + ix + 1],
    c = h[(iy + 1) * n + ix],
    d = h[(iy + 1) * n + ix + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** One world point is dry, authored ground, not a hole and not a raised pad. */
export function footfallGroundOk(t, world, x, y) {
  if (!t || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const n = t.size,
    cols = (t.width ?? n) - 1,
    rows = (t.height ?? n) - 1,
    cx = Math.floor(x / CELL),
    cy = Math.floor(y / CELL);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
  if (t.paint && t.paint.triAt && t.paint.triAt[2 * (cy * cols + cx)] < 0) return false;
  const gi = Math.round(y / CELL) * n + Math.round(x / CELL),
    wet = world && world.wet && world.wet[gi];
  if (wet) return false;
  if (t.water && t.water.on && t.heights[gi] < t.water.level) return false;
  const pad = t.padTop;
  if (pad) {
    const i = Math.floor(x / pad.cell),
      j = Math.floor(y / pad.cell);
    if (i >= 0 && j >= 0 && i < pad.w && j < pad.w && pad.a[j * pad.w + i] >= terrainHeight(t, x, y)) return false;
  }
  return true;
}

/** The centre and four extents of a pad must all be valid ground. */
export function padGroundOk(t, world, pad) {
  const r = Math.max(pad.halfLength, pad.halfWidth) * 0.92;
  if (!footfallGroundOk(t, world, pad.x, pad.y)) return false;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (!footfallGroundOk(t, world, pad.x + Math.cos(a) * r, pad.y + Math.sin(a) * r)) return false;
  }
  return true;
}

export default {
  FOOTFALL,
  hashFootfall,
  footfallHidden,
  footfallKind,
  footfallSize,
  footfallProfile,
  freshFootfall,
  planFootfall,
  footfallGroundOk,
  padGroundOk
};
