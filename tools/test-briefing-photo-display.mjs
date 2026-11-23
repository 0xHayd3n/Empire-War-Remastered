// Synthetic parsed TED and decoder; no installed game, browser profile or private photos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadMap } from '../public/js/ted.js';
import { mountBattleArt } from '../public/js/game/battleart.js';

const ted = new Uint8Array(8), hash = bytes => createHash('sha256').update(bytes).digest('hex');
let approved = hash(ted), status = 200, decode;
globalThis.location = new URL('http://127.0.0.1/');
globalThis.fetch = async input => {
  const url = new URL(input, location);
  if (url.pathname.startsWith('/asset/')) return new Response(ted);
  assert.equal(url.pathname, '/api/battle-photo');
  assert.deepEqual(Object.fromEntries(url.searchParams), {map: 'Data/Art/Maps/PORT.TED', kind: 'space', planet: 'Port'});
  return new Response(status === 200 ? new Uint8Array([1]) : null, {status, headers: {'content-type': 'image/jpeg', 'X-Map-SHA256': approved}});
};
let decoded = 0;
globalThis.Image = class {
  naturalWidth = 1920;
  naturalHeight = 1080;
  async decode() { decoded++; await decode?.(); }
};
const scene = () => ({isConnected: true, images: [], append(image) { this.images.push(image); }});
const setup = {map: await loadMap('PORT.TED'), land: false, campaign: {planetType: 'Port'}};
const matching = scene();
await mountBattleArt(matching, setup);
assert.equal(matching.images.length, 1);
assert.equal(decoded, 1);
for (const [code, sha] of [[200, hash(Buffer.from('different map'))], [200, ''], [204, hash(ted)]]) {
  status = code; approved = sha;
  const absent = scene();
  await mountBattleArt(absent, setup);
  assert.equal(absent.images.length, 0);
  assert.equal(decoded, 1);
}
status = 200; approved = hash(ted);
const started = Promise.withResolvers(), finish = Promise.withResolvers();
decode = () => { started.resolve(); return finish.promise; };
const gone = scene(), pending = mountBattleArt(gone, setup);
await started.promise;
gone.isConnected = false;
finish.resolve();
await pending;
assert.equal(gone.images.length, 0);
console.log('Briefing frame: parsed bytes match, changed bytes, absent attestation, no reviewed entry, and decode after dismissal OK');
