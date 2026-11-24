// The HUD may still order the first available ship of a type. Bind the *actual
// removed slot* before spawning, not a type match inferred at battle end. New
// tactical builds append to the pool and have no campaign ticket.
// An explicitly selected flagship never falls back to its class (and ordinary
// cards cannot consume it). Queue offsets can change while a ghost is on screen.
export function reserveSlot(p, type, id) {
  const book = p.reserveBook;
  if (!book?.flagship && !book?.boarder) return id == null ? p.reinforcements.indexOf(type) : -1;
  const flag = book.flagship,
    crew = book.boarder;
  if (id != null) {
    const named = id === flag?.vessel.id ? flag : id === crew?.salvageId ? crew : null;
    const i = named ? p.reserveTickets.indexOf(named.gid) : -1;
    return i >= 0 && p.reinforcements[i] === type ? i : -1;
  }
  const protectedSlots = [flag, crew].filter(Boolean).map(r => p.reserveTickets.indexOf(r.gid));
  return p.reinforcements.findIndex((t, i) => t === type && !protectedSlots.includes(i));
}
export function reserveCounts(p) {
  const counts = new Map(),
    flag = p.reserveBook?.flagship,
    crew = p.reserveBook?.boarder;
  const fi = flag ? p.reserveTickets.indexOf(flag.gid) : -1,
    ci = crew ? p.reserveTickets.indexOf(crew.gid) : -1;
  if (fi >= 0) counts.set(flag, 1);
  if (ci >= 0) counts.set(crew, 1);
  for (const [i, t] of p.reinforcements.entries()) if (i !== fi && i !== ci) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}
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
