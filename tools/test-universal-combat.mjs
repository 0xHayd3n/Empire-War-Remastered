import assert from 'node:assert/strict';
import { ObjType, db } from '../public/js/gamedata.js';
import { spaceRosters, resolveTactical } from '../public/js/game/tacticalautoresolve.js';
import { applyTransportLosses } from '../public/js/game/galacticautoresolve.js';
import { combatCatalog } from './universal-combat-catalog.mjs';
import { beginUniversalRules, rescueCampaign, restoreUniversalRules } from '../public/js/game/universalrules.js';
import { rescueDeath, prisonChanged, checkPrison, heldForRescue } from '../public/js/game/universalrescue.js';
import { launchPlan } from './universal-atlas.mjs';
const type = (name, props = {}) => {
  const t = new ObjType('SpaceUnit', name);
  for (const [k, v] of Object.entries(props)) t.props.set(k.toLowerCase(), [String(v)]);
  db.types.set(name.toUpperCase(), t);
  return t;
};
db.constants = type('Constants', { Default_Hero_Respawn_Time: 10 });
const a = 'Rebel',
  b = 'Empire';
db.factions.set('REBEL', type(a, { Is_Playable: true, Enemies: b }));
db.factions.set('EMPIRE', type(b, { Is_Playable: true, Enemies: a }));
const allowed = type('x'),
  locked = type('locked', { Is_Autoresolve_Allowed: false }),
  campaigns = new Map([
    ['X', allowed],
    ['LOCKED', locked]
  ]);
const terms = (raw, own = true) =>
  combatCatalog(
    { resolve: () => 'K', read: () => Buffer.from(`<Constants>${raw}</Constants>`) },
    { entries: new Map(own ? [['K', {}]] : []) },
    campaigns
  ).transport;
const tag = n => `<AutoResolveTransportLosses>${n}</AutoResolveTransportLosses>`;
assert.deepEqual(terms(tag('.333333') + tag('.75')), { native: 0.75, declared: true, allowed: ['x'] });
assert.equal(terms(tag('0'), false).declared, false);
assert.equal(terms('').declared, false);
assert.equal(terms(tag('bogus')), null);
let atlas = {
    profiles: [
      {
        id: 'stock',
        combat: { transport: terms(tag('.333333')) },
        rows: [{ id: 'r', faction: a, variants: [{ id: 'x' }, { id: 'locked' }] }]
      },
      { id: 'source', combat: { transport: terms(tag('0')) } }
    ]
  },
  q = { profile: 'stock', row: 'r', target: 'x', difficulty: 'easy' };
assert.deepEqual(launchPlan(atlas, q).setup.universalOptions, {});
assert.deepEqual(launchPlan(atlas, { ...q, transportLosses: 0 }).setup.universalOptions, { transportLosses: 0 });
assert.deepEqual(restoreUniversalRules({ transportLosses: 0 }), { transportLosses: 0 });
for (const bad of [
  { transportLosses: '.333333' },
  { transportLosses: null },
  { transportLosses: 1 },
  { transportLosses: 0, target: 'locked' },
  { heroRescue: true }
])
  assert.throws(() => launchPlan(atlas, { ...q, ...bad }));
const han = type('Han_Solo_Team', { Is_Named_Hero: true }),
  regular = type('Troopers'),
  hull = type('Shuttle', { AI_Combat_Power: 1 }),
  heavy = type('Heavy', { AI_Combat_Power: 200 });
const teams = [{ id: 0 }, { id: 1 }],
  players = teams.map((team, i) => ({ id: i, team, factionName: i ? a : b, reinforcements: i ? [hull, hull] : [] }));
teams.forEach((t, i) => (t.players = [players[i]]));
const ship = (type, i) => ({ type, player: players[i] }),
  called = ship(hull, 1),
  field = ship(hull, 1),
  escort = ship(heavy, 0),
  world = { teams, units: [escort, field, called] };
const side = (team, goods) => ({ team, units: goods.map(([gid, passenger]) => ({ gid, passenger })) });
const campaign = {
  attacker: side(0, [['strong']]),
  defender: side(1, [
    ['field', regular.name],
    ['r1', regular.name],
    ['r2', han.name],
    ['called', regular.name]
  ]),
  autoResolve: { allowed: true, transportOwner: a, transportLosses: 0.75 }
};
const book = {
  entity: new Map([
    ['field', field],
    ['strong', escort]
  ]),
  waiting: ['r1', 'r2', 'called'].map(gid => ({ gid, type: hull, team: 1 })),
  called: new Map([[1, [called]]])
};
const rs = spaceRosters(world, campaign, book);
assert.equal(rs[1].filter(r => r.passenger).length, 4);
assert.equal(rs[1].filter(r => r.passenger.hero)[0].entity.reserveGid, 'r2');
const resolve = c => resolveTactical(rs, c, { random: () => 0 });
const native = resolve({ ...campaign, autoResolve: { allowed: true } }),
  borrowed = resolve(campaign);
assert.equal(native.winner, borrowed.winner);
assert.equal(borrowed.winner, 0);
assert.equal(rs[1].filter(r => !borrowed.doomed.includes(r.entity)).length, 1);
assert(!borrowed.doomed.includes(rs[1].find(r => r.passenger.hero).entity));
const emptyResult = () => ({ winner: 0, sides: [{ alive: new Set([rs[0][0]]) }, { alive: new Set() }] });
for (const [rosters, owner] of [
  [rs, b],
  [[rs[0], [rs[1][0]]], a]
]) {
  const r = emptyResult();
  applyTransportLosses(r, rosters, owner, 0);
  assert.equal(r.sides[1].alive.size, 0);
  assert.equal(r.sides[0].alive.size, 1);
}
assert.deepEqual(resolve({ ...campaign, autoResolve: { ...campaign.autoResolve, allowed: false } }), native);
const worldAt = (name, index, owner) => ({
    name,
    index,
    owner,
    selectable: true,
    type: type(name),
    garrison: [],
    orbitalStructures: [],
    groundStructures: []
  }),
  planets = [worldAt('Home', 0, a), worldAt('Prison', 1, b), worldAt('Conflict', 2, b)];
const g = { campaign: { name: rescueCampaign }, active: a, time: 1, fleets: [], planets, links: [[{ to: 1 }], [{ to: 0 }], []] },
  game = { galaxy: g };
beginUniversalRules(g, { heroRescue: true });
const record = { type: han };
rescueDeath(game, record, planets[2], a, a);
assert.equal(g.universalRules.rescue.state, 'ready');
rescueDeath(game, record, planets[2], a, b);
rescueDeath(game, record, planets[2], a, b);
assert(heldForRescue(g, record, a));
assert.equal(g.universalRules.rescue.prison, 'Prison');
const captive = structuredClone(g.universalRules);
prisonChanged(game, planets[1], b, 'Third', true);
assert.equal(g.universalRules.rescue.state, 'complete');
assert.equal(planets[1].killedHeroes.length, 1);
assert.equal(planets[1].killedHeroes[0].dueFrame, 330, 'Third party does not liberate the hero');
planets[1].killedHeroes = [];
g.universalRules = restoreUniversalRules(captive);
planets[1].restricted = true;
checkPrison(game);
assert.equal(g.universalRules.rescue.state, 'complete');
assert.equal(planets[1].killedHeroes[0].dueFrame, 330);
console.log(
  'PASS: declared values and explicit zero, eligibility, tactical field/called/reserve casualties and hero priority, rescue exclusions and unavailable-prison fallback.'
);
