// Original, renewable local hire. Only the contracted fleet record leaves at term.
import { db } from '../gamedata.js';
import { placeStartingForce } from './galaxy.js';
import { adjustCredits } from './galacticeconomy.js';
import { availableUnits, populationCap, populationUsed } from './galacticproduction.js';
import { conflictAt } from './galacticrelation.js';
import { equalFooting } from './universaleligibility.js';
export const hireTerms = Object.freeze({ planet: 'Bespin', type: 'Corellian_Corvette', fee: 750, term: 120, cooldown: 60 });
export const localRebels = g => g?.universalPath === 1 && !g.humans && g.campaign?.name === equalFooting && g.active === 'Rebel';
const validTime = t => Number.isFinite(t) && t >= 0;
const validID = s => typeof s === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s);
export function restoreHire(g, s) {
  delete g.hire;
  if (!localRebels(g) || !validTime(s?.next)) return;
  if (s.state === 'ready' || s.state === 'expired' || s.state === 'lost') g.hire = { state: s.state, next: s.next };
  else if (
    s.state === 'serving' &&
    validID(s.id) &&
    validTime(s.end) &&
    s.next === s.end + hireTerms.cooldown &&
    (!s.open || validID(s.open))
  )
    g.hire = { state: s.state, next: s.next, end: s.end, id: s.id, ...(s.open ? { open: s.open } : {}) };
}
function quote(g) {
  const m = g.hire,
    p = g.planets.find(p => p.name === hireTerms.planet),
    t = db.type(hireTerms.type),
    player = g.players.find(p => p.faction === g.active);
  if (
    !localRebels(g) ||
    !m ||
    m.id ||
    g.time < m.next ||
    !t ||
    !player ||
    !p?.selectable ||
    p.background ||
    p.destroyed ||
    p.restricted ||
    p.owner !== g.active ||
    !p.station ||
    p.spaceLevel <= 0 ||
    (p.stationOwner || p.owner) !== g.active ||
    g.visibility?.viewer !== g.active ||
    !g.visibility.planets[p.index]?.discovered ||
    conflictAt(g, p.index, g.active)
  )
    return null;
  if (
    !availableUnits(g, p.index, g.active, 'space').includes(t) ||
    player.disabledTypes?.some(n => n.toUpperCase() === t.name.toUpperCase()) ||
    t.num('Population_Value', 0) > Math.max(0, populationCap(g, g.active) - populationUsed(g, g.active))
  )
    return null;
  return { p, t, player };
}
export function hireEscort(g, offer) {
  const q = quote(g);
  if (!q || offer !== g.hire.next || q.player.credits < hireTerms.fee) return false;
  const id = crypto.randomUUID(),
    u = placeStartingForce(q.p, g.active, q.t, g.fleets);
  if (!u) return false;
  u.hireId = id;
  adjustCredits(g, g.active, -hireTerms.fee);
  const end = g.time + hireTerms.term;
  g.hire = { state: 'serving', id, end, next: end + hireTerms.cooldown };
  return true;
}
export function updateHire(g, onEmpty) {
  const m = g.hire;
  if (!m?.id || m.open || g.vessels?.open || g.convoy?.open || g.recovery?.open) return false;
  const found = [];
  for (const f of g.fleets) for (const u of f.units) if (u.hireId === m.id) found.push([f, u]);
  const valid = found.length === 1 && found[0][0].owner === g.active && !found[0][1].dead && found[0][1].type.name === hireTerms.type;
  if (valid && g.time < m.end) return false;
  for (const [f, u] of found) {
    f.units.splice(f.units.indexOf(u), 1);
    if (!f.units.length) {
      g.fleets.splice(g.fleets.indexOf(f), 1);
      onEmpty?.(f);
    }
  }
  g.hire = { state: valid ? 'expired' : 'lost', next: m.next };
  return true;
}
export function hireRows(g, accept) {
  const m = g.hire;
  if (!m || !localRebels(g)) return [];
  const line = text => ({ text, color: '#f2d791', wrap: true });
  if (m.id)
    return [
      line(
        `Mercenary corvette on contract · ${Math.max(0, Math.ceil(m.end - g.time))} campaign seconds left. No refund or replacement if lost.`
      )
    ];
  if (g.time < m.next) return [line(`Mercenary contract ${m.state} · next hire in ${Math.ceil(m.next - g.time)} campaign seconds.`)];
  const q = quote(g);
  if (!q) return [line('Mercenary office: no eligible local berth or population room.')];
  const rows = [
    line('Bespin mercenary office · one Corellian corvette for 120 campaign seconds, then a 60-second hiring cooldown. No refund on loss.')
  ];
  if (q.player.credits >= hireTerms.fee)
    rows.push({ text: 'Hire corvette · 750 credits', color: '#9fd8ff', wrap: true, activate: () => accept(m.next) });
  else rows.push(line('Hiring fee: 750 credits (insufficient funds).'));
  return rows;
}
