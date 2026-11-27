import { FOOTFALL, footfallKind, footfallProfile, planFootfall, padGroundOk, hashFootfall } from './footfall.js';

// Stride phase is distance travelled after simulation contacts, independent of
// presentation (bone LOD, render rate, camera and whether a foot is visible).
export class GroundSteps {
  constructor(world, pits) {
    this.world = world;
    this.pits = pits;
    this.states = new WeakMap();
    this.start = 0;
    this.credit = 2;
  }
  stamp(u, profile, point, crush, concealed) {
    const pits = this.pits,
      grid = pits.cell / pits.physical.n;
    // Centre the pressure on a fine terrain vertex. Even a sub-cell boot must
    // actually move a vertex; no floating decal or unavailable finer sampler.
    const x = grid * Math.round(point.x / grid),
      y = grid * Math.round(point.y / grid);
    const halfLength = Math.min(6, Math.max(2.6, profile.halfLength * (crush ? 1.5 : 1))),
      halfWidth = Math.min(halfLength, Math.max(0.8, profile.halfWidth * (crush ? 1.4 : 1))),
      depth = Math.min(0.95, profile.depth * (crush ? 1.9 : 1));
    if (!padGroundOk(this.world.terrain, this.world, { x, y, halfLength, halfWidth })) return;
    const cell = pits.physical.cells.get(Math.floor(y / pits.cell) * pits.quadsW + Math.floor(x / pits.cell));
    if (!crush && cell?.members.some(s => s.pad && s.x === x && s.y === y && s.depth >= depth)) return;
    return pits.hit(x, y, halfLength, {
      depth,
      lip: 0,
      scorch: 0,
      seed: hashFootfall(profile.seed, point.seq || 0),
      pad: { yaw: point.yaw, halfWidth },
      concealed
    });
  }
  crush(crusher, victim, concealed) {
    if (!crusher || !victim || victim.scriptHidden || victim.inside) return;
    const profile = footfallProfile(crusher, this.world.time) || { depth: 0.32, halfLength: 3, halfWidth: 2, seed: 1 };
    return this.stamp(victim, profile, { x: victim.x, y: victim.y, yaw: crusher.heading || 0 }, true, concealed);
  }
  step(units, dt) {
    if (!(dt > 0) || !units.length) return;
    this.credit = Math.min(6, this.credit + dt * 36);
    const start = this.start % units.length;
    for (let i = 0; i < units.length; i++) {
      const u = units[(start + i) % units.length];
      let st = this.states.get(u);
      if (!st) {
        st = { x: u.x, y: u.y, ready: false, dist: 0, side: 1, seq: 0 };
        this.states.set(u, st);
        continue;
      }
      if (st.x === u.x && st.y === u.y) continue;
      const kind = footfallKind(u, this.world.time);
      if (!kind) {
        st.x = u.x;
        st.y = u.y;
        st.ready = false;
        continue;
      }
      const profile = st.profile || (st.profile = footfallProfile(u, this.world.time));
      const pads = planFootfall(st, u.x, u.y, u.heading, profile, { jump: Math.min(22, Math.max(3, dt * (u.speed || 35) * 2.5)) });
      for (const p of pads) {
        if (this.credit < 1) break;
        const hidden = u.cloaked || this.world.viewFogged?.(p.x, p.y);
        if (this.stamp(u, profile, p, false, !!hidden)) this.credit--;
      }
    }
    this.start = (start + 1) % units.length;
  }
}
