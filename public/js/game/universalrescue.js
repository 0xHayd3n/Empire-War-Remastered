// An original one-shot objective, not an implementation of AotR's story scripts.
import { db } from '../gamedata.js';
import { rescueCampaign } from './universalrules.js';
import { ownedTypes } from './galacticproduction.js';
import { scheduleHeroRespawn } from './galacticherorespawn.js';
import { enemy } from './galacticrelation.js';
const team = 'Han_Solo_Team';
const open = p =>
  p &&
  p.selectable &&
  !p.background &&
  !p.destroyed &&
  !p.restricted &&
  p.invasionEnabled !== false &&
  p.type.bool('Planet_Surface_Accessible', true);
const objective = g =>
  g?.universalRules?.rescue && g.active === 'Rebel' && g.campaign?.name === rescueCampaign ? g.universalRules.rescue : null;
const label = p => db.t(p.type.str('Text_ID')) || p.name;
function prison(g, captor, excluded) {
  // Connected frontier: an invasion can start from an owned surface world. Do
  // not route through locked or undiscovered intermediate worlds to claim reach.
  for (const root of g.planets) {
    if (!open(root) || root.owner !== g.active) continue;
    for (const { to } of g.links[root.index] || []) {
      const p = g.planets[to];
      if (p !== excluded && open(p) && p.owner === captor && (!g.visibility?.planets || g.visibility.planets[to]?.discovered)) return p;
    }
  }
  return null;
}
export function rescueDeath(game, record, where, owner, winner) {
  const g = game.galaxy,
    r = objective(g);
  if (
    !r ||
    r.state !== 'ready' ||
    game.net ||
    owner !== g.active ||
    (record.carries || record.type)?.name !== team ||
    !enemy(owner, winner)
  )
    return;
  if (g.planets.some(p => p.killedHeroes?.some(h => h.type === team && h.owner === owner))) return;
  const p = prison(g, winner, where);
  if (!p) return;
  Object.assign(r, { state: 'captive', prison: p.name, jailer: winner });
  game.galacticLog?.message(`Han and Chewbacca have been captured. Conquer ${label(p)} to rescue them.`);
}
export function heldForRescue(g, record, owner) {
  return owner === g.active && (record.carries || record.type)?.name === team && objective(g)?.state === 'captive';
}
// Convert a resolved objective to the ordinary respawn queue, which already
// knows how to place companies on the map and update the victory/AI ledgers.
function finish(game, r, p, won) {
  const g = game.galaxy,
    type = db.type(team);
  g.universalRules.rescue = { state: 'complete' };
  if (!type || !p || ownedTypes(g, g.active).some(t => t.name === team)) return;
  if (won) {
    const frame = Math.floor(g.time * 30);
    (p.killedHeroes ||= []).push({ type: team, owner: g.active, killer: r.jailer, startFrame: frame, dueFrame: frame });
    g.heroRespawnNext = 0;
    game.galacticLog?.message(`Prison liberated on ${label(p)}. Han and Chewbacca are returning.`);
  } else {
    scheduleHeroRespawn(game, { type }, p, g.active, r.jailer);
    game.galacticLog?.message('The prison is no longer available. Normal hero return rules apply.');
  }
}
export function prisonChanged(game, p, old, now, invasion) {
  const g = game.galaxy,
    r = objective(g);
  if (r?.state !== 'captive' || r.prison !== p.name || g.planets[p.index] !== p) return;
  finish(game, r, p, open(p) && invasion === true && old === r.jailer && now === g.active);
}
export function checkPrison(game) {
  const g = game.galaxy,
    r = objective(g);
  if (r?.state !== 'captive') return;
  const p = g.planets.find(p => p.name === r.prison);
  if (!open(p) || p.owner !== r.jailer) finish(game, r, p || g.planets.find(open), false);
}
