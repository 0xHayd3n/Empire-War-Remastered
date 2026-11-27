// Local mounted integration check. Do not copy any private content to disk.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { libraryHome, listPacks, loadPack } from './universal-library.mjs';
const origin = 'http://127.0.0.1:8590';
for (const { id, name, ready } of listPacks(libraryHome())) {
  if (!ready) continue;
  const host = await fetch(origin + '/api/mount/' + id, { method: 'POST', headers: { Origin: origin } });
  assert.equal(host.status, 200, name);
  const { url } = await host.json(), entries = loadPack(libraryHome(), id).entries;
  // Verify one loose and one archive entry, when present, against immutable manifest digests.
  const candidates = [...entries].filter(([k, e]) => e && e.size >= 300 && e.size <= 2 ** 20 && /^DATA\\[\w .\\-]+$/i.test(k));
  const picks = [true, false].map(loose => candidates.find(([, e]) => e.packLoose === loose)).filter(Boolean);
  assert(picks.length);
  for (const [key, e] of picks) {
    const at = new URL('/asset/' + key.replaceAll('\\', '/'), url), all = await fetch(at);
    assert.equal(all.status, 200);
    const body = Buffer.from(await all.arrayBuffer());
    assert.equal(body.length, e.size); assert.equal(createHash('sha256').update(body).digest('hex'), e.file.slice(-64));
    for (const [lo, hi] of [[17, 201], [e.size - 73, e.size - 1]]) {
      const part = await fetch(at, { headers: { Range: `bytes=${lo}-${hi}` } });
      assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes ${lo}-${hi}/${e.size}`);
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), body.subarray(lo, hi + 1));
    }
  }
  console.log('PASS', id, name, picks.map(([, e]) => e.packLoose ? 'loose' : 'MEG').join('+'), 'full SHA-256 and exact HTTP ranges');
}
