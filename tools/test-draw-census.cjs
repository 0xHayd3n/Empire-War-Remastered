// Synthetic renderer counters: one real submission can issue zero, one, or multiple calls.
const assert = require('node:assert/strict');
const { createCensus } = require('./bench-draw-census.cjs');
const stats = { calls: 0, triangles: 0 },
  scene = {},
  dev = {
    info: { render: stats },
    renderBufferDirect(c, s, g, m, o) {
      stats.calls += o.n ?? 1;
      stats.triangles += (o.n ?? 1) * 2;
    }
  };
const model = { skinBatchable: new WeakSet(), instanceable: new WeakSet() },
  pool = {},
  root = {},
  shield = { parent: root },
  mount = { parent: root },
  neutral = {},
  geo = { id: 1 };
const m = { id: 1, defines: { SKINNED: 1 }, uniforms: { boneMatrices: { value: new Float32Array([1]) } } },
  alpha = { id: 2, transparent: true, defines: { SKINNED: 1 } },
  sh = { userData: { shield: true } };
model.skinBatchable.add(m);
const faded = { parent: mount, n: 2 };
const u = {
  obj: root,
  shieldMesh: shield,
  fadeMats: [[faded, m, alpha]],
  parts: [mount],
  player: { id: 1 },
  isMobile: true,
  type: { name: 'synthetic' }
};
const game = {
  renderer: { renderer: dev, scene, instances: { list: [{ im: pool }] } },
  world: { units: [u, { obj: neutral, player: { id: -1 } }] }
};
const original = dev.renderBufferDirect,
  x = createCensus({ game, model });
const draw = (obj, mat = m) => dev.renderBufferDirect(null, scene, geo, mat, obj);
x.begin();
draw(pool);
draw({ parent: root });
m.uniforms.boneMatrices.value[0] = 2;
draw({ parent: root });
draw({ parent: shield }, sh);
draw(faded, alpha);
draw({ parent: neutral });
draw({});
draw({ n: 0 });
x.end(8, 16);
game.renderer.instances.list = [];
game.world.units = [];
x.begin();
draw(pool);
draw({ parent: root });
x.end(2, 4);
const a = x.finish(2);
assert.deepEqual(
  Object.values(a.calls).map(v => v.total),
  [1, 5, 1, 3]
);
assert.deepEqual(
  Object.values(a.mobileParts).map(v => v.total),
  [1, 2, 2]
);
assert.deepEqual(
  Object.values(a.mobileSurfaces).map(v => v.total),
  [1, 2, 2, 0, 0]
);
assert.equal(a.mobileSkinTransparency.activeFadeTwin.total, 2);
assert.equal(a.skinnedDistinctSignatures.total, 2);
assert.equal(a.opaqueSkinPaletteGroups.mixedRepeated.total, 2);
assert.ok(!a.topLocalMobileParts);
x.restore();
assert.equal(dev.renderBufferDirect, original);
const missing = createCensus({ game, model });
missing.begin();
draw({});
missing.end(2, 4);
assert.throws(() => missing.finish(1), /did not reconcile/);
missing.restore();
console.log('PASS: draw ownership, skipped and multiple submissions, changing pools/roots/palettes, reconciliation and restore');
