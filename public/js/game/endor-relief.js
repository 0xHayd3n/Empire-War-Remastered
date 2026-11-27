// A small world-anchored tessellated replacement, not a sheet hovering over stock terrain.
// Endpoints meet the coarse TED triangles exactly; heights never enter the simulation.
import * as T from 'three';
import { scatteredHeight } from '../endor-tiles.js';
import { BANK_HEIGHT, BED, bankMud } from './endor-habitat.js';
import { CELL as cell } from './terrain-cell.js';
const cells = 8,
  div = 12,
  edge = div + 1,
  points = cells * cells * edge * edge;
export function sampleHeight(h, u, v) {
  const x = (u - Math.floor(u)) * h.size - 0.5,
    y = (v - Math.floor(v)) * h.size - 0.5,
    ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    m = h.size - 1;
  const at = (xx, yy) => h.data[(yy & m) * h.size + (xx & m)] / 255;
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}
export function reliefPatch(ground, t, heights, donorBySlot = null, composition = null) {
  const base = ground.material,
    U = base.uniforms,
    geo = new T.BufferGeometry(),
    attributes = {};
  for (const [name, width] of [
    ['position', 3],
    ['normal', 3],
    ['layers', 4],
    ['corner', 2],
    ['shade', 1]
  ]) {
    const a = (attributes[name] = new T.BufferAttribute(new Float32Array(points * width), width));
    geo.setAttribute(name, a);
    if (name !== 'corner') a.setUsage(T.DynamicDrawUsage);
  }
  // Twelve little raster edges aren't identical to ONE long raster edge, even
  // when collinear in world space. Stitch the perimeter to the actual coarse
  // endpoints. Collapse towards the off-diagonal corner so each fan stays on
  // its original TED triangle; the thin transition strip is left undisplaced.
  const indicesPerCell = div * div * 6,
    verticesPerCell = edge * edge;
  const indices = new Uint16Array(cells * cells * indicesPerCell),
    masks = new Uint8Array(cells * cells);
  const edgeMask = (i, j) => (i === 0 ? 1 : 0) | (i === cells - 1 ? 2 : 0) | (j === 0 ? 4 : 0) | (j === cells - 1 ? 8 : 0);
  function indexCell(q, mask) {
    masks[q] = mask;
    const first = q * verticesPerCell;
    const index = (x, y) => {
      if (x > 0 && x < div) {
        if (y === 0 && mask & 4) x = div;
        else if (y === div && mask & 8) x = 0;
      } else if (y > 0 && y < div) {
        if (x === 0 && mask & 1) y = div;
        else if (x === div && mask & 2) y = 0;
      }
      return first + y * edge + x;
    };
    let k = q * indicesPerCell;
    for (let y = 0; y < div; y++)
      for (let x = 0; x < div; x++) {
        const a = index(x, y),
          b = index(x + 1, y),
          c = index(x, y + 1),
          d = index(x + 1, y + 1);
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = c;
      }
  }
  for (let q = 0; q < cells * cells; q++) {
    indexCell(q, edgeMask(q % cells, Math.floor(q / cells)));
    for (let y = 0; y <= div; y++)
      for (let x = 0; x <= div; x++) attributes.corner.setXY(q * verticesPerCell + y * edge + x, x / div, y / div);
  }
  geo.setIndex(new T.BufferAttribute(indices, 1));
  // Use the same lighting, blend weights, complete material maps and fog as the coarse mesh.
  const mat = new T.ShaderMaterial({
    glslVersion: base.glslVersion,
    vertexShader: base.vertexShader,
    defines: { ...base.defines },
    fragmentShader: base.fragmentShader,
    uniforms: { ...U, reliefPatch: { value: new T.Vector4() } }
  });
  const mesh = new T.Mesh(geo, mat);
  // The scan material ray-marches up to three donors per surface. Let opaque models
  // and alpha-tested leaves populate depth first, before shading hidden ground.
  // Stay in the opaque list, ahead of authored decals (order 1) and blended water.
  const originalOrder = ground.renderOrder;
  mesh.renderOrder = originalOrder + 0.5;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.name = 'Endor displaced ground';
  ground.add(mesh);
  let lastX = -1,
    lastY = -1,
    lastVersion = -1,
    range = 0;
  const weights = new Float32Array(4),
    geometryWeights = new Float64Array(4),
    rank = new Float64Array(4),
    firstCorner = new Uint8Array(4),
    displacement = new Float64Array(4),
    corners = [0, 1, 5, 2],
    coverWeights = new Float64Array(7);
  function physicalHeight(s, x, y, z) {
    const u = U.texU.value[s],
      v = U.texV.value[s],
      id = donorBySlot[s],
      h = heights[id],
      rep = Math.abs(v.w);
    return scatteredHeight(sampleHeight, h, (u.x * x + u.y * y + u.z * z) * rep, (v.x * x + v.y * y + v.z * z) * rep, id, v.w < 0);
  }
  const offset = (s, h) => (h - heights[donorBySlot[s]].mean) * heights[donorBySlot[s]].amplitude;
  const bounds = U.reliefPatch.value,
    cellBase = new Int32Array(cells * cells);
  // Fixed-size scrolling cache of *untapered* displacement. Each cell in the
  // window owns a unique ring slot. A shifted rim must still be tapered anew.
  // Keep a one-window margin for reversing a pan. Store derived vertices by
  // world cell, never by camera or frame. Space stays bounded on any map.
  const cacheSide = cells * 2, cacheCells = cacheSide * cacheSide, cachePoints = cacheCells * verticesPerCell;
  const owners = new Int32Array(cacheCells).fill(-1), rawHeight = new Float64Array(cachePoints),
    finalMask = new Uint8Array(cacheCells), finalPosition = new Float32Array(cachePoints * 3),
    reliefMin = new Float64Array(cacheCells), reliefMax = new Float64Array(cacheCells);
  // Interpolated normals and authored shade follow the world cell, not the rim.
  // Keep one bounded block per ring slot; never copy final tapered heights.
  const normRing = new Float32Array(cachePoints * 3),
    shadeRing = donorBySlot ? new Float32Array(cachePoints) : null;
  if (!shadeRing) attributes.shade.array.fill(1);
  let lastCraters = -1, lastNormal = -1,
    lastShade = -1;
  function update(v, on) {
    ground.renderOrder = on ? mesh.renderOrder : originalOrder;
    if (!on || v.dist > 225) {
      mesh.visible = false;
      bounds.set(0, 0, 0, 0);
      return;
    }
    const width = t.width ?? t.size,
      height = t.height ?? t.size,
      x0 = Math.max(0, Math.min(width - 1 - cells, Math.floor(v.x / cell) - 4)),
      y0 = Math.max(0, Math.min(height - 1 - cells, Math.floor(v.y / cell) - 4));
    const version = t.paint.geo.attributes.layers.version;
    const normal = t.paint.geo.attributes.normal.version,
      shade = t.paint.geo.attributes.shade?.version;
    const craters = t.craterGeometry, revision = craters?.revision ?? 0;
    const changed = lastVersion !== version || lastNormal !== normal || lastShade !== shade;
    if (lastX !== x0 || lastY !== y0 || changed || lastCraters !== revision) {
      lastX = x0;
      lastY = y0;
      if (changed) owners.fill(-1);
      lastCraters = revision;
      lastNormal = normal;
      lastShade = shade;
      lastVersion = version;
      let o = 0,
        topologyChanged = false,
        lo = Infinity,
        hi = -Infinity;
      const source = t.paint.geo.attributes,
        h = t.heights;
      for (let j = 0; j < cells; j++)
        for (let i = 0; i < cells; i++) {
          const cx = x0 + i,
            cy = y0 + j,
            start = t.paint.triAt[2 * (cy * (width - 1) + cx)];
          // Scar tiles own these cells at every zoom, including a stationary close camera.
          if (start < 0 || craters?.ownsCell(cx,cy)) { cellBase[j*cells+i] = -1; continue; }
          cellBase[j*cells+i] = o;
          // Panning preserves the layout. A hole can shift a different edge type
          // into this packed slot; only then do its resident indices change.
          const packed = o / verticesPerCell,
            mask = edgeMask(i, j) | (craters?.ownsCell(cx-1,cy) ? 1 : 0) | (craters?.ownsCell(cx+1,cy) ? 2 : 0) |
              (craters?.ownsCell(cx,cy-1) ? 4 : 0) | (craters?.ownsCell(cx,cy+1) ? 8 : 0);
          if (masks[packed] !== mask) {
            indexCell(packed, mask);
            topologyChanged = true;
          }
          const slots = source.layers.array.subarray(start * 4, start * 4 + 4),
            allMud = slots.every(s => s === BED),
            a = cy * t.size + cx,
            ring = (cy % cacheSide) * cacheSide + (cx % cacheSide),
            cached = owners[ring] === a,
            hs = [h[a], h[a + 1], h[a + t.size], h[a + t.size + 1]];
          // Identical draw slots share a projection as well as a height map. Different
          // slots of the same material need not (e.g. a rotated cliff).
          owners[ring] = a;
          const block = ring * verticesPerCell,
            begin = o,
            end = block + verticesPerCell;
          if (cached) {
            attributes.normal.array.set(normRing.subarray(3 * block, 3 * end), 3 * begin);
            if (shadeRing) attributes.shade.array.set(shadeRing.subarray(block, end), begin);
          } else for (let q = 0; q < 4; q++) firstCorner[q] = slots.indexOf(slots[q]);
          // The four draw slots are constant throughout one TED cell. Replicate
          // that tuple with bulk copies rather than 169 calls into BufferAttribute.
          const dst = attributes.layers.array, at = begin * 4;
          dst.set(slots, at);
          for (let n = 1; n < verticesPerCell; n *= 2)
            dst.copyWithin(at + n * 4, at, at + 4 * Math.min(n, verticesPerCell - n));
          if (cached && finalMask[ring] === mask) {
            attributes.position.array.set(finalPosition.subarray(3 * block, 3 * end), 3 * begin);
            lo = Math.min(lo, reliefMin[ring]); hi = Math.max(hi, reliefMax[ring]);
            o += verticesPerCell;
            continue;
          }
          let cellLo = Infinity, cellHi = -Infinity;
          for (let iy = 0; iy <= div; iy++)
            for (let ix = 0; ix <= div; ix++) {
              const fx = ix / div,
                fy = iy / div,
                x = (cx + fx) * cell,
                y = (cy + fy) * cell,
                z = fx >= fy ? (1 - fx) * hs[0] + (fx - fy) * hs[1] + fy * hs[3] : (1 - fy) * hs[0] + (fy - fx) * hs[2] + fx * hs[3];
              const entry = block + iy * edge + ix;
              let dz = cached ? rawHeight[entry] : 0;
              if (!cached) {
                weights[0] = (1 - fx) * (1 - fy);
                weights[1] = fx * (1 - fy);
                weights[2] = (1 - fx) * fy;
                weights[3] = fx * fy;
                // The mixed-material renderer warps only the scanned share, then ranks each
                // distinct donor by its height. Do the same on the actual displaced mesh.
                if (donorBySlot && !composition) {
                  let organic = 0;
                  for (let q = 0; q < 4; q++) if (donorBySlot[slots[q]] >= 0) organic += weights[q];
                  const X = x * 0.092,
                    Y = y * 0.092,
                    wx = Math.sin(Y + Math.sin(X * 0.43)) + 0.48 * Math.sin(Y * 2.8 + X * 0.71),
                    wy = Math.cos(X * 0.84 + Math.cos(Y * 0.56)) + 0.48 * Math.sin(X * 2.37 - Y * 0.63);
                  const smooth = k => {
                      k = Math.min(1, Math.max(0, k));
                      return k * k * (3 - 2 * k);
                    },
                    ex = smooth(fx + wx * fx * (1 - fx) * 0.61),
                    ey = smooth(fy + wy * fy * (1 - fy) * 0.61);
                  geometryWeights.fill(0);
                  for (let q = 0; q < 4; q++) {
                    const w = (q & 1 ? ex : 1 - ex) * (q & 2 ? ey : 1 - ey);
                    geometryWeights[firstCorner[q]] += weights[q] + organic * (w - weights[q]);
                  }
                }
                let nx = 0,
                  ny = 0,
                  nz = 0,
                  shade = 0,
                  sampled = 0;
                for (let q = 0; q < 4; q++) {
                  if (!weights[q]) continue;
                  const key = firstCorner[q],
                    bit = 1 << key;
                  if (!composition && !(sampled & bit)) {
                    const s = slots[q],
                      u = U.texU.value[s],
                      v = U.texV.value[s],
                      id = donorBySlot ? donorBySlot[s] : u.w,
                      d = heights[id];
                    const ht = d
                      ? scatteredHeight(
                          sampleHeight,
                          d,
                          (u.x * x + u.y * y + u.z * z) * Math.abs(v.w),
                          (v.x * x + v.y * y + v.z * z) * Math.abs(v.w),
                          id,
                          donorBySlot ? v.w < 0 : id === 7
                        )
                      : 0;
                    displacement[key] = d ? (ht - d.mean) * d.amplitude : 0;
                    if (donorBySlot) {
                      const a = Math.min(1, Math.max(0, (ht - 0.14) / 0.72));
                      rank[key] = d ? 0.44 + 1.2 * a * a * (3 - 2 * a) : 1;
                    }
                    sampled |= bit;
                  }
                  if (!donorBySlot) dz += weights[q] * displacement[key];
                  const b = start + corners[q];
                  if (donorBySlot) shade += weights[q] * source.shade.getX(b);
                  nx += weights[q] * source.normal.getX(b);
                  ny += weights[q] * source.normal.getY(b);
                  nz += weights[q] * source.normal.getZ(b);
                }
                if (composition) {
                  let built = 0;
                  for (let q = 0; q < 4; q++)
                    if (weights[q] && composition.built.has(slots[q])) {
                      dz += weights[q] * offset(slots[q], physicalHeight(slots[q], x, y, z));
                      built += weights[q];
                    }
                  if (built < 0.99999) {
                    composition.sample(x, y, coverWeights);
                    let total = 0,
                      natural = 0;
                    for (let k = 0; k < 7; k++)
                      if (coverWeights[k] > 0) {
                        const s = composition.slots[k],
                          ht = physicalHeight(s, x, y, z),
                          u = Math.max(0, Math.min(1, (ht - 0.14) / 0.72)),
                          w = coverWeights[k] * (0.44 + 1.2 * u * u * (3 - 2 * u));
                        natural += w * offset(s, ht);
                        total += w;
                      }
                    dz += ((1 - built) * natural) / total;
                  }
                }
                if (donorBySlot && !composition) {
                  let total = 0;
                  for (let q = 0; q < 4; q++) {
                    if (geometryWeights[q] <= 0) continue;
                    const w = Math.max(0, geometryWeights[q] * rank[q] - 0.004);
                    dz += w * displacement[q];
                    total += w;
                  }
                  dz /= Math.max(1e-9, total);
                }
                // The water sheet clips against the coarse bank. Don't move that shoreline.
                if (!donorBySlot && t.water?.mode === 1 && z < t.water.level + BANK_HEIGHT) {
                  const k = bankMud(z, t.water.level);
                  if (k > 0 && !allMud) {
                    const ub = U.texU.value[BED],
                      vb = U.texV.value[BED],
                      d = heights[ub.w];
                    const mud = scatteredHeight(sampleHeight, d, ub.x * x, vb.y * y, ub.w);
                    dz += k * ((mud - d.mean) * d.amplitude - dz);
                  }
                  dz *= Math.min(1, Math.abs(z - t.water.level) / BANK_HEIGHT);
                }
                rawHeight[entry] = dz;
                attributes.normal.setXYZ(o, nx, ny, nz);
                if (shadeRing) attributes.shade.setX(o, shade);
              }
              const toRim = Math.min(i + fx, j + fy, cells - i - fx, cells - j - fy,
                mask & 1 ? fx : Infinity, mask & 2 ? 1-fx : Infinity,
                mask & 4 ? fy : Infinity, mask & 8 ? 1-fy : Infinity);
              dz *= Math.max(0, Math.min(1, (toRim * div - 1) / (div - 1)));
              cellLo = Math.min(cellLo, dz); cellHi = Math.max(cellHi, dz);
              attributes.position.setXYZ(o++, x, y, z + dz);
            }
          finalMask[ring] = mask;
          reliefMin[ring] = cellLo; reliefMax[ring] = cellHi;
          lo = Math.min(lo, cellLo); hi = Math.max(hi, cellHi);
          finalPosition.set(attributes.position.array.subarray(3 * begin, 3 * o), 3 * block);
          if (!cached) {
            normRing.set(attributes.normal.array.subarray(3 * begin, 3 * o), 3 * block);
            if (shadeRing) shadeRing.set(attributes.shade.array.subarray(begin, o), block);
          }
        }
      if (topologyChanged) geo.index.needsUpdate = true;
      geo.setDrawRange(0, (o / verticesPerCell) * indicesPerCell);
      attributes.position.needsUpdate = attributes.normal.needsUpdate = attributes.layers.needsUpdate = true;
      if (shadeRing) attributes.shade.needsUpdate = true;
      range = o ? hi - lo : 0;
    }
    bounds.set(x0 * cell, y0 * cell, (x0 + cells) * cell, (y0 + cells) * cell);
    mesh.visible = true;
  }
  return {
    update,
    // Sample the actual drawn subtriangle, not a second approximate displacement.
    surface(x, y, coarse) {
      if (!mesh.visible || x < bounds.x || y < bounds.y || x >= bounds.z || y >= bounds.w) return coarse;
      const X = (x - bounds.x) / cell,
        Y = (y - bounds.y) / cell,
        i = Math.floor(X),
        j = Math.floor(Y),
        base = cellBase[j * cells + i];
      if (base < 0) return coarse;
      const gx = (X - i) * div,
        gy = (Y - j) * div,
        ix = Math.min(div - 1, Math.floor(gx)),
        iy = Math.min(div - 1, Math.floor(gy)),
        fx = gx - ix,
        fy = gy - iy;
      const k = base + iy * edge + ix,
        p = attributes.position;
      return fx >= fy
        ? (1 - fx) * p.getZ(k) + (fx - fy) * p.getZ(k + 1) + fy * p.getZ(k + edge + 1)
        : (1 - fy) * p.getZ(k) + (fy - fx) * p.getZ(k + edge) + fx * p.getZ(k + edge + 1);
    },
    get triangles() {
      return mesh.visible ? geo.drawRange.count / 3 : 0;
    },
    get heightRange() {
      return range;
    },
    dispose() {
      ground.renderOrder = originalOrder;
      bounds.set(0, 0, 0, 0);
      ground.remove(mesh);
      geo.dispose();
      mat.dispose();
    }
  };
}
