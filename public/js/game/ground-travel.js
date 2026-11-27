// Navigation already accounts for the movement class/clearance of a unit. A
// point ray across those cells tests the footprint once (not inflated twice).
// Cast only at closed cells crossed by this move. No mesh/world for the map,
// no sampling of renderer geometry, and a newly blocked building works at once.
const ZERO = { x: 0, y: 0, z: 0 },
  Q = { x: 0, y: 0, z: 0, w: 1 };
export class GroundTravel {
  constructor(R, cell, open) {
    this.cell = cell;
    this.open = open;
    this.tile = new R.Cuboid(cell / 2, cell / 2, 1);
    this.ray = new R.Ray({ ...ZERO }, { ...ZERO });
  }
  limit(u, p, d, free) {
    if (free || u.flies || u.structure || u.scriptZ !== undefined || (!d.x && !d.y)) return 1;
    const s = this.cell,
      ex = Math.floor((p.x + d.x) / s + 0.5),
      ey = Math.floor((p.y + d.y) / s + 0.5);
    let ix = Math.floor(p.x / s + 0.5),
      iy = Math.floor(p.y / s + 0.5);
    if ((ex === ix && ey === iy) || !this.open(u, ix * s, iy * s)) return 1; // let a unit leave its spawn cell
    const ray = this.ray;
    ray.dir.x = d.x;
    ray.dir.y = d.y;
    const sx = Math.sign(d.x),
      sy = Math.sign(d.y),
      dx = sx ? s / Math.abs(d.x) : Infinity,
      dy = sy ? s / Math.abs(d.y) : Infinity;
    let tx = sx ? ((ix + 0.5 * sx) * s - p.x) / d.x : Infinity,
      ty = sy ? ((iy + 0.5 * sy) * s - p.y) / d.y : Infinity;
    const cast = (x, y) => {
      if (this.open(u, x * s, y * s)) return 1;
      ray.origin.x = p.x - x * s;
      ray.origin.y = p.y - y * s;
      const t = this.tile.castRay(ray, ZERO, Q, 1, true);
      return t >= 0 && t <= 1 ? Math.min(t, 1 - 1e-8) : 1;
    };
    // Stop as soon as the ray leaves the playable map. Never march farther
    // than the number of crossed cell boundaries (also handles endpoint ties).
    let steps = Math.abs(ex - ix) + Math.abs(ey - iy);
    while (steps-- > 0) {
      let hit;
      if (ix !== ex && iy !== ey && Math.abs(tx - ty) < 1e-10) {
        hit = Math.min(cast(ix + sx, iy), cast(ix, iy + sy));
        if (hit < 1) return hit;
        ix += sx;
        iy += sy;
        tx += dx;
        ty += dy;
        steps--;
      } else if (ix !== ex && (iy === ey || tx < ty)) {
        ix += sx;
        tx += dx;
      } else {
        iy += sy;
        ty += dy;
      }
      hit = cast(ix, iy);
      if (hit < 1) return hit;
    }
    return 1;
  }
}
