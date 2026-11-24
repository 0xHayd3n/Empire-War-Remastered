import { db } from '../gamedata.js';
import { equalFooting } from './universaleligibility.js';
const fee = 1500,
  delay = 600,
  fighter = 'Rebel_X-Wing_Squadron';
export function hasStationOrder(game) {
  const cb = game.setup.campaign;
  return (
    cb?.stationSupport === true &&
    cb.galaxy?.fighterSupport === true &&
    cb.galaxy.universalPath === 1 &&
    cb.campaignName === equalFooting &&
    cb.planetOwner === 'Rebel' &&
    cb.sides?.[1] === 'Rebel' &&
    !!cb.defender.station &&
    !game.setup.net &&
    !game.setup.linkedTactical &&
    game.human?.factionName === 'Rebel' &&
    game.human.team.id === cb.defender.team &&
    !game.spectator
  );
}
export function restoreStationOrder(m) {
  if (m?.phase === 'ready' || m?.phase === 'deployed') return { phase: m.phase };
  if (m?.phase === 'inbound' && Number.isInteger(m.left) && m.left >= 1 && m.left <= delay) return { phase: m.phase, left: m.left };
  // An inconsistent receipt must never turn back into another purchase.
  return { phase: 'closed' };
}
const station = g => {
  const s = g.campaignBook?.station;
  return s && !s.dead && s.player === g.human ? s : null;
};
const stopped = g =>
  g.over ||
  g.spectator ||
  g.modeSuspended ||
  g.controlsLocked ||
  g.cine?.on ||
  g.tacticalCinematics?.on ||
  g.tacticalMovies?.active ||
  g.menus?.open ||
  g.retreat?.active ||
  g.tacticalVictory?.winner;
export function buyStationOrder(g) {
  const m = g.campaignBook?.support,
    p = g.human;
  if (
    !m ||
    m.phase !== 'ready' ||
    !hasStationOrder(g) ||
    !station(g) ||
    stopped(g) ||
    !db.type(fighter)?.has('Squadron_Units') ||
    !g.world.tacticalSessions?.[p.id] ||
    g.world.tacticalSessions[p.id].ai ||
    !(p.credits >= fee)
  )
    return false;
  p.credits -= fee;
  Object.assign(m, { phase: 'inbound', left: delay });
  return true;
}
export function tickStationOrder(g) {
  const m = g.campaignBook.support;
  if (!m || m.phase !== 'inbound') return;
  const s = station(g);
  if (!s || g.over || g.spectator || g.retreat?.active || g.tacticalVictory?.winner) {
    m.phase = 'closed';
    delete m.left;
    return;
  }
  if (g.paused || stopped(g) || --m.left > 0) return;
  // No fleet record or reserve/called ticket. These are local tactical defenders only.
  m.phase = 'deployed';
  delete m.left;
  const t = db.type(fighter),
    w = g.world;
  for (const side of [-1, 1]) w.spawn(t, g.human, s.x + side * 120, s.y + 120, s.heading, { hyperspace: true });
}
export function supportHUD(g, root) {
  const box = document.createElement('div'),
    b = document.createElement('button'),
    status = document.createElement('span');
  box.className = 'recovery-beacon';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Emergency fighter support');
  status.setAttribute('role', 'status');
  b.type = 'button';
  b.textContent = 'Call X-wing support · 1,500 credits';
  box.append(status, b);
  root.append(box);
  function update() {
    const m = g.campaignBook.support;
    const label =
      m.phase === 'inbound'
        ? `X-wings inbound · ${Math.ceil(m.left / 30)}s`
        : m.phase === 'deployed'
          ? 'X-wing wave deployed'
          : m.phase === 'closed' || !station(g)
            ? 'Support unavailable'
            : g.human.credits < fee
              ? 'Insufficient credits'
              : 'Station defense · two temporary squadrons in 20s';
    if (status.textContent !== label) status.textContent = label;
    b.disabled = m.phase !== 'ready' || !station(g) || stopped(g) || g.human.credits < fee;
  }
  b.onclick = () => {
    buyStationOrder(g);
    update();
  };
  update();
  return { update, dispose: () => box.remove() };
}
