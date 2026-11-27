import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { playlistKey, rankedDistance } from '../public/js/game/playlistrelay.js';
import { playlistBuild } from './playlist-build.mjs';

assert(rankedDistance('ranked', 1000, '1016') < rankedDistance('ranked', 1000, '1064'));
assert(rankedDistance('ranked', 1000, 'NaN') > rankedDistance('ranked', 1000, '3000'));
assert.equal(rankedDistance('social', undefined, '1128'), 0);
const mods = [
  { workshop: '101', name: 'Flagship', version: '1.0' },
  { workshop: '202', name: 'Escort', files: 10 }
];
const base = {
  type: 'space',
  variant: 'orbital-foundry',
  version: 'a1b2c3',
  data: 'game-objects',
  content: { edition: 'foc', mods },
  pack: '123:full-revision',
  maps: [['map-a'], ['map-b']],
  factions: ['Empire', 'Rebel']
};
const key = await playlistKey(base);
assert.match(key, /^[0-9a-f]{64}$/);
for (const change of [
  { type: 'land' },
  { variant: 'last-flight' },
  { ladder: 'ranked' },
  { version: 'other-build' },
  { data: 'other-game-objects' },
  { pack: '123:other-revision' },
  { content: { edition: 'eaw', mods } },
  { content: { edition: 'foc', mods: [...mods].reverse() } },
  { content: { edition: 'foc', mods: mods.slice(1) } },
  { content: { edition: 'foc', mods: [{ ...mods[0], version: '2' }, mods[1]] } },
  { content: { edition: 'foc', mods: [mods[0], { ...mods[1], files: 11 }] } },
  { maps: [['map-b']] },
  { factions: ['Empire'] }
])
  assert.notEqual(await playlistKey({ ...base, ...change }), key, JSON.stringify(change));
assert.equal(await playlistKey({ ...base, content: { edition: 'foc', mods: [{ ...mods[0], name: 'Localized title' }, mods[1]] } }), key);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'play-build-'));
try {
  await mkdir(path.join(tmp, 'game'));
  await writeFile(path.join(tmp, 'main.js'), 'export const revision = 1;');
  const first = await playlistBuild(tmp);
  await writeFile(path.join(tmp, 'main.js'), 'export const revision = 2;');
  const second = await playlistBuild(tmp);
  assert.notEqual(first, second);
  await writeFile(path.join(tmp, 'game', 'engine.wasm'), new Uint8Array([0, 97, 115, 109]));
  assert.notEqual(second, await playlistBuild(tmp));
} finally {
  await rm(tmp, { recursive: true, force: true });
}
console.log('PASS: exact playlist/build/content/edition, ordered mods, revisions, maps, factions and local JS/WASM build checks.');
