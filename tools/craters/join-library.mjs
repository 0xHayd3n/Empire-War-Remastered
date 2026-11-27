// Join the two independent checks on their actual inputs. A successful subset,
// a duplicate job, or a visually verified texture variant of another TED isn't
// enough to qualify an entire installed map library.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fingerprint } from '../remaster/survey.mjs';
const { values: arg } = parseArgs({options:Object.fromEntries(['plan','terrain','pixels','out'].map(k=>[k,{type:'string'}]))});
if (!arg.plan || !arg.terrain || !arg.pixels) throw Error('Usage: --plan <plan.json> --terrain <maps.json> --pixels <readbacks.json> [--out <matrix.json>]');
const read = f => JSON.parse(fs.readFileSync(f));
const plan = read(arg.plan), sim = read(arg.terrain), gpu = read(arg.pixels);
assert.ok(sim.complete && gpu.complete && !gpu.match,'partial check');
assert.deepEqual(plan.failures,[]);assert.deepEqual(sim.errors,[]);
const scoped = new Map(sim.scopes.map(s=>[s.scope,new Map(s.land.map(row=>[row.file,row.sha256]))]));
assert.ok(sim.scopes.every(s=>!s.unknown.length),'unclassified TEDs');
const result = {coverage:'Installed terrain and base-material qualification; not a playthrough of every mission.',scopes:[],totals:{}};
const teds = new Set(), variants = new Set(), holes = new Set(), noPixels = new Set();
let count=0;
for (const s of plan.scopes) {
  const remaining = scoped.get(s.scope.key);
  assert.ok(remaining && s.jobs.length === remaining.size && s.land === remaining.size && !s.remaining,`incomplete scope: ${s.scope.key}`);
  const rows=[];
  for(const id of s.jobs){
    const {identity:i} = read(path.join(path.dirname(arg.plan),'jobs',id+'.json'));
    assert.equal(remaining.get(i.path),i.ted,`${s.scope.key}: ${i.path}`);remaining.delete(i.path);
    const key=fingerprint([i.ted,i.slots]),t=sim.byTED[i.ted],g=gpu.results[key];
    assert.ok(t?.pass && g && g.ted===i.ted,'missing matching terrain or material measurement: '+i.path);
    const m=t.measure;
    if(m.excluded){assert.ok(m.emittedGroundTriangles===0 && m.phantomScars===0 && g.notApplicable===m.excluded);holes.add(i.ted);noPixels.add(key);}
    else {assert.ok(m.climbTicks>0 && m.laterHits===29 && g.pass && g.pixels.base>g.pixels.burnt,'missing traversal/persistence/scorch: '+i.path);}
    variants.add(key);teds.add(i.ted);count++;
    rows.push({map:i.path,ted:i.ted,material:key,...(m.excluded?{noSoil:m.excluded}:{at:m.at,depth:m.depth,uphillTicks:m.climbTicks,afterBlasts:m.laterHits,clean:g.pixels.base,burnt:g.pixels.burnt})});
  }
  result.scopes.push({scope:s.scope.key,rows});
}
assert.ok([...scoped.values()].every(m=>!m.size),'terrain map absent from paint plan');
assert.ok(count>0 && gpu.distinct===variants.size && teds.size===Object.keys(sim.byTED).length);
result.totals={mapLoadOrders:count,distinctTerrain:teds.size,traversed:teds.size-holes.size,allHoles:holes.size,readbacks:variants.size-noPixels.size};
if(arg.out)fs.writeFileSync(arg.out,JSON.stringify(result)+'\n');
console.log(result.totals);
