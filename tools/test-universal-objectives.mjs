import assert from 'node:assert/strict';
import { launchPlan } from './universal-atlas.mjs';
import { canonStart, equalFooting, thrawnRevision } from '../public/js/game/universaleligibility.js';
import { objectiveRows, envoyArrival, envoyUpdate, envoyIntel } from '../public/js/game/universalobjectives.js';
import { restoreUniversalRules } from '../public/js/game/universalrules.js';
const row = id => ({ id, faction: 'Rebel', variants: [{ id, sites: [] }] });
const stock = { id: 'stock', combat: { rescue: true }, rows: [row(equalFooting)] },
  tr = { id: '1125571106', revision: thrawnRevision, rows: [row(canonStart)] },
  atlas = { profiles: [stock, tr] };
const q = (p, x = {}) => ({ profile: p.id, row: p.rows[0].id, target: p.rows[0].id, difficulty: 'hard', ...x });
assert.deepEqual(launchPlan(atlas, q(tr)).setup.universalOptions, {});
assert.deepEqual(launchPlan(atlas, q(tr, { canonUnits: true })).setup.universalOptions, { canonUnits: true });
assert.deepEqual(launchPlan(atlas, q(stock, { envoy: true })).setup.universalOptions, { envoy: true });
for (const x of [
  q(stock, { canonUnits: true }),
  q(tr, { envoy: true }),
  q(stock, { envoy: 1 }),
  q(stock, { envoy: true, heroRescue: true }),
  q(stock, { envoy: true, expedition: true })
])
  assert.throws(() => launchPlan(atlas, x));
tr.revision = 'changed';
assert.throws(() => launchPlan(atlas, q(tr, { canonUnits: true })));
stock.combat.rescue = false;
assert.throws(() => launchPlan(atlas, q(stock, { envoy: true })));
const p = (name, index, owner) => ({ name, index, owner, selectable: true, type: { str: () => '', bool: () => true } });
const g = {
    active: 'Rebel',
    planets: [p('Bespin', 0, 'Rebel'), p('Sullust', 1, 'Empire')],
    visibility: { viewer: 'Rebel', planets: [{ discovered: true }, { discovered: false }] },
    time: 10
  },
  game = { galaxy: g };
g.universalRules = { rescue: { state: 'captive', prison: 'Sullust' }, expedition: { sites: ['Bespin', 'Sullust'], found: ['Bespin'] } };
const rows = objectiveRows(g, () => assert.fail('A stale locate action must not reveal a restricted world'));
assert(!JSON.stringify(rows).includes('Sullust'));
assert(rows.some(r => r.text.includes('1 of 2')));
let locate = rows.find(r => r.activate);
g.planets[0].restricted = true;
locate.activate();
g.planets[0].restricted = false;
g.universalRules = { envoy: { state: 'travel' } };
const arrive = (owner, record) => envoyArrival(game, g.planets[0], owner, [record]),
  envoy = { carries: { name: 'Mon_Mothma_Team' } };
arrive('Rebel', envoy);
assert.equal(g.universalRules.envoy.state, 'travel');
g.visibility.planets[1].discovered = true;
arrive('Empire', envoy);
arrive('Rebel', { type: { name: 'Troopers' } });
assert.equal(g.universalRules.envoy.state, 'travel');
arrive('Rebel', envoy);
assert.equal(g.universalRules.envoy.until, 70);
g.time = 20;
arrive('Rebel', envoy);
assert.equal(g.universalRules.envoy.until, 70);
g.universalRules = restoreUniversalRules(JSON.parse(JSON.stringify(g.universalRules)));
assert(envoyIntel(g, g.planets[1], 'Rebel'));
assert(!envoyIntel(g, g.planets[1], 'Empire'));
assert(!envoyIntel(g, g.planets[0], 'Rebel'));
g.time = 70;
assert(!envoyIntel(g, g.planets[1], 'Rebel'));
envoyUpdate(game);
arrive('Rebel', envoy);
assert.equal(g.universalRules.envoy.state, 'complete');
assert.equal(restoreUniversalRules({ envoy: { state: 'report', until: Infinity } }), null);
console.log('PASS: exact option gates, hidden/restricted objectives, envoy owner and time bounds, saved expiry and no repeat reward.');
