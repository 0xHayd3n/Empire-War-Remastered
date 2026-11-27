// Local presentation only: decide which nearby ground vehicles are genuinely
// travelling this frame, so parked wreckage can be shoved by them. A mover is
// read, never written: no path, speed, position, damage or order is touched and
// nothing here feeds back into the battle simulation.
//
// The guard rails matter more than the push itself. Paused units, teleports,
// scripted elevation, flying/hovering / transport riders and fog-hidden units
// must never wake a wreck: a corpse that twitches on its own is worse than a
// static one.
const MIN_SPEED = 2.2; // world units / second: an idling or creeping hull cannot shove
const MAX_FRAME = 0.25; // never integrate more than this as one continuous move
const PLAUSIBLE = 120; // world units / second floor before a jump is treated as a teleport
const MIN_RUN = 20; // continuous travel before contact may shove: teleports and spawns never qualify
const HEAVY = 6; // hit radius below this is a light frame, not a hull
const MAX_REACH = 40;

export class WreckMovers {
  constructor(fogged = () => false) {
    this.fogged = fogged;
    this.last = new WeakMap();
  }

  // A scripted replay or a fresh battle must not inherit stale baselines.
  reset() {
    this.last = new WeakMap();
  }

  eligible(u) {
    if (
      !u ||
      u.kind !== 'VEHICLE' ||
      u.foot ||
      u.structure ||
      u.flies ||
      u.flight ||
      u.rope ||
      u.dead ||
      u.gone ||
      u.limbo ||
      u.inside ||
      u.cinematicTransport ||
      u.retreatFlight ||
      u.scriptHidden ||
      u.netHidden ||
      u.hyper ||
      u.cloaked ||
      u.seen === false ||
      u.holder?.visible === false
    )
      return false;
    // Scripted elevation can be a teleport or an off-map drop; it is not travel.
    if (u.scriptZ !== undefined) return false;
    if ((u.lift || 0) > 2 || (u.hoverZ || 0) > 2) return false;
    if (Number.isFinite(u.hitRadius) && u.hitRadius > 0 && u.hitRadius < HEAVY) return false;
    if (!Number.isFinite(u.x + u.y)) return false;
    return !this.fogged(u.x, u.y);
  }

  // Returns one row per mover whose last frame is real, visible, grounded travel.
  // Call once per frame with the world's live unit list.
  scan(units, dt) {
    const out = [];
    if (!units) return out;
    const step = Math.min(dt > 0 ? dt : 0, MAX_FRAME);
    for (const u of units) {
      if (u?.kind !== 'VEHICLE' || u.foot) continue;
      const x = u.x,
        y = u.y;
      if (!Number.isFinite(x + y)) continue;
      // Baseline every unit every frame, so a resume after a pause, a fog reveal
      // or an ineligible phase starts a fresh travel history instead of a stale
      // one. Only a mover that has demonstrably driven a hull length (MIN_RUN)
      // can shove anything: a spawn, teleport or scripted jump never qualifies.
      const prev = this.last.get(u);
      if (!prev) {
        this.last.set(u, { x, y, run: 0 });
        continue;
      }
      if (!(step > 0) || !this.eligible(u)) {
        prev.x=x;prev.y=y;prev.run=0;
        continue;
      }
      const dx = x - prev.x,
        dy = y - prev.y,
        dist = Math.hypot(dx, dy);
      if (!(dist > 0.01)) continue;
      const speed = dist / step;
      // A jump larger than the hull could physically cover is a teleport/hitch,
      // not contact. The new position starts a fresh travel history.
      const plausible = Math.max(PLAUSIBLE, Math.abs(Number(u.speed) || 0) * 4 + 40);
      if (speed < MIN_SPEED || speed > plausible) {
        this.last.set(u, { x, y, run: 0 });
        continue;
      }
      const run = (prev.run || 0) + dist;
      prev.x=x;prev.y=y;prev.run=run;
      if (run < MIN_RUN) continue;
      const reach = Math.max(HEAVY, Math.min(MAX_REACH, Number(u.hitRadius) || Number(u.visualRadius) || 12));
      out.push({
        u,
        x,
        y,
        dx,
        dy,
        dist,
        speed,
        run,
        reach,
        strength: Math.min(1, (speed - MIN_SPEED) / 30)
      });
    }
    return out;
  }
}
