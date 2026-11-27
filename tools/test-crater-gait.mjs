import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRATER_GAIT,
  craterGaitBody,
  craterGaitReach,
  craterGaitSample,
  tickCraterGait,
  clearCraterGait
} from '../public/js/game/crater-gait.js';

// ---- fixtures --------------------------------------------------------------
// Isolated analytic bowl for repeatable locomotion tests:
// offset = -depth * (1 - d^2/r^2)^2 inside the radius, 0 outside. Off-grid
// centres are deliberate: a soldier never walks a grid line or a chosen node.
function bowl(cx, cy, r, depth) {
  return {
    cx,
    cy,
    r,
    depth,
    offsetAt(x, y) {
      const q = 1 - ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
      return q > 0 ? -depth * q * q : 0;
    }
  };
}

const baseGround = (x, y) => 6 + 0.004 * x + 0.003 * y;

function holder() {
  const h = {
    scale: { x: 1, y: 1, z: 1 },
    position: {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
    },
    quaternion: {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
      set(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
      }
    }
  };
  return h;
}

function unit(over = {}) {
  const u = {
    foot: true,
    structure: false,
    dead: false,
    gone: false,
    flies: false,
    flight: null,
    rope: null,
    inside: null,
    cinematicTransport: null,
    rooted: false,
    scriptZ: undefined,
    needsDeploy: false,
    deployed: false,
    cast: 0,
    onceKind: null,
    animKind: 'move',
    stunUntil: 0,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 37.44,
    v: 37.44,
    mvx: 37.44,
    mvy: 0,
    holder: holder(),
    inst: { box: { isEmpty: () => false, min: { z: 0 }, max: { z: 10 } } },
    anim: { speed: 1 }
  };
  return Object.assign(u, over);
}

function world(surface, time = 0) {
  return {
    time,
    terrain: { craterSurface: surface || null },
    groundZ(x, y) {
      const off = surface && typeof surface.offsetAt === 'function' ? surface.offsetAt(x, y) || 0 : 0;
      return baseGround(x, y) + off;
    }
  };
}

function place(u, w, x, y, heading = 0, speed = 37.44) {
  u.x = x;
  u.y = y;
  u.heading = heading;
  u.v = speed;
  u.mvx = Math.cos(heading) * speed;
  u.mvy = Math.sin(heading) * speed;
  u.z = w.groundZ(x, y);
  u.holder.position.set(x, y, u.z);
}

const qAngle = q => 2 * Math.acos(Math.min(1, Math.max(-1, Math.abs(q.w))));
function tiltOf(u, yaw) {
  const a = yaw + Math.PI / 2,
    c = { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) },
    q = u.holder.quaternion,
    dot = q.x * c.x + q.y * c.y + q.z * c.z + q.w * c.w;
  return 2 * Math.acos(Math.min(1, Math.abs(dot)));
}
const canonical = (yaw, eps = 1e-9) => {
  const a = yaw + Math.PI / 2;
  return { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2), eps };
};
const assertCanonical = (u, yaw) => {
  const c = canonical(yaw);
  assert.ok(Math.abs(u.holder.quaternion.x - c.x) < c.eps, `x ${u.holder.quaternion.x} vs ${c.x}`);
  assert.ok(Math.abs(u.holder.quaternion.y - c.y) < c.eps, `y ${u.holder.quaternion.y} vs ${c.y}`);
  assert.ok(Math.abs(u.holder.quaternion.z - c.z) < c.eps, `z ${u.holder.quaternion.z} vs ${c.z}`);
  assert.ok(Math.abs(u.holder.quaternion.w - c.w) < c.eps, `w ${u.holder.quaternion.w} vs ${c.w}`);
};

// ---- sampling / classification ---------------------------------------------
test('deep crater upgrade reads as a sustained uphill climb', () => {
  const s = bowl(1.3, 2.7, 25, 5);
  const x = s.cx + 10,
    y = s.cy;
  const sample = craterGaitSample(
    (px, py) => baseGround(px, py) + s.offsetAt(px, py),
    s,
    x,
    y,
    0,
    { height: 10, speed: 37.44 }
  );
  assert.equal(sample.mode, 'climb', JSON.stringify(sample));
  assert.ok(sample.depth >= 0.28 * 10, `depth ${sample.depth}`);
  assert.ok(sample.grade >= CRATER_GAIT.climbGrade, `grade ${sample.grade}`);
  assert.ok(sample.sustained >= CRATER_GAIT.climbGrade * 0.55, `sustained ${sample.sustained}`);
});

test('shallow crater rim reads as a short step, not a climb', () => {
  const s = bowl(-3.4, 5.1, 5, 1);
  const sample = craterGaitSample(
    (px, py) => baseGround(px, py) + s.offsetAt(px, py),
    s,
    s.cx - 2.2,
    s.cy,
    0,
    { height: 10, speed: 37.44 }
  );
  assert.equal(sample.mode, 'step', JSON.stringify(sample));
  assert.ok(sample.depth < 0.28 * 10);
});

test('walking down a deep inner wall braces as a descent', () => {
  const s = bowl(4.2, -1.6, 25, 5);
  const sample = craterGaitSample(
    (px, py) => baseGround(px, py) + s.offsetAt(px, py),
    s,
    s.cx + 18,
    s.cy,
    Math.PI,
    { height: 10, speed: 37.44 }
  );
  assert.equal(sample.mode, 'descend', JSON.stringify(sample));
  assert.ok(sample.grade < 0);
});

test('flat floor, flat ground and a stationary soldier stay neutral', () => {
  const s = bowl(0, 0, 25, 5);
  const floor = craterGaitSample((x, y) => baseGround(x, y) + s.offsetAt(x, y), s, 0, 0, 0, {
    height: 10,
    speed: 37.44
  });
  assert.equal(floor.mode, 'flat', 'crater floor is level walking');
  const outside = craterGaitSample((x, y) => baseGround(x, y) + s.offsetAt(x, y), s, 100, 100, 0, {
    height: 10,
    speed: 37.44
  });
  assert.equal(outside.mode, 'flat');
  const still = craterGaitSample((x, y) => baseGround(x, y) + s.offsetAt(x, y), s, 10, 0, 0, {
    height: 10,
    speed: 0
  });
  assert.equal(still.mode, 'flat', 'no gait without movement');
});

test('probe scales with the soldier but stays small-crater sized', () => {
  assert.equal(craterGaitReach(10), 4.5);
  assert.equal(craterGaitReach(4), CRATER_GAIT.probeMin);
  assert.equal(craterGaitReach(60), CRATER_GAIT.probeMax);
  assert.equal(craterGaitBody(unit()), 10);
  const giant = unit({ inst: { box: { isEmpty: () => false, min: { z: -1 }, max: { z: 46 } } } });
  assert.equal(craterGaitBody(giant), CRATER_GAIT.bodyMax, 'giants are clamped');
});

// ---- pose ------------------------------------------------------------------
test('deep climb poses a bounded forward lean, weight bob and slower stride', () => {
  const s = bowl(1.3, 2.7, 25, 5);
  const w = world(s);
  const u = unit();
  place(u, w, s.cx + 10, s.cy, 0);
  for (let i = 0; i < 30; i++) {
    w.time = i / 30;
    tickCraterGait(w, u, 1 / 30, u.heading);
  }
  assert.equal(u.craterGait.mode, 'climb');
  assert.ok(u.craterGait.lean >= 0.08, `lean ${u.craterGait.lean}`);
  assert.ok(u.craterGait.lean <= CRATER_GAIT.leanMax + 1e-9);
  assert.ok(tiltOf(u, u.heading) >= 0.08, `root tilt ${tiltOf(u, u.heading)}`);
  assert.ok(Math.abs(u.holder.position.z - u.z) >= 0.1, 'body bob is visible');
  assert.equal(u.anim.speed, 1, 'the authored MOVE clip is never retimed or swapped');
  assert.equal(u.x, s.cx + 10, 'gait never moves the unit');
  assert.equal(u.y, s.cy);
  assert.equal(u.z, w.groundZ(u.x, u.y));
  assert.equal(u.animKind, 'move', 'gait never swaps the animation state');
  assert.ok(Math.abs(Math.hypot(u.holder.quaternion.x, u.holder.quaternion.y, u.holder.quaternion.z, u.holder.quaternion.w) - 1) < 1e-9);
});

test('shallow step is a quick vertical pop with a much smaller lean', () => {
  const s = bowl(-3.4, 5.1, 5, 1);
  const w = world(s);
  const u = unit();
  place(u, w, s.cx - 4.8, s.cy, 0);
  let peakBob = 0,
    peakLean = 0,
    stepTicks = 0,
    seenStep = false;
  for (let i = 0; i < 24; i++) {
    u.x += (u.v * 1) / 30;
    u.z = w.groundZ(u.x, u.y);
    u.holder.position.set(u.x, u.y, u.z);
    w.time = i / 30;
    tickCraterGait(w, u, 1 / 30, u.heading);
    if (u.craterGait.mode === 'step') {
      seenStep = true;
      stepTicks++;
      peakBob = Math.max(peakBob, Math.abs(u.craterGait.bob));
      peakLean = Math.max(peakLean, Math.abs(u.craterGait.lean));
    }
  }
  assert.ok(seenStep, 'a shallow crater must produce a step reaction');
  assert.ok(peakBob >= 0.25, `step lift ${peakBob}`);
  assert.ok(peakLean <= CRATER_GAIT.stepLean + 0.02, `step lean ${peakLean}`);
  assert.ok(stepTicks >= 2, `step lasted ${stepTicks} ticks`);
  assert.ok(stepTicks <= 12, 'step reaction is transient, got ' + stepTicks + ' ticks');
});

test('the pose is recomposed each tick: no permanent additive rotation', () => {
  const s = bowl(1.3, 2.7, 25, 5);
  const w = world(s);
  const u = unit();
  place(u, w, s.cx + 10, s.cy, 0);
  let tilts = [];
  for (let i = 0; i < 300; i++) {
    w.time = i / 30;
    tickCraterGait(w, u, 1 / 30, u.heading);
    if (i === 29 || i === 149 || i === 299) tilts.push(tiltOf(u, u.heading));
  }
  assert.ok(tilts.every(t => t <= CRATER_GAIT.leanMax + 0.01), `tilt grew: ${tilts}`);
  assert.ok(Math.abs(tilts[1] - tilts[2]) < 0.005, `tilt drifted: ${tilts}`);
  assert.ok(Math.hypot(u.holder.quaternion.x, u.holder.quaternion.y, u.holder.quaternion.z, u.holder.quaternion.w) > 0.999);
});

test('leaving the crater restores the exact canonical transform and stride', () => {
  const s = bowl(1.3, 2.7, 25, 5);
  const w = world(s);
  const u = unit();
  place(u, w, s.cx + 10, s.cy, 0);
  for (let i = 0; i < 30; i++) {
    w.time = i / 30;
    tickCraterGait(w, u, 1 / 30, u.heading);
  }
  place(u, w, s.cx + 200, s.cy + 200, 0);
  for (let i = 0; i < 40; i++) {
    w.time = 1 + i / 30;
    tickCraterGait(w, u, 1 / 30, u.heading);
  }
  assert.ok(!u.craterGait || u.craterGait.mode === 'flat');
  assertCanonical(u, u.heading);
  assert.equal(u.holder.position.x, u.x);
  assert.equal(u.holder.position.y, u.y);
  assert.equal(u.holder.position.z, u.z);
  assert.equal(u.anim.speed, 1, 'authored MOVE clip untouched');
});

test('one tick per world.time: phase and stride are not double-advanced', () => {
  const s = bowl(1.3, 2.7, 25, 5);
  const w = world(s);
  const u = unit();
  place(u, w, s.cx + 10, s.cy, 0);
  w.time = 0.5;
  tickCraterGait(w, u, 1 / 30, u.heading);
  const phase = u.craterGait.phase,
    lean = u.craterGait.lean;
  const again = tickCraterGait(w, u, 1 / 30, u.heading);
  assert.equal(again, false);
  assert.equal(u.craterGait.phase, phase);
  assert.equal(u.craterGait.lean, lean);
});

// ---- protection / restoration ----------------------------------------------
const blocks = {
  'firing (attack anim)': { animKind: 'attack' },
  'casting an ability': { cast: 99 },
  'one-shot ability': { once: 'idle', onceKind: 'DEPLOY' },
  'firing one-shot': { once: 'attack', onceKind: 'ATTACK' },
  'aiming': { animKind: 'ATTACKIDLE' },
  'deployed setup weapon': { needsDeploy: true, deployed: true },
  flying: { flies: true },
  'scripted flight': { flight: { t: 0, T: 1 } },
  'rope drop': { rope: { held: true } },
  garrisoned: { inside: {} },
  'cinematic transport': { cinematicTransport: {} },
  rooted: { rooted: true },
  'scripted Z': { scriptZ: 30 },
  dead: { dead: true },
  vehicle: { foot: false },
  structure: { structure: true }
};

for (const [name, over] of Object.entries(blocks)) {
  test(`${name} never receives a crater pose and is restored`, () => {
    const s = bowl(1.3, 2.7, 25, 5);
    const w = world(s);
    const u = unit();
    place(u, w, s.cx + 10, s.cy, 0);
    for (let i = 0; i < 15; i++) {
      w.time = i / 30;
      tickCraterGait(w, u, 1 / 30, u.heading);
    }
    assert.ok(u.craterGait, 'fixture must have posed the unit first');
    Object.assign(u, over);
    w.time = 0.6;
    const applied = tickCraterGait(w, u, 1 / 30, u.heading);
    assert.equal(applied, false);
    assert.equal(u.craterGait, null);
    assertCanonical(u, u.heading);
    assert.equal(u.holder.position.x, u.x);
    assert.equal(u.holder.position.y, u.y);
    assert.equal(u.holder.position.z, u.z);
    assert.equal(u.anim.speed, 1, 'the clip is never retimed');
  });
}

test('no supplier (other terrain / other battle rules) is a complete no-op', () => {
  const w = world(null);
  const u = unit();
  place(u, w, 10, 10, 0);
  const before = { ...u.holder.quaternion };
  assert.equal(tickCraterGait(w, u, 1 / 30, u.heading), false);
  assert.deepEqual({ ...u.holder.quaternion }, before);
  assert.equal(u.craterGait, undefined);
  // clearing an unposed unit is safe and idempotent
  assert.equal(clearCraterGait(u), false);
  assert.equal(clearCraterGait(u), false);
});

test('gait never writes health, heading or the simulation position', () => {
  const s = bowl(1.3, 2.7, 25, 5);
  const w = world(s);
  const u = unit({ health: 100, heading: 0.7 });
  place(u, w, s.cx + 10, s.cy, 0.7);
  const snap = { x: u.x, y: u.y, z: u.z, h: u.heading, hp: u.health };
  for (let i = 0; i < 60; i++) {
    w.time = i / 30;
    tickCraterGait(w, u, 1 / 30, u.heading);
  }
  assert.deepEqual({ x: u.x, y: u.y, z: u.z, h: u.heading, hp: u.health }, snap);
});
