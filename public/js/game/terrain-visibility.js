import * as T from '../../vendor/three/build/three.module.js';
import { CELL } from './terrain-cell.js';

// Group consecutive rows, then subdivide their bounds along X. Testing an entire
// map-wide row against the six planes alone hugely overestimates its visibility
// for diagonal views. triAt remains the authority on packed offsets and holes.
export function terrainBands(t, triAt, total) {
  const width = (t.width ?? t.size) - 1,
    height = (t.height ?? t.size) - 1,
    bands = [];
  for (let y = 0; y < height; y += 8) {
    const band = { box: new T.Box3(), tiles: [] },
      ymax = Math.min(height, y + 8);
    for (let x = 0; x < width; x += 16) {
      const xmax = Math.min(width, x + 16);
      let start = Infinity,
        end = 0,
        lo = Infinity,
        hi = -Infinity;
      for (let j = y; j < ymax; j++)
        for (let i = x; i < xmax; i++) {
          const at = triAt[2 * (j * width + i)];
          if (at < 0) continue;
          start = Math.min(start, at);
          end = Math.max(end, at + 6);
          const p = j * t.size + i,
            h = t.heights;
          lo = Math.min(lo, h[p], h[p + 1], h[p + t.size], h[p + t.size + 1]);
          hi = Math.max(hi, h[p], h[p + 1], h[p + t.size], h[p + t.size + 1]);
        }
      if (!end) continue;
      const box = new T.Box3(new T.Vector3(x * CELL, y * CELL, lo), new T.Vector3(xmax * CELL, ymax * CELL, hi)).expandByScalar(0.05);
      band.tiles.push({ box, start, end });
      band.box.union(box);
    }
    if (band.tiles.length) bands.push(band);
  }
  const planes = new T.Frustum(),
    clip = new T.Matrix4();
  const edge = (i, step) => {
    for (; i >= 0 && i < bands.length; i += step) {
      const band = bands[i];
      if (!planes.intersectsBox(band.box)) continue;
      let bound = step > 0 ? Infinity : -Infinity;
      for (const tile of band.tiles)
        if (planes.intersectsBox(tile.box)) bound = step > 0 ? Math.min(bound, tile.start) : Math.max(bound, tile.end);
      if (Number.isFinite(bound)) return bound;
    }
    return -1;
  };
  return (camera, world, range) => {
    planes.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(world));
    const start = edge(0, 1);
    range.start = Math.max(0, start);
    range.count = start < 0 ? 0 : Math.min(total, edge(bands.length - 1, -1)) - start;
  };
}

export function enableTerrainCulling(mesh, t, triAt) {
  const geo = mesh.geometry,
    total = geo.drawRange.count;
  if (total < 8192) return;
  const select = terrainBands(t, triAt, total),
    range = geo.drawRange;
  // Runs with the camera actually submitting this draw (including the oblique
  // water mirror). Coarse culling never touches the close relief child or paint.
  mesh.onBeforeRender = (_, scene, camera) => select(camera, mesh.matrixWorld, range);
  mesh.onAfterRender = () => {
    range.start = 0;
    range.count = total;
  };
}
