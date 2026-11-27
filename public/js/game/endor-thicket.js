// Map-wide woodland. The population and the canopy-light field are fixed in map space;
// the camera only chooses geometry level and which distant cells to submit.
import * as T from 'three';
import { textureFromBytes } from '../dds.js';
import { gfx } from '../gfx.js';
import { randomAt, habitat } from './endor-grove.js';
import {depthMaterial,leafShadowMaterial} from '../model.js';
import { dryFootprint } from './endor-habitat.js';
import { forestCover } from './endor-cover.js';
import { landDetailLevel, worldDiameter } from './land-detail.js';
const CHUNK = 240,
  TAU = Math.PI * 2;
export function forestPlan(t, ids, keepClear = []) {
  const width = ((t.width ?? t.size) - 1) * 20,
    height = ((t.height ?? t.size) - 1) * 20,
    patches = new Map(),
    totals = { redwood: 0, hemlock: 0, brush: 0, bracken: 0, log: 0,stone:0 },
    quadrants = [0, 0, 0, 0];
  const sites = keepClear.filter(s => Number.isFinite(s.x) && Number.isFinite(s.y));
  function plant(kind, step, seed) {
    for (let j = 0; j * step < height; j++)
      for (let i = 0; i * step < width; i++) {
        const rnd = k => randomAt(i, j, seed + k),
          x = (i + 0.04 + rnd(1) * 0.92) * step,
          y = (j + 0.04 + rnd(2) * 0.92) * step,
          h = habitat(t, ids, x, y);
        if (!h) continue;
        const tree = kind === 'redwood' || kind === 'hemlock',
          margin = tree ? 10 : 3;
        if (sites.some(s => (s.x - x) ** 2 + (s.y - y) ** 2 < (s.r + margin) ** 2)) continue;
        const pocket = 0.52 + 0.24 * Math.sin(x * 0.019 + Math.sin(y * 0.008) * 2) + 0.24 * Math.cos(y * 0.021 + x * 0.006),
          damp = 0.5 + 0.5 * Math.sin(y * 0.045 + Math.cos(x * 0.031) * 1.8);
        const chance = {
          redwood: 0.52 + 0.34 * pocket + 0.15 * h.wood,
          hemlock: 0.12 + 0.42 * pocket + 0.29 * h.wood,
          brush: 0.17 + 0.47 * pocket + 0.25 * h.wood,
          bracken: 0.29 + 0.44 * damp + 0.22 * h.wood,
          log: 0.42 * pocket,stone:.24+.45*damp
        }[kind];
        if (rnd(3) > chance) continue;
        if((kind==='brush'||kind==='bracken') && !dryFootprint(t,x,y,10*(.65+rnd(4)*.7)))continue;
        const r = rnd(4),
          s = 0.65 + r * 0.7,
          key = Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK);
        let c = patches.get(key);
        if (!c) {
          c = { x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, y: (Math.floor(y / CHUNK) + 0.5) * CHUNK, plants: [] };
          patches.set(key, c);
        }
        c.plants.push({ x, y, z: h.z, s, angle: rnd(5) * TAU, kind, wide: 0.87 + rnd(6) * 0.32, tone: rnd(7) });
        totals[kind]++;
        if (tree) quadrants[+(x >= width / 2) + 2 * +(y >= height / 2)]++;
      }
  }
  plant('redwood', 51, 90);
  plant('hemlock', 34, 120);
  plant('brush', 17, 180);
  plant('bracken', 13.5, 220);
  plant('log', 109, 260);
  plant('stone',59,290);
  return { width, height, chunks: [...patches.values()], totals, quadrants };
}
// Geometry uses logical 2x2 panels. The photo bake devotes a full-height strip to the fir,
// half a column to the shrub and a quarter each to the fern and bough, with straight alpha.
const panels=[[.008,.045,.484,.908],[.507,.043,.484,.417],[.532,.506,.430,.238],[.563,.756,.374,.238]];
function geometry(sprays) {
  const pos = [],
    uv = [],
    idx = [],
    norm = [],
    tan = [],
    bin = [];
  return {
    vertex(x, y, z, u, v, nx, ny, nz) {
      const id = pos.length / 3;
      pos.push(x, y, z);
      if(sprays){const cx=+(u>=.5),cy=+(v>=.5),r=panels[cx+2*cy];uv.push(r[0]+(u*2-cx)*r[2],r[1]+(v*2-cy)*r[3]);}
      else uv.push(u, v);
      const n = new T.Vector3(nx, ny, nz).normalize(),
        a = Math.abs(n.z) < 0.97 ? new T.Vector3(-n.y, n.x, 0).normalize() : new T.Vector3(1, 0, 0),
        b = new T.Vector3().crossVectors(n, a);
      norm.push(...n.toArray());
      tan.push(...a.toArray());
      bin.push(...b.toArray());
      return id;
    },
    quad(a, b, c, d) {
      idx.push(a, b, c, a, c, d);
    },
    finish() {
      const g = new T.BufferGeometry();
      for (const [name, arr, s] of [
        ['position', pos, 3],
        ['normal', norm, 3],
        ['uv', uv, 2],
        ['tangent', tan, 3],
        ['binormal', bin, 3]
      ])
        g.setAttribute(name, new T.Float32BufferAttribute(arr, s));
      g.setIndex(idx);
      return g;
    }
  };
}
// Panel spans a bent radial branch, not a camera-aligned plane. y-down UV atlas.
function fan(g, cx, cy, cz, angle, rise, reach, span, tile, bend = 0.14) {
  const dx = Math.cos(angle),
    dy = Math.sin(angle),
    u = (tile % 2) * 0.5 + 0.007,
    v = Math.floor(tile / 2) * 0.5 + 0.007,
    w = 0.486,
    rows = [];
  for (const [t, k] of [
    [0, 0.23],
    [0.48, 1],
    [1, 0.56]
  ]) {
    const x = cx + dx * reach * t,
      y = cy + dy * reach * t,
      z = cz + rise * t + bend * reach * Math.sin(t * Math.PI),
      wide = k * span * 0.5;
    // Light the volume of the spray. Broadside and tip needles don't all face the zenith.
    const outward=tile===3?.64+.26*t:.30+.26*t, side=.29*k, up=.88-.32*t;
    rows.push([
      g.vertex(x-dy*wide,y+dx*wide,z,u,v+w*(1-t),dx*outward-dy*side,dy*outward+dx*side,up),
      g.vertex(x+dy*wide,y-dx*wide,z,u+w,v+w*(1-t),dx*outward+dy*side,dy*outward-dx*side,up)
    ]);
  }
  for (let j = 0; j < 2; j++) g.quad(rows[j][0], rows[j][1], rows[j + 1][1], rows[j + 1][0]);
}
function tube(g, rings, sides) {
  let prev;
  for (const [x, y, z, r, v] of rings) {
    let row = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * TAU,
        rr = r * (1 + 0.076 * Math.sin(a * 5 + 0.6));
      row.push(g.vertex(x + Math.cos(a) * rr, y + Math.sin(a) * rr, z, (i / sides) * 2.5, v, Math.cos(a), Math.sin(a), 0.08));
    }
    if (prev) for (let i = 0; i < sides; i++) g.quad(prev[i], prev[i + 1], row[i + 1], row[i]);
    prev = row;
  }
}
function mesh(kind, level) {
  const near = level === 0, distant = level === 2;
  const g = geometry(!['trunk','log','stone'].includes(kind));
  if(kind==='stone'){
    // A partially buried weathered group, not identical spheres on top of the forest floor.
    for(const [ox,oy,rad,h,seed]of [[0,0,12,12,4],[9,5,6,5,7],[-5,8,3.7,3.4,29]]){const n=near?10:distant?4:6;let prev;
      for(const [level,span]of (distant?[[-.16,.84],[.29,1],[1,.20]]:[[-.16,.84],[.29,1],[.66,.81],[.94,.44],[1,.02]])){const row=[];for(let k=0;k<=n;k++){
        const a=(k%n)/n*TAU, r=rad*span*(.80+.37*randomAt(k%n,seed,1)),x=ox+r*Math.cos(a)+level*1.7,y=oy+r*Math.sin(a)*.8;
        row.push(g.vertex(x,y,h*level+(randomAt(k%n,seed,5)-.5)*h*.15,(k/n)*2.6,level*1.1,Math.cos(a)*(1-level),Math.sin(a)*(1-level),.21+level));}
        if(prev)for(let k=0;k<n;k++)g.quad(prev[k],prev[k+1],row[k+1],row[k]);prev=row;}}
    return g.finish();}
  if (kind === 'trunk' || kind === 'log') {
    if (kind === 'trunk') {
      tube(
        g,
        distant ? [[-.5,0,-3,8,0],[0,.4,62,4.5,3.45],[1,1,193,.35,10.8]] : [
          [-0.5, 0, -3, 9, 0],
          [0, 0, 3, 7, 0.23],
          [0.2, 0, 14, 5.4, 0.78],
          [0, 0.4, 62, 4.5, 3.45],
          [0.8, 0.1, 112, 3.4, 6.2],
          [1.2, 0.7, 157, 2.1, 8.8],
          [1, 1, 193, 0.35, 10.8]
        ],
        near ? 12 : distant ? 5 : 7
      );
      if (near)
        for (let i = 0; i < 6; i++) {
          const a = i * 2.4,
            d = 10 + (i % 3) * 2;
          tube(
            g,
            [
              [d * Math.cos(a), d * Math.sin(a), -2, 3, 0],
              [Math.cos(a) * 5, Math.sin(a) * 5, 4, 3.6, 0.6],
              [Math.cos(a) * 3, Math.sin(a) * 3, 10, 1.2, 1]
            ],
            5
          );
        }
    } else {
      tube(
        g,
        [
          [0, 0, -1, 2.2, 0],
          [0.6, 0, 1, 2.7, 0.25],
          [1, 0.5, 29, 2.3, 3],
          [0.1, 1, 53, 1.7, 6]
        ],
        distant ? 4 : 7
      );
    }
    return g.finish();
  }
  if (kind === 'crown') {
    const tiers = near ? 8 : distant ? 3 : 5,
      n = near ? 11 : distant ? 4 : 7;
    for (let j = 0; j < tiers; j++) {
      const t = j / (tiers - 1),
        z = 80 + 112 * t,
        r = 40 * (1 - 0.8 * t) + 8 * Math.sin(t * Math.PI);
      for (let i = 0; i < n; i++) {
        const a = (i * TAU) / n + j * 1.473,
          rand = randomAt(i, j, 21);
        fan(
          g,
          Math.cos(a) * r * 0.085,
          Math.sin(a) * r * 0.085,
          z + rand * 5,
          a,
          -9 + 15 * t + rand * 5,
          r * (0.88 + 0.29 * rand),
          r * (near ? 0.86 : distant ? 1.65 : 1.17),
          3,
          0.23
        );
      }
    }
  } else if (kind === 'hemlock') {
    // The actual donor fir keeps a continuous leading stem, even between branch tiers.
    for(let k=0;k<3;k++){
      const a=k*Math.PI/3+.29,dx=Math.cos(a)*13,dy=Math.sin(a)*13;
      const vs=[[-1,0,.002,.498],[1,0,.498,.498],[1,52,.498,.002],[-1,52,.002,.002]].map(([s,z,u,v])=>g.vertex(s*dx,s*dy,z,u,v,-Math.sin(a)*.46,Math.cos(a)*.46,.78));
      g.quad(...vs);
    }
    // Three fixed intersecting fir panels retain the tapered side silhouette;
    // leave one radial tier so the crown is still visible from directly above.
    const tiers=near?5:distant?1:3, spokes=near?6:distant?3:4;
    for (let j = 0; j < tiers; j++) {
      const t = distant ? .26 : j / (tiers-1);
      for (let i = 0; i < spokes; i++) {
        const a = (i * TAU) / spokes + 1.22 * j;
        fan(g, 0, 0, 7 + t * 39, a, 7 + t * 4, 16 * (1 - t * 0.85), 16 * (1 - t * 0.8), 3, 0.18);
      }
    }
  } else {
    const tile = kind === 'brush' ? 1 : 2,
      n = near ? 8 : distant ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n + (i % 2) * 0.23,
        q = randomAt(i, 3, tile),
        h = kind === 'brush' ? 15 : 8;
      fan(
        g,
        0,
        0,
        -0.4,
        a,
        h * (0.72 + q * 0.7),
        (kind === 'brush' ? 10 : 11) * (0.78 + q * 0.63),
        (kind === 'brush' ? 16 : 15) * (0.73 + q * 0.45),
        tile,
        0.12
      );
    }
  }
  return g.finish();
}
export async function thicket(game, ids, plants, signal, tier, rockMaps) {
  const t = game.terrain,
    owned = [],
    own = x => (owned.push(x), x),
    group = new T.Group(),
    batches = {}, shadows={}, shadowGroup=new T.Group(),
    trans = new T.Object3D();
  group.name = 'Endor map-wide old growth';
  group.visible = false;
  shadowGroup.name='Endor forest shadow casters';shadowGroup.visible=false;shadowGroup.userData.casts=true;
  const safe = [...game.world.sites.map(s => ({ ...s, r: 44 })), ...game.world.points.map(s => ({ ...s, r: 31 }))];
  const stats = {};
  let layout,
    version = -1,
    last = '',
    lastCasters = '',
    rank = Math.min(2, tier),
    lightMap;
  const dispose = () => {
    group.removeFromParent();shadowGroup.removeFromParent();
    for (const o of owned) o.dispose();
  };
  try {
    const res = await fetch(new URL('../../art/endor-thicket/sprays.png', import.meta.url), { signal });
    if (!res.ok) throw Error('Missing woodland sprays');
    const art = own(await textureFromBytes(await res.arrayBuffer(), false));
    const mat = own(plants.materials[0].clone());
    mat.uniforms = {
      ...plants.materials[0].uniforms,
      map: { value: art },
      alphaRef: { value: 0.25 },
      emissive: { value: new T.Color(0.1, 0.1, 0.1) }
    };
    mat.defines = { ALPHA: 1, WIND_LEAVES: 1 };
    mat.side = T.DoubleSide;
    mat.userData.alpha = true;
    const bark = own(plants.materials[1].clone());
    bark.uniforms = plants.materials[1].uniforms;
    // This batch has no vertex colors; a copied USE_VCOLOR is not a bark attribute.
    bark.defines = { BUMP: 1, ENDOR_BARK: 1 };
    const stone=own(bark.clone());
    stone.uniforms={...bark.uniforms,map:{value:rockMaps[0]},normalMap:{value:rockMaps[1]},emissive:{value:new T.Color(.025,.025,.025)}};
    // Only upright trunks join the view fade. Logs and the rock clone use the
    // same bark lighting convention but must remain solid.
    const stem=own(bark.clone()); stem.uniforms=bark.uniforms; stem.defines.CANOPY_STEM=1;
    const capFloor = [1, 0.78, 0.56][rank];
    for (const [kind, nearCap, farCap] of [
      ['trunk', 90, 2400],
      ['crown', 90, 2400],
      ['hemlock', 155, 1180],
      ['brush', 640, 1900],
      ['bracken', 800, 1700],
      ['log', 50, 100], ['stone',95,320]
    ]) {
      batches[kind] = [];
      for (const [lod, cap] of [
        [0, nearCap],
        [1, farCap],
        [2, farCap]
      ]) {
        const g = own(mesh(kind, lod)),
          max = Math.ceil(cap * capFloor),
          tint = new T.InstancedBufferAttribute(new Float32Array(max * 4), 4);
        g.setAttribute('instanceTint', tint);
        const im = own(new T.InstancedMesh(g, kind === 'trunk' ? stem : kind === 'log' ? bark : kind==='stone'?stone:mat, max));
        im.name = `${kind} · ${['near','medium','distant'][lod]}`;
        im.count = 0;
        im.frustumCulled = false;
        im.instanceMatrix.setUsage(T.DynamicDrawUsage);
        group.add(im);
        batches[kind].push({ im, max, tint });
      }
    }
    // Same trunk outlines and alpha masks as the visible trees, but a bounded sun-view list.
    // A camera cutaway or an offscreen crown must not switch off the sun's occluder.
    for (const [kind,rows] of Object.entries(batches)) {
      const source=rows[1].im, cap=Math.min(rows[1].max,({trunk:470,crown:470,hemlock:320,brush:150,bracken:160,log:50,stone:75})[kind]);
      const mat=source.material.defines?.ALPHA?leafShadowMaterial(source.material):depthMaterial(source.material);
      if(!mat)continue;
      const im=own(new T.InstancedMesh(source.geometry,mat,cap));im.frustumCulled=false;im.count=0;im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      shadows[kind]={im,cap};shadowGroup.add(im);
    }
    // A full detail stream can demote an eligible root, never evict the last
    // visible representation. Grow only on observed peak demand; keep the mesh
    // and its geometry/material identity. Dispose the old GL instance buffers.
    function growDistant(b) {
      const m = b.im, n = m.count, cap = Math.ceil(b.max * 1.5);
      const matrices = new T.InstancedBufferAttribute(new Float32Array(cap*16),16).setUsage(T.DynamicDrawUsage);
      const tint = new T.InstancedBufferAttribute(new Float32Array(cap*4),4).setUsage(T.DynamicDrawUsage);
      matrices.array.set(m.instanceMatrix.array); tint.array.set(b.tint.array);
      m.dispose(); m.geometry.dispose();
      m.instanceMatrix = matrices; m.geometry.setAttribute('instanceTint', tint);
      b.tint = tint; b.max = cap; m.count = n;
    }
    function plantMap() {
      layout = forestPlan(t, ids, safe);
      // Beyond the detail neighbourhood only landmarks, not the dense fern carpet.
      for (const c of layout.chunks) {
        c.landmarks=c.plants.filter(p=>['redwood','hemlock','log','stone'].includes(p.kind));
        c.bounds=new T.Box3();
        for(const p of c.landmarks)c.bounds.expandByPoint(trans.position.set(p.x,p.y,p.z));
        if(c.landmarks.length){c.bounds.expandByScalar(65);c.bounds.max.z+=240;}
      }
      stats.total = layout.totals;
      stats.quadrants = layout.quadrants;
      version = t.paint.paintRevision || 0;
      const pixels = forestCover(layout);
      if (lightMap) lightMap.image.data = pixels;
      else {
        lightMap = own(new T.DataTexture(pixels, 512, 512));
        lightMap.minFilter = lightMap.magFilter = T.LinearFilter;
      }
      lightMap.needsUpdate = true;
      t.paint.soilGrid?.refreshCover?.();
      last = lastCasters = '';
    }
    plantMap();
    game.scene.add(group,shadowGroup);
    const frustum=new T.Frustum(),pm=new T.Matrix4(),sphere=new T.Sphere(new T.Vector3(),1);
    // The arrays are capacity-sized, but only the rewritten prefix is drawn.
    // Leave zero-count streams alone; a growing list always republishes its full prefix.
    function publish(attr,count) {
      if (!count) return;
      attr.clearUpdateRanges(); attr.addUpdateRange(0,count*attr.itemSize); attr.needsUpdate=true;
    }
    function update(on) {
      group.visible = on;
      const cast = on && gfx.shadows;
      shadowGroup.userData.forestCaster = cast;
      if (!on) {
        last = lastCasters = '';
        return;
      }
      if (version !== (t.paint.paintRevision||0)) plantMap();
      const v = game.view, cam = game.camera,
        display = game.renderer.domElement.clientHeight || innerHeight,
        x = Math.floor(v.x / 24) * 24,
        y = Math.floor(v.y / 24) * 24,
        band = Math.round(v.dist / 60),
        eye = game.camera.position,
        key = [x, y, band, Math.round(eye.x / 8), Math.round(eye.y / 8), Math.round(eye.z / 10), display, cam.projectionMatrix.elements[0], cam.projectionMatrix.elements[5], Math.round(cam.quaternion.x*256), Math.round(cam.quaternion.y*256), Math.round(cam.quaternion.z*256), Math.round(cam.quaternion.w*256)].join('/');
      // The sun-view list depends on the focus and reach, not on the player's eye or cutaway.
      // Keep its instance buffers resident while orbiting; units still render at the current pose.
      const casterKey = cast ? `${x}/${y}/${band}` : 'off';
      const rebuildCasters = casterKey !== lastCasters;
      if (last === key && !rebuildCasters) return;
      last = key;
      lastCasters = casterKey;
      game.camera.updateMatrixWorld();frustum.setFromProjectionMatrix(pm.multiplyMatrices(game.camera.projectionMatrix,game.camera.matrixWorldInverse));
      const canopyReach = Math.min(2600, Math.max(1220, 640 + v.dist * 1.8)),
        brushReach = Math.min(920, 470 + v.dist * 0.8);
      for (const rows of Object.values(batches)) for (const b of rows) b.im.count = 0;
      if (rebuildCasters) for (const {im} of Object.values(shadows)) im.count = 0;
      const reach=Math.min(1150,Math.max(340,(band * 60 + 30)*1.25));
      const order = layout.chunks
        .map(c => [c, (c.x - x) ** 2 + (c.y - y) ** 2])
        .filter(([c, d]) => d < (canopyReach + CHUNK) ** 2 || (c.landmarks.length && frustum.intersectsBox(c.bounds)))
        .sort((a, b) => a[1] - b[1]);
      const focusZ =
        t.heights[
          Math.max(0, Math.min(t.size - 1, Math.round(v.y / 20))) * t.size + Math.max(0, Math.min(t.size - 1, Math.round(v.x / 20)))
        ] || 0;
      const ax = v.x - eye.x,
        ay = v.y - eye.y,
        az = focusZ - eye.z,
        ds = Math.max(1, ax * ax + ay * ay);
      for (const [c, dist2] of order)
        for (const p of dist2 < (canopyReach+CHUNK)**2 ? c.plants : c.landmarks) {
          const d = (p.x - x) ** 2 + (p.y - y) ** 2,
            tree = p.kind === 'redwood',
            mid = p.kind === 'hemlock';
          if (!tree && !mid && p.kind!=='stone' && p.kind!=='log') {
            // Stagger the edge of the local fern carpet by permanent root seed.
            // A small reverse pan shouldn't toggle a whole ring of shrubs at once.
            const limit = brushReach*(.88+.24*p.tone)+(p.inBrush ? 12 : 0);
            p.inBrush = (p.x-v.x)**2+(p.y-v.y)**2 <= limit*limit;
            if (!p.inBrush) continue;
          }
          const height=(tree?196:mid?57:p.kind==='log'?46:21)*p.s;
          sphere.center.set(p.x,p.y,p.z+(p.kind==='log'?0:height*.5));sphere.radius=height*.65+42;
          const halo=tree?190*p.s:mid?52*p.s:14*p.s;
          const casts = cast && rebuildCasters && d < (reach + halo) ** 2 && (tree || mid || d < Math.min(300,reach) ** 2);
          const shown=frustum.intersectsSphere(sphere);
          if(!shown && !casts)continue;
          // Choose by the plant's actual size in the player's view. A tall tree
          // behind the focus and a rock beside the eye must not share a zoom tier.
          const radius = (tree ? 103 : mid ? 30 : p.kind === 'log' ? 29 : 16) * p.s;
          const pixels = worldDiameter(cam, display, sphere.center.x, sphere.center.y, sphere.center.z, radius);
          const lod = p.detail = landDetailLevel(pixels, p.detail, tree ? 420 : mid ? 180 : 110, tree ? 115 : mid ? 54 : 32);
          if (!p.transform) {
            trans.position.set(p.x, p.y, p.z);
            trans.rotation.set(p.kind === 'log' ? 1.5 : 0, p.kind === 'log' ? 0.07 : 0, p.angle, 'ZXY');
            trans.scale.set(p.s * p.wide, p.s * p.wide, p.s);
            trans.updateMatrix();
            p.transform = new Float32Array(trans.matrix.elements);
          }
          for (const kind of tree ? ['trunk', 'crown'] : [p.kind]) {
            const slot=shadows[kind];
            if(casts && slot && slot.im.count<slot.cap)slot.im.instanceMatrix.array.set(p.transform,16*slot.im.count++);
            if(!shown)continue;
            // Keep the view *through* the stand. Only remove an added plant that blocks the
            // segment between the tactical camera and its focus, not one behind the subject.
            const raw = ((p.x - eye.x) * ax + (p.y - eye.y) * ay) / ds,
              f = Math.max(0, Math.min(1, raw)),
              dz = eye.z + az * f - p.z;
            const lo = (kind === 'crown' ? 62 : -8) * p.s - Math.min(49,v.dist*.12),
              hi = { crown: 205, trunk: 196, hemlock: 64, brush: 23, bracken: 12, log: 9,stone:12 }[kind] * p.s;
            const room =
              kind === 'crown'
                ? 52 * p.s + Math.min(55, v.dist * 0.11)
                : kind === 'trunk'
                  ? 9 * p.s + 7
                  : kind === 'hemlock'
                    ? 16 * p.s + 10
                    : 12 * p.s + 5;
            const lateral = (p.x - eye.x - ax * f) ** 2 + (p.y - eye.y - ay * f) ** 2;
            if (tree) {
              // Removing just the crown left a forest of sharpened poles at command zoom.
              const pad=Math.min(49,v.dist*.12);
              if(raw<1.03 && dz<205*p.s+6 && ((dz>62*p.s-pad && lateral<(52*p.s+Math.min(55,v.dist*.11))**2) ||
                (dz>-8*p.s-pad && lateral<(9*p.s+7)**2)))continue;
            } else if (raw < 1.03 && dz > lo && dz < hi + 6 && lateral < room * room) continue;
            const rows = batches[kind];
            let layer = lod;
            while (layer < 2 && rows[layer].im.count >= rows[layer].max) layer++;
            const b = rows[layer];
            if (b.im.count >= b.max) growDistant(b);
            const i = b.im.count++;
            b.im.instanceMatrix.array.set(p.transform, 16*i);
            const shade = 0.76 + p.tone * 0.23;
            b.tint.setXYZW(i, shade, shade, shade, -1);
          }
        }
      let tris = 0;
      stats.drawn = {};
      for (const [k, rows] of Object.entries(batches)) {
        let n = 0;
        for (const { im, tint } of rows) {
          im.visible = im.count > 0;
          publish(im.instanceMatrix, im.count);
          publish(tint, im.count);
          n += im.count;
          tris += (im.count * im.geometry.index.count) / 3;
        }
        stats.drawn[k] = n;
      }
      if (rebuildCasters) {
        stats.shadowInstances = 0;
        for (const {im} of Object.values(shadows)) {
          im.visible = im.count > 0;
          publish(im.instanceMatrix, im.count);
          stats.shadowInstances += im.count;
        }
      }
      stats.triangles = tris;
    }
    return { stats, update, dispose, lightMap, materials:[mat,bark,stone,stem] };
  } catch (e) {
    dispose();
    throw e;
  }
}
