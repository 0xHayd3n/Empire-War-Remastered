import { appearances, validPaint } from './appearancechoices.js';
import { db } from '../gamedata.js';
import { availableUnits, queueUnit } from './galacticproduction.js';
const stamp = () => globalThis.document?.querySelector('meta[name="swr-pack-revision"]')?.content;
export function beginAppearance(g, opts) {
  for (const [key, d] of Object.entries(appearances))
    if (
      g.universalPath === 1 &&
      !g.humans &&
      g.active === 'Empire' &&
      g.campaign.name === d.target &&
      stamp() === `${d.id}:${d.revision}` &&
      validPaint(d, opts?.[key])
    ) {
      (g.paintKeys ||= []).push(key);
      (g.paint ||= {})[key] = { goal: opts[key], phase: 'start', at: 0 };
    }
}
// Advance only after observing the native result. A saved wait is not a new order;
// completing or abandoning a request never disables later native control.
export function stepAppearance(game) {
  const g = game.galaxy;
  if (
    !g.paint ||
    game.net ||
    game.paused ||
    game.busy ||
    game.controlsLocked ||
    game.storyDialog?.opened ||
    game.scriptUI?.modal ||
    g.time < (game.nextPaintCheck || 0)
  )
    return;
  game.nextPaintCheck = g.time + 0.25;
  const entry = Object.entries(g.paint)[0];
  if (!entry) return;
  const [key, m] = entry,
    d = appearances[key];
  const finish = success => {
    delete g.paint[key];
    if (!Object.keys(g.paint).length) delete g.paint;
    game.galacticLog?.message(
      success
        ? `${d.title}: ${d.choices[m.goal]}. Native appearance controls remain available.`
        : `${d.title}: opening request stopped. Use the native Options category.`
    );
  };
  if (g.time > 100 || game.me !== g.active || stamp() !== `${d.id}:${d.revision}` || g.campaign.name !== d.target) return finish(false);
  const button = game.scriptUI?.state('B_SAVE_FIXER');
  if (
    !game.story?.values.has(d.id === '1976399102' ? 'CLONE_DEFAULT' : 'DEFAULT_LIGHTSABER_REVAN') ||
    !button?.visible ||
    !button.enabled ||
    g.time < 12
  )
    return;
  const raw = game.story.values.get(d.flag),
    current = d.values ? d.values.indexOf(raw ?? null) : raw;
  if (current === m.goal) return finish(true);
  const t = db.type(d.type),
    player = g.players.find(p => p.faction === game.me);
  if (!t || !player) return finish(false);
  const queued = () => g.planets.some(p => p.production.space.some(q => q.owner === g.active && q.type === t));
  if (m.phase === 'start') {
    if (current !== 0 || player.builtCounts?.[t.name] || queued()) return finish(false);
    const p = g.planets.find(
      p =>
        p.selectable &&
        !p.destroyed &&
        !p.background &&
        !p.restricted &&
        p.owner === g.active &&
        p.station &&
        (p.stationOwner || p.owner) === g.active &&
        g.visibility?.planets[p.index]?.discovered
    );
    if (!p) return finish(false);
    game.select(p.index);
    if (!game.scriptUI?.click('B_SAVE_FIXER')) return finish(false);
    Object.assign(m, { phase: 'queue', planet: p.index, deadline: g.time + 10 });
    return;
  }
  const p = g.planets[m.planet];
  if (!p || game.selected !== p.index || p.owner !== g.active || g.time > m.deadline) return finish(false);
  if (m.phase === 'wait') {
    if (current === m.at) return;
    if (current !== m.at + 1) return finish(false);
    m.at = current;
    m.phase = 'queue';
    m.deadline = g.time + 10;
  }
  if (current !== m.at || queued()) return finish(false);
  if (!availableUnits(g, p.index, g.active, 'space').includes(t)) return;
  if (queueUnit(g, p.index, g.active, t)) return finish(false);
  m.phase = 'wait';
  m.deadline = g.time + 15;
}
