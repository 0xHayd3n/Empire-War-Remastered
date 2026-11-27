// Art direction in TED world units. The XML damage radius is a gameplay area,
// not the radius of excavated soil. No changes to weapon range, damage or FX.
const bound = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const positive = n => Number.isFinite(n) && n > 0 ? n : 0;

export function groundImpact(s, surfaceZ) {
  if (s.dud || s.expired || !s.w?.proj || !Number.isFinite(surfaceZ)) return null;
  const w = s.w, p = w.proj;
  const area = positive(w.blastR ?? p.num('Projectile_Blast_Area_Range', 0));
  const blast = positive(w.blastD ?? p.num('Projectile_Blast_Area_Damage', 0));
  const direct = positive(s.damage ?? w.damage ?? p.num('Projectile_Damage', 0));
  if (area && blast) {
    const r = bound(1.9 + 0.44 * Math.sqrt(area) + 0.77 * Math.sqrt(blast), 4, 26);
    const gap = Math.abs(s.z - surfaceZ);
    if (!s.ground && !(gap < r * 0.55)) return null;
    const contact = s.ground ? 1 : 1 - 0.65 * gap / (r * 0.55);
    const radius = r * contact, depth = Math.min(5.5, radius * (0.14 + 0.13 * Math.min(1, blast / 80)));
    return { radius, depth };
  }
  if (!s.ground || !direct) return null; // a bolt on armour is not a hole below the tank
  // Where the model supplies a bolt width, use it: a narrow, high-damage
  // rifle shouldn't excavate the same bowl as a wide tank bolt. Missing width
  // is common on Workshop models; fall back to the weapon's own damage tier.
  const width = positive(p.num('Projectile_Width',0));
  if (direct < 15 || (width && width < 0.55)) return { radius: bound(0.75 + Math.sqrt(direct)*0.27 + 0.8*Math.min(width,1), 1, 2.6), depth: 0 };
  const radius = bound(1.7 + Math.sqrt(direct)*0.57 + 0.9*Math.min(width||0.7,3), 4.5, 13);
  return { radius, depth: radius * 0.12 };
}

export function wreckImpact(unit) {
  if (unit.kind !== 'VEHICLE' || unit.foot || unit.flies || unit.structure || unit.inside || !unit.type.list('Death_Explosions').length) return null;
  const radius = bound(positive(unit.hitRadius) * 0.78, 5, 24);
  return { radius, depth: radius * 0.22 };
}

export function walkableCraters(setup) {
  return !!setup && !setup.net && !setup.shooterNet && !setup.replay && !setup.headless && !setup.attract &&
    (!setup.restore || setup.restore.battle?.craterRule === 1);
}
