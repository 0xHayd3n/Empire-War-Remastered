import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
import { TerrainCraters } from '../public/js/game/terrain-craters.js';
import { LandScars } from '../public/js/game/land-scars.js';
import { makeMap } from './craters/fixture.mjs';
const opts = { fixedGrid: 10, maxPatchVerts: 245, maxCraters: 2, maxPads: 4 };
function make() {
  const { terrain, mesh } = makeMap(22, { z: () => 20 });
  return new TerrainCraters(terrain, mesh, opts);
}
function print(f, x, y, concealed = false) {
  return f.hit(x, y, 3, { depth: 0.4, pad: { halfWidth: 1.8, yaw: 0.42 }, lip: 0, scorch: 0, concealed });
}
function ray(f, x, y) {
  f.ground.updateWorldMatrix(true, true);
  return new T.Raycaster(new T.Vector3(x, y, 100), new T.Vector3(0, 0, -1)).intersectObject(f.ground, true)[0];
}
test('print recycling leaves independent explosion capacity and swaps only vacated fine slots', () => {
  const f = make();
  try {
    for (let x = 10; x <= 130; x += 40) assert.ok(print(f, x, 10));
    for (const x of [10, 50]) assert.ok(f.hit(x, 50, 6, { depth: 3 }));
    const z = f.offsetAt(10, 50);
    assert.ok(z < -2);
    for (let i = 0; i < 70; i++) assert.ok(print(f, 10 + 40 * (i % 9), 90 + 40 * (Math.floor(i / 9) % 3)));
    assert.equal(f.pads.size, 4);
    assert.equal(f.craters.length, 6);
    assert.equal(f.hits, 2);
    assert.equal(f.offsetAt(10, 50), z);
    assert.equal(f.offsetAt(10, 10), 0);
    assert.equal(ray(f, 10, 10).object, f.ground);
    for (const r of f.craters) {
      const hit = ray(f, r.x, r.y);
      assert.equal(hit.object, f.mesh);
      assert.ok(Math.abs(hit.point.z - 20 - f.offsetAt(r.x, r.y)) < 1e-5);
    }
  } finally {
    f.dispose();
  }
});
test('hidden footprints, same-cell blast, reveal and JSON resume agree on the triangle surface', () => {
  const f = make(),
    g = make();
  try {
    assert.ok(f.hit(49, 50, 6, { depth: 2 }));
    assert.ok(print(f, 50, 50, true));
    assert.ok(f.offsetAt(50, 50) < f.drawnOffsetAt(50, 50) - 0.39);
    const wire = JSON.parse(JSON.stringify(f.snapshot()));
    assert.equal(wire.v, 2);
    assert.ok(g.restore(wire));
    assert.equal(g.offsetAt(50, 50), f.offsetAt(50, 50));
    assert.equal(g.drawnOffsetAt(50, 50), f.drawnOffsetAt(50, 50));
    assert.equal(
      g.reveal(() => true),
      1
    );
    for (let x = 48; x <= 52; x += 0.25) {
      const h = ray(g, x, 50.25);
      assert.ok(Math.abs(h.point.z - 20 - g.offsetAt(x, 50.25)) < 1e-5);
    }
    wire.craters.find(r => r.pad).halfWidth = Infinity;
    assert.equal(g.restore(wire), false);
  } finally {
    f.dispose();
    g.dispose();
  }
});
test('only new solo and explicitly marked saves create actual walking prints', () => {
  function mount(setup) {
    const { terrain, mesh } = makeMap(),
      world = { terrain, wet: [] },
      scene = new T.Scene();
    scene.add(mesh);
    return new LandScars(world, mesh, scene, setup);
  }
  for (const setup of [{ net: {} }, { replay: {} }, { headless: true }, { restore: { battle: { craterRule: 1 } } }]) {
    const s = mount(setup);
    try {
      assert.ok(!s.steps);
      assert.ok(!s.save().footfallRule);
    } finally {
      s.dispose();
    }
  }
  const s = mount({ mode: 'land' });
  let battle;
  try {
    const u = { x: 50, y: 50 };
    assert.ok(s.crushPrint({ heading: 0 }, u, true));
    battle = JSON.parse(JSON.stringify(s.save()));
    assert.equal(battle.footfallRule, 1);
  } finally {
    s.dispose();
  }
  const resumed = mount({ mode: 'land', restore: { battle } });
  try {
    assert.ok(resumed.steps);
    assert.ok(resumed.pits.offsetAt(50, 50) < -0.1);
    assert.equal(resumed.pits.drawnOffsetAt(50, 50), 0);
  } finally {
    resumed.dispose();
  }
});
