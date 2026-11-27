import assert from 'node:assert/strict';
import { fleetKey, readCards, readPresets, planCard, savePreset, saveCard, removeCard } from '../public/js/game/fleetpresets.js';
const data = new Map();
globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
const empty = { edition: 'foc', mods: [] },
  mod = (workshop, packRevision) => ({ workshop, packRevision, version: '2' });
const a = fleetKey({ ...empty, mods: [mod('11', 'abc')] }, '11:abc');
assert.equal(a, 'swr-fleet-presets-v1:["foc",["11","2","abc"]]');
assert.notEqual(a, fleetKey({ ...empty, mods: [mod('12', 'abc')] }, '12:abc'));
assert.notEqual(fleetKey(empty, '11:abc'), fleetKey(empty, '11:def'));
assert.notEqual(fleetKey(empty, '11:abc'), fleetKey(empty, '12:abc'));
assert.notEqual(fleetKey(empty, '11:abc'), fleetKey(empty));
assert.notEqual(
  fleetKey({ ...empty, mods: [mod('11', 'a'), mod('12', 'b')] }),
  fleetKey({ ...empty, mods: [mod('12', 'b'), mod('11', 'a')] })
);
const fleet = { id: 'v1', name: 'Patrol', faction: 'Red', units: ['A', 'B'] },
  roster = [
    { name: 'A', cost: 100 },
    { name: 'B', cost: 200, hero: true }
  ];
const c = { lead: 'A', faction: 'Red', copies: 2, support: 'B', wing: 1 };
localStorage.setItem(a, JSON.stringify([fleet]));
saveCard(a, c, 'Red', roster);
assert.deepEqual(readCards(a), [c]);
assert.deepEqual(readPresets(a), [fleet]);
const base = ['A'];
assert.deepEqual(planCard(c, 'Red', roster, base, 500), { units: ['A', 'A', 'B'], cost: 500 });
assert.deepEqual(base, ['A']);
for (const plan of [
  planCard(c, 'Red', roster, base, 499),
  planCard(c, 'Red', roster, ['B']),
  planCard(c, 'Blue', roster),
  planCard(c, 'Red', roster.slice(0, 1)),
  planCard({ ...c, copies: 0 }, 'Red', roster),
  planCard({ ...c, copies: 1.5 }, 'Red', roster),
  planCard({ ...c, wing: -3 }, 'Red', roster),
  planCard({ ...c, wing: 2 }, 'Red', roster),
  planCard({ ...c, support: 'A' }, 'Red', roster),
  planCard({ ...c, copies: 256 }, 'Red', roster),
  planCard(c, 'Red', roster, Array(254).fill('A'))
])
  assert(plan.error);
assert.throws(() => saveCard(a, c, 'Blue', roster));
assert.deepEqual(readCards(a), [c]);
const solo = { ...c, copies: 3, support: '', wing: 0 };
saveCard(a, solo, 'Red', roster);
assert.deepEqual(readCards(a), [solo]);
saveCard(a, { ...c, faction: 'Blue' }, 'Blue', roster);
removeCard(a, c);
assert.deepEqual(readCards(a), [{ ...c, faction: 'Blue' }]);
assert.deepEqual(readCards(fleetKey(empty)), []);
assert.deepEqual(readPresets(fleetKey(empty)), []);
localStorage.setItem(a, 'bad old store');
assert.deepEqual(readPresets(a), []);
assert.throws(() => savePreset(a, fleet));
assert.equal(localStorage.getItem(a), 'bad old store');
console.log(
  'PASS: prior v1 shape and key, pack/faction isolation, ordered layers, missing mounted identity fallback, exact card append, budget/hero/count/roster rejection, and non-destructive persistence.'
);
