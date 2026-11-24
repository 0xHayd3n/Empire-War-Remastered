// The HUD may still order the first available ship of a type. Bind the *actual
// removed slot* before spawning, not a type match inferred at battle end. New
// tactical builds append to the pool and have no campaign ticket.
export function takeReserve(p, i) {
  const book = p.reserveBook,
    gid = p.reserveTickets?.splice(i, 1)[0];
  p.reinforcements.splice(i, 1);
  if (!gid || !book) return null;
  const j = book.waiting.findIndex(r => r.gid === gid);
  if (j < 0) throw new Error('Missing campaign reserve ticket');
  const [record] = book.waiting.splice(j, 1);
  // Scripted calls can wait for art; a save before spawn returns the unplaced record.
  book.absent.push(gid);
  return e => {
    if (!e) return;
    const at = book.absent.indexOf(gid);
    if (at < 0) return;
    book.absent.splice(at, 1);
    book.entity.set(gid, e);
    book.placeVessel(e, record);
  };
}
export function loseReserve(e, book) {
  if (e.dead) return;
  const p = e.reserve;
  const i = p.reserveTickets
    ? e.reserveGid
      ? p.reserveTickets.indexOf(e.reserveGid)
      : p.reinforcements.findIndex((t, i) => t === e.type && !p.reserveTickets[i])
    : p.reinforcements.indexOf(e.type);
  if (i < 0 || p.reinforcements[i] !== e.type) return;
  e.dead = true;
  takeReserve(p, i);
  if (e.reserveGid) {
    (book.lostReserve ||= []).push(e.reserveGid);
    if (p.reserveTickets) book.absent.splice(book.absent.indexOf(e.reserveGid), 1);
  }
}
