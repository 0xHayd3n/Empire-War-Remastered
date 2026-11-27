import { RamImpacts } from './ram-impacts.js';

// Orders propose a displacement. The accepted path is constrained to that
// segment, so a contact cannot push a soldier through impassable map cells.
// Sweep both hulls, not one hull against last frame's stationary scenery.
const ZERO = { x: 0, y: 0, z: 0 },
  GAP = 0.002;
const mag = v => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const rotate = (r, v) => ({ x: v.x * r.cos - v.y * r.sin, y: v.x * r.sin + v.y * r.cos, z: v.z });
const earlier = (a, b) => a.t - b.t || a.p.id - b.p.id;
function push(heap, e) {
  let i = heap.length;
  heap.push(e);
  while (i) {
    const p = (i - 1) >> 1;
    if (earlier(heap[p], e) <= 0) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = e;
}
function pop(heap) {
  const first = heap[0],
    tail = heap.pop();
  if (heap.length) {
    let i = 0;
    for (;;) {
      let j = 2 * i + 1;
      if (j >= heap.length) break;
      if (j + 1 < heap.length && earlier(heap[j + 1], heap[j]) < 0) j++;
      if (earlier(tail, heap[j]) <= 0) break;
      heap[i] = heap[j];
      i = j;
    }
    heap[i] = tail;
  }
  return first;
}

// A stop changes all future relative sweeps involving that unit. In particular
// a following vehicle may now hit a stationary leader that was previously
// travelling at the same speed. Each mover stops at most once per tick.
function schedule(p, now, heap) {
  const { a, b } = p,
    tag = ++p.tag,
    av = a.free ? a.d : ZERO,
    bv = b.free ? b.d : ZERO;
  const vx = av.x - bv.x,
    vy = av.y - bv.y,
    vz = av.z - bv.z,
    speed2 = vx * vx + vy * vy + vz * vz;
  if (speed2 < 1e-16) return;
  const af = Math.min(now, a.until),
    bf = Math.min(now, b.until);
  const x = b.c.x - a.c.x + b.d.x * bf - a.d.x * af,
    y = b.c.y - a.c.y + b.d.y * bf - a.d.y * af,
    z = b.c.z - a.c.z + b.d.z * bf - a.d.z * af;
  const delta = { x, y, z },
    span = 1 - now,
    radius = a.r + b.r,
    near = Math.max(0, Math.min(span, (x * vx + y * vy + z * vz) / speed2));
  if ((x - vx * near) ** 2 + (y - vy * near) ** 2 + (z - vz * near) ** 2 > (radius + 0.002) ** 2) return;
  const hit = a.shape.castShape(ZERO, a.q, av, b.shape, delta, b.q, bv, 0, span, true);
  if (!hit) return;
  let normal = hit.normal1,
    point = hit.witness1;
  const at = hit.time_of_impact;
  if (at <= 1e-6) {
    // A pre-existing deep overlap (e.g. spawning a company or exiting a
    // transport) is not an impact. Do not trap or eject its occupants.
    const contact = a.shape.contactShape(ZERO, a.q, b.shape, delta, b.q, GAP);
    if (!contact || contact.distance < -GAP) return;
    // contactShape unlike castShape returns *world* normals and witnesses.
    const closing = vx * contact.normal1.x + vy * contact.normal1.y + vz * contact.normal1.z;
    if (closing <= 1e-6) return;
    push(heap, { p, tag, t: now, inward: closing, normal: contact.normal1, point: contact.point1, fresh: false });
    return;
  }
  normal = rotate(a, normal);
  point = rotate(a, point);
  const inward = vx * normal.x + vy * normal.y + vz * normal.z;
  if (inward > 1e-6 && Number.isFinite(at) && at <= span) push(heap, { p, tag, t: now + at, inward, normal, point, fresh: true });
}

export class TacticalMovement extends RamImpacts {
  constructor(R, domain, allied = null, groundZ = null) {
    super(R, domain);
    this.allied = allied;
    this.groundZ = groundZ;
    this.motionStops = 0;
  }
  begin(units, dt) {
    super.begin(units, dt);
    if (!this.land) return;
    // A mover may pop the waypoint based on the proposed end before we resolve
    // contacts. Remember one head, not a copy of every path or the order queue.
    for (const u of units) {
      const r = this.rows.get(u);
      if (r?.epoch !== this.epoch) continue;
      r.path = u.path;
      r.head = u.path?.[0];
      r.second = u.path?.[1];
      r.pathLength = u.path?.length;
    }
  }
  eligible(u) {
    if (super.eligible(u)) return true;
    if (
      u.dead ||
      u.gone ||
      u.limbo ||
      u.scriptHidden ||
      u.hyper ||
      u.retreatFlight ||
      u.flight ||
      u.rope ||
      u.inside ||
      u.cinematicTransport ||
      !(u.maxHealth > 0) ||
      !Number.isFinite(u.x + u.y + u.z)
    )
      return false;
    if (this.land)
      return !u.spot && !u.untargetable && (u.foot || u.flies || ((u.structure || u.kind === 'STRUCTURE') && !!u.footprint?.length));
    return u.isStation || (!u.isPad && u.type?.behaviors?.().has('SPACE_OBSTACLE') && !u.isField);
  }
  passThrough(a, b) {
    if (!this.land) return a.carrier === b || b.carrier === a;
    if (a.squad?.entering === b || b.squad?.entering === a) return true;
    return (
      ((a.crusher && (b.squashable || (a.supercrusher && b.squashableBig))) ||
        (b.crusher && (a.squashable || (b.supercrusher && a.squashableBig)))) &&
      !(this.allied ? this.allied(a.side, b.side) : a.side === b.side)
    );
  }
  end(units, onImpact) {
    const dt = this.dt;
    this.dt = 0;
    if (!(dt > 0 && dt <= 0.25)) return;
    const rows = this.sweep,
      heap = this.hits;
    let id = 0;
    const damage = [];
    for (const u of units) {
      const r = this.rows.get(u);
      if (!r || r.epoch !== this.epoch || !this.eligible(u)) continue;
      const { d, p, c } = r;
      d.x = u.x - p.x;
      d.y = u.y - p.y;
      d.z = u.z - p.z;
      r.travel = mag(d);
      if (r.travel > Math.max(3, 4 * r.speed * dt)) continue; // scripted relocation
      r.free = r.travel > 1e-7;
      r.until = 1;
      (r.neighbors ||= []).length = 0;
      // Actual projected capsule extents, not a sphere the length of a ship.
      const ex = r.radius + r.span * Math.abs(r.sin),
        ey = r.radius + r.span * Math.abs(r.cos);
      r.lo = c.x + Math.min(0, d.x) - ex;
      r.hi = c.x + Math.max(0, d.x) + ex;
      r.y0 = c.y + Math.min(0, d.y) - ey;
      r.y1 = c.y + Math.max(0, d.y) + ey;
      r.z0 = c.z + Math.min(0, d.z) - r.radius;
      r.z1 = c.z + Math.max(0, d.z) + r.radius;
      if (this.terrain && r.free) {
        const t = this.terrain.limit(u, p, d, r.head?.free);
        if (t < 1) push(heap, { tile: r, t, p: { id: id++ } });
      }
      rows.push(r);
    }
    rows.sort((a, b) => a.lo - b.lo || a.order - b.order);
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i];
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j];
        if (b.lo > a.hi) break;
        if ((!a.free && !b.free) || a.y1 < b.y0 || b.y1 < a.y0 || a.z1 < b.z0 || b.z1 < a.z0 || this.passThrough(a.u, b.u)) continue;
        // Every capsule contains its central ball. A deep initial overlap
        // cannot be a new contact. Catch stacked reinforcements here without
        // allocating a graph edge and making two native queries per pair.
        const dx = a.c.x - b.c.x,
          dy = a.c.y - b.c.y,
          dz = a.c.z - b.c.z,
          inside = a.radius + b.radius - GAP;
        if (dx * dx + dy * dy + dz * dz < inside * inside) continue;
        const p = { a, b, id: id++, tag: 0 };
        a.neighbors.push(p);
        b.neighbors.push(p);
        schedule(p, 0, heap);
      }
    }
    while (heap.length) {
      const e = pop(heap);
      if (e.tile) {
        const r = e.tile;
        if (r.free) {
          r.until = Math.max(0, e.t - GAP / r.travel);
          r.free = false;
          this.motionStops++;
          for (const p of r.neighbors) schedule(p, e.t, heap);
        }
        continue;
      }
      const { a, b } = e.p;
      if (e.tag !== e.p.tag) continue;
      const ar = a.free ? a.speed : 0,
        br = b.free ? b.speed : 0,
        rate = Math.max(1, ar, br),
        closing = e.inward / dt;
      const ram = e.fresh && closing >= Math.max(this.land ? 5 : 8, 0.3 * rate) && super.eligible(a.u) && super.eligible(b.u);
      const at = {
        x: a.c.x + a.d.x * Math.min(e.t, a.until) + e.point.x,
        y: a.c.y + a.d.y * Math.min(e.t, a.until) + e.point.y,
        z: a.c.z + a.d.z * Math.min(e.t, a.until) + e.point.z
      };
      const changed = [];
      for (const [r, sense] of [
        [a, 1],
        [b, -1]
      ])
        if (r.free && (ram || dot(r.d, e.normal) * sense > 0)) {
          r.until = Math.max(0, e.t - GAP / Math.max(0.001, r.travel));
          r.free = false;
          changed.push(r);
          this.motionStops++;
        }
      if (ram && this.latch(a, b))
        damage.push([a.u, b.u, Math.min(a.u.maxHealth, b.u.maxHealth) * Math.min(0.4, Math.max(0.025, 0.14 * (closing / rate) ** 2)), at]);
      for (const r of changed) for (const p of r.neighbors) if (p !== e.p) schedule(p, e.t, heap);
    }
    for (const r of rows) {
      r.neighbors.length = 0;
      if (r.until >= 1) continue;
      const { u, p, d, until: f } = r;
      u.x = p.x + f * d.x;
      u.y = p.y + f * d.y;
      u.z = p.z + f * d.z;
      if (this.land) {
        u.mv = 0;
        u.v = 0;
        if (this.groundZ && !u.flies && u.scriptZ === undefined) u.z = this.groundZ(u.x, u.y) + (u.lift || 0) + (u.hoverZ || 0);
        if (
          r.head &&
          u.path === r.path &&
          u.path.length === r.pathLength - 1 &&
          u.path[0] === r.second &&
          u.legTo === r.head &&
          Math.hypot(r.head.x - u.x, r.head.y - u.y) > Math.max(2, GAP)
        )
          u.path.unshift(r.head);
        u.holder?.position.set(u.x, u.y, u.z);
      } else {
        u.speed = 0;
        u.syncObj?.();
      }
    }
    rows.length = 0;
    for (const [a, b, d, at] of damage)
      if (!a.dead && !b.dead) {
        this.impacts++;
        onImpact(a, b, d, at);
      }
  }
}
