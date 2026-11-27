// Real terrain/water builders, synthetic height fields. No mounted assets or graphics device.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
const three = new URL('../public/vendor/three/build/three.module.js', import.meta.url).href;
register(
  'data:text/javascript,' +
    encodeURIComponent(`export function resolve(n,c,next){return n==='three'?{url:${JSON.stringify(three)},shortCircuit:true}:next(n,c)}`),
  import.meta.url
);
const T = await import(three),
  { buildTerrain, buildWater, drawSky } = await import('../public/js/game/terrain.js');
function field(w, h, at, mode = 1) {
  const size = Math.max(w, h),
    heights = new Float32Array(size * size);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) heights[y * size + x] = at(x, y);
  return {
    width: w,
    height: h,
    size,
    heights,
    layerIndex: new Uint8Array(heights.length),
    shade: new Uint8Array(heights.length).fill(254),
    layers: [],
    water: {
      mode,
      level: 0,
      tint: [1, 1, 1],
      glint: [1, 1, 1],
      textures: ['', '', ''],
      ripples: [],
      reflect: 0.5,
      fade: 10,
      least: 0.2,
      bend: 0.1
    }
  };
}
test('a single planar hillside keeps its normal up to rectangular map edges', async () => {
  const mesh = await buildTerrain(field(5, 3, (x, y) => 20 * x - 10 * y));
  const expect = new T.Vector3(-1, 0.5, 1).normalize(),
    normal = new T.Vector3(),
    attr = mesh.geometry.attributes.normal;
  for (let i = 0; i < mesh.geometry.drawRange.count; i++)
    assert(normal.fromBufferAttribute(attr, i).distanceTo(expect) < 1e-6, `vertex ${i}: ${normal.toArray()}`);
});
for (const mode of [1, 2, 3])
  test(`sheet ${mode} stops at the waterline inside a partly wet cell`, () => {
    const m = buildWater(field(2, 2, (x, y) => (x || y ? 1 : -1), mode));
    const { position: p, depth: d } = m.children[0].geometry.attributes;
    let area = 0;
    for (let i = 0; i < p.count; i += 3) {
      const twice = (p.getX(i + 1) - p.getX(i)) * (p.getY(i + 2) - p.getY(i)) - (p.getY(i + 1) - p.getY(i)) * (p.getX(i + 2) - p.getX(i));
      assert(twice > 0, 'degenerate or back-facing liquid');
      area += twice / 2;
    }
    assert.equal(area, 100, 'wet footprint inside the 20×20 cell');
    assert([...d.array].every(z => z >= 0));
    assert(Math.max(...d.array) > 0);
  });
function reflection() {
  const g = buildWater(field(2, 2, () => -1)),
    c = new T.PerspectiveCamera(60, 1, 0.1, 500),
    destination = {};
  c.position.set(10, -10, 30);
  c.lookAt(10, 10, 0);
  c.updateMatrixWorld();
  const r = {
    target: destination,
    getDrawingBufferSize: s => s.set(128, 128),
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(t) {
      this.target = t;
    },
    state: { buffers: { depth: { setMask() {} } } },
    clear() {}
  };
  return { g, c, r, destination };
}
test('aborted reflection releases the target, unhides water and retries', () => {
  const { g, c, r, destination } = reflection(),
    stop = new Error('interrupted pass');
  assert.throws(
    () =>
      g.userData.mirror(r, c, () => {
        assert(!g.visible);
        throw stop;
      }),
    e => e === stop
  );
  assert.equal(r.target, destination);
  assert(g.visible);
  let calls = 0;
  g.userData.mirror(r, c, () => calls++);
  assert.equal(calls, 1);
});
test('a renderer switch never reuses the other device\'s reflection', () => {
  const { g, c, r } = reflection(), other = { ...r }, draws = [];
  for (const renderer of [r, other, other, r])
    g.userData.mirror(renderer, c, () => draws.push(renderer === r ? 'first' : 'second'));
  assert.deepEqual(draws, ['first', 'second', 'first']);
});
test('reflection cannot unhide a deliberately hidden sheet', () => {
  const { g, c, r } = reflection();
  g.visible = false;
  let calls = 0;
  g.userData.mirror(r, c, () => calls++);
  assert(!g.visible);
  assert.equal(calls, 0);
});
test('surfacing refreshes immediately without disabling the half-rate pass', () => {
  const { g, c, r } = reflection(),
    below = c.clone();
  below.position.z = -10;
  below.lookAt(10, 10, 0);
  below.updateMatrixWorld();
  let calls = 0;
  const draw = () => calls++;
  g.userData.mirror(r, below, draw);
  assert.equal(calls, 0);
  g.userData.mirror(r, c, draw);
  assert.equal(calls, 1);
  g.userData.mirror(r, c, draw);
  assert.equal(calls, 1);
  g.userData.mirror(r, c, draw);
  assert.equal(calls, 2);
});
for (const mode of [1, 3]) test(`separated sheets (${mode}) skip the dry gap and refresh on entering either pond`, () => {
  const { c, r } = reflection(), group = buildWater(field(65, 9, (x, y) => (y === 4 && (x === 2 || x === 62) ? -1 : 5), mode));
  let n = 0;
  function look(x) {
    c.position.set(x, 80, 25); c.lookAt(x, 80, 0); c.updateMatrixWorld();
    group.userData.mirror(r, c, () => n++);
  }
  look(640); look(650); assert.equal(n, 0, 'no reflected draws between separate ponds');
  look(40); look(40); assert.equal(n, 1, 'visible water still draws at half rate');
  look(40); assert.equal(n, 2);
  look(640); look(1240); assert.equal(n, 3, 'first visible frame after the gap must refresh');
});
test('an interrupted reflected sky restores the oblique camera projection and inverse', () => {
  const { g, c, r } = reflection();
  g.userData.mirror(r, c, eye => {
    const projection = eye.projectionMatrix.clone(),
      inverse = eye.projectionMatrixInverse.clone();
    assert(!projection.equals(eye.userData.plain));
    assert.throws(
      () =>
        drawSky(
          {
            render() {
              throw Error('interrupted sky');
            }
          },
          new T.Scene(),
          eye
        ),
      /interrupted sky/
    );
    assert(eye.projectionMatrix.equals(projection));
    assert(eye.projectionMatrixInverse.equals(inverse));
  });
});
