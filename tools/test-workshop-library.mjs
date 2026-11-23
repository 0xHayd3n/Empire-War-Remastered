import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLibrary } from './workshop-library.mjs';
import { bindMedia } from './workshop-media.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-workshop-'));
try {
  function put(rel, bytes = '') {
    const file = path.join(temp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  const items = 'steamapps/workshop/content/32470';
  for (const n of ['10', '20', '30', '40']) put(`${items}/${n}/Data/test.txt`);
  put(`${items}/50/description.txt`); // installed notice, not a playable mod
  put(`${items}/10/modinfo.json`, JSON.stringify({ name: 'Base', icon: '10/base.ico' }));
  put(`${items}/10/base.ico`);
  for (const d of ['GameData', 'corruption']) put(`game/${d}/Data/megafiles.xml`);
  const profile = { displayName: 'My loadout', variant: 'forces-of-corruption', isDraft: false, primaryItemId: '10',
    itemOrder: ['20', '30', '10'], requiredItemIds: ['20'], optionalItemIds: ['30'], disabledItemIds: ['30'], incompatibilities: [] };
  const save = () => put('profiles/p.json', JSON.stringify({ schemaVersion: 1, profile }));
  const read = () => readLibrary([temp], path.join(temp, 'profiles'), path.join(temp, 'game'));
  save();
  const a = read();
  assert.equal(a.items.size, 4);
  assert.equal(a.cards[0].name, 'My loadout');
  assert.deepEqual(a.cards[0].order, ['20', '10']);
  assert.deepEqual(a.cards[0].disabled, ['30']);
  assert.equal(a.cards[0].problem, undefined);
  assert.equal(a.cards[1].primary, '40');
  assert.equal(path.basename(a.items.get('10').art), 'base.ico');
  assert.equal(a.items.get('40').art, undefined);
  put('art/10.png', 'local preview');
  put('art/10-wordmark.png', 'local wordmark');
  put('ModCollectionLauncher/music/10.mp3', 'local theme');
  const media = bindMedia(a, {local: temp, art: path.join(temp, 'art')});
  assert.equal(media.items.get('10').backdrop[1], '10.png');
  assert.equal(media.items.get('10').theme[1], '10.mp3');
  assert.equal(media.items.get('10').wordmark[1], '10-wordmark.png');
  assert.equal(media.items.get('20').wordmark, undefined);
  assert.equal(media.items.get('20').theme, undefined);
  assert.equal(media.items.get('20').backdrop, undefined);
  fs.rmSync(path.join(temp, items, '20'), { recursive: true });
  assert.equal(read().cards[0].problem, 'Missing item 20');
  profile.isDraft = true;
  save();
  assert.equal(read().skipped, 1);
  console.log('Workshop discovery: installed data, saved order, disabled and missing members, icons and fallback passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
