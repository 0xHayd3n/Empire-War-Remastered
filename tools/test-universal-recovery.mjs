import assert from 'node:assert/strict';
import { db, ObjType } from '../public/js/gamedata.js';
import { launchPlan } from './universal-atlas.mjs';
import { equalFooting } from '../public/js/game/universaleligibility.js';
import {
  enableRecovery,
  restoreRecovery,
  assignCrew,
  recoveryBattle,
  recoveryAuto,
  checkRecovery,
  finishRecoveryBattle,
  refitQuote,
  settlePrize,
  recoveryRows,
  prizeShip,
  boardingShip
} from '../public/js/game/derelictrecovery.js';
import { openVesselBattle, acceptVesselResult } from '../public/js/game/campaignvessels.js';
import { createBoarding, stepBoarding, restoreBoarding, recoveredPrize, holdTicks } from '../public/js/game/derelicttactical.js';
import { reserveCards } from '../public/js/game/reservecards.js';
import { reserveSlot, takeReserve } from '../public/js/game/campaignreserve.js';
const profile = {
    id: 'stock',
    combat: { rescue: true },
    rows: [{ id: equalFooting, faction: 'Rebel', variants: [{ id: equalFooting, sites: [] }] }]
  },
  atlas = { profiles: [profile] },
  req = { profile: 'stock', row: equalFooting, target: equalFooting, difficulty: 'medium' };
assert(!launchPlan(atlas, req).setup.universalOptions.recovery);
assert(launchPlan(atlas, { ...req, flagship: true, recovery: true }).setup.universalOptions.recovery);
for (const x of [{ recovery: false }, { recovery: 'true' }, { convoy: true }, { envoy: true }, { heroRescue: true }, { expedition: true }])
  assert.throws(() => launchPlan(atlas, { ...req, recovery: true, ...x }));
function type(n, props = {}) {
  const t = new ObjType('SpaceUnit', n);
  for (const [k, v] of Object.entries(props)) t.props.set(k.toLowerCase(), [String(v)]);
  db.types.set(n.toUpperCase(), t);
  return t;
}
const board = type(boardingShip, { Behavior: 'DUMMY_STARSHIP' }),
  prize = type(prizeShip, { Behavior: 'DUMMY_STARSHIP', Build_Cost_Credits: 2200 });
db.constants = type('constants');
function run() {
  const planets = ['Hoth', 'Sullust', 'Bespin'].map((name, index) => ({
      name,
      index,
      type: type(name),
      owner: index === 1 ? 'Empire' : 'Rebel',
      station: index === 1 ? null : {},
      spaceLevel: 1,
      selectable: true
    })),
    f = { owner: 'Rebel', planet: 0, units: [{ type: board }, { type: board }], slot: 0 },
    g = {
      active: 'Rebel',
      universalPath: 1,
      campaign: { name: equalFooting },
      visibility: { viewer: 'Rebel', planets: planets.map(() => ({ discovered: true })) },
      planets,
      fleets: [f],
      players: [{ faction: 'Rebel', credits: 5000 }],
      creditCapOverride: 10000
    };
  return { g, f, a: f.units[0], u: f.units[1], p: planets[2], wallet: g.players[0] };
}
const mission = () => {
  const q = run(),
    { g, f, u } = q;
  enableRecovery(g);
  assert(assignCrew(g, f, u));
  assert(!assignCrew(g, f, f.units[0]));
  f.planet = 1;
  const b = { p: 1, attacker: 'Rebel', defender: 'Empire', mode: 'space' },
    receipt = openVesselBattle(g, 1, ['Rebel', 'Empire']);
  assert(!recoveryBattle(g, { ...b, linked: true }, receipt));
  const r = recoveryBattle(g, b, receipt);
  assert.deepEqual(r, { id: u.salvageId, gid: '0:1' });
  const cb = {
      vesselBattle: receipt,
      recovery: r,
      attacker: { team: 0, units: f.units.map((u, i) => ({ type: board, gid: `0:${i}` })) },
      defender: { team: 1, units: [] }
    },
    book = {
      anchors: [
        { x: 0, y: 0 },
        { x: 2000, y: 1000 }
      ],
      entity: new Map()
    },
    entity = { x: 0, y: 0, health: 100, type: board, player: { human: true, team: { id: 0 } } };
  createBoarding(cb, book);
  Object.assign(entity, { x: book.boarding.x, y: book.boarding.y });
  book.entity.set('0:0', entity);
  return { ...q, receipt, b, cb, book, entity };
};
const result = (q, winner = 'attacker', survive = true) => {
  const r = {
    planet: 1,
    sides: ['Rebel', 'Empire'],
    winner,
    vesselBattle: q.receipt,
    vesselOutcomes: [],
    battleSlots: ['0:0', '0:1'],
    alive: survive ? ['0:0', '0:1'] : ['0:0'],
    ...recoveredPrize(q.cb, q.book, winner === 'attacker' ? 0 : 1, survive ? ['0:0', '0:1'] : ['0:0'])
  };
  assert(acceptVesselResult(q.g, r));
  finishRecoveryBattle(q.g, r);
  assert(!acceptVesselResult(q.g, r));
};
const secured = q => {
  q.book.entity.set('0:1', q.entity);
  for (let i = 0; i < holdTicks; i++) stepBoarding(q.cb, q.book);
  assert.equal(q.book.boarding.ticks, holdTicks);
};
{
  const { g, f, u } = run();
  g.humans = ['REBEL'];
  enableRecovery(g);
  assert(!g.recovery);
  delete g.humans;
  enableRecovery(g);
  g.planets[1].restricted = true;
  assert(!assignCrew(g, f, u));
  assert(!JSON.stringify(recoveryRows(g)).includes('Sullust'));
  restoreRecovery(g, { state: 'tow', id: 'bogus' });
  assert(!g.recovery);
}
{
  const q = mission(),
    { book, cb, entity } = q,
    m = book.boarding;
  assert(recoveryAuto(q.g, q.b));
  assert(!recoveryAuto(q.g, { ...q.b, mode: 'land' }));
  for (let i = 0; i < 160; i++) stepBoarding(cb, book);
  assert.equal(m.ticks, 0, 'An identical sister cannot board');
  book.entity.set('0:1', entity);
  stepBoarding(cb, book, true);
  assert.equal(m.ticks, 0);
  stepBoarding(cb, book);
  assert.equal(m.ticks, 1);
  entity.x += 500;
  stepBoarding(cb, book);
  assert.equal(m.ticks, 0);
  restoreBoarding(cb, book, { ...cb.recovery, id: 'stale', ticks: 150, void: false });
  assert(m.void);
  result(q);
  assert.equal(q.g.recovery.state, 'missed');
}
for (const reason of ['lost', 'retreated', 'loser', 'autoresolved', 'removed', 'captured']) {
  const q = mission();
  secured(q);
  if (reason === 'lost') q.entity.dead = true;
  if (reason === 'retreated') q.entity.retreated = true;
  if (reason === 'autoresolved') q.book.boarding.void = true;
  if (reason === 'captured') q.entity.player.team.id = 1;
  result(q, reason === 'loser' ? 'defender' : 'attacker', !['lost', 'removed'].includes(reason));
  assert(['missed', 'lost'].includes(q.g.recovery.state));
  assert(!refitQuote(q.g));
}
for (const release of [false, true]) {
  const q = mission(),
    { g, f, p, wallet } = q;
  secured(q);
  result(q);
  assert.equal(g.recovery.state, 'tow');
  assert(!refitQuote(g));
  f.planet = 2;
  const quote = refitQuote(g);
  assert.equal(quote.price, 1100);
  wallet.credits = 1099;
  assert(!settlePrize(g, quote));
  wallet.credits = 5000;
  p.restricted = true;
  assert(!settlePrize(g, quote));
  p.restricted = false;
  p.spaceLevel = 0;
  assert(!refitQuote(g));
  p.spaceLevel = 1;
  p.stationOwner = 'Empire';
  assert(!refitQuote(g));
  delete p.stationOwner;
  assert(!settlePrize(g, { ...quote, price: 1 }));
  assert(!settlePrize(g, { ...quote, id: 'sister' }));
  const labels = recoveryRows(
    g,
    { kind: 'refit', q: quote },
    () => {},
    () => {}
  );
  assert(labels.some(r => r.text === 'Cancel'));
  assert(settlePrize(g, quote, release));
  assert(!settlePrize(g, quote, release));
  assert.equal(wallet.credits, release ? 5000 : 3900);
  assert.equal(g.fleets.flatMap(f => f.units).filter(u => u.type === prize).length, release ? 0 : 1);
  assert.equal(f.units.length, 2);
  assert(!q.u.salvageId);
  restoreRecovery(g, JSON.parse(JSON.stringify(g.recovery)));
  assert(!settlePrize(g, quote));
}
{
  const q = mission();
  secured(q);
  result(q);
  q.f.units = [q.a];
  assert(checkRecovery(q.g));
  assert.equal(q.g.recovery.state, 'lost');
}
{
  const q = mission(),
    book = q.book,
    card = (book.boarder = { type: board, gid: '0:1', salvageId: q.u.salvageId });
  book.waiting = [card];
  book.absent = [];
  book.placeVessel = () => {};
  const p = { reserveBook: book, reinforcements: [board, board], reserveTickets: ['0:1', '0:0'] };
  assert(reserveCards(p).some(c => c.detail === 'Recovery boarding crew'));
  assert.equal(reserveSlot(p, board, null), 1);
  assert.equal(reserveSlot(p, board, card.salvageId), 0);
  takeReserve(p, 0)(q.entity);
  assert.equal(reserveSlot(p, board, card.salvageId), -1);
  stepBoarding(q.cb, book);
  assert.equal(book.boarding.ticks, 1);
}
console.log(
  'PASS: stock-only opt-in; exact boarding craft including reserve, interrupted hold and reload; no prize on loss, retreat or auto-resolve; tow loss, yard/quote revalidation, release and one paid refit.'
);
