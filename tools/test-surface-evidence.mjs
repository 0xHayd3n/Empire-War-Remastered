import assert from 'node:assert/strict';
import { checkSurfaceEvidence } from './remaster/fit.mjs';
import evidence from './remaster/ground-evidence.cjs';
const blank = c => ({ width: 30, height: 30, data: new Uint8Array(30 * 30 * 4).fill(c) });
const frame = blank(70);
for (let y = 5; y < 9; y++) for (let x = 0; x < 30; x++) frame.data.fill(0, (y * 30 + x) * 4, (y * 30 + x + 1) * 4);
const edge = evidence.darkIsland(frame, [0, 0, 30, 30]);
assert.equal(edge.largest, 120);
assert.equal(edge.fraction, 120 / 900);
const a = {
    waterMode: 0,
    hasSheet: false,
    edgeView: 'edge',
    edge: { ...edge, limit: 0.04 },
    heightRange: [0.3, 0.4],
    donors: { earth: { heightSpan: 83, normalCorrelation: [0.5, 0.51] } },
    surfaceViews: ['low', 'pan']
  },
  r = { surfaceAudit: a, views: { low: {}, pan: {}, edge: {} } },
  job = { water: { mode: 0 } };
assert.throws(() => checkSurfaceEvidence(job, r), /edge/);
Object.assign(a.edge, evidence.darkIsland(blank(65), [0, 0, 30, 30]));
assert.equal(checkSurfaceEvidence(job, r), a);
a.donors.earth.normalCorrelation[1] = -0.51;
assert.throws(() => checkSurfaceEvidence(job, r), /misregistered/);
a.donors.earth.normalCorrelation[1] = 0.51;
a.hasSheet = true;
assert.throws(() => checkSurfaceEvidence(job, r), /Dry map/);
a.waterMode = job.water.mode = 1;
assert.throws(() => checkSurfaceEvidence(job, r), /water-on/);
assert.throws(() => evidence.lakeWindow(blank(0), blank(110), [0, 0, 30, 30]), /Black sheet/);
const darkBed = blank(110);
for (let y = 5; y < 9; y++) darkBed.data.fill(0, y * 30 * 4, (y + 1) * 30 * 4);
assert.throws(() => evidence.lakeWindow(frame, darkBed, [0, 0, 30, 30]), /Black sheet\/bed/);
a.lake = evidence.lakeWindow(blank(84), blank(110), [0, 0, 30, 30]);
assert.equal(checkSurfaceEvidence(job, r), a);
console.log('PASS visible edge, reversed normal, close pan, dry map and black-water gate');
