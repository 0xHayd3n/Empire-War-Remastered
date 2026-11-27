// Native authority for one question the tactical sims keep asking: did this
// projectile segment strike that unit's authored hull, and where?
//
// Rapier owns the acceleration structure and the triangle test. The caller keeps
// ownership of everything else: target eligibility (land shotMeets/o === s.target,
// space team/hardpoint rules), damage, armour, shields, deflection, fuses, blast,
// script effects and FX. This module never damages, never scores a "miss" and
// never draws anything - it answers with a time-of-impact and that number is what
// land's meshStrike() and space's meshStep() return to their hit loops.
//
// Geometry lives in each model's own space. A unit's authored collision triangles
// or authored COLLISIONBOX are uploaded once per model (collmesh.js already caches
// them per model), and every query transforms the shot segment into that space -
// the same convention the legacy meshHit() calls used. Moving units therefore cost
// one matrix inverse per strike and no collider synchronisation, and a shot cannot
// hit a hull at a stale pose.
//
// Precision order, per unit:
//   1. authored collision triangles (collisionOf)   exact triangle test
//   2. authored COLLISIONBOX (collisionBoxOf)       exact for that authored box
//   3. no authored mesh: use the existing gameplay volume with its exact axes.
// Transformed rays let a single solid native sphere/box represent every scaled,
// rotated ellipsoid or box, including authored Collision_Box_Modifier padding.
//
// Rapier's trimesh cast is double-sided, so a segment that starts inside a hull
// reports the exit intersection rather than tunnelling out, exactly like the
// double-sided meshHit() test this replaces.

const ZERO = { x: 0, y: 0, z: 0 },
  Q = { x: 0, y: 0, z: 0, w: 1 };

export class BattleWeaponCasts {
  // R is the Rapier module from rapier-runtime.js (loadWreckPhysics()). Nothing is
  // allocated for a battle that never asks a question.
  constructor(R, opts = {}) {
    this.R = R || null;
    this.enabled = !!this.R && opts.enabled !== false;
    this.hulls = new WeakMap();
    this.hullCount = 0;
    this.queries = 0;
    this.failed = null;
    this.world = null;
    this.ray = null;
    if (!this.enabled) return;
    try {
      // Gravity is irrelevant: nothing here is ever stepped. Colliders are static
      // and sit at the model-space origin for the lifetime of the model.
      this.world = new this.R.World({ x: 0, y: 0, z: 0 });
      this.ball = new R.Ball(1);
      this.box = new R.Cuboid(1, 1, 1);
      this.ray = new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    } catch (e) {
      this.failed = e;
      this.enabled = false;
      this.world = null;
      this.ray = null;
    }
  }

  // Upload (or reuse) the native trimesh for one collmesh.js hull. `mesh` is the
  // BVH record collmesh.js builds - both the authored triangle set and the
  // authored box are expressed that way, so callers hand over whichever their
  // precision policy picked. Returns null when the hull cannot be served.
  colliderFor(mesh) {
    const known = this.hulls.get(mesh);
    if (known !== undefined) return known;
    let collider = null;
    try {
      const T = mesh && mesh.T;
      const n = T ? (T.length / 9) | 0 : 0;
      if (n > 0) {
        const indices = new Uint32Array(n * 3);
        for (let k = 0; k < indices.length; k++) indices[k] = k;
        collider = this.world.createCollider(this.R.ColliderDesc.trimesh(T instanceof Float32Array ? T : Float32Array.from(T), indices));
        this.hullCount++;
      }
    } catch (e) {
      this.failed = e;
      collider = null;
    }
    this.hulls.set(mesh, collider);
    return collider;
  }

  // Segment-vs-hull in the hull's own space. Returns the fraction of the segment
  // at which the hull is struck (0..1, the same units meshHit() reports), -1 for a
  // clean miss, or undefined when this authority cannot decide (authority off, no
  // native hull for this mesh, Rapier unavailable). Callers treat undefined as
  // "fall back to the legacy test" so an unavailable authority can never turn a
  // hit into a miss.
  segment(mesh, x0, y0, z0, x1, y1, z1) {
    if (!this.enabled || !mesh || !mesh.T) return undefined;
    const collider = this.colliderFor(mesh);
    if (!collider) return undefined;
    const dx = x1 - x0,
      dy = y1 - y0,
      dz = z1 - z0;
    if (!(dx || dy || dz)) return -1;
    const ray = this.ray;
    ray.origin.x = x0;
    ray.origin.y = y0;
    ray.origin.z = z0;
    ray.dir.x = dx;
    ray.dir.y = dy;
    ray.dir.z = dz;
    this.queries++;
    // maxToi 1 with the full segment as the direction keeps the result in the
    // fraction space the call sites already interpolate with. solid = true because
    // an authored hull is a surface, not a hollow shell.
    const t = collider.castRay(ray, 1, true);
    return t < 0 ? -1 : t > 1 ? 1 : t;
  }

  volume(box, x0, y0, z0, x1, y1, z1, cx, cy, cz, heading, a, b, c) {
    if (!this.enabled || !(a > 0 && b > 0 && c > 0)) return undefined;
    const ray = this.ray,
      co = Math.cos(heading),
      si = Math.sin(heading),
      x = x0 - cx,
      y = y0 - cy,
      dx = x1 - x0,
      dy = y1 - y0;
    ray.origin.x = (x * co + y * si) / a;
    ray.origin.y = (-x * si + y * co) / b;
    ray.origin.z = (z0 - cz) / c;
    ray.dir.x = (dx * co + dy * si) / a;
    ray.dir.y = (-dx * si + dy * co) / b;
    ray.dir.z = (z1 - z0) / c;
    if (!(ray.dir.x || ray.dir.y || ray.dir.z)) {
      const { x, y, z } = ray.origin;
      return (box ? Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1 : x * x + y * y + z * z <= 1) ? 0 : -1;
    }
    this.queries++;
    return (box ? this.box : this.ball).castRay(ray, ZERO, Q, 1, true);
  }

  stats() {
    return {
      enabled: this.enabled,
      hulls: this.hullCount,
      queries: this.queries,
      failed: this.failed ? String(this.failed.message || this.failed) : null
    };
  }

  // Release the WASM side. Idempotent; a disposed authority answers undefined.
  dispose() {
    const world = this.world;
    this.world = null;
    this.ray = null;
    this.hulls = new WeakMap();
    this.enabled = false;
    world?.free();
  }
}
