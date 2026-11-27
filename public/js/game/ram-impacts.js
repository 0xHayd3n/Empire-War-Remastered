// Swept gameplay hulls. Unlike death debris, these queries are made by the
// tactical authority, using simulation positions (never camera, LOD or fog).
// No rigid-body world to step or serialize; only the order mover proposes a path.
const Q = { x: 0, y: 0, z: 0, w: 1 };
const vec = () => ({ x: 0, y: 0, z: 0 });
const ZERO = vec();
const rotate = (row, v) => ({ x: v.x * row.cos - v.y * row.sin, y: v.x * row.sin + v.y * row.cos, z: v.z });
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function wantsRamming(setup) {
  // Network peers must first negotiate a common physics/rules version. Old
  // recordings have no marker and must never gain new damage on playback.
  return (
    !!setup &&
    (!setup.mode || setup.mode === 'land' || setup.mode === 'space') &&
    !setup.net &&
    !setup.shooterNet &&
    !setup.attract &&
    !setup.headless &&
    (!setup.replay || setup.ramRule === 1)
  );
}

export class RamImpacts {
  constructor(R, domain) {
    this.R = R;
    this.land = domain === 'land';
    this.rows = new WeakMap();
    this.sweep = [];
    this.hits = [];
    this.held = new Set();
    this.impacts = 0;
    this.epoch = 0;
  }
  eligible(u) {
    if (
      u.dead ||
      u.gone ||
      u.limbo ||
      u.scriptHidden ||
      u.hyper ||
      u.retreatFlight ||
      !(u.maxHealth > 0) ||
      !Number.isFinite(u.x + u.y + u.z)
    )
      return false;
    return this.land
      ? u.kind === 'VEHICLE' &&
          !u.foot &&
          !u.structure &&
          !u.flies &&
          !u.flight &&
          !u.rope &&
          !u.inside &&
          !u.cinematicTransport &&
          !u.untargetable
      : u.isMobile && !u.isPad && !u.isStation && u.targetableUnit !== false;
  }
  row(u) {
    let row = this.rows.get(u);
    if (!row) {
      row = { u, p: vec(), d: vec(), c: vec(), q: { ...Q }, peers: new Set() };
      this.rows.set(u, row);
    }
    return row;
  }
  latch(a, b) {
    if (a.peers.has(b)) return false;
    a.peers.add(b);
    b.peers.add(a);
    this.held.add({ a, b });
    return true;
  }
  // Unit references are resolved by the existing tactical save codecs; never
  // write Rapier shapes, transforms or renderer IDs to a save. Reloading a
  // battle with two hulls still touching must not charge for a second ram.
  snapshot(ref) {
    const pairs = [];
    for (const { a, b } of this.held) {
      if (a.u.dead || b.u.dead) continue;
      const x = ref(a.u),
        y = ref(b.u);
      if (x && y) pairs.push([x, y]);
    }
    return pairs;
  }
  restore(pairs, resolve) {
    if (!Array.isArray(pairs)) return;
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const a = resolve(pair[0]),
        b = resolve(pair[1]);
      if (a && b && a !== b && this.eligible(a) && this.eligible(b)) this.latch(this.row(a), this.row(b));
    }
  }
  begin(units, dt) {
    this.dt = dt;
    this.epoch++;
    this.sweep.length = this.hits.length = 0;
    if (!(dt > 0 && dt <= 0.25)) return;
    for (const [i, u] of units.entries()) {
      if (!this.eligible(u)) continue;
      const row = this.row(u);
      // Conservative footprint, not the texture/glow or a capital ship's full
      // enclosing sphere. Mod/no-art units still have a gameplay hit radius.
      const width = !this.land && u.hitB > 0 && u.hitC > 0 ? Math.min(u.hitRadius, u.hitB, u.hitC) : u.hitRadius;
      const r = Number.isFinite(width) && width > 0 ? width : this.land ? 4 : 10;
      const radius = clamp(r, 1, this.land ? 128 : 1000);
      const span = !this.land && Number.isFinite(u.hitA) ? clamp(u.hitA - radius, 0, 1600) : 0;
      if (row.span !== span || row.radius !== radius) {
        row.shape = span ? new this.R.Capsule(span, radius) : new this.R.Ball(radius);
        row.span = span;
        row.radius = radius;
        row.r = span + radius;
      }
      const heading = span ? u.heading || 0 : 0,
        angle = span ? heading - Math.PI / 2 : 0;
      row.cos = Math.cos(angle);
      row.sin = Math.sin(angle);
      row.q.z = Math.sin(angle / 2);
      row.q.w = Math.cos(angle / 2);
      const ch = Math.cos(heading),
        sh = Math.sin(heading),
        f = span ? u.hitF || 0 : 0,
        l = span ? u.hitL || 0 : 0;
      row.c.x = u.x + ch * f - sh * l;
      row.c.y = u.y + sh * f + ch * l;
      row.c.z = u.z + (span ? u.hitZ || 0 : 0);
      row.epoch = this.epoch;
      row.p.x = u.x;
      row.p.y = u.y;
      row.p.z = u.z;
      row.speed = Math.max(1, (this.land ? u.speed : u.maxSpeed) || 0);
      row.order = i;
      row.stopped = false;
    }
    for (const h of this.held) {
      const { a, b } = h;
      const pad = Math.max(1, (a.radius + b.radius) * 0.12);
      if (a.epoch !== this.epoch || b.epoch !== this.epoch || !a.shape.contactShape(a.c, a.q, b.shape, b.c, b.q, pad)) {
        a.peers.delete(b);
        b.peers.delete(a);
        this.held.delete(h);
      }
    }
  }
  end(units, onImpact) {
    const dt = this.dt;
    if (!dt) return;
    this.dt = 0;
    const { sweep, hits } = this;
    for (const u of units) {
      const a = this.rows.get(u);
      if (!a || a.epoch !== this.epoch || !this.eligible(u)) continue;
      const { p, d, r } = a;
      d.x = u.x - p.x;
      d.y = u.y - p.y;
      d.z = u.z - p.z;
      // A scripted relocation, reinforcement warp or correction isn't a ram.
      if (Math.hypot(d.x, d.y, d.z) > Math.max(3, 4 * a.speed * dt)) continue;
      a.lo = a.c.x + Math.min(0, d.x) - r;
      a.hi = a.c.x + Math.max(0, d.x) + r;
      sweep.push(a);
    }
    sweep.sort((a, b) => a.lo - b.lo || a.order - b.order);
    for (let i = 0; i < sweep.length; i++)
      for (let j = i + 1; j < sweep.length && sweep[j].lo <= sweep[i].hi; j++) {
        const a = sweep[i],
          b = sweep[j],
          r = a.r + b.r;
        const x = b.c.x - a.c.x,
          y = b.c.y - a.c.y,
          z = b.c.z - a.c.z;
        const vx = a.d.x - b.d.x,
          vy = a.d.y - b.d.y,
          vz = a.d.z - b.d.z,
          travel = vx * vx + vy * vy + vz * vz;
        const start = x * x + y * y + z * z,
          approach = x * vx + y * vy + z * vz;
        if (
          !travel ||
          (!a.span && !b.span && (approach <= 0 || start <= r * r)) ||
          Math.abs(y) > r + Math.abs(vy) ||
          Math.abs(z) > r + Math.abs(vz)
        )
          continue;
        const f = clamp(approach / travel, 0, 1);
        if ((x - vx * f) ** 2 + (y - vy * f) ** 2 + (z - vz * f) ** 2 > r * r) continue;
        // Cast one normalized tick in relative coordinates to retain precision
        // on large maps. This catches hits between ticks as well as final overlap.
        const hit = a.shape.castShape(ZERO, a.q, a.d, b.shape, { x, y, z }, b.q, b.d, 0, 1, true);
        if (!hit || hit.time_of_impact <= 0) continue; // spawning already overlapped isn't an impact
        const n = rotate(a, hit.normal1),
          t = hit.time_of_impact;
        const closing = (vx * n.x + vy * n.y + vz * n.z) / dt;
        const rate = Math.max(
          1,
          Math.hypot(a.d.x, a.d.y, a.d.z) > 0.001 ? a.speed : 0,
          Math.hypot(b.d.x, b.d.y, b.d.z) > 0.001 ? b.speed : 0
        );
        if (!Number.isFinite(closing + t) || closing < Math.max(this.land ? 5 : 8, 0.3 * rate)) continue;
        hits.push({ a, b, t, witness: rotate(a, hit.witness1), closing, rate });
      }
    hits.sort((p, q) => p.t - q.t || p.a.order - q.a.order || p.b.order - q.b.order);
    for (const h of hits) {
      const { a, b, witness, t, closing, rate } = h;
      if (a.stopped || b.stopped || a.u.dead || b.u.dead) continue;
      const at = { x: a.c.x + t * a.d.x + witness.x, y: a.c.y + t * a.d.y + witness.y, z: a.c.z + t * a.d.z + witness.z };
      for (const row of [a, b]) {
        const { u, p, d } = row;
        if (!(d.x || d.y || d.z)) continue;
        // Retain a tiny gap so a subsequent sweep can see sustained contact;
        // don't rewind the unit farther than its proposed move on this tick.
        const f = Math.max(0, t - 0.002 / Math.max(0.001, Math.hypot(d.x, d.y, d.z)));
        u.x = p.x + d.x * f;
        u.y = p.y + d.y * f;
        u.z = p.z + d.z * f;
        row.stopped = true;
        if (this.land) {
          u.mv = 0;
          u.holder?.position.set(u.x, u.y, u.z);
        } else {
          u.speed = 0;
          u.syncObj?.();
        }
      }
      if (!this.latch(a, b)) continue;
      this.impacts++;
      // Both sides take the same raw hit. The smaller hull limits the energy
      // available: a fighter doesn't deal a capital ship's worth of damage.
      const damage = Math.min(a.u.maxHealth, b.u.maxHealth) * clamp(0.14 * (closing / rate) ** 2, 0.025, 0.4);
      onImpact(a.u, b.u, damage, at);
    }
    // Release references to casualties between ticks. No native handles survive a cast.
    sweep.length = hits.length = 0;
  }
}
