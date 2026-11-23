// Synthetic DevTools events; no browser, game install, or profiler captures required.
const assert = require('node:assert/strict');
const { reduceTrace } = require('./bench-live-space.cjs');
const e = (name, ts, extra = {}) => ({ pid: 1, tid: 2, name, ts, ...extra });
const wait = (ts, dur, extra = {}) => e('CommandBufferProxyImpl::WaitForGetOffset', ts, { ph: 'X', dur, ...extra });
const marks = [e('fleetStart0', 1000, { tts: 10 }), e('fleetEnd0', 3000, { tts: 1010 }), e('fleetStart1', 4000), e('fleetEnd1', 5000)];
const cp = {
  startTime: 0,
  endTime: 6000,
  samples: [1, 1, 1, 1],
  timeDeltas: [500, 1000, 2000, 1000],
  nodes: [{ id: 1, callFrame: { functionName: 'projectObject', url: 'synthetic:three' } }]
};
const out = reduceTrace(
  [
    ...marks,
    wait(500, 1100),
    wait(1300, 100),
    wait(2900, 1300),
    wait(1800, 900, { tid: 7 }),
    e('CommandBufferHelper::Flush', 1500, { ph: 'X', dur: 1400 })
  ],
  cp,
  2,
  false
);
assert.deepEqual(out.commandWaitMs, { p50: 0.2, p95: 0.7 }); // clip at draw edges, union nested, exclude flushes and other threads
assert.equal(out.framesWithCommandWait, 2);
assert.equal(out.threadCpuSamples, 1);
assert.deepEqual(out.offCpuMs, { p50: 1, p95: 1 });
assert.deepEqual(out.leafSamples, { traverseSort: 2 });
assert.equal(reduceTrace(marks, cp, 2, false).framesWithCommandWait, 0);
assert.throws(() => reduceTrace(marks, cp, 2, true), /lost trace data/);
assert.throws(() => reduceTrace(marks.slice(1), cp, 2, false), /Missing trace markers/);
assert.throws(() => reduceTrace(marks, { ...cp, startTime: 1100 }, 2, false), /clocks/);
console.log('PASS: same-thread wait union, clipping, CPU clocks, leaf attribution and invalid trace rejection');
