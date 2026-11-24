// Battle book only. The wreck is scenery, not a player, a victory unit, a reserve
// or an enemy target. Its position is derived from this particular map's anchors.
const boarder = 'Corellian_Corvette';
export const wreckType = 'Nebulon_B_Frigate',
  holdTicks = 150,
  distance = 190;
export function createBoarding(cb, book) {
  const r = cb.recovery;
  if (!cb.vesselBattle || cb.linked || !r || !cb.attacker.units.some(u => u.gid === r.gid && (u.type?.name || u.type) === boarder)) return;
  const a = book.anchors[cb.attacker.team],
    b = book.anchors[cb.defender.team];
  if (!a || !b) return;
  book.boarding = { x: a.x + (b.x - a.x) * 0.35, y: a.y + (b.y - a.y) * 0.35, ticks: 0, void: false };
}
export const boardingCraft = (cb, book) => {
  const e = book.entity.get(cb.recovery?.gid);
  return e &&
    !e.dead &&
    !e.retreated &&
    !e.hyper &&
    e.health > 0 &&
    e.type.name === boarder &&
    e.player?.human &&
    e.player.team.id === cb.attacker.team
    ? e
    : null;
};
export function stepBoarding(cb, book, frozen = false) {
  const m = book.boarding;
  if (!m || m.void || m.ticks === holdTicks || frozen) return;
  const e = boardingCraft(cb, book);
  m.ticks = e && Math.hypot(e.x - m.x, e.y - m.y) <= distance ? m.ticks + 1 : 0;
}
export function recoveredPrize(cb, book, winner, alive) {
  const m = book.boarding;
  return m && !m.void && m.ticks === holdTicks && winner === cb.attacker.team && boardingCraft(cb, book) && alive.includes(cb.recovery.gid)
    ? { recovered: cb.recovery.id }
    : {};
}
export function restoreBoarding(cb, book, s) {
  const m = book.boarding;
  if (!m) return;
  if (
    s?.id !== cb.recovery.id ||
    s.gid !== cb.recovery.gid ||
    !Number.isInteger(s.ticks) ||
    s.ticks < 0 ||
    s.ticks > holdTicks ||
    typeof s.void !== 'boolean'
  ) {
    m.ticks = 0;
    m.void = true;
    return;
  }
  m.ticks = s.ticks;
  m.void = s.void;
}
