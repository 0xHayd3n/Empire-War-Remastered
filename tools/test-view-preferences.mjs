import assert from 'node:assert/strict';
const storage = new Map([
  ['swr-player-view-v1', JSON.stringify({ pan: 99, wheel: null, captionInk: 'red', musicResume: 0, replayRate: 64, radarGrid: false })]
]);
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
const {
  viewOptions: v,
  setViewOption: set,
  showUnitVitals,
  landZoomStep,
  tacticalWheel
} = await import('../public/js/game/viewpreferences.js');
assert.deepEqual([v.pan, v.wheel, v.captionInk, v.musicResume, v.replayRate, v.radarGrid], [1, 1, 'white', true, 16, false]);
// The land and space defaults differ, even when the subject is neither selected nor damaged.
assert.deepEqual([showUnitVitals(false, false, false), showUnitVitals(true, false, false)], [false, true]);
for (const [mode, expected] of [
  ['damaged', [true, true, false]],
  ['focus', [true, false, false]],
  ['off', [false, false, false]]
]) {
  set('barMode', mode);
  assert.deepEqual([showUnitVitals(false, true, false), showUnitVitals(true, false, true), showUnitVitals(true, false, false)], expected);
}
set('invertWheel', true);
set('wheel', 2);
assert.equal(tacticalWheel(100), -200);
assert.equal(landZoomStep(1), 0.89 ** 2);
set('wheel', 0);
assert.equal(v.wheel, 2);
assert.equal(JSON.parse(storage.get('swr-player-view-v1')).invertWheel, true);
const { eligibleConditions, saveCondition, conditionPrefs, installedConditions } = await import('../public/js/game/startingconditions.js');
const p = { facts: { Rebel: { adj: 1 } } },
  r = {
    faction: 'Rebel',
    slots: ['credits', 'tech', 'maxTech', 'autoResolve'],
    limits: { custom: true, minTech: 1, maxTech: 5, minCredits: 0, maxCredits: 10000 },
    base: { credits: 12000, tech: 1, maxTech: 4, autoResolve: 2 },
    defaultFtguYear: '4 ABY'
  };
for (const [k, n] of Object.entries({ credits: 8000, tech: 3, maxTech: 4, autoResolve: 0 })) saveCondition(k, n);
const apply = (row = r, profile = p, year = '') => eligibleConditions(profile, row, { year }, conditionPrefs());
assert.deepEqual(apply(), { credits: 8000, tech: 2, maxTech: 3, autoResolve: 0 });
assert.equal(apply(r, p, '4 ABY').credits, undefined);
assert.deepEqual(apply({ ...r, scripted: true }), {});
assert.deepEqual(apply({ ...r, limits: { ...r.limits, custom: false } }), {});
assert.equal(apply(r, { ...p, yearLegend: '1. - Era I' }).tech, undefined);
saveCondition('maxTech', 1);
saveCondition('credits', 8500);
assert.deepEqual(apply(), { autoResolve: 0 });
assert.equal(installedConditions([{ ...p, rows: [r] }], 'credits').length, 11);
saveCondition('tech', undefined);
assert.equal(conditionPrefs().tech, undefined);
console.log('PASS: view defaults, invalid storage, wheel direction, and campaign slot/date/tech guards.');
