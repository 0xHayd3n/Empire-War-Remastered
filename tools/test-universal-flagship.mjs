import assert from 'node:assert/strict';
import { launchPlan } from './universal-atlas.mjs';
import { equalFooting } from '../public/js/game/universaleligibility.js';
import { enableFlagship, designateFlagship, openVesselBattle, restoreVessels } from '../public/js/game/campaignvessels.js';
import { confirmRepair, repairQuote, flagshipRows } from '../public/js/game/flagshipcommission.js';
import { reserveCounts, reserveSlot } from '../public/js/game/campaignreserve.js';
const p = {
    id: 'stock',
    combat: { rescue: true },
    rows: [{ id: equalFooting, faction: 'Rebel', variants: [{ id: equalFooting, sites: [] }] }]
  },
  atlas = { profiles: [p] },
  q = { profile: 'stock', row: equalFooting, target: equalFooting, difficulty: 'medium' };
assert.deepEqual(launchPlan(atlas, q).setup.universalOptions, {});
assert.deepEqual(launchPlan(atlas, { ...q, flagship: true, envoy: true }).setup.universalOptions, { flagship: true, envoy: true });
for (const bad of [false, 0, 'true', {}]) assert.throws(() => launchPlan(atlas, { ...q, flagship: bad }));
p.rows[0].scripted = true;
assert.throws(() => launchPlan(atlas, { ...q, flagship: true }));
delete p.rows[0].scripted;
p.combat.rescue = false;
assert.throws(() => launchPlan(atlas, { ...q, flagship: true }));
const type = { name: 'Calamari_Cruiser', num: () => 4000, str: () => '', bool: () => false, sub: () => [], list: () => [] },
  p0 = { index: 0, name: 'Bespin', selectable: true, owner: 'Rebel', spaceLevel: 1, station: {}, type },
  planets = [p0, { ...p0, index: 1, name: 'Other' }],
  [a, b] = [{}, {}].map(u => ({ ...u, type })),
  f = { units: [a, b], owner: 'Rebel', planet: 0 },
  wallet = { faction: 'Rebel', credits: 5000 };
const g = {
  campaign: { name: equalFooting },
  active: 'Rebel',
  universalPath: 1,
  visibility: { viewer: 'Rebel', planets: planets.map(() => ({ discovered: true })) },
  fleets: [f],
  players: [wallet],
  planets,
  creditCapOverride: 10000
};
assert.deepEqual(
  flagshipRows(g, null, () => {}),
  []
);
assert(enableFlagship(g));
assert.equal(openVesselBattle(g, 0, ['Rebel', 'Empire']), null);
assert(!a.vessel && !b.vessel);
let prompt = null;
const rows = () => flagshipRows(g, prompt, p => (prompt = p));
const activate = s => {
  const r = rows().find(r => r.text.startsWith(s) && r.activate);
  assert(r, s);
  r.activate();
};
activate('Designate: Bespin · Fleet 1 · Cruiser 2');
activate('Cancel');
assert(!b.vessel);
activate('Designate: Bespin · Fleet 1 · Cruiser 2');
activate('Confirm designation');
assert(!a.vessel);
assert.equal(b.vessel.id, g.vessels.flagship);
assert(!designateFlagship(g, f, a));
const reg = { ...g.vessels };
restoreVessels(g, reg);
assert.equal(g.vessels.flagship, b.vessel.id);
b.vessel.condition = {
  hull: 1,
  parts: [
    ['engines', 0],
    ['weapons', 1]
  ]
};
let quote = repairQuote(g);
assert.equal(quote.price, 1000);
assert(!confirmRepair(g, { ...quote, price: 1 }));
wallet.credits = 999;
assert(!confirmRepair(g, quote));
assert.equal(wallet.credits, 999);
wallet.credits = 5000;
f.planet = 1;
assert(!confirmRepair(g, quote));
f.planet = 0;
p0.stationOwner = 'Empire';
assert(!confirmRepair(g, quote));
delete p0.stationOwner;
g.visibility.planets[0].discovered = false;
assert(!JSON.stringify(rows()).includes('Bespin'));
assert(!confirmRepair(g, quote));
g.visibility.planets[0].discovered = true;
activate('Review full repair');
activate('Cancel');
assert.equal(wallet.credits, 5000);
activate('Review full repair');
activate('Confirm repair');
assert.equal(wallet.credits, 4000);
assert(!confirmRepair(g, quote));
assert(!b.vessel.condition);
const flag = { gid: '3:1', type, vessel: b.vessel };
for (const at of [0, 1]) {
  const player = {
    reserveBook: { flagship: flag },
    reinforcements: [type, type, type],
    reserveTickets: at ? [null, flag.gid] : [flag.gid, null]
  };
  assert.equal(reserveCounts(player).get(flag), 1);
  assert.equal(reserveCounts(player).get(type), 2);
  assert.equal(reserveSlot(player, type, b.vessel.id), at);
  assert.equal(reserveSlot(player, type), 1 - at);
  assert.equal(reserveSlot(player, type, 'stale'), -1);
  player.reserveTickets.splice(at, 1);
  player.reinforcements.splice(at, 1);
  assert.equal(reserveSlot(player, type, b.vessel.id), -1);
}
f.units = [a];
assert(!designateFlagship(g, f, a));
assert(rows().some(r => r.text.includes('Commission closed')));
assert(!repairQuote(g));
console.log(
  'PASS: exact flagship opt-in, designation/cancel/loss, distinct reserve slots and stale commands, revalidated yard/price, affordability and exactly-once repair.'
);
