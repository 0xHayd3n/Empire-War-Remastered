import assert from 'node:assert/strict';
import { mountedMapHeaders } from './mounted-map-headers.mjs';
import { mountedGalacticSources } from './mounted-galactic-sources.mjs';
import { GalacticSources, unpackGalacticSources } from '../public/js/game/galacticsources.js';
import { parseMapHeader } from '../public/js/ted.js';
const raw = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const map = Buffer.alloc(5000, 42);
map.writeUInt32LE(0, 0);
map.writeUInt32LE(12, 4);
map[8] = 1;
map[9] = 4;
map.writeInt32LE(2, 10);
map[14] = 2;
map[15] = 4;
map.writeInt32LE(4, 16);
const files = new Map([
  ['DATA\\ART\\MAPS\\X.TED', map],
  ['DATA\\CUSTOMMAPS\\X.TED', Buffer.alloc(3)],
  ['DATA\\ART\\MAPS\\SUB\\Y.TED', map],
  ['DATA\\SCRIPTS\\GAME\\GAMESCORING.LUA', Buffer.from('require("helper")')],
  ['DATA\\SCRIPTS\\LIBRARY\\HELPER.LUA', Buffer.from('require("GameScoring") -- caf\xe9', 'latin1')],
  ['DATA\\SCRIPTS\\OTHER\\HELPER.LUA', Buffer.from('not the default alias')]
]);
const assets = {
  index: new Map([...files].map(([k, v]) => [k, { size: v.length }])),
  read: k => files.get(k),
  readPart: (k, at, n) => files.get(k).subarray(at, at + n)
};
const rows = mountedMapHeaders(assets);
assert.deepEqual(
  rows.map(([dir, name]) => [dir, name]),
  [
    [false, 'X.TED'],
    [true, 'X.TED']
  ]
);
assert.equal(Buffer.from(rows[0][2], 'base64').length, 20);
for (const [dir, name, h] of rows)
  assert.deepEqual(
    parseMapHeader(raw(Buffer.from(h, 'base64'))),
    parseMapHeader(raw(files.get(`DATA\\${dir ? 'CUSTOMMAPS' : 'ART\\MAPS'}\\${name}`)))
  );
const buf = mountedGalacticSources(assets),
  packed = unpackGalacticSources(raw(buf));
for (const [k, view] of packed) assert.deepEqual(Buffer.from(view), files.get(k));
assert.throws(() => unpackGalacticSources(raw(buf.subarray(0, buf.length - 1))));
const lib = new GalacticSources([...packed.keys()], packed);
lib.source('GameScoring');
while (lib.pending.size) await Promise.all([...lib.pending.values()]);
assert.equal(lib.source('helper'), 'require("GameScoring") -- café');
assert.equal(lib.source('GameScoring'), 'require("helper")');
assert.equal(lib.source('absent'), null);
assert.equal(lib.errors.size, 0);
assets.index.get('DATA\\SCRIPTS\\GAME\\GAMESCORING.LUA').size = 9 * 1024 * 1024;
assert.equal(mountedGalacticSources(assets), null, 'oversized libraries use ordinary VFS reads');
console.log('Mounted map and Lua packets preserve header fields, original bytes, transitive aliases and size fallback.');

if (process.env.SWR_GAME) {
  const { openGame } = await import('./megfs.mjs');
  const game = openGame(process.env.SWR_GAME, process.env.SWR_MOD ? [process.env.SWR_MOD] : []);
  try {
    const rows = mountedMapHeaders(game);
    assert(rows.length);
    for (const [custom, file, encoded] of rows) {
      const src = game.readPart(game.resolve(`Data/${custom ? 'CustomMaps' : 'Art/Maps'}/${file}`), 0, 4096);
      assert.deepEqual(parseMapHeader(raw(Buffer.from(encoded, 'base64'))), parseMapHeader(raw(src)), file);
    }
    const buf = mountedGalacticSources(game);
    const scripts = unpackGalacticSources(raw(buf));
    assert.deepEqual([...scripts.keys()], [...game.index.keys()].filter(k => k.includes('SCRIPTS\\') && k.endsWith('.LUA')).sort());
    for (const [k, bytes] of scripts) assert.deepEqual(Buffer.from(bytes), game.read(k), k);
    console.log(`Verified ${rows.length} map headers and ${scripts.size} script files against individual archive reads.`);
  } finally {
    game.close();
  }
}
