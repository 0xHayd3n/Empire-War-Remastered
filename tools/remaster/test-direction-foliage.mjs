/**
 * Offline fixture tests for the reviewed foliage class schema in direction.mjs.
 * No network, no downloads, no checkout writes. Run: node --test test-direction-foliage.mjs
 *
 * The schema is judged on four things a reviewer can check without a renderer:
 * classes are growth forms with their own silhouette and variation, every class is placed
 * or excluded in a named place, each class states replace/retain/absent with a reason, and
 * a world with no vegetation is a valid answer rather than a missing one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateDirection, validateFoliageReview, normalizeDirection, requireDirection, foliageDispositions } from './direction.mjs';

const JOB = 'd96aa07683839825c24b8653663e554a88948f6d4e2ff1a198d77b426f1bb03e';
const shipped = JSON.parse(fs.readFileSync(new URL(`./directions/${JOB}.json`, import.meta.url)));
const sha = n => n.toString(16).padStart(64, 'a');
const VIEWS = [1, 2, 3, 4, 5].map(n => ({
  page: `https://example.test/page-${n}`,
  image: `https://example.test/image-${n}.jpg`,
  sha256: sha(n),
  visible: `Inspected environment view ${n} with readable ground and foliage.`
}));
const h = n => sha(n);

function form(id, evidence = [h(1)], extra = {}) {
  return {
    id,
    form: `Observed growth form for ${id}, described without a species claim.`,
    silhouette: `Silhouette of ${id} as a player would read it at squad and command height.`,
    variation: `How instances of ${id} differ in scale, spacing and density.`,
    disposition: 'replace',
    reason: `Why ${id} replaces or rejects the authored alternative here.`,
    evidence,
    ...extra
  };
}

function review(over = {}) {
  const forms = over.forms ?? [form('a'), form('b')];
  const ids = forms.map(f => f.id);
  return {
    disposition: 'replace',
    basis: 'What these inspected views establish, and what remains inference rather than observation.',
    forms,
    zones: {
      place: [{ where: 'The authored stands beyond the built edge.', forms: ids, evidence: [h(1)] }],
      exclude: [{ where: 'The paved apron and the muster lanes.', reason: 'The views show clear ground there.', evidence: [h(1)] }]
    },
    variation: {
      decision: 'Vary by place and by instance instead of repeating one authored model everywhere.',
      limits: ['Adjacent foreground instances differ in scale and spacing.'],
      evidence: [h(1)]
    },
    ...over
  };
}

function doc(block = review(), views = VIEWS) {
  return {
    job: JOB,
    planet: 'Fixture World',
    views,
    foliage: {
      decision: 'A decided prose direction for the fixture foliage.',
      reject: 'A rejected alternative.',
      evidence: [h(1)],
      review: block
    }
  };
}

test('the shipped Yavin direction carries a reviewed class list that loads strictly and leniently', () => {
  const d = shipped;
  validateDirection({ id: d.job }, d);
  const loaded = requireDirection({ id: d.job });
  assert.equal(loaded.foliage.review.status, undefined, 'a briefed direction is not marked unreviewed');
  assert.ok(loaded.foliage.review.forms.length >= 1, 'at least one class is named');
  for (const f of d.foliage.review.forms) assert.ok(foliageDispositions.includes(f.disposition), f.id + ' has a real disposition');
  const ids = d.foliage.review.forms.map(f => f.id);
  for (const id of ['canopy', 'broadleaf', 'fern', 'needle-conifer']) assert.ok(ids.includes(id), 'regression: ' + id + ' stays named');
  // The three answers are all exercised by this one world, which is what the schema allows.
  assert.equal(d.foliage.review.forms.find(f => f.id === 'fern').disposition, 'retain');
  assert.equal(d.foliage.review.forms.find(f => f.id === 'needle-conifer').disposition, 'absent');
  const cited = new Set(d.foliage.review.forms.flatMap(f => f.evidence).concat(d.foliage.review.zones.place.flatMap(z => z.evidence)));
  assert.ok(cited.size >= 3, 'several distinct views inform the classes, not one plate');
});

test('the stored direction holds decisions and hashes only, never private image paths or bytes', () => {
  const raw = fs.readFileSync(new URL(`./directions/${JOB}.json`, import.meta.url), 'utf8');
  assert.ok(!/localFile/.test(raw), 'no local image path is stored');
  assert.ok(!/Windows.Temp/i.test(raw) && !/yavin-direction/i.test(raw), 'no private temp path is stored');
  assert.ok(JSON.parse(raw).foliage.review, 'the reviewed classes survive the safe copy');
});

test('a direction briefed before the class schema still loads, marked unreviewed', () => {
  const { review: _drop, ...legacyFoliage } = shipped.foliage;
  const legacy = { ...shipped, foliage: legacyFoliage };
  assert.throws(() => validateDirection({ id: shipped.job }, legacy), /Foliage needs a reviewed class list/);
  const normalized = normalizeDirection(legacy);
  assert.equal(normalized.foliage.review.status, 'unreviewed');
  validateDirection({ id: shipped.job }, normalized, { allowUnreviewedFoliage: true });
  assert.equal(normalizeDirection(normalized), normalized, 'normalizing a normalized brief is a no-op');
});

test('a world with no vegetation is a complete answer, not a quota of classes', () => {
  const barren = doc({
    disposition: 'absent',
    basis: 'All exterior views show bare ground and rock; no plant silhouette is readable anywhere on the surface.',
    forms: [],
    zones: {
      place: [],
      exclude: [
        { where: 'Every inspected square of ground.', reason: 'The views show rock, dust and shadow only.', evidence: [h(1), h(2)] }
      ]
    },
    variation: {
      decision: 'No vegetation to vary; ground patterning is a terrain decision, not a planting one.',
      limits: ['Any plant at all is a fault.'],
      evidence: [h(1), h(2)]
    }
  });
  assert.equal(validateFoliageReview(barren), barren.foliage.review);
  validateFoliageReview(
    doc({
      ...barren.foliage.review,
      forms: [form('stray', [h(1)], { disposition: 'absent' })],
      zones: { place: [], exclude: barren.foliage.review.zones.exclude }
    })
  );
});

test('a sparsely vegetated world keeps one sparse class and its gaps', () => {
  const sparse = doc({
    disposition: 'retain',
    basis: 'The views show scattered low clumps with bare gravel between them and no continuous cover.',
    forms: [form('sparse-scrub', [h(1), h(2)], { disposition: 'retain', variation: 'Clump size and gaps change across the flat ground.' })],
    zones: {
      place: [{ where: 'Scattered clumps on the open flat with visible gaps.', forms: ['sparse-scrub'], evidence: [h(1), h(2)] }],
      exclude: [{ where: 'The route and the built pad.', reason: 'The views show bare compacted ground there.', evidence: [h(2)] }]
    },
    variation: {
      decision: 'Keep the gaps: sparsity is the direction, not a shortage of classes.',
      limits: ['Clumps never join into continuous cover.'],
      evidence: [h(2)]
    }
  });
  validateFoliageReview(sparse);
  assert.equal(sparse.foliage.review.forms.length, 1, 'one class is allowed');
});

test('there is no upper quota: twelve distinct classes still pass', () => {
  const many = doc(review({ forms: Array.from({ length: 12 }, (_, i) => form('class-' + i, [h(1 + (i % 4)), h(5)])) }));
  validateFoliageReview(many);
});

test('classes are distinct growth forms, not one repeating silhouette or variation sentence', () => {
  const twins = doc(review({ forms: [form('a'), form('b', [h(1)], { silhouette: form('a').silhouette })] }));
  assert.throws(() => validateFoliageReview(twins), /share one silhouette/);
  const sameWalk = doc(review({ forms: [form('a'), form('b', [h(1)], { variation: form('a').variation })] }));
  assert.throws(() => validateFoliageReview(sameWalk), /share one variation sentence/);
});

test('brief ingestion rejects a review that cannot be checked', () => {
  const cases = [
    [review({ disposition: 'plant-some' }), /replace, retain or absent/],
    [review({ basis: '' }), /what the inspected views establish/],
    [review({ forms: [form('a', [h(9)])] }), /not on this board/],
    [review({ forms: [] }), /cannot only reject/],
    [review({ zones: { place: [], exclude: [] } }), /must not appear/],
    [
      review({
        zones: { place: [{ where: 'Somewhere on the map.', forms: ['ghost'], evidence: [h(1)] }], exclude: review().zones.exclude }
      }),
      /reviewed foliage classes/
    ],
    [review({ zones: { place: [], exclude: [{ where: 'The paved apron.', reason: '', evidence: [h(1)] }] } }), /show there instead/],
    [review({ variation: { decision: 'Vary it.', limits: [], evidence: [h(1)] } }), /limits for variation/],
    [review({ forms: [form('a', [h(1)], { variation: '' })] }), /own variation/],
    [review({ forms: [form('a', [h(1)], { disposition: 'keep' })] }), /replace, retain or absent/],
    [review({ forms: [form('a', [h(1)], { reason: '' })] }), /reason for its disposition/],
    [review({ forms: [form('a', [h(1)]), form('a', [h(2)])] }), /Duplicate foliage class/],
    [review({ forms: [form('A B', [h(1)])] }), /short lowercase id/],
    // A replace brief on one plate, or two views, cannot separate crown, understory and ground.
    [
      review({
        forms: [form('a', [h(1)]), form('b', [h(1)])],
        zones: {
          place: [{ where: 'The authored stands.', forms: ['a', 'b'], evidence: [h(1)] }],
          exclude: [{ where: 'The paved surface.', reason: 'The views show clear ground there.', evidence: [h(1)] }]
        },
        variation: { decision: 'Vary by place and instance.', limits: ['Instances differ.'], evidence: [h(1)] }
      }),
      /at least 3 distinct/
    ]
  ];
  for (const [block, message] of cases) assert.throws(() => validateFoliageReview(doc(block)), message, JSON.stringify(block).slice(0, 80));
});

test('a two-view retain or absent review is allowed where the views agree', () => {
  const two = doc(review({ disposition: 'retain', forms: [form('a', [h(1), h(2)], { disposition: 'retain' })] }));
  validateFoliageReview(two);
});

test('placing anything on a world recorded as absent is a contradiction', () => {
  const block = review({
    disposition: 'absent',
    forms: [form('a', [h(1)], { disposition: 'absent' })],
    zones: { place: [{ where: 'The open ground.', forms: ['a'], evidence: [h(1)] }], exclude: review().zones.exclude }
  });
  assert.throws(() => validateFoliageReview(doc(block)), /cannot also place classes/);
});

test('full direction validation still fails on the older defects it always caught', () => {
  assert.throws(() => validateDirection({ id: JOB }, { ...shipped, views: shipped.views.slice(0, 4) }), /five distinct/i);
  assert.throws(() => validateDirection({ id: JOB }, { ...shipped, landUse: { ...shipped.landUse, natural: null } }), /natural/);
  assert.throws(
    () => validateDirection({ id: JOB }, { ...shipped, foliage: { ...shipped.foliage, review: review({ disposition: 'x' }) } }),
    /replace, retain or absent/
  );
});

console.log('PASS reviewed foliage classes, variation, placement, exclusion and replace/retain/absent');
