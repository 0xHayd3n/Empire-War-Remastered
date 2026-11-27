import assert from 'node:assert/strict';
import { Radar } from '../public/js/game/radar.js';
import { LandUI } from '../public/js/game/landhud.js';
import { setViewOption as set } from '../public/js/game/viewpreferences.js';

// Exercise the two production draw loops, recording path primitives instead of needing a GPU.
const ink = [];
const g = new Proxy({}, { get: (o, k) => o[k] ?? ((...args) => ink.push([k, ...args])) });
const cv = { width: 100, height: 100, clientWidth: 100, getContext: () => g, getBoundingClientRect: () => ({ width: 100, height: 100 }) };
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { getElementById: () => cv, createElement: () => ({ ...cv }) };
set('radarView', false);
const def = { show: true, enemy: true, blip: 2 },
  own = { id: 0, bit: 1, team: 0 },
  ally = { id: 1, team: 0 },
  enemy = { id: 2, team: 1 },
  neutral = { id: -1, team: -1 };
const u = (x, player, extra = {}) => ({ x, y: 25, player, side: player.id, seenBy: 1, ...extra });
const units = [
  u(10, own),
  u(20, ally),
  u(30, enemy),
  u(40, neutral),
  u(50, enemy, { cloaked: true }),
  u(60, enemy, { seenBy: 0, seen: false }),
  u(70, enemy, { type: { show: false } })
];
const R = Object.assign(Object.create(Radar.prototype), {
  settings: { base: [0, 0, 0] },
  events: [],
  of: t => t || def,
  teamTypeOf: t => t,
  colorOf: () => ({ rgb: '#aac' })
});
const shapes = () => ink.filter(([op]) => ['arc', 'rect', 'moveTo'].includes(op)).map(([op, x]) => [op, Math.round(x)]);
const world = { units, squads: [], min: { x: 0, y: 0 }, max: { x: 100, y: 100 }, fog: true, radarAlways: true };
const space = () => {
  ink.length = 0;
  R.draw(cv, { world, player: own, r: {} }, 0);
  return shapes();
};
assert.deepEqual(space(), [], 'authored blips by default');
set('radarShapes', true);
assert.deepEqual(space(), [
  ['arc', 10],
  ['arc', 20],
  ['moveTo', 30],
  ['rect', 38]
]);
world.squads = [
  { type: def, player: enemy, fighters: [u(75, enemy), u(85, enemy)] },
  { type: def, player: enemy, fighters: [u(95, enemy, { cloaked: true })] }
];
world.time = 0.5; // Squads move on a new simulation step; the radar caches intervening frames.
assert.deepEqual(space().at(-1), ['moveTo', 80]);
world.radarAlways = false;
world.time = 1;
R.radarOn = () => false;
assert.deepEqual(space(), [['arc', 10], ['arc', 20], ['moveTo', 30], ['rect', 38], ['moveTo', 80]], 'visible contacts do not require a radar source');
units[2].seenBy = 0;
for (const q of world.squads) for (const f of q.fighters) f.seenBy = 0;
world.time++;
assert.deepEqual(
  space(),
  [
    ['arc', 10],
    ['arc', 20],
    ['rect', 38]
  ],
  'offline radar must not reveal hostile units or squadrons'
);
units[2].seenBy = 1;
const w = { units, points: [], wild: 3, ally: (s, m) => s === m || s === 1 };
const hud = {
  world: w,
  me: 0,
  game: { terrain: { size: 100 }, map: { playMin: [0, 0], playMax: [100, 100] } },
  ground: {},
  fogShown: null,
  radar: R,
  radarOn: () => true
};
const land = () => {
  ink.length = 0;
  LandUI.prototype.drawRadar.call(hud);
  return shapes();
};
assert.deepEqual(land(), [
  ['arc', 10],
  ['arc', 20],
  ['moveTo', 30],
  ['rect', 38]
]);
w.units = [
  { x: 10, y: 10, side: 3 },
  { x: 30, y: 10, side: 3, squad: { native: true, members: [{}] } }
];
assert.deepEqual(
  land(),
  [
    ['rect', 8],
    ['moveTo', 30]
  ],
  'neutral wildlife is distinct from hostile native forces'
);
set('radarShapes', false);
assert.deepEqual(land(), []);
console.log('PASS: alternate radar symbols, alliances, fog, cloak, offline radar, squadrons, neutral wildlife and native enemies.');
