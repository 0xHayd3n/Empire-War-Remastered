// Additional CC0 model instances: a view-local population sampled from the actual painted habitat.
// No entity is added to props, navigation, targeting or saves. Samples belong to map coordinates,
// so panning away and back grows exactly the same clump. Do not scatter into gameplay paving.
import * as T from 'three';
import {coverAt, dryFootprint} from './endor-habitat.js';
import { lighting, programSources, boltLights, blastLights } from '../model.js';
import { textureFromBytes } from '../dds.js';
import { digest } from '../texture-showcase/recipes.js';
const dir = new URL('../../art/endor-grove/', import.meta.url);
const budgets = { grass: 1400, meadow: 290, fern: 95, bush: 35, sapling: 8 };
export function randomAt(x, y, k) {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(k, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
export function habitat(t, ids, x, y) {
  const w = t.width ?? t.size,
    h = t.height ?? t.size,
    xx = x / 20,
    yy = y / 20,
    i = Math.floor(xx),
    j = Math.floor(yy);
  if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) return null;
  const a = j * t.size + i,
    n = t.size,
    fx = xx - i,
    fy = yy - j,
    v = [a, a + 1, a + n, a + n + 1],
    wt = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
    z = t.heights;
  let meadow = 0,
    wood = 0,
    hard = 0;
  for (let k = 0; k < 4; k++) {
    const id = ids[t.layerIndex[v[k]]];
    if (id === 0) meadow += wt[k];
    else if (id === 1 || id === 2) wood += wt[k];
    else hard += wt[k];
  }
  if (hard > 0.12 || Math.max(...v.map(i => z[i])) - Math.min(...v.map(i => z[i])) > 10) return null;
  const base =
    fx >= fy ? (1 - fx) * z[a] + (fx - fy) * z[a + 1] + fy * z[a + n + 1] : (1 - fy) * z[a] + (fy - fx) * z[a + n] + fx * z[a + n + 1];
  if (t.water?.mode && base < t.water.level + 1.2) return null;
  return { meadow, wood, z: base };
}
export function groveMaterial(map, normalMap, cutout) {
  const m = new T.ShaderMaterial({
    vertexShader: programSources.VERT,
    fragmentShader: programSources.FRAG,
    defines: { BUMP: 1, ...(cutout ? { ALPHA: 1 } : {}) },
    side: cutout ? T.DoubleSide : T.FrontSide,
    uniforms: {
      ...lighting,
      ...boltLights,
      ...blastLights,
      map: { value: map },
      normalMap: { value: normalMap },
      emissive: { value: new T.Color(0.085, 0.085, 0.085) },
      diffuse: { value: new T.Color(1, 1, 1) },
      specular: { value: new T.Color(0.055, 0.055, 0.055) },
      shininess: { value: 10 },
      colorization: { value: new T.Vector4(1, 1, 1, 1) },
      opacity: { value: 1 },
      tint: { value: new T.Vector4(1, 1, 1, -1) },
      alphaRef: { value: 0.34 },
      glow: { value: 1 },
      ghost: { value: 0 },
      dissolve: { value: 0 },
      uvScroll: { value: new T.Vector2() }
    }
  });
  m.userData.depthOk = !cutout;
  m.userData.alpha = cutout;
  return m;
}
export async function prepareGrove(game, ids, signal, tier = 0, recipe=null) {
  const capFor = kind => Math.ceil(budgets[kind] * [1, 0.62, 0.33][Math.min(2, tier)]);
  const group = new T.Group(),
    owned = [],
    batches = [],
    t = game.terrain,
    stats = { grass: 0, fern: 0, sapling: 0, triangles: 0 },
    trans = new T.Object3D();
  const woody = new T.Group();woody.name='Endor understory shadow casters';woody.userData.casts=true;woody.visible=false;
  group.name = 'Endor planted woodland';
  group.visible = false;
  const own = o => (owned.push(o), o),
    dispose = () => {
      group.removeFromParent();woody.removeFromParent();
      for (const a of owned) a.dispose();
    };
  async function fetchArt(file) {
    const r = await fetch(new URL(file, dir), { signal });
    if (!r.ok) throw Error('Missing plant ' + file);
    const bytes=await r.arrayBuffer();if(recipe && await digest(bytes)!==recipe.files[file])throw Error('Changed grove file: '+file);return bytes;
  }
  try {
    const rows = JSON.parse(new TextDecoder().decode(await fetchArt('models.json'))),
      mats = {};
    for (const row of rows) {
      const { kind, material: key, vertices, triangles } = row;
      if(recipe && !recipe.kinds.includes(kind))continue;
      const bytes = await fetchArt(row.file);
      if ((await digest(bytes)) !== row.sha256 || bytes.byteLength !== vertices * 32 + triangles * 6) throw Error('Invalid ' + row.file);
      if (!mats[key]) {
        const color = own(await textureFromBytes(await fetchArt(key + '.png'), key === 'bark')),
          normal = own(await textureFromBytes(await fetchArt(key + '-normal.png'), key === 'bark'));
        mats[key] = own(groveMaterial(color, normal, key !== 'bark'));
      }
      const g = own(new T.BufferGeometry()),
        inter = new Float32Array(bytes, 0, vertices * 8);
      for (const [label, n, offset] of [
        ['position', 3, 0],
        ['normal', 3, 3],
        ['uv', 2, 6]
      ]) {
        const arr = new Float32Array(vertices * n);
        for (let i = 0; i < vertices; i++) for (let c = 0; c < n; c++) arr[i * n + c] = inter[i * 8 + offset + c];
        g.setAttribute(label, new T.BufferAttribute(arr, n));
      }
      g.setIndex(new T.BufferAttribute(new Uint16Array(bytes, vertices * 32), 1));
      g.computeTangents();
      const tan = g.attributes.tangent,
        norm = g.attributes.normal,
        tan3 = [],
        bin = [];
      const p = new T.Vector3(),
        q = new T.Vector3();
      for (let i = 0; i < vertices; i++) {
        p.fromBufferAttribute(tan, i);
        tan3.push(p.x, p.y, p.z);
        q.fromBufferAttribute(norm, i).cross(p).multiplyScalar(tan.getW(i));
        bin.push(q.x, q.y, q.z);
      }
      g.setAttribute('tangent', new T.Float32BufferAttribute(tan3, 3));
      g.setAttribute('binormal', new T.Float32BufferAttribute(bin, 3));
      const cap = capFor(kind);
      g.setAttribute('instanceTint', new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      const m = own(new T.InstancedMesh(g, mats[key], cap));
      m.count = 0;
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.frustumCulled = false;
      (kind==='sapling'||kind==='bush'||kind==='fern'?woody:group).add(m);
      batches.push({ m, kind, key, variant: row.variant, triangles });
    }
    let last = '',
      was = false;
    const keepClear = [...(game.world.sites || []).map(p => [p.x, p.y, 38]), ...(game.world.points || []).map(p => [p.x, p.y, 22])];
    // Habitat, clearance and seed are world-space. Cache rejections as well as
    // plants; never cache the moving detailed surface or a per-view LOD decision.
    const rings = new Map();
    let oldCanopy, oldVersion, oldLayers;
    const update = (on, patch, canopy) => {
      group.visible = woody.visible = on;
      if (!on) {
        was = false;
        return;
      }
      const v = game.view,
        band = v.dist < 145 ? 0 : v.dist < 330 ? 1 : v.dist < 680 ? 2 : 3,
        cx = Math.floor(v.x / 10) * 10 + 5,
        cy = Math.floor(v.y / 10) * 10 + 5,
        key = [cx, cy, band, patch.triangles > 0, canopy?.version, t.paint.geo.attributes.layers.version].join('/');
      const layers = t.paint.geo.attributes.layers.version;
      if (canopy !== oldCanopy || canopy?.version !== oldVersion || layers !== oldLayers) {
        rings.clear(); was = false; oldCanopy = canopy; oldVersion = canopy?.version; oldLayers = layers;
      }
      if (was && last === key) return;
      was = true;
      last = key;
      stats.triangles = 0;
      for (const kind of recipe?.kinds||Object.keys(budgets)) {
        const step = { grass: 4.5, meadow: 4.0, fern: 17, bush: 17, sapling: 57 }[kind],
          r = {
            grass: [114, 112, 0, 0],
            meadow: [67, 48, 0, 0],
            fern: [155, 205, 210, 0],
            bush: [105, 115, 0, 0],
            sapling: [248, 305, 340, 0]
          }[kind][band],
          cand = [],
          bs = batches.filter(b => b.kind === kind);
        // Each ring fits this kind's widest visible diameter. A distant jump
        // reuses the same storage; absolute coordinates disambiguate wrapping.
        let ring = rings.get(kind);
        if (!ring) { ring = {side: {grass:64,meadow:64,fern:32,bush:16,sapling:16}[kind], slots:[]}; rings.set(kind,ring); }
        if (r)
          for (let j = Math.floor((cy - r) / step); j <= (cy + r) / step; j++)
            for (let i = Math.floor((cx - r) / step); i <= (cx + r) / step; i++) {
              const mask=ring.side-1, slot=(i&mask)+(j&mask)*ring.side;
              let site=ring.slots[slot];
              if(site?.i===i && site.j===j){
                if(Number.isFinite(site.z)){
                  site.d=(site.x-cx)**2+(site.y-cy)**2;
                  if(site.d<=r*r)cand.push(site);
                }
                continue;
              }
              const x = (i + 0.12 + randomAt(i, j, 1) * 0.76) * step,
                y = (j + 0.12 + randomAt(i, j, 2) * 0.76) * step,
                d = (x - cx) ** 2 + (y - cy) ** 2;
              if (d > r * r) continue;
              site=ring.slots[slot]={x,y,i,j,d,z:NaN};
              const h = habitat(t, ids, x, y);
              if (!h || keepClear.some(([px, py, r]) => (px - x) ** 2 + (py - y) ** 2 < r * r)) continue;
              const patch = 0.5 + 0.26 * Math.sin(x * 0.053 + Math.sin(y * 0.038) * 1.7) + 0.24 * Math.sin(y * 0.069 + x * 0.013);
              const density =
                kind === 'grass' || kind === 'meadow'
                  ? h.meadow * (0.3 + patch * 0.98)
                  : kind === 'fern' || kind === 'bush'
                    ? (0.44 * h.meadow + 0.95 * h.wood) * (0.32 + patch)
                    : 0.52 * h.wood;
              const [c,b]=canopy?coverAt(canopy.image,x,y,((t.width??t.size)-1)*20,((t.height??t.size)-1)*20):[0,0];
              const adjusted=(kind==='grass'||kind==='meadow')?density*(1-.92*Math.max(c,b)):density*(.70+.58*Math.max(c,b));
              if (randomAt(i, j, 3) > adjusted || !dryFootprint(t,x,y,kind==='bush'?9:6)) continue;
              site.z=h.z; cand.push(site);
            }
        cand.sort((a, b) => a.d - b.d);
        const selected = cand.slice(0, capFor(kind));
        stats[kind] = selected.length;
        for (const b of bs) b.m.count = 0;
        for (const p of selected) {
          const q = randomAt(p.i, p.j, 4),
            scale = { grass: 29, meadow: 30, fern: 25, bush: 11, sapling: 27 }[kind] * (0.68 + q * 0.74);
          const z=patch.surface(p.x,p.y,p.z)-(kind==='grass'?.1:.13);
          if(t.water?.mode===1 && z<=t.water.level+.3)continue;
          trans.position.set(p.x,p.y,z);
          trans.scale.setScalar(scale);
          trans.rotation.z = 2 * Math.PI * randomAt(p.i, p.j, 6);
          trans.updateMatrix();
          for (const b of bs) {
            if (kind === 'grass' && b.variant !== (q > 0.5 ? 7 : 8)) continue;
            b.m.setMatrixAt(b.m.count++, trans.matrix);
          }
        }
        for (const b of bs) {
          b.m.visible = b.m.count > 0;
          b.m.instanceMatrix.needsUpdate = true;
          stats.triangles += b.m.count * b.triangles;
        }
      }
    };
    game.scene.add(group,woody);
    return { stats, update, dispose, materials: Object.values(mats) };
  } catch (e) {
    dispose();
    throw e;
  }
}
