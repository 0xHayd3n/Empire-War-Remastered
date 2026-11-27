import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import scouting from './scout-inventory.cjs';
import { draftSlots } from './prep.mjs';
import { briefDraft, placeInputs } from './reference-worklist.mjs';
import { verify } from './verify.mjs';
import { needsClearInterval } from './climate.mjs';
const texture = 'Tower.tga',
  bump = 'Rock_B.tga',
  layers = [
    { texture, bump, tilt: 0.7, turn: 0 },
    { texture: 'Pad.tga', bump: null, tilt: 0, turn: 0 }
  ];
const t = {
  size: 4,
  width: 2,
  height: 2,
  layerIndex: [0, 0, 1, 1, 0, 0, 1, 1],
  heights: [0, 20, 9e6, 9e6, 0, 20, 9e6, 9e6],
  paint: {
    slot: new Map([
      [1, 0],
      [0, 1]
    ])
  },
  layers
};
const inventory = scouting.scoutInventory(null, {
  terrain: t,
  props: [{ modelFile: 'Spire', x: 5, y: 10 }],
  world: { units: [{ foot: true, side: 1, x: 20, y: 0 }], sites: [] }
});
assert.deepEqual(
  inventory.slots.map(s => [s.vertices, s.grade]),
  [
    [4, [1, 1, 1]],
    [0, null]
  ]
);
assert.equal(inventory.props[0].count, 1);
const job = {
  id: 'f'.repeat(64),
  file: '_MP_LAND_UNREGISTERED.TED',
  environments: [{ name: 'Noon' }],
  identity: {
    slots: [
      [0, 'x', 'a', 'y', 'b'],
      [1, 'z', 'c', null, null]
    ]
  },
  slots: [
    { texture: { name: texture, hash: 'a' }, bump: { name: bump, hash: 'b' }, vertices: 4 },
    { texture: { name: 'Pad.tga', hash: 'c' }, vertices: 0 }
  ]
};
const r = { job: job.id, state: 'baseline-only', activeSlots: [1, 0], trial: null, errors: [], unreadable: [], inventory };
assert.deepEqual(
  draftSlots(job, r).map(s => s.family),
  [null, null]
);
for (const change of [{ activeSlots: [0] }, { state: 'trial-needs-visual-review' }, { unreadable: [0] }, { job: 'changed' }])
  assert.throws(() => draftSlots(job, { ...r, ...change }));
assert.throws(() => draftSlots({ ...job, slots: [{ ...job.slots[0], vertices: 3 }, job.slots[1]] }, r), /Changed/);
assert.deepEqual(briefDraft(job, 'New planet').views, []);
assert.deepEqual(briefDraft(job, 'New planet').climate.skies, ['Noon']);
const h = fs.mkdtempSync(path.join(os.tmpdir(), 'source-test-'));
try {
  const bytes = Buffer.from('source'),
    file = path.join(h, 'image'),
    hash = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(file, bytes);
  const candidate = { directUrl: 'https://example.org/test.jpg', pageUrl: 'https://example.org/test', file: 'image', sha256: hash };
  const ref = { paths: { dir: h }, candidates: [candidate, candidate] };
  assert.equal(placeInputs(job, ref, h).length, 1);
  fs.writeFileSync(file, 's0urce');
  assert.equal(placeInputs(job, ref, h).length, 0);
} finally {
  fs.rmSync(h, { recursive: true, force: true });
}
assert(!needsClearInterval([{ phases: [] }]));
assert(
  needsClearInterval([
    {
      phases: [
        ['snow', 1],
        ['clear', 0]
      ]
    }
  ])
);
await assert.rejects(verify(job, os.tmpdir()), /No verification matrix/);
await assert.rejects(verify({ ...job, file: '_MP_LAND_GEONOSIS.TED' }, os.tmpdir()), /Unregistered mount/);
await assert.rejects(verify(job, os.tmpdir(), { workers: 100 }), /one or two/);
console.log('PASS scout: padded slope, live slot inventory, no inferred approvals, photo byte/dedup, known route and weather gates');
