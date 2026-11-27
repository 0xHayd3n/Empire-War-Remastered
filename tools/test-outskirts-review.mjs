import assert from 'node:assert/strict';
import { checkOutskirtsAudit, checkOutskirtsBrief, edgeIntake, rimViews } from './remaster/outskirts.mjs';
const t = {
  size: 4,
  width: 4,
  height: 3,
  heights: new Float32Array(16).fill(5),
  layerIndex: new Uint8Array(16),
  layers: [{}, { hole: true }],
  water: { mode: 1, level: 0 }
};
t.heights[11] = -3;
t.heights[12] = -1000;
t.layerIndex[4] = 1;
assert.deepEqual(edgeIntake(t, { playMin: [7, 9], playMax: [51, 28] }), {
  span: [60, 40],
  margins: [7, 9, 9, 12],
  pivot: [7, 9, 51, 28],
  edgeHeight: [-3, 5],
  holes: 1,
  wet: 1
});
const d = {
  views: [{ sha256: 'a' }, { sha256: 'b' }],
  foliage: { review: { forms: [{ id: 'crown', disposition: 'absent' }] } },
  outskirts: {
    treatment: 'flat',
    evidence: ['a', 'b'],
    foliage: [],
    skyline: 'A wide barren salt flat.',
    join: 'Continue the crust beyond the authored rim.',
    reject: 'Do not plant a line of trees.'
  }
};
assert.equal(checkOutskirtsBrief(d), d.outskirts);
for (const extra of [{ foliage: ['crown'] }, { evidence: ['a', 'a'] }, { evidence: ['a', 'c'] }, { join: '' }])
  assert.throws(() => checkOutskirtsBrief({ ...d, outskirts: { ...d.outskirts, ...extra } }));
const a = {
  treatment: 'flat',
  pivot: [0, 0, 100, 80],
  maximum: 1300,
  boundsUnchanged: true,
  rollback: { changed: 0 },
  control: { before: 2200, after: 0 },
  triangles: 1100,
  skyline: [],
  samples: []
};
for (const view of rimViews) {
  a.skyline.push({ view, changed: 0 });
  for (const [band, dist] of [
    ['maximum', 1300],
    ['oblique', 180]
  ])
    a.samples.push({
      view,
      band,
      dist,
      c: [view.includes('e') ? 100 : view.includes('w') ? 0 : 50, view.includes('n') ? 80 : view.includes('s') ? 0 : 40, dist],
      tested: 5000,
      exposed: 0
    });
}
const check = x => checkOutskirtsAudit(d, { outskirtsAudit: x });
assert.equal(check(a), a);
for (const edit of [
  x => x.samples.pop(),
  x => x.samples[0].c[0]++,
  x => (x.samples[0].exposed = 200),
  x => x.skyline.pop(),
  x => (x.skyline[0].changed = 90),
  x => (x.boundsUnchanged = false),
  x => (x.rollback.changed = 200),
  x => (x.control.before = 0)
]) {
  const copy = structuredClone(a);
  edit(copy);
  assert.throws(() => check(copy));
}
console.log(
  'PASS rectangular rim inventory, barren-world brief, eight camera stops, two heights, outer strip, exposure control and rollback'
);
