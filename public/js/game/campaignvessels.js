// Opt-in engine seam. IDs are allocated on actual
// records, never reconstructed by matching an owner/type or a previous fleet slot.
import { adjustCredits, creditCap } from './galacticeconomy.js';
import { equalFooting } from './universaleligibility.js';
const pilot = g => g?.universalPath === 1 && !g.humans && g.campaign?.name === equalFooting && g.active === 'Rebel';
const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const integer = n => Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER;
const hull = (g, f, u) => pilot(g) && f.owner === g.active && !u.carries && u.type.name === 'Calamari_Cruiser';
const fraction = x => Number.isFinite(x) && x >= 0 && x <= 1;
function validCondition(c) {
  return (
    !!c &&
    fraction(c.hull) &&
    c.hull > 0 &&
    Array.isArray(c.parts) &&
    c.parts.length <= 256 &&
    c.parts.every(p => Array.isArray(p) && typeof p[0] === 'string' && fraction(p[1]))
  );
}
export function enrollVessels(g) {
  if (!pilot(g) || g.vessels) return false;
  g.vessels = { open: null };
  return true;
}
// The player-facing rule never bulk-enrolls like the adversarial engine fixture.
export function enableFlagship(g) {
  if (!enrollVessels(g)) return false;
  g.vessels.flagship = null;
  return true;
}
export const flagshipMode = g => pilot(g) && !!g.vessels && Object.hasOwn(g.vessels, 'flagship');
export const eligibleCruiser = (g, f, u) => hull(g, f, u) && !u.dead && !f.leg && f.planet >= 0;
export function designateFlagship(g, f, u) {
  if (
    !flagshipMode(g) ||
    g.vessels.open ||
    g.vessels.flagship !== null ||
    !g.fleets.includes(f) ||
    !f.units.includes(u) ||
    !eligibleCruiser(g, f, u)
  )
    return false;
  const id = crypto.randomUUID();
  u.vessel = { id, rev: 0 };
  g.vessels.flagship = id;
  return true;
}
export function restoreVessels(g, registry) {
  delete g.vessels;
  const seen = new Set();
  let ok = pilot(g) && registry && (registry.open === null || uuid(registry.open));
  for (const f of g.fleets)
    for (const u of f.units)
      if (u.vessel !== undefined) {
        const v = u.vessel;
        if (
          !hull(g, f, u) ||
          !v ||
          !uuid(v.id) ||
          seen.has(v.id) ||
          !integer(v.rev) ||
          (v.condition !== undefined && !validCondition(v.condition))
        )
          ok = false;
        // The incoming snapshot may be reused for a retry. Fleet flags are
        // shallow-copied by applyGalaxy; never update a saved receipt in place.
        if (ok) u.vessel = structuredClone(v);
        seen.add(v?.id);
      }
  const single = registry && Object.hasOwn(registry, 'flagship');
  if (single && ((registry.flagship !== null && !uuid(registry.flagship)) || [...seen].some(id => id !== registry.flagship))) ok = false;
  if (ok) g.vessels = { open: registry.open, ...(single ? { flagship: registry.flagship } : {}) };
  else
    for (const f of g.fleets)
      for (const u of f.units) {
        delete u.vessel;
        delete u.battleSlot;
      }
}
export function openVesselBattle(g, planet, sides) {
  const cargoHere = g.convoy?.id && g.fleets.some(f => f.owner === g.active && !f.leg && f.planet === planet && f.units.some(u => !u.dead && u.charter === g.convoy.id));
  const s = g.vessels || (cargoHere && g.convoy);
  if (!s || !pilot(g) || !sides.includes(g.active)) return null;
  let any = !!cargoHere;
  for (const f of g.fleets)
    if (f.planet === planet && !f.leg)
      for (const u of f.units)
        if (g.vessels && hull(g, f, u) && (!Object.hasOwn(s, 'flagship') || (s.flagship && u.vessel?.id === s.flagship))) {
          u.vessel ||= { id: crypto.randomUUID(), rev: 0 };
          any = true;
        }
  if (!any) return null;
  // applyGalaxy legitimately drops empty fleets. Give *every* participating
  // record its original per-battle address before snapshot, including the enemy.
  // These tickets expire on return; they are not persistent ship IDs.
  g.fleets.forEach((f, fi) => {
    if (f.planet === planet && !f.leg && sides.includes(f.owner))
      f.units.forEach((u, ui) => {
        u.battleSlot = fi + ':' + ui;
      });
  });
  return (s.open = crypto.randomUUID());
}
export function conditionOf(e) {
  if (e?.retreated && e.savedCondition) return e.savedCondition;
  if (!e?.type || !(e.health > 0) || !e.maxHealth) return null;
  const condition = {
    hull: Math.min(1, e.health / e.maxHealth),
    parts: e.hardpoints.filter(h => h.destroyable).map(h => [h.def.name, h.alive ? Math.min(1, h.health / h.maxHealth) : 0])
  };
  return validCondition(condition) ? condition : null;
}
export function placeVessel(e, r) {
  const v = r?.vessel;
  if (!v || !e || e.type.name !== 'Calamari_Cruiser') return;
  const c = v.condition;
  const hp = e.hardpoints.filter(h => h.destroyable);
  // An unknown hardpoint layout is not a full-health repair. Never overwrite
  // its previous condition with a snapshot of an incompatible template.
  if (c && (!validCondition(c) || hp.length !== c.parts.length || hp.some((h, i) => h.def.name !== c.parts[i][0]))) return;
  e.vesselId = v.id;
  if (!c) return;
  e.health = e.maxHealth * c.hull;
  hp.forEach((h, i) => {
    h.health = h.maxHealth * c.parts[i][1];
    if (h.health === 0) {
      h.alive = false;
      h.smoke = true;
      if (h.part) h.part.visible = false;
      if (h.decal) h.decal.visible = true;
    }
  });
}
export function vesselResult(cb, book, alive) {
  if (!cb.vesselBattle) return {};
  const kept = new Set(alive);
  return {
    vesselBattle: cb.vesselBattle,
    battleSlots: [...cb.attacker.units, ...cb.defender.units].map(r => r.gid),
    vesselOutcomes: [...cb.attacker.units, ...cb.defender.units]
      .filter(r => r.vessel)
      .map(r => {
        const e = book.entity.get(r.gid),
          survived = kept.has(r.gid);
        return { id: r.vessel.id, gid: r.gid, survived, ...(survived && e?.vesselId === r.vessel.id ? { condition: conditionOf(e) } : {}) };
      })
  };
}
// Translate the entire survivor list to current roster slots
// before the native casualty/victory code runs. A repeated result has no effects.
export function acceptVesselResult(g, r) {
  const s = g.vessels || g.convoy;
  if (!r.vesselBattle) return !s?.open;
  if (!s?.open || s.open !== r.vesselBattle || !Array.isArray(r.vesselOutcomes)) return false;
  if (!Array.isArray(r.battleSlots) || !Array.isArray(r.alive) || !Array.isArray(r.sides) || r.vesselOutcomes.some(o => !o || !uuid(o.id)))
    return false;
  const out = new Map(r.vesselOutcomes.map(o => [o.id, o])),
    alive = new Set(r.alive),
    entries = new Map(),
    here = [];
  const slots = new Set(r.vesselOutcomes.map(o => o.gid));
  if (
    out.size !== r.vesselOutcomes.length ||
    slots.size !== out.size ||
    r.vesselOutcomes.some(
      o => typeof o.survived !== 'boolean' || o.survived !== alive.has(o.gid) || (o.condition != null && !validCondition(o.condition))
    )
  )
    return false;
  let unique = true;
  g.fleets.forEach((f, fi) => {
    if (f.planet === r.planet && !f.leg && r.sides.includes(f.owner))
      f.units.forEach((u, ui) => {
        if (entries.has(u.battleSlot)) unique = false;
        entries.set(u.battleSlot, [fi + ':' + ui, u]);
        if (u.vessel && hull(g, f, u)) here.push([u.vessel, u.battleSlot]);
      });
  });
  if (
    !unique ||
    entries.size !== r.battleSlots.length ||
    new Set(r.battleSlots).size !== entries.size ||
    !r.battleSlots.every(gid => entries.has(gid)) ||
    !r.alive.every(gid => entries.has(gid)) ||
    here.length !== out.size ||
    here.some(([v, gid]) => out.get(v.id)?.gid !== gid)
  )
    return false;
  for (const [v] of here) {
    const o = out.get(v.id);
    if (!o.survived) continue;
    if (validCondition(o.condition)) {
      const c = o.condition;
      if (c.hull === 1 && c.parts.every(p => p[1] === 1)) delete v.condition;
      else v.condition = structuredClone(c);
      v.rev++;
    }
  }
  r.alive = r.alive.map(gid => entries.get(gid)[0]);
  if (r.superweapons) r.superweapons = r.superweapons.map(w => ({ ...w, gid: entries.get(w.gid)?.[0] ?? w.gid }));
  for (const [, u] of entries.values()) delete u.battleSlot;
  s.open = null;
  return true;
}
// Lower-level test and yard transaction. The player-facing order recomputes the
// tariff and checks the quoted yard and revision before passing it here.
export function repairVessel(g, { id, rev }, tariff) {
  if (!g.vessels || g.vessels.open || !pilot(g) || !integer(tariff) || !tariff) return false;
  for (const f of g.fleets) {
    const p = g.planets[f.planet];
    if (f.leg || !p?.station || p.destroyed || p.owner !== g.active || (p.stationOwner || p.owner) !== g.active) continue;
    const v = f.units.find(u => hull(g, f, u) && u.vessel?.id === id)?.vessel;
    if (!v?.condition || v.rev !== rev) continue;
    const credits = g.players.find(p => p.faction === g.active)?.credits,
      left = credits - tariff;
    if (!(left >= 0) || left > creditCap(g, g.active) || Math.fround(left) !== left) return false;
    delete v.condition;
    v.rev++;
    adjustCredits(g, g.active, -tariff);
    return true;
  }
  return false;
}
