import test from 'node:test';
import assert from 'node:assert/strict';
import { RamImpacts, wantsRamming } from '../public/js/game/ram-impacts.js';
import { loadWreckPhysics } from '../public/js/game/rapier-runtime.js';
const R = await loadWreckPhysics();
function unit(x, extra = {}) {
  return { x, y: 0, z: 0, health: 200, maxHealth: 200, hitRadius: 5, kind: 'VEHICLE', isMobile: true, speed: 200, maxSpeed: 200, ...extra };
}
function tick(layer, list, path, dt = 0.05) {
  const hits = [];
  layer.begin(list, dt);
  path();
  layer.end(list, (a, b, d, at) => hits.push({ a, b, d, at }));
  return hits;
}
for (const mode of ['land', 'space']) {
  test(mode + ': hard collisions stop at contact, hit both hulls once, and rearm only after separation', () => {
    const layer = new RamImpacts(R, mode),
      a = unit(-7),
      b = unit(7),
      list = [a, b];
    const hits = tick(layer, list, () => {
      a.x += 10;
      b.x -= 10;
    });
    assert.equal(hits.length, 1);
    assert(hits[0].d > 0);
    assert(Math.abs(hits[0].at.x) < 0.01);
    assert(a.x < -4.99 && b.x > 4.99 && b.x - a.x < 10.02);
    for (let i = 0; i < 30; i++)
      assert.equal(
        tick(layer, list, () => {
          a.x += 2;
          b.x -= 2;
        }).length,
        0
      );
    tick(layer, list, () => {
      a.x -= 5;
      b.x += 5;
    });
    a.speed = b.speed = 200;
    assert.equal(
      tick(layer, list, () => {
        a.x += 10;
        b.x -= 10;
      }).length,
      1
    );
  });
  test(mode + ': no damage on spawn overlap, glancing touch, formation travel, teleport or different altitude', () => {
    for (const [x, y, z, dx, bdx] of [
      [3, 0, 0, 2, 0],
      [15, 9.999, 0, 10, 0],
      [11, 0, 0, 10, 10],
      [20, 0, 0, 400, 0],
      [15, 0, 12, 10, 0],
      [10.1, 0, 0, 0.25, 0]
    ]) {
      const a = unit(0),
        b = unit(x, { y, z });
      assert.equal(
        tick(new RamImpacts(R, mode), [a, b], () => {
          a.x += dx;
          b.x += bdx;
        }).length,
        0
      );
    }
  });
  test(mode + ': swept hull catches a fast crossing without hitting a second target behind the first', () => {
    const a = unit(0, { hitRadius: 1, speed: 600, maxSpeed: 600 }),
      b = unit(6, { hitRadius: 1 }),
      c = unit(17, { hitRadius: 1 });
    const hits = tick(new RamImpacts(R, mode), [c, a, b], () => (a.x += 30));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].b, b);
    assert(Math.abs(a.x - 4) < 0.02);
  });
}
test('restoring a save between impact and separation does not charge a second hit', () => {
  const layer = new RamImpacts(R, 'land'),
    list = [unit(-7), unit(7)];
  const move = () => {
    list[0].x += 4;
    list[1].x -= 4;
  };
  assert.equal(tick(layer, list, move).length, 1);
  const packed = JSON.parse(JSON.stringify(layer.snapshot(u => 'q' + list.indexOf(u))));
  assert.equal(packed.length, 1);
  list[0] = { ...list[0] };
  list[1] = { ...list[1] };
  const restored = new RamImpacts(R, 'land');
  restored.restore(packed, id => list[+id.slice(1)]);
  assert.equal(tick(restored, list, move).length, 0);
  tick(restored, list, () => {
    list[0].x -= 2;
    list[1].x += 2;
  });
  assert.equal(tick(restored, list, move).length, 1);
  list.splice(0, 1);
  tick(restored, list, () => {});
  assert.deepEqual(
    restored.snapshot(() => 'gone'),
    []
  );
});

test('space: a long hull can ram with its bow, but its enclosing sphere cannot hit across an empty broadside', () => {
  for (const heading of [0, Math.PI / 2, Math.PI * 1.2]) {
    const x = Math.cos(heading),
      y = Math.sin(heading);
    for (const lateral of [0, 14]) {
      const a = unit(0, { hitRadius: 20, hitA: 34, hitB: 5, hitC: 4, heading }),
        b = unit(42 * x - lateral * y, { y: 42 * y + lateral * x, hitRadius: 3 });
      const result = tick(new RamImpacts(R, 'space'), [a, b], () => {
        a.x += 10 * x;
        a.y += 10 * y;
      });
      assert.equal(result.length, lateral ? 0 : 1);
      if (!lateral) assert(Math.abs(Math.hypot(result[0].at.x, result[0].at.y) - 39) < 0.05);
    }
  }
});

test('no model, camera or fog needed; no accidental ram on arrival/transport; smaller hull limits raw damage', () => {
  const layer = new RamImpacts(R, 'space');
  let a = unit(-7, { health: 6, maxHealth: 6, seen: false }),
    b = unit(7, { maxHealth: 8000, seen: false });
  const tryRam = () =>
    tick(layer, [a, b], () => {
      a.x += 10;
      b.x -= 10;
    });
  a.hyper = {};
  assert.equal(tryRam().length, 0);
  a.x = -7;
  b.x = 7;
  a.hyper = null;
  const hits = tryRam();
  assert.equal(hits.length, 1);
  assert(hits[0].d < 3);
  assert(wantsRamming({ mode: 'space' }));
  assert(wantsRamming({ replay: {}, ramRule: 1 }));
  for (const setup of [{ net: {} }, { shooterNet: {} }, { attract: true }, { replay: {} }, { headless: true }])
    assert(!wantsRamming(setup));
});
