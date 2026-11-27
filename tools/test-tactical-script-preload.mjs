// Script IO can start without a world, but the readiness barrier must include
// transitive requires (and cycles) before the original script startup runs.
import assert from 'node:assert/strict';
const files = ['AI\\LANDMODE\\OPEN', 'LIBRARY\\HELPER', 'LIBRARY\\END', 'STORY\\UNUSED'].map(f => `DATA\\SCRIPTS\\${f}.LUA`);
const [open, helper, end, unused] = files, reads = [];
let release;
const held = new Promise(resolve => { release = resolve; });
globalThis.SWR_OVERLAY = {
  whole:true, find: async () => files,
  read: async file => {
    reads.push(file);
    if (file === end) await held;
    return new TextEncoder().encode(new Map([[open,'require("helper")'],[helper,'require("end")'],[end,'require("helper")']]).get(file)).buffer;
  }
};
const { ScriptHost } = await import('../public/js/game/scripts.js');
const input = await ScriptHost.prepare();
assert.deepEqual(reads, [open], 'preflight reads AI plans, not every story or an executing VM');
const host = Object.assign(Object.create(ScriptHost.prototype), { index:input.index, planSources:input.plans, sources:new Map(), fetching:0 });
host.fetch('OPEN',open);
let ready = false;
const drained = host.sourcesReady().then(() => { ready = true; });
await new Promise(setImmediate);
assert.deepEqual(reads, [open,helper,end]);
assert.equal(ready,false,'nested source is still in flight');
release(); await drained;
assert.equal(host.fetching,0);
assert.equal(host.sources.get('END'),'require("helper")');
assert(!reads.includes(unused));
console.log('Preloaded plan reused; nested and cyclic requires drained exactly once.');
