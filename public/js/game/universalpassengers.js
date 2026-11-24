import { db } from '../gamedata.js';
import { namedHero } from './galacticautoresolve.js';
// Use the same initial, reserved, and called records as battleResult. A hull's
// name alone is not proof it carried a company (heroes may also ride flagships).
export function markPassengers(rosters, book, campaign) {
  if (!book || campaign.autoResolve?.transportLosses === undefined) return;
  for (const [i, side] of [campaign.attacker, campaign.defender].entries()) {
    const rows = rosters[i];
    if (!rows.some(r => r.owner === campaign.autoResolve.transportOwner)) continue;
    const byEntity = new Map(rows.map(r => [r.entity, r])),
      records = new Map(side.units.map(u => [u.gid, u]));
    const mark = (r, gid) => {
      const t = db.type(records.get(gid)?.passenger);
      if (r && t && r.owner === campaign.autoResolve.transportOwner) r.passenger = { hero: namedHero(t) };
    };
    for (const [gid, e] of book.entity) if (records.has(gid)) mark(byEntity.get(e), gid);
    if (rows.some(r => r.entity.reserve?.reserveBook === book)) {
      for (const r of rows) if (r.entity.reserveGid) mark(r, r.entity.reserveGid);
      continue;
    }
    const available = rows.filter(r => r.entity.reserve),
      called = [...(book.called?.get(side.team) || [])];
    for (const u of book.waiting.filter(u => u.team === side.team && !book.lostReserve?.includes(u.gid))) {
      const waiting = available.findIndex(r => r.entity.type === u.type);
      if (waiting >= 0) {
        const [r] = available.splice(waiting, 1);
        r.entity.reserveGid = u.gid;
        mark(r, u.gid);
      } else {
        const index = called.findIndex(e => e.type === u.type);
        if (index >= 0) mark(byEntity.get(called.splice(index, 1)[0]), u.gid);
      }
    }
  }
}
