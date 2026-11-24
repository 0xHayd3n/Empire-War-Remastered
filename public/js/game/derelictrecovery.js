// Original, one-shot stock expedition. A salvage team rides a particular owned
// corvette. The powerless prize is cargo until the player pays for commissioning.
import { db } from '../gamedata.js';
import { placeStartingForce } from './galaxy.js';
import { adjustCredits, creditCap } from './galacticeconomy.js';
import { conflictAt } from './galacticrelation.js';
import { equalFooting } from './universaleligibility.js';
export const boardingShip = 'Corellian_Corvette',
  prizeShip = 'Nebulon_B_Frigate';
const site = 'Sullust',
  home = 'Hoth';
const guid = x => typeof x === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(x);
const pilot = g => g.universalPath === 1 && !g.humans && g.campaign?.name === equalFooting && g.active === 'Rebel';
const world = (g, n) => g.planets.find(p => p.name === n);
const known = (g, p) =>
  p?.selectable &&
  !p.restricted &&
  !p.background &&
  !p.destroyed &&
  g.visibility?.viewer === g.active &&
  g.visibility.planets[p.index]?.discovered;
const friendly = (g, p) => known(g, p) && p.owner === g.active && !conflictAt(g, p.index, g.active);
const fees = () => Math.ceil((db.type(prizeShip)?.num('Build_Cost_Credits', 0) || 0) / 2);
export function enableRecovery(g) {
  if (pilot(g) && !g.recovery && world(g, site) && world(g, home) && fees() > 0) g.recovery = { state: 'offer' };
}
export function restoreRecovery(g, s) {
  delete g.recovery;
  if (!pilot(g) || !s) return;
  if (['offer', 'lost', 'missed', 'released', 'commissioned'].includes(s.state)) g.recovery = { state: s.state };
  if (
    ['search', 'tow'].includes(s.state) &&
    guid(s.id) &&
    (!s.open || guid(s.open)) &&
    (!s.attempt || (s.state === 'search' && guid(s.attempt)))
  )
    g.recovery = { state: s.state, id: s.id, ...(s.open ? { open: s.open } : {}), ...(s.attempt ? { attempt: s.attempt } : {}) };
}
function carriers(g) {
  const id = g.recovery?.id;
  if (!id) return [];
  return g.fleets.flatMap(f => f.units.filter(u => !u.dead && u.salvageId === id).map(u => ({ f, u })));
}
const eligible = (g, f, u) => f.owner === g.active && u.type?.name === boardingShip && !u.carries && !u.dead;
export function assignCrew(g, f, u) {
  const p = g.planets[f.planet],
    s = world(g, site);
  if (
    !pilot(g) ||
    g.recovery?.state !== 'offer' ||
    !g.fleets.includes(f) ||
    !f.units.includes(u) ||
    !eligible(g, f, u) ||
    f.leg ||
    p?.name !== home ||
    !friendly(g, p) ||
    !known(g, s) ||
    s.owner !== 'Empire'
  )
    return false;
  const id = crypto.randomUUID();
  u.salvageId = id;
  g.recovery = { state: 'search', id };
  return true;
}
export function recoveryBattle(g, b, receipt) {
  const m = g.recovery;
  if (
    !pilot(g) ||
    !receipt ||
    !(g.vessels?.open === receipt || m?.open === receipt) ||
    m?.state !== 'search' ||
    b.mode !== 'space' ||
    b.linked ||
    b.attacker !== g.active ||
    b.defender !== 'Empire' ||
    g.planets[b.p]?.name !== site ||
    !known(g, g.planets[b.p]) ||
    g.planets[b.p].owner !== 'Empire'
  )
    return null;
  const c = carriers(g);
  if (c.length !== 1) return null;
  const { f, u } = c[0];
  if (!eligible(g, f, u) || f.leg || f.planet !== b.p || !u.battleSlot) return null;
  m.attempt = receipt;
  return { id: m.id, gid: u.battleSlot };
}
export function missRecovery(g) {
  for (const { u } of carriers(g)) delete u.salvageId;
  g.recovery = { state: 'missed' };
}
export function recoveryAuto(g, b) {
  if (
    g.recovery?.state === 'search' &&
    b.mode === 'space' &&
    g.planets[b.p]?.name === site &&
    b.attacker === g.active &&
    b.defender === 'Empire' &&
    carriers(g).some(({ f }) => f.planet === b.p && !f.leg)
  )
    return true;
  return false;
}
// Called only after the roster receipt is consumed and survivor gids translated.
export function finishRecoveryBattle(g, r) {
  const m = g.recovery;
  if (!m?.attempt || m.attempt !== r.vesselBattle) return;
  const c = carriers(g),
    pair = c.length === 1 && c[0],
    f = pair?.f,
    u = pair?.u;
  const survived =
    f && eligible(g, f, u) && !f.leg && f.planet === r.planet && r.alive.includes(`${g.fleets.indexOf(f)}:${f.units.indexOf(u)}`);
  const won =
    survived &&
    r.recovered === m.id &&
    r.winner === 'attacker' &&
    r.sides?.[0] === g.active &&
    r.sides[1] === 'Empire' &&
    g.planets[r.planet]?.name === site;
  if (!won && u) delete u.salvageId;
  g.recovery = won ? { state: 'tow', id: m.id } : { state: survived ? 'missed' : 'lost' };
}
export function checkRecovery(g) {
  const m = g.recovery;
  if (!m?.id || m.open || g.vessels?.open || m.attempt) return false;
  const c = carriers(g);
  if (c.length !== 1 || !eligible(g, c[0].f, c[0].u)) {
    g.recovery = { state: 'lost' };
    return true;
  }
  if (m.state === 'search' && (!known(g, world(g, site)) || world(g, site)?.owner !== 'Empire')) {
    delete c[0].u.salvageId;
    g.recovery = { state: 'missed' };
    return true;
  }
  return false;
}
export function refitQuote(g) {
  if (!pilot(g) || g.recovery?.state !== 'tow' || g.recovery.open || g.vessels?.open) return null;
  const c = carriers(g);
  if (c.length !== 1) return null;
  const { f, u } = c[0],
    p = g.planets[f.planet],
    price = fees();
  if (
    !eligible(g, f, u) ||
    f.leg ||
    !friendly(g, p) ||
    p.name === site ||
    !p.station ||
    !(p.spaceLevel > 0) ||
    (p.stationOwner || p.owner) !== g.active ||
    !Number.isSafeInteger(price) ||
    price < 1
  )
    return null;
  return { id: g.recovery.id, planet: p.name, price };
}
export function settlePrize(g, quote, release = false) {
  const q = refitQuote(g);
  if (!q || !quote || q.id !== quote.id || q.planet !== quote.planet || q.price !== quote.price) return false;
  const player = g.players.find(p => p.faction === g.active),
    p = world(g, q.planet),
    ship = db.type(prizeShip),
    left = player?.credits - q.price;
  if (!release && (!(left >= 0) || left > creditCap(g, g.active) || Math.fround(left) !== left || !ship)) return false;
  const { u } = carriers(g)[0];
  delete u.salvageId;
  g.recovery = { state: release ? 'released' : 'commissioned' };
  if (!release) {
    adjustCredits(g, g.active, -q.price);
    placeStartingForce(p, g.active, ship, g.fleets);
  }
  return true;
}
export function recoveryRows(g, prompt, run, locate) {
  const m = g.recovery;
  if (!m || !pilot(g)) return [];
  const text = text => ({ text, color: '#f2d791', wrap: true }),
    act = (text, fn) => ({ text, color: '#9fd8ff', wrap: true, activate: fn });
  const link = (p, prefix) =>
    known(g, p)
      ? [
          act(`${prefix}: ${db.t(p.type.str('Text_ID')) || p.name}`, () => {
            if (known(g, p)) locate(p);
          })
        ]
      : [];
  if (m.state === 'offer') {
    const p = world(g, home),
      s = world(g, site);
    if (!friendly(g, p) || !known(g, s) || s.owner !== 'Empire') return [text('Derelict recovery: departure or survey site unavailable.')];
    const rows = [
      text(
        'Derelict recovery · Sullust. Assign one of your Corellian corvettes at Hoth. Escort it into a manually fought attack. Only that ship can board the wreck.'
      )
    ];
    for (const f of g.fleets)
      if (!f.leg && f.planet === p.index)
        for (const [i, u] of f.units.entries())
          if (eligible(g, f, u))
            rows.push(act(`Embark crew: Hoth · Fleet ${(f.slot ?? 0) + 1} · Ship ${i + 1}`, () => run({ kind: 'assign', f, u })));
    if (rows.length === 1) rows.push(text('Station an owned Corellian corvette at Hoth to embark the crew.'));
    return rows;
  }
  if (['lost', 'missed', 'commissioned', 'released'].includes(m.state))
    return [
      text(
        {
          lost: 'Derelict recovery: boarding ship lost. No replacement or prize.',
          missed: 'Derelict recovery: the wreck was not secured. No prize.',
          commissioned: 'Derelict recovery complete: one Nebulon-B frigate recommissioned.',
          released: 'Derelict recovery closed. Prize released without charge.'
        }[m.state]
      )
    ];
  const c = carriers(g),
    f = c.length === 1 ? c[0].f : null,
    p = f && !f.leg ? g.planets[f.planet] : null;
  const rows = [
    text(
      m.state === 'search'
        ? 'Boarding crew embarked. Take this corvette into a manual space attack at the survey site. Keep it alongside the wreck for five seconds, then win with it still on the field.'
        : 'Prize secured · tow the derelict to an uncontested friendly starbase away from the battle site. Losing the boarding ship loses the prize.'
    ),
    ...link(p, 'Boarding ship')
  ];
  if (m.state === 'search') return [...rows, ...link(world(g, site), 'Survey site')];
  const q = refitQuote(g);
  if (!q) return rows;
  if (prompt?.q && q.id === prompt.q.id && q.planet === prompt.q.planet && q.price === prompt.q.price) {
    const release = prompt.kind === 'release';
    rows.push(
      text(
        release
          ? 'Permanently release the prize? Your corvette stays.'
          : `Full refit: ${q.price} credits for one Nebulon-B frigate. Your corvette stays.`
      )
    );
    if (release || g.players.find(p => p.faction === g.active)?.credits >= q.price)
      rows.push(act(release ? 'Confirm release' : `Confirm refit · ${q.price} credits`, () => run({ kind: 'confirm', prompt })));
    else rows.push(text('Insufficient credits. No charge has been made.'));
    rows.push(act('Cancel', () => run({ kind: 'cancel' })));
  } else
    rows.push(
      act(`Review refit · ${q.price} credits`, () => run({ kind: 'refit', q })),
      act('Review release without refit', () => run({ kind: 'release', q }))
    );
  return rows;
}
