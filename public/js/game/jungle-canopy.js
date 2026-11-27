// Authenticated, draw-only Yavin foliage. Placement and visibility are separate: detail can
// change with the camera, but an eligible plant never loses its last representation to a budget.
import * as T from 'three';
import { fetchBinary } from '../vfs.js';
import { digest } from '../texture-showcase/recipes.js';
import { textureFromBytes, whiteTexture } from '../dds.js';
import { groveMaterial, randomAt, habitat } from './endor-grove.js';
import { heightAt } from './terrain.js';
import { foliageStream, plantChunks, splitPlants } from './foliage-stream.js';
import { landDetailLevel, worldDiameter } from './land-detail.js';
const base = new URL('../../art/', import.meta.url);
const fileReader = (name, files, signal) => async file => {
  if (!Object.hasOwn(files, file)) throw Error('Unreviewed jungle file: ' + file);
  const r = await fetch(new URL(name + '/' + file, base), { signal });
  if (!r.ok) throw Error('Missing jungle file: ' + file);
  const b = await r.arrayBuffer();
  if ((await digest(b)) !== files[file]) throw Error('Changed jungle file: ' + file);
  return b;
};
async function geometry(read, row, own, bump) {
  const b = await read(row.file),
    v = row.vertices,
    n = row.triangles * 3;
  if (!v || !n || b.byteLength !== v * 32 + n * 2) throw Error('Bad foliage geometry: ' + row.file);
  const g = own(new T.BufferGeometry()),
    f = new Float32Array(b, 0, v * 8);
  for (const [key, stride, off] of [
    ['position', 3, 0],
    ['normal', 3, 3],
    ['uv', 2, 6]
  ]) {
    const a = new Float32Array(v * stride);
    for (let i = 0; i < v; i++) for (let j = 0; j < stride; j++) a[i * stride + j] = f[i * 8 + off + j];
    g.setAttribute(key, new T.BufferAttribute(a, stride));
  }
  g.setIndex(new T.BufferAttribute(new Uint16Array(b, v * 32, n), 1));
  if (bump) {
    g.computeTangents();
    const ta = g.attributes.tangent,
      bt = new Float32Array(v * 3),
      vec = new T.Vector3(),
      tan = new T.Vector3();
    for (let i = 0; i < v; i++)
      vec
        .fromBufferAttribute(g.attributes.normal, i)
        .cross(tan.fromBufferAttribute(ta, i))
        .multiplyScalar(ta.getW(i))
        .toArray(bt, i * 3);
    g.setAttribute('binormal', new T.BufferAttribute(bt, 3));
  }
  return g;
}
export async function prepareJungle(game, recipe, ids, signal, tier, grove, farCover) {
  const group = new T.Group(),
    owned = [],
    own = o => (owned.push(o), o),
    stock = [],
    trees = [],
    authored = [],
    streams = [],
    t = game.terrain,
    cover = new Float32Array(t.layerIndex.length),
    stats = {},
    groveStats = { grass: 0, fern: 0, sapling: 0, triangles: 0 };
  group.name = 'Yavin broadleaf canopy';
  group.userData.casts = true;
  group.visible = false;
  let active = false,
    hidden = [],
    chunks,
    revision,
    last = '';
  function toggle(on) {
    if (active === on) return;
    if (on) {
      for (const p of stock)
        p.grp.traverse(o => {
          if (o.isMesh && o.visible) {
            hidden.push(o);
            o.visible = false;
          }
        });
    } else {
      for (const o of hidden) o.visible = true;
      hidden = [];
    }
    group.visible = active = on;
    last = '';
  }
  function dispose() {
    toggle(false);
    group.removeFromParent();
    for (const s of streams) s.dispose();
    for (const o of owned) o.dispose();
  }
  try {
    const jungle = fileReader('yavin-jungle', recipe.files, signal),
      fern = fileReader('endor-grove', grove.files, signal),
      far = fileReader('yavin-groundcover', farCover.files, signal);
    await Promise.all(
      Object.entries(recipe.sources).map(async ([key, pin]) => {
        const b = await fetchBinary(key, { keep: false });
        if (!b || (await digest(b)) !== pin) throw Error('Changed planted source: ' + key);
      })
    );
    const keepClear = [...(game.world.sites || []).map(p => [p.x, p.y, 38]), ...(game.world.points || []).map(p => [p.x, p.y, 22])];
    const free = (x, y, r) => !keepClear.some(([a, b, d]) => (a - x) ** 2 + (b - y) ** 2 < (r ?? d) ** 2),
      counts = {};
    for (const prop of game.props) {
      const file = prop.modelFile?.toUpperCase(),
        def = recipe.targets[file];
      if (!def) continue;
      stock.push(prop);
      counts[file] = (counts[file] || 0) + 1;
      const gx = prop.x,
        gy = prop.y,
        seed = (gx * 23 + gy * 43) | 0,
        rand = k => randomAt(seed, k, 57),
        base = prop.grp.scale.x;
      for (let j = 0; j < def.stems; j++) {
        const ang = j * 2.39996 + rand(0) * 6.283,
          rad = j ? Math.sqrt(j / def.stems) * def.radius * base : 0,
          x = gx + rad * Math.cos(ang),
          y = gy + rad * Math.sin(ang),
          z = heightAt(t, x, y);
        if (def.herb) {
          if (free(x, y, 32))
            authored.push({
              x,
              y,
              z,
              prop,
              rot: rand(j + 2) * 6.283,
              variant: Math.floor(rand(j + 101) * 3),
              role: 'broadleaf',
              s: base * (10 + 15 * rand(j + 3))
            });
          continue;
        }
        if (j && !free(x, y, 34)) continue;
        const s = base * (3.55 + 2.9 * rand(j + 5)) * (j % 4 === 3 ? 0.7 : 1);
        trees.push({ x, y, z: z - 1, prop, rot: rand(j + 19) * 6.283, s, stretch: 0.96 + 0.35 * rand(j + 49), role: 'canopy', variant: 0 });
        const R = s * 12;
        for (let b = Math.max(0, Math.floor((y - R) / 20)); b <= Math.min(t.height - 1, (y + R) / 20); b++)
          for (let a = Math.max(0, Math.floor((x - R) / 20)); a <= Math.min(t.width - 1, (x + R) / 20); a++) {
            const d = Math.hypot(a * 20 - x, b * 20 - y) / R;
            cover[b * t.size + a] = Math.max(cover[b * t.size + a], 1 - d);
          }
      }
    }
    for (const [file, def] of Object.entries(recipe.targets))
      if (counts[file] !== def.count) throw Error('Changed planted placements: ' + file);
    Object.assign(stats, { targets: stock.length, trees: trees.length, plans: 0 });
    function plant() {
      const herbs = authored.filter(p => habitat(t, ids, p.x, p.y)),
        roots = [...trees, ...herbs];
      stats.herbs = herbs.length;
      // Same world seeds, density, clearance and donor as the previously accepted near fern. Test once per paint revision, not per camera position.
      for (let j = 0; j * 17 < (t.height - 1) * 20; j++)
        for (let i = 0; i * 17 < (t.width - 1) * 20; i++) {
          const x = (i + 0.12 + randomAt(i, j, 1) * 0.76) * 17,
            y = (j + 0.12 + randomAt(i, j, 2) * 0.76) * 17,
            h = habitat(t, ids, x, y);
          if (!h || !free(x, y)) continue;
          const patch = 0.5 + 0.26 * Math.sin(x * 0.053 + Math.sin(y * 0.038) * 1.7) + 0.24 * Math.sin(y * 0.069 + x * 0.013),
            density = (0.44 * h.meadow + 0.95 * h.wood) * (0.32 + patch) * 0.7;
          if (randomAt(i, j, 3) <= density)
            roots.push({
              x,
              y,
              z: h.z,
              rot: 2 * Math.PI * randomAt(i, j, 6),
              s: 25 * (0.68 + randomAt(i, j, 4) * 0.74),
              role: 'fern',
              variant: 0
            });
        }
      chunks = plantChunks(roots);
      stats.ferns = roots.length - trees.length - herbs.length;
      revision = t.paint.paintRevision || 0;
      last = '';
      stats.plans++;
    }
    plant();
    const json = async read => JSON.parse(new TextDecoder().decode(await read('models.json'))),
      jm = await json(jungle),
      fm = await json(fern),
      detailFern = fm.find(r => r.file === 'fern2-fern.bin');
    const tex = async (read, name) => own(await textureFromBytes(await read(name))),
      crown = await tex(jungle, 'jacaranda.png'),
      herbTex = await tex(jungle, 'anthurium.png'),
      herbNormal = await tex(jungle, 'anthurium-normal.png'),
      fernTex = await tex(fern, 'fern.png'),
      fernNormal = await tex(fern, 'fern-normal.png'),
      atlas = await tex(far, farCover.atlas);
    function mat(color, normal, role, alpha) {
      const m = own(groveMaterial(color, normal || whiteTexture(), true));
      if (!normal) delete m.defines.BUMP;
      if (role === 'canopy') m.defines.ENDOR_WOODLAND = 1;
      else m.defines.WIND_LEAVES = 1;
      m.uniforms.alphaRef.value = alpha;
      if (role !== 'fern') m.uniforms.emissive.value.setRGB(0.11, 0.12, 0.095);
      return m;
    }
    const groups = { canopy: [], broadleaf: [], fern: [] },
      fernMat = mat(fernTex, fernNormal, 'fern', 0.34),
      leafMat = mat(herbTex, herbNormal, 'broadleaf', 0.36),
      treeMat = mat(crown, null, 'canopy', 0.28),
      proxyMat = mat(atlas, null, 'broadleaf', 0.22);
    async function pair(role, hi, lo, readHi, readLo, m1, m2) {
      const detailGeometry = await geometry(readHi, hi, own, !!m1.defines.BUMP);
      detailGeometry.computeBoundingSphere();
      const hs = foliageStream(group, detailGeometry, m1, role, 'detail'),
        farGeometry = await geometry(readLo, lo, own, false),
        ls = foliageStream(group, farGeometry, m2, role, 'proxy');
      streams.push(hs, ls);
      const variant = { streams: [hs, ls], tri: [hi.triangles, lo.triangles], bounds: detailGeometry.boundingSphere };
      if (role === 'canopy') {
        // Simplify the authenticated proxy once, not the live forest each frame.
        // Same vertices, UVs, atlas and cutoff. Tiny herbs already cost <=12 triangles.
        try {
          const { landIndexLod } = await import('./land-index-lod.js');
          const index = await landIndexLod(farGeometry.index.array,farGeometry.attributes.position.array,farGeometry.attributes.uv.array,.3,.025);
          if (index) {
            // Streams resize/dispose their VAOs independently; this tiny proxy
            // must not invalidate a sibling's GL attribute buffers when it grows.
            const geo = own(farGeometry.clone());
            geo.setIndex(new T.BufferAttribute(index,1));
            const distant = foliageStream(group,geo,m2,role,'distant');
            streams.push(distant); variant.streams.push(distant); variant.tri.push(index.length/3);
          }
        } catch { /* Original proxy remains usable if simplification is unavailable. */ }
      }
      groups[role].push(variant);
      return farGeometry;
    }
    const scenicCrown = await pair('canopy', jm[0], jm[1], jungle, jungle, treeMat, treeMat);
    const farRows = (await json(far)).models,
      proxyFor = file => {
        const row = farRows.find(r => r.source.file === file);
        if (!row || row.triangles > 12) throw Error('Missing cheap proxy for ' + file);
        return row;
      };
    for (const row of jm.slice(2)) await pair('broadleaf', row, proxyFor(row.file), jungle, far, leafMat, proxyMat);
    await pair('fern', detailFern, proxyFor(detailFern.file), fern, far, fernMat, proxyMat);
    game.scene.add(group);
    const frustum = new T.Frustum(),
      pv = new T.Matrix4(),
      scriptFlags = new WeakMap();
    return {
      stats,
      groveStats,
      cover,
      // Borrow the authenticated silhouette and lighting for the ground immediately across the TED edge.
      scenicCrown:{geometry:scenicCrown,material:treeMat},
      dispose,
      update(on, patch) {
        toggle(on);
        if (!on) return;
        if ((t.paint.paintRevision || 0) !== revision) plant();
        const v = game.view,
          cam = game.camera;
        cam.updateMatrixWorld();
        pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        let changed = false;
        if (game.scripts)
          for (const p of stock) {
            const show = p.grp.parent === game.scene && !p.scriptHidden;
            if (scriptFlags.get(p) !== show) {
              scriptFlags.set(p, show);
              changed = true;
            }
          }
        const display = game.renderer.domElement.clientHeight || innerHeight;
        const key = [v.x, v.y, v.dist, display, ...pv.elements].join('/');
        if (key === last && !changed) return;
        last = key;
        frustum.setFromProjectionMatrix(pv);
        const roots = { canopy: [], broadleaf: [], fern: [] };
        for (const c of chunks)
          if (frustum.intersectsBox(c.bounds))
            for (const p of c.roots) if (!p.prop || (p.prop.grp.parent === game.scene && !p.prop.scriptHidden)) roots[p.role].push(p);
        for (const [role, variants] of Object.entries(groups)) {
          const tree = role === 'canopy',
            near = [],
            far = [],
            rank = tree ? p => (p.x-cam.position.x)**2+(p.y-cam.position.y)**2 : p => (p.x-v.x)**2+(p.y-v.y)**2;
          // Taper the near budget instead of dropping every detailed crown or fern on one zoom tick.
          const limit = tree ? 540 : 430, range = (tree ? 390 : 195)*Math.max(0,Math.min(1,(limit-v.dist)/(limit*.2)));
          const cap = tree ? Infinity : role === 'fern' ? [95,59,32][Math.min(tier,2)] : tier>=2 ? 26 : 55;
          splitPlants(roots[role], () => true, range, cap, rank, near, far);
          let rowsByLevel = [near,far];
          if (tree && variants[0].streams.length===3) {
            const medium=[], distant=[], s=variants[0].bounds;
            for (const p of far) {
              const pixels=worldDiameter(cam,display,p.x,p.y,p.z+s.center.z*p.s*p.stretch,s.radius*p.s*Math.max(1,p.stretch));
              p.detail=landDetailLevel(pixels,p.detail,230,90);
              (p.detail===2 ? distant : medium).push(p);
            }
            rowsByLevel=[near,medium,distant];
          }
          let tris = 0;
          for (let k = 0; k < variants.length; k++)
            for (const [lod, rows] of rowsByLevel.entries()) {
              const set = variants.length === 1 ? rows : rows.filter(p => p.variant === k),
                z = p => (tree ? p.z : patch.surface(p.x, p.y, p.z) - (role === 'fern' ? 0.13 : 0.12));
              variants[k].streams[lod].commit(set, z);
              tris += set.length * variants[k].tri[lod];
            }
          if (tree) {
            stats.near = near.length;
            stats.far = far.length;
          } else if (role === 'fern') {
            Object.assign(groveStats, { fern: near.length + far.length, near: near.length, far: far.length, triangles: tris });
          } else {
            stats.broadleafHerbs = near.length + far.length;
            stats.herbNear = near.length;
            stats.herbFar = far.length;
          }
        }
        stats.streams = streams.map(s => s.receipt());
      }
    };
  } catch (e) {
    dispose();
    throw e;
  }
}
