import * as THREE from 'three';
// Nest contours by containment, not winding. A symbol may contain holes with
// other disconnected pieces inside them (e.g. a hub within a cog's outer rim).
function inside(p, loop) {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i],
      b = loop[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function pathFor(loop, hole, round) {
  const path = hole ? new THREE.Path() : new THREE.Shape(),
    n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i + n - 1) % n],
      p = loop[i],
      b = loop[(i + 1) % n],
      da = p.distanceTo(a),
      db = p.distanceTo(b);
    const corner = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (da * db || 1);
    const r = corner > 0.34 ? Math.min(round, da * 0.35, db * 0.35) : 0,
      t = da ? r / da : 0,
      u = db ? r / db : 0;
    path[i ? 'lineTo' : 'moveTo'](p.x + (a.x - p.x) * t, p.y + (a.y - p.y) * t);
    if (r) path.quadraticCurveTo(p.x, p.y, p.x + (b.x - p.x) * u, p.y + (b.y - p.y) * u);
  }
  path.closePath();
  return path;
}
function solidLayer(body, w, h, depth) {
  const rings = body
    .map(nums => {
      const points = [],
        box = new THREE.Box2();
      for (let i = 0; i < nums.length; i += 2) {
        const p = new THREE.Vector2(nums[i] / 8192, -nums[i + 1] / 8192);
        if (!points.at(-1)?.equals(p)) {
          points.push(p);
          box.expandByPoint(p);
        }
      }
      return { points, box, area: Math.abs(THREE.ShapeUtils.area(points)), depth: 0 };
    })
    .filter(r => r.points.length >= 3 && r.area > 1e-8)
    .sort((a, b) => b.area - a.area);
  const shapes = [];
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    let parent;
    for (let j = i - 1; j >= 0; j--) {
      const q = rings[j];
      if (q.box.containsBox(r.box) && inside(r.points[0], q.points)) {
        parent = q;
        break;
      }
    }
    r.depth = parent ? parent.depth + 1 : 0;
    const hole = r.depth % 2;
    const path = pathFor(r.points, hole, Math.min(0.014, 0.82 / Math.max(w, h)));
    if (hole) parent.shape.holes.push(path);
    else {
      r.shape = path;
      shapes.push(path);
    }
  }
  if (!shapes.length) return null;
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.0022,
    bevelSegments: 1,
    curveSegments: 3,
    steps: 1
  });
  return geo.translate(0, 0, -depth / 2);
}
export function crestSolid({ body, relief, w, h }) {
  const base = solidLayer(body, w, h, 0.105),
    raised = relief && solidLayer(relief, w, h, 0.149);
  if (!base) throw Error('Empty crest contours');
  const geo = new THREE.BufferGeometry(),
    layers = raised ? [base, raised] : [base];
  for (const key of ['position', 'normal']) {
    const size = layers.reduce((n, g) => n + g.attributes[key].array.length, 0),
      data = new Float32Array(size);
    let at = 0;
    for (const g of layers) {
      data.set(g.attributes[key].array, at);
      at += g.attributes[key].array.length;
    }
    geo.setAttribute(key, new THREE.BufferAttribute(data, 3));
  }
  const signal = new Float32Array(geo.attributes.position.count);
  signal.fill(raised ? 0.32 : 1, 0, base.attributes.position.count);
  if (raised) signal.fill(1, base.attributes.position.count);
  geo.setAttribute('signal', new THREE.BufferAttribute(signal, 1));
  for (const g of layers) g.dispose();
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox,
    span = Math.max(max.x - min.x, max.y - min.y);
  geo.translate(-(max.x + min.x) / 2, -(max.y + min.y) / 2, -(max.z + min.z) / 2);
  geo.scale(1 / span, 1 / span, 1);
  geo.computeBoundingSphere();
  return geo;
}
