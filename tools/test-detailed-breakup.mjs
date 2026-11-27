import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { VehicleWrecks, loadWreckPhysics } from '../public/js/game/vehicle-wrecks.js';
import { SpaceWrecks } from '../public/js/game/space-wrecks.js';
import { cutCap } from '../public/js/game/fracture-caps.js';
import { HullCuts } from '../public/js/game/hull-cut-cache.js';
const R = await loadWreckPhysics();
function hull() {
  const holder = new T.Group(),
    root = new T.Group();
  holder.add(root);
  const skin = new T.MeshBasicMaterial(),
    geo = new T.BoxGeometry(18, 4, 6),
    mesh = new T.Mesh(geo, skin);
  root.add(mesh);
  holder.position.set(28, 0, 20);
  holder.rotation.z = 1.2;
  holder.updateMatrixWorld(true);
  return { holder, root, mesh, skin, geo };
}
function area(mesh) {
  const g = mesh.geometry,
    ix = g.index,
    a = g.attributes.position;
  let sum = 0;
  for (let i = 0; i < (ix?.count ?? a.count); i += 3) {
    const pts = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(a, ix ? ix.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
    sum += new T.Triangle(...pts).getArea();
  }
  return sum;
}
test('land: use posed mechanical islands before cutting a walker; respect its actual draw range', () => {
  const { holder, root, mesh, geo, skin } = hull(),
    scene = new T.Scene(),
    layer = new VehicleWrecks(
      R,
      scene,
      () => 0,
      () => false
    );
  const n = geo.attributes.position.count,
    pos = new Float32Array(n * 3 * 3),
    ids = [],
    bones = new Float32Array(3 * n * 4),
    weights = new Float32Array(3 * n * 4),
    palette = new Float32Array(3 * 16);
  for (let k = 0; k < 3; k++) {
    pos.set(geo.attributes.position.array, k * n * 3);
    ids.push(...Array.from(geo.index.array, i => i + k * n));
    for (let i = 0; i < n; i++) {
      bones[(i + k * n) * 4] = k;
      weights[(i + k * n) * 4] = 1;
    }
    new T.Matrix4().makeTranslation(20 * k, 0, 0).toArray(palette, k * 16);
  }
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new T.BufferAttribute(bones, 4));
  geo.setAttribute('skinWeight', new T.BufferAttribute(weights, 4));
  geo.setIndex(ids);
  geo.setDrawRange(0, (ids.length * 2) / 3);
  try {
    assert(layer.spawn({ holder, inst: { root, skins: [{ mesh, mats: palette }] }, kind: 'VEHICLE', x: 28, y: 0, z: 20 }));
    const { pieces } = layer.live[0];
    assert.equal(pieces.length, 2, 'only two visible islands');
    for (const { root } of pieces) {
      assert.equal(root.children.length, 1);
      assert.equal(root.children[0].geometry.attributes.position, geo.attributes.position);
    }
    assert(Math.abs(pieces[0].root.position.distanceTo(pieces[1].root.position) - 20) < 1e-4);
  } finally {
    layer.dispose();
    geo.dispose();
    skin.dispose();
  }
  assert.equal(geo.attributes.position.array, pos);
  assert.equal(scene.children.length, 0);
});

test('high-poly pods sharing one export node detach intact without copying their surfaces', () => {
  const root = new T.Group(),
    geo = new T.SphereGeometry(5, 100, 50),
    mat = new T.MeshBasicMaterial(),
    cuts = new HullCuts();
  root.add(new T.Mesh(geo, mat), new T.Mesh(geo, mat));
  root.children[1].position.y = 20;
  root.updateMatrixWorld(true);
  const inputs = root.children.map(mesh => ({ mesh }));
  const parts = cuts.cut(inputs, root.matrixWorld, 3);
  assert.equal(parts.length, 2);
  assert(parts.every(p => p.meshes.length === 1 && inputs.includes(p.meshes[0])));
  cuts.dispose();
  geo.dispose();
  mat.dispose();
});

test('cut interiors keep a real engine bore and disjoint pods open', () => {
  const ring = coords =>
    coords.map(([x, y], i) => [
      [x, y, 0],
      [...coords[(i + 1) % coords.length], 0]
    ]);
  const loops = [
    ...ring([
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6]
    ]),
    ...ring([
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3]
    ]),
    ...ring([
      [8, 0],
      [10, 0],
      [10, 2],
      [8, 2]
    ])
  ];
  const cap = cutCap(loops, new T.Vector3(0, 0, 1), 10);
  assert(cap);
  const mesh = new T.Mesh(cap);
  assert.equal(area(mesh), 36);
  cap.dispose();
  mesh.material.dispose();
});

test('articulated hull capture cuts the latest skin pose, not bind space, and retains UVs', () => {
  const { holder, mesh, geo, skin } = hull(),
    cuts = new HullCuts(),
    n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new T.BufferAttribute(new Uint8Array(n * 4), 4));
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) w[4 * i] = 1;
  geo.setAttribute('skinWeight', new T.BufferAttribute(w, 4));
  const palette = new Float32Array(16);
  new T.Matrix4().makeTranslation(25, 7, 0).toArray(palette);
  const original = palette.slice();
  const parts = cuts.cut([{ mesh, palette }], holder.matrixWorld, 3);
  assert.equal(parts.length, 3);
  const bound = new T.Box3();
  for (const p of parts) {
    bound.union(p.box);
    for (const m of p.meshes) {
      if (m.mesh.material === skin) {
        assert(m.palette);
        assert.equal(m.palette[12], 0, 'draw palette must not pose the baked vertices twice');
        assert.equal(m.mesh.geometry.attributes.uv.count, m.mesh.geometry.attributes.position.count);
      }
      m.mesh.geometry.dispose();
    }
  }
  const expected = new T.Vector3(25, 7, 0).applyMatrix4(mesh.matrixWorld);
  assert(bound.getCenter(new T.Vector3()).distanceTo(expected) < 1e-4);
  assert.deepEqual(palette, original);
  cuts.dispose();
  geo.dispose();
  skin.dispose();
});

test('two casualties sharing one hull keep their own paint, orientation, and lifetime', () => {
  const { holder, mesh, geo, skin } = hull(),
    cuts = new HullCuts();
  const a = cuts.cut([{ mesh }], holder.matrixWorld, 3);
  holder.position.x += 1000;
  holder.rotation.z -= 0.6;
  holder.updateMatrixWorld(true);
  const other = new T.MeshBasicMaterial({ color: 0x889944 });
  mesh.material = other;
  const b = cuts.cut([{ mesh }], holder.matrixWorld, 3);
  const bounds = new T.Box3();
  for (const p of b) {
    bounds.union(p.box);
    assert(p.meshes.some(m => m.mesh.material === other));
    assert(p.meshes.every(m => m.mesh.material !== skin));
  }
  assert(bounds.getCenter(new T.Vector3()).distanceTo(holder.position) < 1e-3);
  assert.notEqual(a[0].meshes[0].mesh.geometry, b[0].meshes[0].mesh.geometry);
  for (const p of [...a, ...b]) for (const m of p.meshes) m.mesh.geometry.dispose();
  cuts.dispose();
  geo.dispose();
  skin.dispose();
  other.dispose();
});

for (const mode of ['land', 'space'])
  test(mode + ': a one-piece hull splits into closed, textured sections without changing shared source art', () => {
    const { holder, root, mesh, skin, geo } = hull(),
      pos = geo.attributes.position.array.slice(),
      scene = new T.Scene();
    const layer =
      mode === 'land'
        ? new VehicleWrecks(
            R,
            scene,
            () => 0,
            () => false
          )
        : new SpaceWrecks(R, scene);
    try {
      const u = { holder, inst: { root }, kind: 'VEHICLE', x: 28, y: 0, z: 20 };
      if (mode === 'land') assert(layer.spawn(u));
      else layer.spawn(holder, { x: 0, y: 10, z: 0 }, 22);
      const parts = mode === 'land' ? layer.live[0].pieces : layer.pieces;
      assert.equal(parts.length, 3, 'three full-detail rigid pieces, not the additive death particle');
      scene.updateMatrixWorld(true);
      const centers = parts.map(p => new T.Vector3().copy(p.body.translation()));
      let outside = 0,
        inside = 0;
      for (const part of parts) {
        const pm = (part.root || part.obj).children;
        assert(pm.some(m => m.material === skin));
        assert(
          pm.some(m => m.material !== skin),
          'cap exposed interior'
        );
        for (const m of pm) {
          if (m.material === skin) {
            assert(m.geometry.attributes.uv);
            outside += area(m);
          } else inside += area(m);
        }
      }
      assert(Math.abs(outside - area(mesh)) < 1e-3, 'all original exterior panels retained once');
      assert(inside >= 96 - 1e-3, 'both faces of each cut closed');
      for (let i = 0; i < 30; i++) layer.step(1 / 60);
      assert(
        centers[0].distanceTo(centers[1]) + 0.01 < new T.Vector3().copy(parts[0].body.translation()).distanceTo(parts[1].body.translation())
      );
      assert.deepEqual(geo.attributes.position.array, pos);
      assert.equal(mesh.geometry, geo);
    } finally {
      layer.dispose();
      geo.dispose();
      skin.dispose();
    }
    assert.equal(scene.children.length, 0);
  });
