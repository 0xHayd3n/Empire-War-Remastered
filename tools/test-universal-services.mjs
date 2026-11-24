import assert from 'node:assert/strict';
import { launchPlan } from './universal-atlas.mjs';
import { appearances, restorePaint, battlePaint, tacticalPaint } from '../public/js/game/appearancechoices.js';
import { db } from '../public/js/gamedata.js';
import { tickStationOrder, buyStationOrder, hasStationOrder, restoreStationOrder } from '../public/js/game/stationsupport.js';
import { restoreHire, updateHire } from '../public/js/game/mercenarycontract.js';
import { equalFooting } from '../public/js/game/universaleligibility.js';
const atlas = (id, revision, row, target, faction) => ({
  profiles: [{ id, revision, combat: { rescue: id === 'stock' }, rows: [{ id: row, faction, variants: [{ id: target, sites: [] }] }] }]
});
const profile = 'stock',
  row = equalFooting,
  q = { profile, row, target: row, difficulty: 'medium' },
  stock = atlas(profile, 'stock', row, row, 'Rebel');
for (const k of ['mercenaries', 'fighterSupport']) {
  assert(!Object.hasOwn(launchPlan(stock, q).setup.universalOptions, k));
  assert(launchPlan(stock, { ...q, [k]: true }).setup.universalOptions[k]);
  for (const n of [false, 0, 'true']) assert.throws(() => launchPlan(stock, { ...q, [k]: n }));
}
for (const [k, d] of Object.entries(appearances)) {
  const a = atlas(d.id, d.revision, d.row, d.target, 'Empire'),
    q = { profile: d.id, row: d.row, target: d.target, difficulty: 'medium' };
  for (const [n] of d.choices.entries()) assert.equal(launchPlan(a, { ...q, [k]: n }).setup.universalOptions[k], n);
  for (const n of [-1, d.choices.length, '1', true]) assert.throws(() => launchPlan(a, { ...q, [k]: n }));
  a.profiles[0].revision += '1';
  assert.throws(() => launchPlan(a, { ...q, [k]: 0 }));
}
const d = appearances.saber;
globalThis.document = { querySelector: () => ({ content: `${d.id}:${d.revision}` }) };
const g = { campaign: { name: d.target }, active: 'Empire', universalPath: 1, planets: [{}] };
restorePaint(g, { keys: ['saber', 'fleetMark', 'nope'], orders: { saber: { goal: 3, at: 1, phase: 'wait', planet: 0, deadline: 15 } } });
assert.deepEqual(g.paintKeys, ['saber']);
assert.equal(g.paint.saber.phase, 'wait');
const paint = battlePaint(
  g,
  new Map([
    [d.flag, 4],
    ['RANDOM_FLAG', 12]
  ])
);
const setup = {
  campaign: {
    ...paint,
    campaignName: d.target,
    sides: ['Empire', 'Rebel'],
    galaxy: { campaign: d.target, universalPath: 1, paintPolicy: { keys: ['saber'] } }
  }
};
assert.deepEqual([...tacticalPaint(setup)], [[d.flag, 4]]);
assert.equal(tacticalPaint({ ...setup, net: {} }).size, 0);
assert.equal(tacticalPaint({ ...setup, linkedTactical: true }).size, 0);
assert.deepEqual(battlePaint(g, new Map([[d.flag, 122]])), {});
delete globalThis.document;
const h = { active: 'Rebel', universalPath: 1, campaign: { name: row }, fleets: [], time: 10 },
  id = crypto.randomUUID();
restoreHire(h, { id, end: 130, next: 190, state: 'serving' });
const escort = { hireId: id, type: { name: 'Corellian_Corvette' } },
  sister = { type: escort.type };
h.fleets = [{ owner: 'Rebel', leg: {}, units: [sister, escort] }];
h.time = 129;
assert(!updateHire(h));
h.time = 130;
assert(updateHire(h));
assert.deepEqual(h.fleets[0].units, [sister]);
assert.deepEqual(h.hire, { next: 190, state: 'expired' });
assert(!updateHire(h));
restoreHire(h, { id, end: 130, next: 190, state: 'serving' });
assert(updateHire(h));
assert.equal(h.hire.state, 'lost');
assert.deepEqual(h.fleets[0].units, [sister]);
restoreHire(h, { id, end: 100, next: -1, state: 'serving' });
assert(!h.hire);
const cb = {
    stationSupport: true,
    campaignName: row,
    sides: ['Empire', 'Rebel'],
    planetOwner: 'Rebel',
    defender: { team: 1, station: 'Rebel_Star_Base_2' },
    galaxy: { universalPath: 1, fighterSupport: true }
  },
  p = { id: 0, team: { id: 1 }, factionName: 'Rebel', credits: 1499 },
  calls = [],
  human = {
    setup: { campaign: cb },
    human: p,
    world: { tacticalSessions: [{ ai: false }], spawn: (...a) => calls.push(a) },
    campaignBook: { station: { player: p, x: 0, y: 0, heading: 1 }, support: { phase: 'ready' } }
  };
const old = db.type;
try {
  db.type = () => ({ has: () => true });
  assert(hasStationOrder(human));
  assert(!buyStationOrder(human));
  p.credits = 2000;
  assert(!hasStationOrder({ ...human, setup: { campaign: cb, net: {} } }));
  assert(buyStationOrder(human));
  assert(!buyStationOrder(human));
  assert.equal(p.credits, 500);
  human.paused = true;
  tickStationOrder(human);
  assert.equal(human.campaignBook.support.left, 600);
  human.paused = false;
  for (let i = 0; i < 599; i++) tickStationOrder(human);
  assert.equal(calls.length, 0);
  human.campaignBook.support = restoreStationOrder(JSON.parse(JSON.stringify(human.campaignBook.support)));
  tickStationOrder(human);
  tickStationOrder(human);
  assert.equal(calls.length, 2);
  assert(calls.every(a => a[1] === p));
  assert(!buyStationOrder(human));
  for (const reason of ['station', 'retreat']) {
    human.campaignBook.support = { phase: 'inbound', left: 1 };
    human.campaignBook.station.dead = reason === 'station';
    human.retreat = { active: reason === 'retreat' };
    tickStationOrder(human);
    assert.equal(human.campaignBook.support.phase, 'closed');
    assert.equal(calls.length, 2);
  }
  assert.equal(restoreStationOrder({ phase: 'inbound', left: -1 }).phase, 'closed');
} finally {
  db.type = old;
}
console.log(
  'PASS: exact openings and supported cosmetics; latest native value; rental identity/expiry/loss; station fee, pause, restore, single wave and cancellation.'
);
