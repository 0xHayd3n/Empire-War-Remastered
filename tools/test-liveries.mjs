import assert from 'node:assert/strict';
import {
  sanitizeLivery,
  factionLiveries,
  activeLivery,
  saveLivery,
  deleteLivery,
  equipStock,
  setLiveryProfile
} from '../public/js/game/liveries.js';
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const paint = { colors: ['#ffaa00', '#dd3300', '#123456', '#000000'], pattern: 'chevron' };
assert.equal(activeLivery('Empire'), null);
for (const v of [
  undefined,
  false,
  'red',
  {},
  { ...paint, colors: new Array(4) },
  { ...paint, colors: [...paint.colors, '#fefefe'] },
  { ...paint, pattern: '../custom' }
])
  assert.equal(sanitizeLivery(v), null);
const a = saveLivery('Empire', '', '  501st  ', { ...paint, unit: 'Stormtrooper' });
assert.deepEqual(activeLivery('EMPIRE'), paint);
assert.deepEqual(Object.keys(factionLiveries('empire').presets[0]).sort(), ['colors', 'id', 'name', 'pattern']);
assert.equal(activeLivery('rebel'), null);
assert.throws(() => saveLivery('Empire', '', '501ST', paint));
assert.equal(saveLivery('Empire', a, '501st', { ...paint, pattern: 'split' }), a);
equipStock('Empire');
assert.equal(activeLivery('Empire'), null);
assert.equal(factionLiveries('Empire').presets.length, 1);
const b = saveLivery('Empire', '', 'Patrol', paint);
deleteLivery('Empire', a);
assert.equal(factionLiveries('Empire').active, b);
setLiveryProfile({ edition: 'foc', mods: [{ name: 'Test mod' }] });
assert.equal(activeLivery('Empire'), null);
const c = saveLivery('Empire', '', 'Mod corps', paint);
deleteLivery('Empire', c);
assert.equal(activeLivery('Empire'), null);
const broken = [...store.keys()].at(-1);
store.set(broken, 'broken JSON');
assert.equal(activeLivery('Empire'), null);
assert.throws(() => saveLivery('Empire', '', 'Test', paint));
assert.equal(store.get(broken), 'broken JSON');
console.log('Liveries: validation, faction/profile isolation, stock, create/update/delete, damaged storage OK');
