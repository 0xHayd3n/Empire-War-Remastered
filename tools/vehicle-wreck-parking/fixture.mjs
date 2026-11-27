// A small authored ground vehicle: opaque hull groups (one mesh each) or a single
// monolithic hull, plus the unit record the wreck layer reads. Z is up and the
// terrain height field returns z = 0.
import * as THREE from 'three';

export function buildVehicle({ x = 0, y = 0, z = 10, heading = 0.4, parts = 3, single = false } = {}) {
  const holder = new THREE.Group();
  const root = new THREE.Group();
  holder.add(root);
  holder.position.set(x, y, z);
  const groups = [];
  const make = (parent, name, geo) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.name = name;
    parent.add(mesh);
    groups.push({ parent, mesh, geo });
  };
  if (single) {
    make(root, 'hull', new THREE.BoxGeometry(36, 8, 6));
  } else {
    for (let i = 0; i < parts; i++) {
      const g = new THREE.Group();
      g.name = 'part' + i;
      g.position.set(i === 0 ? 0 : i % 2 ? 16 : -16, 0, i === 0 ? 0 : i % 3 === 0 ? 3 : -3);
      root.add(g);
      make(g, 'mesh' + i, new THREE.BoxGeometry(9, 4, 5));
    }
  }
  holder.updateMatrixWorld(true);
  return {
    holder,
    root,
    groups,
    u: {
      kind: 'VEHICLE',
      x,
      y,
      z,
      heading,
      holder,
      inst: { root },
      type: { name: 'WreckFixtureTank' },
      seen: true
    }
  };
}

// A locally visible, grounded, heavy mover. The wreck layer may read it; it must
// never write to it. Tests wrap it in a throwing Proxy to prove that.
export function buildMover({ x = 0, y = 0, speed = 40, hitRadius = 15, ...extra } = {}) {
  return {
    kind: 'VEHICLE',
    x,
    y,
    z: 0,
    speed,
    hitRadius,
    foot: false,
    structure: false,
    flies: false,
    dead: false,
    seen: true,
    holder: { visible: true },
    type: { name: 'WreckFixtureMover' },
    ...extra
  };
}

export function snapshot(root) {
  return {
    position: root.position.toArray(),
    quaternion: root.quaternion.toArray(),
    visible: root.visible,
    children: root.children.map(mesh => ({
      geometry: mesh.geometry,
      material: mesh.material,
      name: mesh.name,
      matrix: mesh.matrix.toArray()
    }))
  };
}

export function disposeCount(geometries) {
  const seen = new Map();
  for (const geo of geometries) {
    if (!geo || seen.has(geo)) continue;
    const original = geo.dispose.bind(geo);
    const row = { disposed: 0 };
    geo.dispose = () => {
      row.disposed++;
      original();
    };
    seen.set(geo, row);
  }
  return () => [...seen.values()].every(row => row.disposed > 0);
}
