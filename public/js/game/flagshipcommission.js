// One commission per campaign. The log holds only a temporary confirmation;
// ownership, orbital location, the quoted price and condition are rechecked on use.
import { db } from '../gamedata.js';
import { designateFlagship, eligibleCruiser, flagshipMode, repairVessel } from './campaignvessels.js';
import { conflictAt } from './galacticrelation.js';
import { flagshipName, conditionLabel } from './flagshiplabel.js';
const known = (g, p) =>
  p &&
  p.selectable &&
  !p.restricted &&
  !p.destroyed &&
  !p.background &&
  g.visibility?.viewer === g.active &&
  g.visibility.planets[p.index]?.discovered;
const label = p => db.t(p.type.str('Text_ID')) || p.name;
function berth(g, f) {
  const p = g.planets[f.planet];
  return !f.leg && known(g, p) ? p : null;
}
function findFlagship(g) {
  const id = g.vessels?.flagship;
  if (!id) return null;
  for (const f of g.fleets) {
    if (f.owner !== g.active) continue;
    const u = f.units.find(u => !u.dead && u.vessel?.id === id);
    if (u) return { f, u };
  }
  return null;
}
export function repairQuote(g) {
  if (!flagshipMode(g) || g.vessels.open) return null;
  const ship = findFlagship(g);
  if (!ship) return null;
  const { f, u } = ship,
    v = u.vessel,
    c = v.condition,
    p = berth(g, f);
  if (
    !c ||
    !p ||
    !p.station ||
    !(p.spaceLevel >= 1) ||
    p.owner !== g.active ||
    (p.stationOwner || p.owner) !== g.active ||
    conflictAt(g, p.index, g.active)
  )
    return null;
  const base = u.type.num('Build_Cost_Credits', 0),
    partLoss = c.parts.reduce((loss, [, fraction]) => loss + 1 - fraction, 0) / Math.max(1, c.parts.length);
  // An original rule, not the native station repair tariff. Half base hull price
  // scaled by the worse of missing hull or average missing hardpoint health.
  const price = Math.max(1, Math.ceil(base * 0.5 * Math.max(1 - c.hull, partLoss)));
  if (!(base > 0) || !Number.isSafeInteger(price)) return null;
  return { id: v.id, rev: v.rev, planet: p.index, price };
}
export function confirmRepair(g, quote) {
  const now = repairQuote(g);
  return !!now && !!quote && ['id', 'rev', 'planet', 'price'].every(k => now[k] === quote[k]) && repairVessel(g, now, now.price);
}
export function flagshipRows(g, prompt, choose) {
  if (!flagshipMode(g) || g.visibility?.viewer !== g.active) return [];
  const out = [],
    text = s => out.push({ text: s, color: '#f2d791', wrap: true }),
    action = (s, fn) => out.push({ text: s, color: '#9fd8ff', wrap: true, activate: fn }),
    cancel = () => action('Cancel', () => choose(null));
  if (prompt?.message) text(prompt.message);
  if (g.vessels.flagship === null) {
    if (prompt?.kind === 'designate') {
      const { f, u, planet, name } = prompt;
      if (berth(g, f)?.index !== planet || !g.fleets.includes(f) || !f.units.includes(u) || !eligibleCruiser(g, f, u)) {
        text('This cruiser is no longer available.');
        cancel();
        return out;
      }
      text(`Commission ${name} as ${flagshipName}? This campaign has one commission; it cannot be transferred or replaced.`);
      action('Confirm designation', () => {
        const ok = berth(g, f)?.index === planet && designateFlagship(g, f, u);
        choose({ message: ok ? 'Commission confirmed.' : 'This cruiser is no longer available.' });
      });
      cancel();
      return out;
    }
    text('Flagship commission: designate one owned Mon Calamari cruiser. Only that ship will carry battle damage.');
    let count = 0;
    for (const f of g.fleets) {
      const p = berth(g, f);
      if (!p || f.owner !== g.active) continue;
      let n = 0;
      for (const u of f.units) {
        if (!eligibleCruiser(g, f, u)) continue;
        count++;
        const name = `${label(p)} · Fleet ${(f.slot ?? 0) + 1} · Cruiser ${++n}`;
        action('Designate: ' + name, () => choose({ kind: 'designate', f, u, planet: p.index, name }));
      }
    }
    if (!count) text('No eligible cruiser in orbit. Build one normally or wait for your fleet to arrive.');
    return out;
  }
  const ship = findFlagship(g);
  if (!ship) {
    text(`${flagshipName}: no longer in your fleet. Commission closed.`);
    return out;
  }
  const { f, u } = ship,
    p = berth(g, f);
  text(`${flagshipName} · ${p ? label(p) : f.leg ? 'in transit' : 'deployed'} · ${conditionLabel(u.vessel.condition)}`);
  if (!u.vessel.condition) return out;
  const quote = repairQuote(g);
  if (!quote) {
    text('Full repairs require an uncontested friendly starbase.');
    return out;
  }
  const credits = g.players.find(x => x.faction === g.active)?.credits ?? 0;
  if (credits < quote.price) {
    text(`Full repair: ${quote.price} credits needed; treasury ${Math.floor(credits)}.`);
    return out;
  }
  if (prompt?.kind === 'repair') {
    text(`Restore hull and all hardpoints at ${label(p)}? Treasury: ${Math.floor(credits)} credits.`);
    action(`Confirm repair · ${prompt.quote.price} credits`, () => {
      const ok = confirmRepair(g, prompt.quote);
      choose({ message: ok ? `Repair complete: ${prompt.quote.price} credits paid.` : 'Repair not placed. Check the current quote.' });
    });
    cancel();
  } else action(`Review full repair · ${quote.price} credits`, () => choose({ kind: 'repair', quote }));
  return out;
}
