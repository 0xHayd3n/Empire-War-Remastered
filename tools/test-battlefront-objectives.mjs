import assert from 'node:assert/strict';
import { matchRules } from '../public/js/game/battlefrontrules.js';
globalThis.window ??= globalThis;
const { LandWorld } = await import('../public/js/game/land.js');
const { Shooter } = await import('../public/js/game/shooter.js');
const launch = {
  mode: 'land',
  soloBattlefront: { enabled: true, rules: { postCaptureTime: 0.5, postNeutralTime: 2, squadSpawnMax: 0, squadSpawnCalm: 8 } }
};
const custom = matchRules(launch),
  normal = matchRules({ ...launch, shooterNet: true });
const point = { side: 0, taker: -1, progress: 0, x: 0, y: 0, radius: 10, seconds: 20, reinforce: true };
const attacker = { x: 0, y: 0, side: 1, captures: true };
const w = Object.assign(Object.create(LandWorld.prototype), {
  shooter: { rules: custom },
  time: 30,
  captureWait: 60,
  points: [point],
  sites: [],
  units: [attacker],
  ally: (a, b) => a === b,
  paintPoint() {},
  showOwner() {}
});
w.updatePoints(5);
assert.equal(point.progress, 0, 'initial owned-post protection still applies');
w.time = 60;
point.locked = true;
w.updatePoints(5);
assert.equal(point.progress, 0, 'cannot neutralize a locked post');
point.locked = false;
w.updatePoints(10);
assert.equal(point.progress, 0.25);
w.updatePoints(30);
assert.equal(point.side, -1);
const defender = { ...attacker, side: 0 };
w.units.push(defender);
w.updatePoints(5);
assert.equal(point.progress, 0, 'contested neutral post cannot be claimed');
w.units.pop();
w.updatePoints(5);
assert.equal(point.progress, 0.5);
w.units = [];
w.updatePoints(2.5);
assert.equal(point.progress, 0.25, 'interrupted capture unwinds at capture speed');
w.units = [attacker];
for (const [rules, reinforce] of [
  [custom, false],
  [normal, true],
  [null, true]
]) {
  w.shooter = rules ? { rules } : null;
  Object.assign(point, { side: -1, taker: -1, progress: 0, reinforce });
  w.updatePoints(5);
  assert.equal(point.progress, 0.25, 'build pads, excluded matches and ordinary land retain map timing');
}
const ready = { side: 0, lead: {} };
const s = Object.assign(Object.create(Shooter.prototype), {
  points: () => [point],
  me: 0,
  world: w,
  squadSpots: new WeakMap(),
  bots: new Map(),
  teams: [
    { side: 1, lead: {} },
    { side: 0, lead: { inside: true } },
    { side: 0, lead: { dead: true } },
    ready,
    { side: 0, lead: {} },
    { side: 0, lead: {} }
  ]
});
s.rules = custom;
assert.deepEqual(s.spawnSpots(), [point], 'Off leaves fixed locations alone');
s.rules = { ...custom, squadSpawnMax: 2 };
s.bots.set(ready.lead, { mode: 'fight', until: w.time + 2 });
assert(!s.spawnSpots().some(p => p.squad === ready), 'active combat bars even an unhurt leader');
s.bots.delete(ready.lead);
assert.deepEqual(
  s.spawnSpots().map(p => p.squad),
  [undefined, ready, s.teams[4]]
);
console.log(
  'PASS: opening and locked posts, contested capture, rollback, map timing outside solo Battlefront, squad limits and active-combat gate.'
);
