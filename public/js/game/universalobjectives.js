import { db } from '../gamedata.js';
import { equalFooting } from './universaleligibility.js';
// A diplomatic rendezvous, not a spy ability: it neither moves/spawns the envoy
// nor changes discovery. The report is only one extra source in the human mask.
export const envoySeconds = 60;
const visible = p => p && p.selectable && !p.background && !p.destroyed && !p.restricted;
const world = (g, name) => g.planets.find(p => p.name === name);
const known = (g, p) => visible(p) && g.visibility?.viewer === g.active && g.visibility.planets[p.index]?.discovered;
const label = p => db.t(p.type.str('Text_ID')) || p.name;
export function envoyEligible(g) {
  const a = world(g, 'Hoth'),
    b = world(g, 'Bespin'),
    c = world(g, 'Sullust');
  return (
    g.active === 'Rebel' &&
    g.campaign?.name === equalFooting &&
    [a, b, c].every(visible) &&
    a.owner === g.active &&
    b.owner === g.active &&
    c.owner === 'Empire' &&
    [a, b].every((p, i) => g.links[p.index]?.some(e => e.to === [b, c][i].index))
  );
}
export function envoyArrival(game, p, owner, units) {
  const g = game.galaxy,
    m = g.universalRules?.envoy;
  if (
    m?.state !== 'travel' ||
    game.net ||
    g.active !== owner ||
    p.name !== 'Bespin' ||
    p.owner !== owner ||
    !known(g, p) ||
    !units.some(u => !u.dead && (u.carries || u.type)?.name === 'Mon_Mothma_Team')
  )
    return;
  const target = world(g, 'Sullust');
  if (!known(g, target) || target.owner !== 'Empire') return;
  Object.assign(m, { state: 'report', until: g.time + envoySeconds });
  game.galacticLog?.message('Mon Mothma reached Bespin. The Sullust fleet report is available for 60 seconds of campaign time.');
}
export function envoyUpdate(game) {
  const g = game.galaxy,
    m = g.universalRules?.envoy;
  if (!m) return;
  if (m.state === 'report' && g.time >= m.until) {
    g.universalRules.envoy = { state: 'complete' };
    game.galacticLog?.message('The Sullust fleet report has expired.');
  } else if (
    m.state === 'travel' &&
    (!visible(world(g, 'Bespin')) ||
      world(g, 'Bespin').owner !== g.active ||
      !visible(world(g, 'Sullust')) ||
      world(g, 'Sullust').owner !== 'Empire')
  ) {
    g.universalRules.envoy = { state: 'unavailable' };
    game.galacticLog?.message('The envoy rendezvous is no longer available.');
  }
}
export function envoyIntel(g, p, viewer) {
  const m = g.universalRules?.envoy;
  return m?.state === 'report' && viewer === g.active && g.time < m.until && p.name === 'Sullust' && known(g, p);
}
// Rebuilt from saved campaign state, not message history. Never expose a name
// or a navigable coordinate for an undiscovered / restricted world.
export function objectiveRows(g, locate) {
  const rules = g.universalRules,
    out = [];
  if (!rules) return out;
  const text = s => out.push({ text: s, color: '#f2d791', wrap: true }),
    site = (name, prefix = 'Locate') => {
      const p = world(g, name);
      if (known(g, p))
        out.push({
          text: `${prefix}: ${label(p)}`,
          color: '#9fd8ff',
          wrap: true,
          activate: () => {
            if (known(g, p)) locate(p);
          }
        });
    };
  const r = rules.rescue;
  if (r) {
    if (r.state === 'ready') text('Hero rescue: on standby for Han and Chewbacca.');
    else if (r.state === 'captive') {
      const p = world(g, r.prison);
      text(
        known(g, p)
          ? `Han and Chewbacca are held on ${label(p)}. Conquer the prison world to free them.`
          : 'Han and Chewbacca are captive. Their prison is not visible on the chart.'
      );
      site(r.prison);
    } else text('Hero rescue: closed.');
  }
  const x = rules.expedition;
  if (x) {
    text(
      `Star Map Expedition: ${x.found.length} of ${x.sites.length} sites surveyed${x.found.length === x.sites.length ? ' · complete.' : '.'}`
    );
    for (const name of x.sites) site(name, x.found.includes(name) ? 'Surveyed' : 'Outstanding');
  }
  const m = rules.envoy;
  if (m) {
    if (m.state === 'travel') {
      text('Diplomatic envoy: send Mon Mothma to the friendly rendezvous for a fleet report.');
      site('Bespin', 'Rendezvous');
    } else if (m.state === 'report' && m.until > g.time) {
      text(`Envoy report: ${Math.ceil(m.until - g.time)} campaign seconds remaining.`);
      site('Sullust', 'Fleet intelligence');
    } else text(m.state === 'unavailable' ? 'Diplomatic envoy: rendezvous unavailable.' : 'Diplomatic envoy: report expired.');
  }
  return out;
}
