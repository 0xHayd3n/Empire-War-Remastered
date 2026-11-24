import { db } from '../gamedata.js';
import { availableUnits, queueUnit } from './galacticproduction.js';
import { canonStart, thrawnRevision } from './universaleligibility.js';
// Request a real local order after native initialization; never grant a tech,
// duplicate an order, manufacture the category dummy, or force a story flag.
export function stepCanonOrder(game) {
  const g = game.galaxy,
    m = g.universalRules?.canon;
  if (!m || !['request', 'category'].includes(m.state)) return;
  const stop = () => {
    g.universalRules.canon = { state: 'unavailable' };
    game.galacticLog?.message('Canon Units could not be queued. The native Options control is unchanged.');
  };
  if (
    game.net ||
    g.campaign.name !== canonStart ||
    game.me !== 'Rebel' ||
    document.querySelector('meta[name="swr-pack-revision"]')?.content !== `1125571106:${thrawnRevision}`
  )
    return stop();
  if (m.state === 'request' && g.time > 90) return stop();
  if (
    game.controlsLocked !== false ||
    game.busy ||
    game.paused ||
    game.storyDialog?.opened ||
    game.scriptUI?.modal ||
    game.story?.values.get('GALACTIC_DISPLAY_ON') !== 1
  )
    return;
  if (game.nextCanonCheck > g.time) return;
  game.nextCanonCheck = g.time + 0.25;
  const t = db.type('Option_Canon_Units'),
    player = g.players.find(p => p.faction === game.me);
  if (!t || !player) return stop();
  if (
    player.builtCounts?.[t.name] ||
    g.planets.some(p => Object.values(p.production).some(l => l.some(q => q.owner === game.me && q.type === t)))
  ) {
    g.universalRules.canon = { state: 'ordered' };
    return;
  }
  if (m.state === 'request') {
    const p = g.planets.find(
      p =>
        p.owner === game.me &&
        (p.stationOwner || p.owner) === game.me &&
        p.station &&
        p.spaceLevel > 0 &&
        !p.background &&
        !p.restricted &&
        !p.destroyed &&
        p.selectable
    );
    if (!p) return stop();
    game.select(p.index);
    if (!game.scriptUI?.click('B_SAVE_FIXER')) return stop();
    Object.assign(m, { state: 'category', planet: p.name, deadline: g.time + 8 });
    return;
  }
  const p = g.planets[game.selected];
  if (!p || p.name !== m.planet || p.owner !== game.me || g.time > m.deadline) return stop();
  if (!availableUnits(g, p.index, game.me, 'space').includes(t)) return;
  if (queueUnit(g, p.index, game.me, t)) return stop();
  g.universalRules.canon = { state: 'ordered' };
  game.galacticLog?.message('Enable Canon Units queued using the native Options order.');
  game.ui?.refresh();
}
