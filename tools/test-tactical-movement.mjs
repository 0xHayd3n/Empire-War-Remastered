import assert from 'node:assert/strict';
import test from 'node:test';
import { TacticalMovement } from '../public/js/game/tactical-movement.js';
import { GroundTravel } from '../public/js/game/ground-travel.js';
import { motionRule, installBattlePhysics } from '../public/js/game/battle-physics.js';
import { loadWreckPhysics } from '../public/js/game/rapier-runtime.js';
const R = await loadWreckPhysics();
function unit(x, data = {}) {
  return {
    x,
    y: 0,
    z: 0,
    kind: 'INFANTRY',
    foot: true,
    side: 0,
    speed: 100,
    maxSpeed: 100,
    maxHealth: 100,
    hitRadius: 1,
    isMobile: true,
    ...data
  };
}
function drive(m, units, move) {
  const hits = [];
  m.begin(units, 0.1);
  move();
  m.end(units, (...hit) => hits.push(hit));
  return hits;
}
const near = (actual, want) => assert(Math.abs(actual - want) < 0.012, `${actual} should be near ${want}`);
for (const domain of ['land', 'space']) {
  test(domain + ': slow approaches stop at actual contact without applying any damage; free motion and separating motion pass', () => {
    const m = new TacticalMovement(R, domain),
      a = unit(0),
      b = unit(2.4),
      c = unit(12, { z: 6 });
    assert.deepEqual(
      drive(m, [a, b, c], () => {
        a.x += 0.8;
        c.x += 0.8;
      }),
      []
    );
    near(a.x, 0.4);
    near(c.x, 12.8);
    assert.equal(m.motionStops, 1);
    assert.equal(m.impacts, 0);
    drive(m, [a, b, c], () => {
      a.x -= 0.5;
    });
    near(a.x, -0.1);
  });
  test(domain + ': contact propagates up a moving column within the same tick', () => {
    const m = new TacticalMovement(R, domain),
      leader = unit(3),
      rear = unit(0),
      wall = unit(5.2);
    const hits = drive(m, [wall, rear, leader], () => {
      rear.x += 1.8;
      leader.x += 1.8;
    });
    near(leader.x, 3.2);
    near(rear.x, 1.2);
    assert.equal(hits.length, 0);
    assert.equal(m.motionStops, 2);
  });
  test(domain + ': starting or spawning overlapped does not trap or launch a unit', () => {
    const m = new TacticalMovement(R, domain),
      a = unit(0),
      b = unit(1);
    drive(m, [a, b], () => (a.x -= 2));
    assert.equal(a.x, -2);
    assert.equal(m.motionStops, 0);
  });
}
test('static stations and occupied structures block; garrison orders, authored enemy crush, scripted travel and fields keep their own behavior', () => {
  for (const domain of ['land', 'space']) {
    const m = new TacticalMovement(R, domain),
      a = unit(0),
      wall = unit(
        3,
        domain === 'land' ? { kind: 'STRUCTURE', structure: true, foot: false, footprint: [0] } : { isMobile: false, isStation: true }
      );
    assert.deepEqual(
      drive(m, [a, wall], () => (a.x = 2)),
      []
    );
    near(a.x, 1);
    a.x = 0;
    if (domain === 'land') a.squad = { entering: wall };
    else {
      wall.isStation = false;
      wall.isField = true;
    }
    drive(m, [a, wall], () => (a.x = 2));
    near(a.x, 2);
  }
  const m = new TacticalMovement(R, 'land'),
    a = unit(0, { kind: 'VEHICLE', foot: false, crusher: true }),
    b = unit(3, { side: 1, squashable: true });
  drive(m, [a, b], () => (a.x = 2));
  assert.equal(a.x, 2);
});
test('crossing a closed tile between two open endpoints stops at its edge, even diagonally; flight and free routing are exempt', () => {
  const m = new TacticalMovement(R, 'land');
  m.terrain = new GroundTravel(R, 20, (u, x, y) => x !== 20 || y !== 0);
  for (const [dx, dy, fly, free, want] of [
    [45, 0, false, false, 10],
    [45, 45, false, false, 10],
    [45, 0, true, false, 45],
    [45, 0, false, true, 45]
  ]) {
    const a = unit(0, { flies: fly, speed: 200, path: [{ free }] });
    drive(m, [a], () => {
      a.x = dx;
      a.y = dy;
    });
    near(a.x, want);
  }
});

test('a blocked ground unit is not marked arrived at its proposed waypoint or left at the height of the far slope', () => {
  const m = new TacticalMovement(R, 'land', null, (x, y) => (x * x) / 10),
    a = unit(0),
    b = unit(3),
    head = { x: 5, y: 0 };
  a.path = [head];
  drive(m, [a, b], () => {
    a.x = 5;
    a.z = 2.5;
    a.legTo = head;
    a.path.shift();
  });
  assert(a.x < 2);
  near(a.z, (a.x * a.x) / 10);
  assert.deepEqual(a.path, [head]);
});

test('same hard collision is charged once, clip before damage, resume a saved contact without a duplicate', () => {
  const m = new TacticalMovement(R, 'space'),
    a = unit(0),
    b = unit(4);
  let h = drive(m, [a, b], () => (a.x = 8));
  assert.equal(h.length, 1);
  near(a.x, 2);
  const ids = u => (u === a ? 'a' : 'b');
  const saved = m.snapshot(ids);
  assert.equal(saved.length, 1);
  const next = new TacticalMovement(R, 'space');
  next.restore(saved, id => (id === 'a' ? a : b));
  h = drive(next, [a, b], () => (a.x += 8));
  assert.equal(h.length, 0);
  near(a.x, 2);
});
test('only new solo rulesets opt in: old saves, recordings, multiplayer and the galaxy do not silently change', () => {
  assert.equal(motionRule({ mode: 'land' }), 1);
  assert.equal(motionRule({ ramRule: 1, replay: {}, battlePhysicsRule: 1 }), 1);
  for (const setup of [{ mode: 'galactic' }, { replay: {}, ramRule: 1 }, { restore: { battle: {} } }, { net: {} }, { shooterNet: {} }])
    assert.equal(motionRule(setup), 0);
  assert.equal(motionRule({ restore: { battle: { physicsRule: 1 } } }), 1);
  const w = {};
  installBattlePhysics(w, R, 'space', 0);
  assert(!(w.ramImpacts instanceof TacticalMovement));
});
