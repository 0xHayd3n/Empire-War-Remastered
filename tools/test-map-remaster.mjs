// No mounted or licensed source files required. Exercise load-order collisions, tombstones,
// pair/review invalidation and cohort ranking rather than relying on filename guesses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openScope, scope, resolver, pairId, catalog, fingerprint, makeQueue } from './remaster/survey.mjs';
import { learn, annotate } from './remaster/decisions.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remaster-test-'));
try {
  const lib = { game: root, items: new Map(), ambiguous: new Set() };
  for (const id of ['11', '22']) {
    const folder = path.join(root, id),
      art = path.join(folder, 'Data/Art');
    lib.items.set(id, { folder, name: id });
    for (const sub of ['Textures', 'Maps']) fs.mkdirSync(path.join(art, sub), { recursive: true });
    fs.writeFileSync(path.join(art, 'Textures', 'test.dds'), Buffer.from('diff' + id));
    fs.writeFileSync(path.join(art, 'Textures', 'test_b.dds'), Buffer.from('bump'));
    fs.writeFileSync(path.join(art, 'Textures', 'gone.dds'), id === '11' ? '' : 'old');
    const h = Buffer.alloc(20);
    h.writeUInt32LE(12, 4);
    h[8] = 1;
    h[9] = 4;
    h.writeInt32LE(1, 10);
    h[14] = 2;
    h[15] = 4;
    h.writeInt32LE(2, 16);
    fs.writeFileSync(path.join(art, 'Maps', 'same.ted'), h);
  }
  const mounts = [];
  for (const key of ['11,22', '22,11']) {
    const view = openScope(lib, scope(lib, key));
    try {
      const r = resolver(view),
        a = r('test.TGA'),
        b = r('test_b');
      assert.equal(a.key, 'DATA\\ART\\TEXTURES\\TEST.DDS');
      assert.equal((r('gone')?.hash || null) === null, key === '11,22');
      assert.equal(catalog(view)[0].domain, 'land');
      mounts.push(pairId(a, b));
      assert.equal(pairId(a, r('absent')), null);
    } finally {
      view.close();
    }
  }
  assert.notEqual(...mounts);
  assert.throws(() => scope(lib, '22,22'));
  lib.ambiguous.add('11');
  assert.throws(() => scope(lib, '11'));
  const [d, b] = mounts[0].split(':'),
    identity = { edition: 'foc', order: [], path: 'DATA\\ART\\MAPS\\SAME.TED', ted: 'sample', slots: [[0, 'A', d, 'B', b]] },
    job = { id: fingerprint(identity), identity, slots: [{ index: 0, texture: { name: 'A' }, vertices: 10, pair: mounts[0] }] };
  const pin = { id: 'sand', tileMeters: 2, colorHash: 'old', surfaceHash: 'surface' },
    rep = {
      state: 'trial-needs-visual-review',
      job: job.id,
      trial: { slot: 0, donor: 'sand' },
      donorPin: pin,
      backend: 'webgl',
      errors: [],
      unreadable: [],
      activeSlots: [0],
      views: { surface: { trial: 100, restored: 0 }, command: { restored: 0 }, squad: { restored: 0 } }
    };
  const reason = 'The wet bank scan is too green for this dry path',
    note = learn(job, rep, 'avoid', reason);
  assert.equal(note.reason, reason);
  assert.throws(() => learn(job, { ...rep, state: 'blocked' }, 'avoid', reason));
  assert.throws(() => learn(job, { ...rep, views: { ...rep.views, surface: { trial: 0, restored: 0 } } }, 'candidate', reason));
  assert.throws(() => learn({ ...job, identity: { ...identity, order: ['22'] } }, rep, 'candidate', reason));
  annotate(job, [note], [pin]);
  assert.equal(job.slots[0].reviews[0].decision, 'avoid');
  annotate(job, [note], [{ ...pin, colorHash: 'changed' }]);
  assert.equal(job.slots[0].reviews.length, 0);
  const changed = { id: 'other', slots: [{ ...job.slots[0], pair: mounts[1] }] };
  annotate(changed, [note], [pin]);
  assert.equal(changed.slots[0].reviews.length, 0);
  const q = makeQueue([job, { ...job, id: 'second', slots: [...job.slots, ...job.slots] }, changed]);
  assert.deepEqual(
    q.map(r => r.maps),
    [2, 1]
  );
  assert.equal(q[0].vertices, 30);
  assert.equal(q[0].jobs.length, 2);
  console.log(
    'PASS ordered winners, aliases, deleted/missing art, scoped identity, trial gates, stale donor notes and distinct-map grouping'
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
