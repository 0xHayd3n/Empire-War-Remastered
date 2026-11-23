import { db } from '../gamedata.js';
import { battleMapLabel, mountBattleArt } from './battleart.js';
import { battleBriefing } from './battlebriefing.js';

let active = null;
export const activeLoadScreen = () => active;

// The same plate for every player-facing tactical load. Neither a native dialog
// resource, an illustration, nor authored lore is required to show or finish it.
export function showLoadScreen({ setup, map, land, staged = false }) {
  const { title, site, description } = battleBriefing(db, { map, mapFile: setup.mapFile, campaign: setup.campaign });
  const kind = land ? 'Land battle' : 'Space battle';
  const plate = document.createElement('section');
  plate.className = 'battle-plate';
  plate.dataset.kind = land ? 'land' : 'space';
  plate.setAttribute('aria-label', kind + ' briefing');
  plate.innerHTML = '<div class="battle-scene"></div><div class="battle-copy"><h2></h2><div class="battle-subtitle"></div></div><footer><progress max="1" aria-label="Battle loading progress"></progress><span class="loading-caption"><i aria-hidden="true"></i>Loading battle</span></footer>';
  const heading = plate.querySelector('h2');
  heading.textContent = battleMapLabel(title);
  // This is the same place name in another script, not a second accessible title.
  // A missing or slow decorative font must never delay a battle or duplicate Latin text.
  document.fonts.load('1em "Aurebesh AF Canon"', heading.textContent).then(faces => {
    if (!faces.length || !heading.isConnected) return;
    const glyphs = document.createElement('span');
    glyphs.className = 'battle-aurebesh';
    glyphs.setAttribute('aria-hidden', 'true');
    glyphs.textContent = heading.textContent;
    heading.before(glyphs);
  }).catch(() => {});
  plate.querySelector('.battle-subtitle').textContent = [site, kind].filter(Boolean).join(' · ');
  if (description) {
    const p = document.createElement('p');
    p.className = 'battle-description';
    p.textContent = description;
    plate.querySelector('.battle-copy').append(p);
  }
  // A replacement screen must not inherit the previous battle's peer listener or art.
  if (active) closeScreen(active);
  active = { plate, staged, meter: plate.querySelector('footer progress'), rows: setup.net ? playerRows(plate, setup) : null };
  document.body.append(plate);
  mountBattleArt(plate.querySelector('.battle-scene'), { land, map, campaign: setup.campaign })
    .catch(error => console.warn('Could not load the battle illustration.', error))
    .then(shown => {
      if (shown || !plate.isConnected) return;
      const note = document.createElement('small');
      note.className = 'battle-photo-note';
      note.textContent = 'No verified map photograph';
      plate.querySelector('.battle-copy').append(note);
    });
}

export function loadProgress(frac) {
  if (!active || !Number.isFinite(frac)) return;
  active.meter.value = frac;
  active.rows?.mine(frac);
}

// Progress is informational: lockstep still owns readiness. Keep each human
// slot's peer reports separate, including co-op players sharing a faction.
function playerRows(plate, setup) {
  const { session, me } = setup.net;
  const list = document.createElement('aside');
  list.className = 'battle-peers';
  list.setAttribute('aria-label', 'Player loading progress');
  const rows = new Map();
  for (const p of setup.players.filter(player => player.human)) {
    const label = document.createElement('label'), bar = document.createElement('progress');
    bar.max = 1;
    label.append(p.name || 'Player', bar);
    list.append(label);
    const peers = (p.peers || [p.peer]).filter(peer => peer !== undefined);
    const row = { bar, count: peers.length, shares: new Map() };
    for (const peer of peers) rows.set(peer, row);
  }
  if (list.childElementCount) plate.append(list);
  const set = (peer, f) => {
    const row = rows.get(peer);
    if (!row || !Number.isFinite(f)) return;
    row.shares.set(peer, Math.max(0, Math.min(1, f)));
    if (row.shares.size === row.count) row.bar.value = Math.min(...row.shares.values());
  };
  const unhook = session.on('message', (from, m) => {
    if (m?.k !== 'loadp') return;
    if (session.host) {
      set(from, m.f);
      session.broadcast({ k: 'loadp', p: from, f: m.f }, from);
    } else if (from === 0) set(m.p, m.f);
  });
  let said = -1;
  return {
    mine(f) {
      set(me, f);
      const step = Math.floor(f * 50);
      if (step === said) return;
      said = step;
      if (session.host) session.broadcast({ k: 'loadp', p: me, f });
      else session.send(0, { k: 'loadp', f });
    },
    close: unhook
  };
}

function closeScreen(screen) {
  screen.rows?.close();
  screen.plate.remove();
  if (active === screen) active = null;
}

export function endLoadScreen({ direct = false, unlock = () => {} } = {}) {
  const screen = active;
  if (!screen) return;
  try {
    loadProgress(1);
    if (!direct) unlock();
  } finally {
    closeScreen(screen);
  }
}
