import assert from 'node:assert/strict';
import { instantForces, packArmy, unpackArmy } from '../public/js/game/instantforces.js';
import { COMBAT_KIT, guestRefs } from '../public/js/game/tacticalroster.js';
import { db, ObjType, guestObjects } from '../public/js/gamedata.js';
import { prepareDetachments } from '../public/js/game/skirmishdetachments.js';

const faction = 'Rebel',
  revision = 'a'.repeat(64);
const profile = (id, revision, space) => ({
  id,
  revision,
  name: id,
  skirmishFactions: [faction],
  availability: { Rebel: { land: true, space, nativespace: true, nativeland: true } }
});
const sources = [profile('stock', 'stock', true), profile('123', revision, true), profile('124', revision, false)];
const kits = instantForces(sources, 'stock', [faction]);
const ref = { profile: '123', revision, faction },
  value = 'UXF_123__Rebel';
assert.equal(kits.resolve('land', ref), value);
assert.equal(kits.resolve('space', { ...ref, profile: '124' }), null);
assert.equal(kits.resolve('space', { ...ref, revision: 'b'.repeat(64) }), null);
assert.equal(kits.resolve('space', { profile: 'stock', revision: 'stock', faction }), 'Rebel');
assert.deepEqual(guestRefs([ref, ref]), [ref]);
assert.throws(() => guestRefs([ref, { ...ref, revision: 'x' }]));
let schema = COMBAT_KIT - 1,
  calls = 0;
globalThis.fetch = async url => {
  calls++;
  const domain = new URL(url, 'http://localhost').searchParams.get('domain');
  return Response.json({
    id: ref.profile,
    revision,
    faction,
    domain,
    combatSchema: schema,
    roster: [
      { name: 'Wing', members: ['Fighter'], cost: 60 },
      { name: 'Cruiser', body: 'Cruiser', members: [], cost: 90 }
    ],
    defs: {
      Fighter: { tag: 'SpaceUnit', props: { ship_class: 'Fighter' } },
      Cruiser: { tag: 'SpaceUnit', props: { ship_class: 'Corvette' } },
      Retired: { tag: 'SpaceUnit', props: {} }
    },
    restoreBodies: ['Retired'],
    hp: {}
  });
};
await assert.rejects(kits.load('space', value), /older combat roster/);
schema = COMBAT_KIT;
await Promise.all([kits.load('space', value), kits.load('space', value)]);
await kits.load('space', 'Rebel');
assert.equal(calls, 2);
assert.deepEqual(
  kits.roster(value).map(x => [x.name, x.cost, x.cls]),
  [
    [value + '__GROUP__Wing', 60, 0],
    [value + '__Cruiser', 90, 3]
  ]
);
await kits.load('land', value);
assert.deepEqual(kits.ground(value), [value + '__GROUP__Wing', value + '__GROUP__Cruiser']);
assert.deepEqual(
  kits.groundRoster(value).map(r => r.name),
  kits.ground(value)
);
assert.deepEqual(kits.ground(value, value + '__GROUP__Cruiser'), [value + '__GROUP__Cruiser']);
assert.deepEqual(kits.ground(value, 'UXF_124__Rebel__GROUP__Cruiser'), []);
assert.deepEqual(kits.ground('Rebel', value + '__GROUP__Cruiser'), []);
assert.deepEqual(
  Object.values(guestObjects).map(m => m.size),
  [0, 0, 0],
  'preview must not install objects'
);
// Restore previously saved scoped ships, without allowing them in a fresh draft.
const home = new ObjType('Faction', 'Empire');
home.props.set('is_playable', ['Yes']);
db.factions.set('EMPIRE', home);
const old = value + '__Retired';
const saved = {
  mode: 'space',
  teamFactions: [value, 'Empire'],
  players: [{ team: 0 }, { team: 1 }],
  skirmishRosters: [ref],
  instant: { armies: [[old], ['Native']] }
};
await assert.rejects(prepareDetachments(saved), /not provided/);
await prepareDetachments({ ...saved, restore: {} });
assert(db.type(old));
assert(!db.faction(value).detachment.roster.includes(old));
await assert.rejects(prepareDetachments(saved), /not provided/); // even after installation was cached
const army = ['ship', 'ship', 'wing', 'ship'];
assert.deepEqual(unpackArmy(packArmy(army)), army);
assert.throws(() =>
  unpackArmy([
    ['ship', 4000],
    ['wing', 1]
  ])
);
console.log(
  'Instant guest choices: source identity, domain, revision, stale schema, retry, cache, prices, classes and non-installing preview OK'
);
