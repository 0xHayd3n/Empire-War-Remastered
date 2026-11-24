// One original charter, not an import of a Workshop freight economy. The carrier is
// a loaned stock civilian ship. Its token moves with the fleet record, never a slot.
import { db } from '../gamedata.js';
import { placeStartingForce } from './galaxy.js';
import { adjustCredits } from './galacticeconomy.js';
import { conflictAt } from './galacticrelation.js';
import { equalFooting } from './universaleligibility.js';
const origin = 'Hoth',
  destination = 'Bespin',
  ship = 'Merchant_Freighter',
  fee = 1500;
const token = s => typeof s === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const pilot = g => g.universalPath === 1 && !g.humans && g.campaign?.name === equalFooting && g.active === 'Rebel';
const port = (g, n) => g.planets.find(p => p.name === n);
const known = (g, p) =>
  p?.selectable &&
  !p.destroyed &&
  !p.background &&
  !p.restricted &&
  g.visibility?.viewer === g.active &&
  g.visibility.planets[p.index]?.discovered;
const dock = (g, p) => known(g, p) && p.owner === g.active && !conflictAt(g, p.index, g.active);
export function enableConvoy(g) {
  if (
    pilot(g) &&
    !g.convoy &&
    db.type(ship)?.bool('Hyperspace') &&
    g.links[port(g, origin)?.index]?.some(e => e.to === port(g, destination)?.index)
  )
    g.convoy = { state: 'offer' };
}
export const chartered = (g, u) => !!g.convoy?.id && g.convoy.id === u.charter && u.type?.name === ship && !u.dead;
export function restoreConvoy(g, s) {
  delete g.convoy;
  if (!pilot(g) || !s) return;
  if (['offer', 'paid', 'lost', 'closed'].includes(s.state)) g.convoy = { state: s.state };
  if (['sailing', 'return'].includes(s.state) && token(s.id) && (!s.open || token(s.open)))
    g.convoy = { state: s.state, id: s.id, ...(s.open ? { open: s.open } : {}) };
}
function route(g) {
  const from = port(g, origin),
    to = port(g, destination);
  return dock(g, from) && dock(g, to) && g.links[from.index]?.some(e => e.to === to.index);
}
export function acceptConvoy(g) {
  if (!pilot(g) || g.convoy?.state !== 'offer' || !route(g) || !db.type(ship)) return false;
  const id = crypto.randomUUID(),
    f = g.fleets.length,
    p = port(g, origin);
  const u = placeStartingForce(p, g.active, db.type(ship), g.fleets);
  if (!u) return false;
  u.charter = id;
  const berth = [1, 2, 0].find(
    i => !g.fleets.slice(0, f).some(x => !x.leg && x.planet === p.index && x.owner === g.active && (x.slot ?? 0) === i)
  );
  g.fleets[f].slot = berth ?? 0;
  g.convoy = { state: 'sailing', id };
  return true;
}
// Called on campaign time, after arrivals. Don't unload ahead of a contested
// space battle or from an identically typed replacement. No payment on retreat en route.
export function settleConvoy(g) {
  const m = g.convoy;
  if (!m?.id || m.open || !pilot(g)) return false;
  const ships = [];
  for (const f of g.fleets) for (const u of f.units) if (chartered(g, u)) ships.push([f, u]);
  if (ships.length !== 1 || ships[0][0].owner !== g.active) {
    g.convoy = { state: 'lost' };
    return true;
  }
  const [f, u] = ships[0],
    to = port(g, destination),
    here = g.planets[f.planet];
  if (m.state === 'sailing' && (!known(g, to) || to.owner !== g.active)) m.state = 'return';
  if (f.leg || !dock(g, here) || (m.state !== 'return' && here !== to)) return false;
  const paid = m.state === 'sailing';
  g.convoy = { state: paid ? 'paid' : 'closed' };
  f.units.splice(f.units.indexOf(u), 1);
  if (paid) adjustCredits(g, g.active, fee);
  return true;
}
export function convoyRows(g, accept, locate) {
  const m = g.convoy;
  if (!m || !pilot(g)) return [];
  const line = text => ({ text, color: '#f2d791', wrap: true });
  const action = (text, activate) => ({ text, color: '#9fd8ff', wrap: true, activate });
  if (m.state === 'offer')
    return route(g)
      ? [
          line(
            'Convoy charter: Hoth → Bespin · 1,500 credits on delivery (treasury cap applies). A merchant loans the freighter; you choose its escort. No charge to accept.'
          ),
          action('Accept freight charter', accept)
        ]
      : [line('Convoy charter: two secure friendly ports are required.')];
  if (['paid', 'closed', 'lost'].includes(m.state))
    return [
      line(
        {
          paid: 'Convoy delivered. Charter settled; the merchant reclaimed the freighter.',
          closed: 'Charter closed without payment. The freighter returned to port.',
          lost: 'Convoy lost. No payment or replacement.'
        }[m.state]
      )
    ];
  const f = g.fleets.find(f => f.owner === g.active && f.units.some(u => chartered(g, u)));
  const here = g.planets[f?.planet],
    to = port(g, destination);
  const link = (p, title) =>
    known(g, p)
      ? [
          action(title + ': ' + (db.t(p.type.str('Text_ID')) || p.name), () => {
            if (known(g, p)) locate(p);
          })
        ]
      : [];
  return [
    line(
      m.state === 'return'
        ? 'Delivery cancelled. Return the chartered freighter to any secure friendly port.'
        : 'Freight in transit · 1,500 credits on delivery. Move the Merchant Freighter to the receiving port.'
    ),
    ...(!f?.leg && here ? link(here, 'Locate freighter') : []),
    ...(m.state === 'sailing' ? link(to, 'Receiving port') : [])
  ];
}
