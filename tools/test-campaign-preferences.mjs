import assert from 'node:assert/strict';
import {
  campaignValues,
  eligibleCampaignPreferences,
  setCampaignPreference,
  campaignPreferences
} from '../public/js/game/campaignpreferences.js';
const profiles = [
  [1, false, 0.33, 40000, 7],
  [0.8, true, 0.75, 100000, 160]
].map(([time, pay, loss, treasury, politics], i) => ({
  name: `Pack ${i}`,
  defaults: { treasury, politics },
  donor: { values: { treasury, politics } },
  buildTime: { declared: true, native: time },
  payment: { declared: true, native: pay },
  combat: { transport: { declared: true, native: loss, allowed: ['supported'] } }
}));
const values = new Map();
globalThis.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
assert.equal(campaignValues(profiles, 'payAsYouGo').size, 2);
for (const [k, v] of Object.entries({ treasury: 40000, politics: 7, buildTime: 1, payAsYouGo: false, transportLosses: 0.33 }))
  setCampaignPreference(k, v);
const prefs = campaignPreferences(),
  choose = (sources, target, id, pref = prefs, scripted = false) =>
    eligibleCampaignPreferences(sources, target, { scripted }, { id }, pref);
assert.equal(prefs.payAsYouGo, false);
assert.deepEqual(choose(profiles, profiles[1], 'supported'), prefs);
assert.deepEqual(choose(profiles, profiles[0], 'supported'), {}); // same as native
assert.deepEqual(choose([profiles[1]], profiles[1], 'supported'), {}); // source no longer installed
assert.deepEqual(choose(profiles, profiles[1], 'supported', prefs, true), {}); // script selects the destination
assert.equal(choose(profiles, profiles[1], 'forbidden').transportLosses, undefined);
setCampaignPreference('payAsYouGo', undefined);
assert(!Object.hasOwn(campaignPreferences(), 'payAsYouGo'));
const { openingDefaults, setOpeningDefault } = await import('../public/js/game/openingpreferences.js');
const { appearances } = await import('../public/js/game/appearancechoices.js');
const d = appearances.clonePaint,
  profile = { id: d.id, revision: d.revision },
  row = { id: d.row, faction: 'Empire' },
  target = { id: d.target };
for (const n of [0, 3]) {
  setOpeningDefault(profile, row, target, 'clonePaint', n);
  assert.deepEqual(openingDefaults(profile, row, target), { clonePaint: n });
}
assert.deepEqual(openingDefaults({ ...profile, revision: 'another' }, row, target), {});
assert.deepEqual(openingDefaults(profile, { ...row, scripted: true }, target), {});
assert.deepEqual(openingDefaults(profile, { ...row, faction: 'Rebel' }, target), {});
setOpeningDefault(profile, row, target, 'clonePaint', -4);
assert.equal(openingDefaults(profile, row, target).clonePaint, 3);
setOpeningDefault(profile, row, target, 'clonePaint', undefined);
assert.deepEqual(openingDefaults(profile, row, target), {});
console.log('PASS: sourced rules, exact opening and faction, revision change, clear, and scripted/forbidden starts');
