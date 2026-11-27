import * as T from '../../vendor/three/build/three.module.js';

// Use the terrain's diagonal and linearly interpolated height. Dry portions must not
// rely on the opaque terrain winning the depth test, especially on displaced banks.
export function liquidGeometry(t, cell, reflectionRegions = null) {
  const n = t.size,
    height = t.heights,
    level = t.water.level;
  const pos = [],
    depth = [];
  const xOf = i => (i % n) * cell,
    yOf = i => Math.floor(i / n) * cell;
  function put(x, y, d) {
    pos.push(x, y, level);
    depth.push(d);
  }
  function vertex(i) {
    put(xOf(i), yOf(i), level - height[i]);
  }
  function triangle(a, b, c) {
    if (height[a] >= level && height[b] >= level && height[c] >= level) return;
    if (height[a] <= level && height[b] <= level && height[c] <= level) {
      vertex(a);
      vertex(b);
      vertex(c);
      return;
    }
    const poly = [];
    let prev = c;
    for (const i of [a, b, c]) {
      if ((height[prev] < level && height[i] > level) || (height[prev] > level && height[i] < level)) {
        // Canonical endpoints give both triangles exactly the same crossing.
        const s = Math.min(i, prev),
          e = Math.max(i, prev),
          f = (level - height[s]) / (height[e] - height[s]);
        poly.push([xOf(s) + f * (xOf(e) - xOf(s)), yOf(s) + f * (yOf(e) - yOf(s)), 0]);
      }
      if (height[i] <= level) poly.push([xOf(i), yOf(i), level - height[i]]);
      prev = i;
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      put(...poly[0]);
      put(...poly[k]);
      put(...poly[k + 1]);
    }
  }
  // Build conservative boxes from wet cells only. A single box around the entire
  // sheet can span large stretches of dry land between ponds. Lava needs none.
  const cols = Math.ceil(((t.width ?? n) - 1) / 8), blocks = reflectionRegions && [],
    point = reflectionRegions && new T.Vector3(), z = Math.fround(level);
  for (let y = 0; y < (t.height ?? n) - 1; y++)
    for (let x = 0; x < (t.width ?? n) - 1; x++) {
      const a = y * n + x, start = pos.length;
      triangle(a, a + 1, a + n + 1);
      triangle(a, a + n + 1, a + n);
      if (blocks && pos.length !== start) {
        const k = (y >> 3) * cols + (x >> 3);
        let box = blocks[k];
        if (!box) reflectionRegions.push(box = blocks[k] = new T.Box3());
        box.expandByPoint(point.set(x * cell, y * cell, z));
        box.expandByPoint(point.set((x + 1) * cell, (y + 1) * cell, z));
      }
    }
  if (!pos.length) return null;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('depth', new T.Float32BufferAttribute(depth, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// An authored layer turn is a rigid rotation of *both* UV axes. Scroll heading is
// already in texture space. Shared by the water, lava and ice programs on both APIs.
export function slideShader(wg) {
  const V = wg ? 'vec2f' : 'vec2',
    d = wg ? 'let' : 'vec2';
  return `${wg ? 'fn slide(vWorld:vec3f,r:vec4f,aside:f32)->vec2f' : 'uniform float time; vec2 slide(vec4 r,float aside)'} {
    ${d} axis=${V}(cos(r.y),sin(r.y));
    ${d} uv=${V}(dot(vWorld.xy,axis),dot(vWorld.xy,${V}(-axis.y,axis.x)))/r.x;
    return uv+${V}(cos(r.w+aside),sin(r.w+aside))*r.z*${wg ? 'D.time' : 'time'};
  }`;
}
