import assert from 'node:assert/strict';
import { parseWorkshopOrder, workshopLayers } from '../public/js/workshoporder.js';

const sub = { workshop: '42' }, base = { handle: { name: '9007199254740993' } }, extra = { workshopFolder: '7', on: true };
const mods = [sub, extra, base];
const ids = parseWorkshopOrder(' steammod=42\nSTEAMMOD=9007199254740993 ');
assert.deepEqual(ids, ['42', '9007199254740993']);
assert.deepEqual(workshopLayers(ids, mods), [
  { mod: base, order: 0, on: true },
  { mod: sub, order: 1, on: true },
  { mod: extra, order: 2, on: false }
]);
assert.equal(workshopLayers(['7'], mods)[0].mod, extra);
for (const text of ['', 'steammod=42 STEAMMOD=42', 'SWR_MOD=42', 'STEAMMOD=0', 'STEAMMOD=18446744073709551616', 'STEAMMOD=../42', 'STEAMMOD=42 --run']) {
  assert.throws(() => parseWorkshopOrder(text));
}
assert.throws(() => workshopLayers(['14'], [...mods, { name: '14' }]), /Not in the mod list: 14/);
assert.throws(() => workshopLayers(ids, [...mods, { workshopFolder: '42' }]), /Several mods match Workshop item 42/);
console.log('Workshop load options: exact IDs, precedence, exclusions and invalid stacks passed');
