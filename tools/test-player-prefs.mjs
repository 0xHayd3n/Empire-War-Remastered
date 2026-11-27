import assert from 'node:assert/strict';
import { applyPreferences, preferenceChanges, preferenceSnapshot } from '../public/js/playerprefs.js';
function store(seed) {
  const data = new Map(Object.entries(seed));
  return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
}
const from = store({'swr-keys':'{"PAUSE":["KeyU"]}', 'swr-instant-setup':'{"players":["stock"],"budget":2000}', 'swr.mpname':'profile A'});
const before = preferenceSnapshot(from,{'swr-gfx':{shadows:true,bloom:true,battleRealism:'custom',level:2}});
from.setItem('swr-gfx','{"shadows":false,"bloom":true,"battleRealism":"on","level":-1}');
from.setItem('swr-subtitles','0'); from.setItem('swr-instant-setup','{"players":["another"],"budget":3000}');
from.removeItem('swr-keys'); from.setItem('swr.mpname','private');
const patch = preferenceChanges(before,preferenceSnapshot(from));
assert.deepEqual({...patch},{'swr-gfx/shadows':'false','swr-keys/PAUSE':null,'swr-instant-setup/budget':'3000','swr-subtitles':'0'});
const to=store({'swr.mpname':'profile B','swr-gfx':'{"shadows":true,"bloom":false,"battleRealism":"off","level":1}',
  'swr-keys':'{"PAUSE":["KeyJ"],"MOVE":["KeyV"]}','swr-instant-setup':'{"players":["mod"],"budget":1000}'});
applyPreferences(to,{...patch,'swr.mpname':'bogus','swr-gfx/battleRealism':'"on"','swr-instant-setup/players':'["bogus"]','swr-keys/__proto__':'["x"]'});
assert.deepEqual(JSON.parse(to.getItem('swr-gfx')),{shadows:false,bloom:false,battleRealism:'off',level:-1});
assert.deepEqual(JSON.parse(to.getItem('swr-instant-setup')),{players:['mod'],budget:3000});
assert.deepEqual(JSON.parse(to.getItem('swr-keys')),{MOVE:['KeyV']});
assert.equal(to.getItem('swr-subtitles'),'0'); assert.equal(to.getItem('swr.mpname'),'profile B');
console.log('Portable preferences: field-level merge, false, reset binding, untouched settings, local-only records passed');
