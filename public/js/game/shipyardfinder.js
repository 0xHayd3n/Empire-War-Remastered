import { db } from '../gamedata.js';
import { forceKind } from './galaxy.js';
import { availableUnits, productionBlock, productionCandidates, productionCost, productionTime } from './galacticproduction.js';
const label = t => db.t(t.str('Text_ID')) || t.name;
const ship = t => ['starship', 'squadron'].includes(forceKind(t));
export const finderEnabled = game =>
  game.galaxy.universalPath === 1 &&
  !game.galaxy.humans &&
  !game.net &&
  game.me === game.galaxy.active &&
  game.galaxy.visibility?.viewer === game.me;
const knownPort = (g, p) =>
  g.planets[p?.index] === p &&
  p?.owner === g.active &&
  p.selectable &&
  !p.restricted &&
  !p.destroyed &&
  !p.background &&
  g.visibility?.viewer === g.active &&
  g.visibility.planets[p.index]?.discovered;
const yards = g => g.planets.filter(p => knownPort(g, p));
const listed = (names, t) => names?.some(n => n.toUpperCase() === t.name.toUpperCase());
// Only advertise a ship already visible through a human build list, an explicit
// unlock, an owned hull or a known native tech-tree entry (not every XML type).
export function finderShips(g) {
  const seen = new Set(),
    player = g.players.find(p => p.faction === g.active);
  for (const p of yards(g)) for (const t of availableUnits(g, p.index, g.active, 'space')) seen.add(t);
  for (const f of g.fleets) if (f.owner === g.active) for (const u of f.units) if (!u.dead) seen.add(u.carries || u.type);
  return productionCandidates(g.active, 'space')
    .filter(t => ship(t) && (seen.has(t) || listed(player?.unlockedTypes, t)))
    .sort((a, b) => label(a).localeCompare(label(b)) || a.name.localeCompare(b.name));
}
export const finderType = (g, t) => t && ship(t) && productionCandidates(g.active, 'space').includes(t);
export function checkYard(g, p, t) {
  if (!finderType(g, t) || !knownPort(g, p)) return 'Yard unavailable';
  const player = g.players.find(q => q.faction === g.active);
  if (listed(player?.disabledTypes, t)) return 'Disabled by the campaign';
  const why = productionBlock(g, p.index, g.active, t);
  return why?.startsWith('TEXT_') ? db.t(why) || why : why;
}
export function finderRows(g, view, set, jump) {
  const action = (text, activate) => ({ text, activate, color: '#9fd8ff', wrap: true }),
    line = text => ({ text, color: '#f2d791', wrap: true });
  if (!view) return [action('Shipyard finder · Where can I build this?', () => set({ page: 0 }))];
  const rows = [line('Shipyard finder · current production rules'), action('Close shipyard finder', () => set(null))];
  if (!view.type) {
    const ships = finderShips(g),
      size = 10,
      page = Math.max(0, Math.min(view.page, Math.ceil(ships.length / size) - 1));
    if (!ships.length) rows.push(line('No known producible ships. The finder follows your current faction and native build filters.'));
    for (const t of ships.slice(page * size, (page + 1) * size)) rows.push(action(`Find yards: ${label(t)}`, () => set({ type: t, page })));
    if (page > 0) rows.push(action('Previous ships', () => set({ page: page - 1 })));
    if ((page + 1) * size < ships.length) rows.push(action('More ships', () => set({ page: page + 1 })));
  } else {
    const t = view.type,
      blocked = new Map();
    rows.push(line(`${label(t)} · yards where you can queue this ship now:`));
    let count = 0;
    for (const p of yards(g)) {
      const why = checkYard(g, p, t);
      if (why) blocked.set(why, (blocked.get(why) || 0) + 1);
      else {
        count++;
        rows.push(
          action(
            `Go to yard: ${label(p.type)} · ${productionCost(g, p, g.active, t)} credits · ${+productionTime(g, p, g.active, t).toFixed(1)} s`,
            () => {
              if (!checkYard(g, p, t)) jump(p);
              else set(view);
            }
          )
        );
      }
    }
    if (!count) rows.push(line('No available yard.'));
    for (const [why, n] of blocked) rows.push(line(`${why} · ${n} ${n === 1 ? 'world' : 'worlds'}`));
    rows.push(action('Choose another ship', () => set({ page: view.page || 0 })));
  }
  return rows;
}
