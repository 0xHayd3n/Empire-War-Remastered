// Crater traversal gait for grounded foot soldiers (visual only).
//
// SCOPE
//   `terrain.craterSurface` is set by the battle authority only in eligible new
//   solo battles and exposes a signed world-unit depression:
//       offsetAt(x, y) -> signed height (negative in a bowl, zero outside)
//   `heightAt(terrain, x, y[, true])` already adds it exactly once, so u.x/u.y,
//   u.z, walking, pathing and ground projectiles follow the real surface. This
//   module never moves a unit and never writes terrain: it only poses the
//   holder (root group) of a living, moving, non-firing foot soldier so that a
//   shallow crater reads as a short step and a deep, sustained rise reads as a
//   heavy uphill climb.
//
// WHAT IT ADDS
//   - bounded forward/back lean around a horizontal axis perpendicular to the
//     facing, composed with the normal `heading + PI/2` root yaw;
//   - a bounded vertical bob and lateral weight shift driven by our own stride
//     phase (the authored MOVE clip is never swapped, retimed or stopped).
//   Nothing is accumulated: every tick recomposes the root quaternion from the
//   canonical yaw, so a permanent additive rotation is impossible. Once the
//   crater is left (or the soldier stops, fires, casts, dies, flies, ropes or
//   garrisons) the pose eases back and is restored to the exact canonical
//   transform.
//
// AUTHORED CLIPS
//   The project's animation suffix table (public/js/game/animkinds.js) has no
//   climb clip: MOVE / WALKMOVE / CROUCHMOVE / MOVESTART are plain locomotion,
//   and ROPE*/JUMP/LAND belong to ropes, flight and deaths. Re-purposing those
//   would be the "unrelated ladder/death clip" case, so the gait uses the
//   normal animated rig plus the procedural fallback below.
//
// THRESHOLDS (stock foot soldier, ~10 world units tall, Max_Speed 37.44)
//   probe reach        ~4.5 world units
//   deep crater        >= 0.28 * body height (>= ~2.8 units)
//   climb entry        sustained grade >= 0.16 (9 deg), exit < 0.09
//   shallow step       local rise >= 0.018 * body height (~0.18 units)
//   lean               climb <= 0.20 rad, descend <= 0.10 rad, step <= 0.06 rad
//   stride phase       0.60x climb, 0.82x descend, 1.15x step (procedural)
//
// No imports: this module is plain math over duck-typed world/unit/terrain
// records, so it can be unit-tested in Node without three.js or a DOM.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ease = (dt, rate) => 1 - Math.exp(-rate * Math.max(0, dt));

export const CRATER_GAIT = Object.freeze({
  bodyMin: 8,
  bodyMax: 16,
  probeScale: 0.45,
  probeMin: 2.5,
  probeMax: 6,
  influence: 0.02,
  deep: 0.28, // x gait body height
  climbGrade: 0.16,
  climbExit: 0.09,
  descendGrade: 0.12,
  stepGrade: 0.1,
  stepRise: 0.018, // x gait body height
  stepTime: 0.28,
  switchDelay: 0.1,
  leanMax: 0.2,
  descendLean: 0.1,
  stepLean: 0.06,
  strideClimb: 0.6,
  strideDescend: 0.82,
  strideStep: 1.15,
  bob: 0.03, // x gait body height
  stepBob: 0.06, // x gait body height
  crouch: 0.02, // x gait body height
  sway: 0.012, // x gait body height
  cadence: 1.9, // stride cycles / s at full speed, flat
  ease: 10,
  reset: 0.002
});

/** Gait body height in world units, clamped so giants like a Rancor do not
 *  classify every small crater as a flat puddle. */
export function craterGaitBody(u) {
  const b = u && u.inst && u.inst.box;
  let h = 0;
  if (b && b.max && b.min && (typeof b.isEmpty !== 'function' || !b.isEmpty())) h = Math.abs((b.max.z || 0) - (b.min.z || 0));
  const s = Math.abs((u && u.holder && u.holder.scale && u.holder.scale.x) || 1) || 1;
  return clamp((h || 10) * s, CRATER_GAIT.bodyMin, CRATER_GAIT.bodyMax);
}

export function craterGaitReach(body = 10) {
  return clamp(body * CRATER_GAIT.probeScale, CRATER_GAIT.probeMin, CRATER_GAIT.probeMax);
}

/**
 * Sample the real ground along the facing. `ground(x,y)` must be the crater-aware
 * height sampler the battle uses (heightAt with terrain.craterSurface included
 * once). `surface.offsetAt(x,y)` only classifies depth, so a supplier that
 * exposes the same offset the ground sampler adds keeps the two in agreement.
 */
export function craterGaitSample(ground, surface, x, y, heading, options = {}) {
  const body = clamp(options.height || 10, CRATER_GAIT.bodyMin, CRATER_GAIT.bodyMax);
  const reach = options.reach || craterGaitReach(body);
  const speed = Math.max(0, options.speed || 0);
  const flat = {
    mode: 'flat',
    depth: 0,
    grade: 0,
    sustained: 0,
    rise: 0,
    dir: 1,
    reach,
    body,
    speed,
    deep: CRATER_GAIT.deep * body,
    family: false,
    stepRise: CRATER_GAIT.stepRise * body
  };
  if (!surface || typeof surface.offsetAt !== 'function' || !(speed > 0.5)) return flat;
  const c = Math.cos(heading),
    s = Math.sin(heading),
    off = k => {
      const v = surface.offsetAt(x + c * k, y + s * k);
      return Number.isFinite(v) ? Math.min(0, v) : 0;
    };
  const o0 = off(0),
    o1 = off(reach),
    o2 = off(2 * reach),
    ob = off(-reach),
    spanDepth = Math.max(-o0, -o1, -o2, -ob);
  if (spanDepth <= CRATER_GAIT.influence) return flat;

  // Grade comes from the crater's own offset, not the combined height field:
  // stock terrain hills already have normal locomotion, and the crater wall must
  // read the same on a slope as on a plain. The unit's z still follows the full
  // crater-aware heightAt (see tick below), so this only classifies the pose.
  const near = (o1 - o0) / reach,
    far = (o2 - o1) / reach,
    sustained = (o2 - ob) / (3 * reach),
    rise = o1 - o0,
    backRise = o0 - ob,
    // The climb/descent family is about the wall around the soldier, not only
    // the point under its feet: the last stretch out of a deep crater has a
    // shallow underfoot sample but is still a real climb, never a "step".
    family = spanDepth >= CRATER_GAIT.deep * body * 0.6,
    up = near >= CRATER_GAIT.climbGrade && sustained >= CRATER_GAIT.climbGrade * 0.55,
    down = near <= -CRATER_GAIT.descendGrade && sustained <= -CRATER_GAIT.descendGrade * 0.5,
    // A few tenths of a unit count at a shallow bolt scar. Don't mistake
    // the gentle curvature at the bottom of a deep bowl for a step.
    stepRise = (family ? 0.045 : CRATER_GAIT.stepRise) * body,
    stepped = Math.abs(near) >= CRATER_GAIT.stepGrade || Math.abs(rise) >= stepRise || Math.abs(backRise) >= stepRise;

  let mode = 'flat';
  if (family && up) mode = 'climb';
  else if (family && down) mode = 'descend';
  else if (stepped) mode = 'step';

  const groundHere = typeof ground === 'function' ? ground(x, y) : NaN,
    groundAhead = typeof ground === 'function' ? ground(x + c * reach, y + s * reach) : NaN;
  return {
    mode,
    depth: spanDepth,
    underfoot: -o0,
    grade: near,
    far,
    sustained,
    rise,
    backRise,
    groundGrade: Number.isFinite(groundHere) && Number.isFinite(groundAhead) ? (groundAhead - groundHere) / reach : 0,
    dir: near > 0 ? 1 : near < 0 ? -1 : 1,
    reach,
    body,
    speed,
    deep: CRATER_GAIT.deep * body,
    family,
    stepRise
  };
}

function freshState() {
  return {
    at: -1,
    t: 0,
    mode: 'flat',
    target: 'flat',
    targetT: 0,
    stepT: CRATER_GAIT.stepTime,
    stepDir: 1,
    lean: 0,
    crouch: 0,
    bob: 0,
    sway: 0,
    phase: 0,
    body: 10,
    depth: 0,
    grade: 0,
    sustained: 0,
    rise: 0,
    speed: 0,
    yaw: 0,
    canonical: Math.PI / 2,
    applied: false
  };
}

function canonicalQuaternion(yaw, out) {
  const a = yaw + Math.PI / 2;
  return out(0, 0, Math.sin(a / 2), Math.cos(a / 2));
}

/** Compose world yaw with a forward lean around the horizontal facing axis. */
function leanedQuaternion(yaw, lean, out) {
  const a = yaw + Math.PI / 2,
    c2 = Math.cos(a / 2),
    s2 = Math.sin(a / 2);
  if (!lean) return out(0, 0, s2, c2);
  // Axis = up x forward = (sin yaw, -cos yaw, 0); negative angle tips the top
  // toward the movement direction (forward lean into the climb).
  const ax = Math.sin(yaw),
    ay = -Math.cos(yaw),
    h = -lean / 2,
    sh = Math.sin(h),
    ch = Math.cos(h);
  const x1 = ax * sh,
    y1 = ay * sh,
    w1 = ch;
  return out(x1 * c2 + y1 * s2, y1 * c2 - x1 * s2, w1 * s2, w1 * c2);
}

/** Put the holder back on the exact canonical transform (idempotent). */
export function clearCraterGait(u) {
  const st = u && u.craterGait;
  if (!st) return false;
  const h = u.holder;
  if (h && h.quaternion && st.applied) {
    canonicalQuaternion(st.yaw, (x, y, z, w) => h.quaternion.set(x, y, z, w));
    if (h.position) h.position.set(u.x, u.y, u.z);
  }
  u.craterGait = null;
  return true;
}

/**
 * Advance the gait for one simulation tick and pose the holder.
 * Call after the world has placed the holder at (u.x, u.y, u.z) for this tick.
 * Safe to call for every unit; non-foot units are cleared and ignored.
 */
export function tickCraterGait(world, u, dt, yaw) {
  if (!u || !u.holder || !u.holder.quaternion) return false;
  const terrain = world && world.terrain,
    surface = terrain && terrain.craterSurface;
  const previous = u.craterGait;
  if (previous && world && previous.at === world.time) return false;
  if (dt === undefined || dt === null) dt = 0;

  const eligible = !!(
    surface &&
    u.foot &&
    !u.structure &&
    !u.dead &&
    !u.gone &&
    !u.flies &&
    !u.flight &&
    !u.rope &&
    !u.inside &&
    !u.cinematicTransport &&
    !u.rooted &&
    u.scriptZ === undefined &&
    !(u.needsDeploy && u.deployed) &&
    !u.cast &&
    !u.once && u.animKind !== 'ATTACKIDLE' &&
    u.animKind !== 'attack' &&
    !(u.stunUntil > (world.time || 0))
  );
  if (!eligible) {
    clearCraterGait(u);
    return false;
  }

  if (!previous?.applied && (surface.nearOffset?.(u.x,u.y,CRATER_GAIT.probeMax*2) === false ||
      !(u.v > .5 || Math.hypot(u.mvx || 0,u.mvy || 0) > .5))) {
    if (previous) u.craterGait = null;
    return false;
  }
  const st = (u.craterGait = previous || freshState());
  st.t += dt;
  st.yaw = Number.isFinite(yaw) ? yaw : u.heading || 0;
  st.body = craterGaitBody(u);
  const speed = Math.max(u.v || 0, Math.hypot(u.mvx || 0, u.mvy || 0));
  const sample = craterGaitSample(null, surface, u.x, u.y, u.heading || 0, {
    height: st.body,
    speed
  });
  st.depth = sample.depth;
  st.grade = sample.grade;
  st.sustained = sample.sustained;
  st.rise = sample.rise;
  st.speed = speed;

  // Hysteresis: a new *sustained* mode waits; a step impulse is immediate.
  if (sample.mode !== st.target) {
    st.target = sample.mode;
    st.targetT = 0;
  } else st.targetT += dt;
  const immediate = st.target === 'step' || st.mode === 'step';
  const stillClimbing = st.mode==='climb' && sample.mode==='flat' && st.grade>=CRATER_GAIT.climbExit;
  if (!stillClimbing && sample.mode !== st.mode && (immediate || st.targetT >= CRATER_GAIT.switchDelay)) {
    st.mode = sample.mode;
    if (st.mode === 'step') {
      st.stepT = 0;
      st.stepDir = sample.dir;
      st.stepHeight = Math.min(st.body*CRATER_GAIT.stepBob, sample.depth*.75);
    }
  }
  if (st.mode === 'step') {
    st.stepT += dt;
    if (st.stepT >= CRATER_GAIT.stepTime) st.mode = sample.mode === 'step' ? 'flat' : sample.mode;
  }

  const body = st.body,
    norm = clamp(speed / Math.max(1, u.speed || speed || 1), 0, 1.4),
    k = ease(dt, CRATER_GAIT.ease);
  let leanT = 0,
    crouchT = 0,
    stride = 1,
    bobAmp = 0,
    swayAmp = 0,
    stepLift = 0;
  if (st.mode === 'climb') {
    leanT = CRATER_GAIT.leanMax * clamp(st.grade / 0.22, 0, 1);
    stride = 1 - (1 - CRATER_GAIT.strideClimb) * clamp(st.grade / 0.26, 0, 1);
    crouchT = -CRATER_GAIT.crouch * body * clamp(st.grade / 0.24, 0, 1);
    bobAmp = CRATER_GAIT.bob * body * (0.6 + 0.6 * clamp(st.grade / 0.28, 0, 1));
    swayAmp = CRATER_GAIT.sway * body;
  } else if (st.mode === 'descend') {
    leanT = -CRATER_GAIT.descendLean * clamp(-st.grade / 0.22, 0, 1);
    stride = CRATER_GAIT.strideDescend;
    bobAmp = CRATER_GAIT.bob * body * 0.8;
    swayAmp = CRATER_GAIT.sway * body;
  } else if (st.mode === 'step') {
    const p = clamp(st.stepT / CRATER_GAIT.stepTime, 0, 1),
      e = Math.sin(Math.PI * p);
    leanT = CRATER_GAIT.stepLean * st.stepDir * e;
    stride = CRATER_GAIT.strideStep;
    stepLift = (st.stepHeight || 0) * e;
    bobAmp = CRATER_GAIT.bob * body * 0.5;
    swayAmp = CRATER_GAIT.sway * body * 0.6;
  }

  st.lean += (leanT - st.lean) * k;
  st.crouch += (crouchT - st.crouch) * k;
  if (Math.abs(st.lean) < CRATER_GAIT.reset) st.lean = 0;
  if (Math.abs(st.crouch) < CRATER_GAIT.reset) st.crouch = 0;

  const moving = norm > 0.02 && (st.mode === 'climb' || st.mode === 'descend' || st.mode === 'step');
  if (moving) st.phase += dt * CRATER_GAIT.cadence * norm * stride;
  st.bob = (moving ? Math.sin(st.phase * TAU) * bobAmp * norm : 0) + stepLift + st.crouch;
  st.sway = moving ? Math.cos(st.phase * TAU) * swayAmp * norm : 0;

  const h = u.holder,
    yawNow = st.yaw;
  if (!st.lean && !st.bob && !st.sway && !st.applied) {
    // Exact no-op path on flat ground.
    st.canonical = yawNow + Math.PI / 2;
    st.at = world.time;
    return false;
  }
  leanedQuaternion(yawNow, st.lean, (x, y, z, w) => h.quaternion.set(x, y, z, w));
  if (h.position) {
    h.position.set(u.x - Math.sin(yawNow)*st.sway, u.y + Math.cos(yawNow)*st.sway, u.z + st.bob);
  }
  st.applied = true;
  st.canonical = yawNow + Math.PI / 2;

  // Settled all the way back: restore the exact canonical transform and forget
  // the pose so nothing lingers on the rig.
  if (st.mode === 'flat' && !st.lean && !st.bob && !st.sway) {
    canonicalQuaternion(yawNow, (x, y, z, w) => h.quaternion.set(x, y, z, w));
    if (h.position) h.position.set(u.x, u.y, u.z);
    st.applied = false;
  }
  st.at = world.time;
  return st.applied;
}
