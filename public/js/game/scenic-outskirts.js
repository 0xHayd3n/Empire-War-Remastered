// Display-only scenery. The land game still picks, moves, simulates fog and builds from
// the original TED. No part of this group enters the prop list, minimap, or caster list.
import * as T from 'three';
import { depositField } from './ground-deposition.js';
import { buildScenicRing } from './scenic-ring.js';
import { digest } from '../texture-showcase/recipes.js';
import { textureFromBytes, whiteTexture } from '../dds.js';
import { groveMaterial, randomAt } from './endor-grove.js';
const blankPick = () => {};

// Three orthographic projections of the same crown used inside Yavin. Static stands
// are spatially binned once, so the renderer can skip a whole hillside from any eye.
function crownCards() {
  const pos = [],
    norm = [],
    uv = [],
    indices = [];
  for (const [side, u, v, w] of [
    [0, 0, 2, 1],
    [1, 1, 2, 0],
    [2, 0, 1, 2]
  ]) {
    const base = pos.length / 3;
    for (let row = 0; row <= 2; row++)
      for (let col = 0; col <= 2; col++) {
        const i = col / 2,
          j = row / 2,
          p = [0, 0, 0],
          bounds = [
            [-14, 13],
            [-11, 11],
            [-0.4, 21]
          ];
        p[u] = bounds[u][0] + i * (bounds[u][1] - bounds[u][0]);
        p[v] = bounds[v][0] + j * (bounds[v][1] - bounds[v][0]);
        // A vaulted crown, not a flat tabletop across two vertical cutouts.
        p[w] = side === 2 ? 19 - 5 * (Math.abs(i - 0.5) + Math.abs(j - 0.5)) * 2 : 2.8 * (1 - 2 * Math.abs(i - 0.5)) * (1 - j);
        pos.push(...p);
        const n = new T.Vector3(p[0] / 15, p[1] / 15, 0.9).normalize();
        norm.push(n.x, n.y, n.z);
        uv.push((side + (5.5 + 245 * i) / 256) / 3, (5.5 + 245 * (1 - j)) / 256);
      }
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const k = base + j * 3 + i;
        indices.push(k, k + 1, k + 3, k + 1, k + 4, k + 3);
      }
  }
  const g = new T.BufferGeometry();
  for (const [name, a, n] of [
    ['position', pos, 3],
    ['normal', norm, 3],
    ['uv', uv, 2]
  ])
    g.setAttribute(name, new T.Float32BufferAttribute(a, n));
  g.setIndex(indices);
  return g;
}
function stands(r, seed) {
  const { positions: p, index, extent } = r,
    bins = new Map(),
    rng = (f, k) => randomAt(f, k, seed),
    { width: w, height: h } = extent;
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f] * 3,
      b = index[f + 1] * 3,
      c = index[f + 2] * 3,
      bx = p[b] - p[a],
      by = p[b + 1] - p[a + 1],
      cx = p[c] - p[a],
      cy = p[c + 1] - p[a + 1],
      area = (bx * cy - by * cx) * 0.5;
    // Sample the rendered triangles, not the analytic hill function: coarse distant
    // triangles do not pass through every analytic height.
    const expect = area / 7800,
      count = Math.floor(expect) + (rng(f, 1) < expect % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      let u = rng(f, 2 + i * 6),
        v = rng(f, 3 + i * 6);
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const x = p[a] + u * bx + v * cx,
        y = p[a + 1] + u * by + v * cy,
        d = Math.hypot(Math.max(0, -x, x - w), Math.max(0, -y, y - h));
      const mass = 0.58 + 0.24 * Math.sin(x * 0.0047 + 2 * Math.sin(y * 0.003)) + 0.25 * Math.sin(y * 0.007 + x * 0.0025);
      if (d < 58 || rng(f, 4 + i * 6) > mass * Math.max(0.13, 1 - d / 4100)) continue;
      const z = p[a + 2] + u * (p[b + 2] - p[a + 2]) + v * (p[c + 2] - p[a + 2]),
        s = 3 + 3.6 * rng(f, 5 + i * 6),
        angle = rng(f, 6 + i * 6) * Math.PI * 2;
      const key = (d < 1250 ? 'near:' : 'far:') + Math.floor(x / 1100) + ',' + Math.floor(y / 1100);
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push([x, y, z - 1, s, angle]);
    }
  }
  return bins;
}
export async function prepareOutskirts(g, t, material, policy, crown, signal, deposition) {
  const desert=policy.profile==='arid-basin' && policy.treeClass===null,
    polar=policy.profile==='glacial-basin' && policy.treeClass===null,
    mesas=policy.profile==='eroded-badlands' && policy.treeClass===null,
    shelf=policy.profile==='sinkhole-shelf' && policy.treeClass===null,
    meadow=policy.profile==='terraced-meadow' && policy.treeClass===null, bare=desert||polar||mesas||meadow||shelf;
  if (policy.treatment !== (polar?'mountains':'foothills') || (!bare && policy.treeClass !== 'canopy') || t.water?.mode === 1)
    throw Error('Unsupported reviewed outskirts');
  const r = buildScenicRing(t, {
    relief: mesas?'benches':'foothills',
    seed: policy.seed,
    reach: 7400,
    amplitude: shelf ? 185 : meadow ? 255 : polar ? 890 : mesas ? 590 : desert ? 645 : 480,
    lift: polar ? 1.18 : desert ? 1.05 : 1.3,
    // Keep the open meadow skyline low. Descend behind the foothills, rather than
    // lifting their crests to hide the polygon edge from the maximum oblique camera.
    backSlope: shelf ? 10 : meadow ? 7 : 2.8,
    ease: 480,
    ...(polar||mesas||meadow||shelf?{maxGap:260,maxSpacing:185}:{}),
    maxTriangles: 29000
  });
  if (!r.ok) throw Error('Scenic terrain: ' + r.message);
  let bytes;
  if(!bare){const res=await fetch(new URL('../../art/yavin-fringe/jacaranda-horizon.png', import.meta.url),{signal});if(!res.ok)throw Error('Missing scenic canopy');bytes=await res.arrayBuffer();if(await digest(bytes)!==policy.crown)throw Error('Changed scenic canopy');}
  const group = new T.Group(),
    owned = [],
    own = o => (owned.push(o), o);
  group.name = 'Reviewed outskirts';
  group.visible = false;
  function dispose() {
    group.removeFromParent();
    for (const o of owned) o.dispose();
    owned.length = 0;
  }
  try {
    const tex = bytes ? own(await textureFromBytes(bytes)) : null;
    if (signal.aborted) throw Error('Outskirts cancelled');
    const geo = own(new T.BufferGeometry()),
      mat = own(
        new T.ShaderMaterial({
          glslVersion: material.glslVersion,
          defines: { ...material.defines },
          vertexShader: material.vertexShader,
          fragmentShader: material.fragmentShader,
          uniforms: {
            ...material.uniforms,
            groundMixB: { value: material.uniforms.groundMixB.value.clone() },
            reliefPatch: { value: new T.Vector4() }
          }
        })
      );
    mat.uniforms.groundMixB.value.w = meadow ? 6 : (mesas||shelf) ? 5 : polar ? 4 : desert ? 3 : 2;
    const shade = new Float32Array(r.vertexCount),
      layers = new Float32Array(4 * r.vertexCount),
      corners = new Float32Array(2 * r.vertexCount);
    layers.fill(material.uniforms.groundMixA.value.x);
    // No built corners outside the TED. Carry a continuous, interpolated mantle share
    // in that unused attribute; the fragment shader still joins the exact clamped rim.
    if(bare){const field=depositField(deposition);for(let i=0;i<r.vertexCount;i++)corners[2*i]=field(r.positions[3*i],r.positions[3*i+1]);}
    for (let i = 0; i < shade.length; i++) {
      const x = Math.round(Math.max(0, Math.min(r.extent.width, r.positions[i * 3])) / 20),
        y = Math.round(Math.max(0, Math.min(r.extent.height, r.positions[i * 3 + 1])) / 20),
        k = Math.min(1, r.depth[i] / 300);
      shade[i] = Math.min(1, t.shade[x + y * t.size] / 254) * (1 - k) + 0.92 * k;
      // The TED's perimeter uses one-sided gradients. Copy the actual submitted
      // vertex normal at the seam rather than lighting the two sides independently.
      if (!r.depth[i]) {
        const cx = Math.min(x, t.width - 2),
          cy = Math.min(y, t.height - 2),
          dx = x - cx,
          dy = y - cy,
          tri = 2 * (cy * (t.width - 1) + cx) + (dy > dx ? 1 : 0),
          corner = dx === 0 && dy === 0 ? 0 : dx === 1 && dy === 0 ? 1 : 2,
          v = t.paint.triAt[tri] + corner,
          attr = t.paint.geo.attributes.normal;
        r.normals.set([attr.getX(v), attr.getY(v), attr.getZ(v)], 3 * i);
      }
    }
    for (const [name, a, n] of [
      ['position', r.positions, 3],
      ['normal', r.normals, 3],
      ['shade', shade, 1],
      ['layers', layers, 4],
      ['corner', corners, 2]
    ])
      geo.setAttribute(name, new T.BufferAttribute(a, n));
    geo.setIndex(new T.BufferAttribute(r.index, 1));
    const ground = new T.Mesh(geo, mat);
    ground.name = 'Exterior terrain';
    ground.userData.withoutLastStrip = r.indexCount - 3 * (r.rings.at(-1).vertices + r.rings.at(-2).vertices);
    ground.raycast = blankPick;
    group.add(ground);
    let crowns=0, standCount=0;
    if(tex){
    const leaves = own(groveMaterial(tex, whiteTexture(), true));
    delete leaves.defines.BUMP;
    leaves.defines.ENDOR_WOODLAND = 1;
    leaves.uniforms.alphaRef.value = 0.25;
    leaves.uniforms.emissive.value.setRGB(0.11, 0.12, 0.095);
    const cards = own(crownCards()),
      near = own(crown.geometry.clone()),
      m = new T.Object3D(),
      bins = stands(r, policy.seed);
    standCount=bins.size;
    // In each family all chunks share immutable vertex buffers. Only the used matrices
    // belong to a chunk; the all-neutral tint buffer is sized to the largest single draw.
    for (const [prefix, geometry] of [
      ['near:', near],
      ['far:', cards]
    ]) {
      const capacity = Math.max(0, ...[...bins].filter(([key]) => key.startsWith(prefix)).map(([, rows]) => rows.length));
      geometry.setAttribute('instanceTint', new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    }
    for (const [key, rows] of bins) {
      const local = key.startsWith('near:'),
        mesh = own(new T.InstancedMesh(local ? near : cards, local ? crown.material : leaves, rows.length));
      mesh.raycast = blankPick;
      rows.forEach(([x, y, z, s, turn], i) => {
        m.position.set(x, y, z);
        m.rotation.z = turn;
        m.scale.setScalar(s);
        m.updateMatrix();
        mesh.setMatrixAt(i, m.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      crowns += rows.length;
    }
    }
    g.scene.add(group);
    return {
      group,
      dispose,
      receipt: { treatment: policy.treatment, triangles: r.triangleCount, crowns, stands: standCount, reach: r.reach, rim: r.rimCount }
    };
  } catch (e) {
    dispose();
    throw e;
  }
}
