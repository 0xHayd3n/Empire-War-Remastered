import { lobbyUrl, listGames, newGameId } from '../net.js';
import { relayBase } from '../socialidentity.js';
import { mapTitle } from '../ted.js';
import { variants, variantOf } from './operationvariants.js';
import { el, action, option } from './commandui.js';

const key = 'swr-matchmaking-console-v1';
const local = 'http://localhost:8787';
export const ladderName = id => (id === 'ranked' ? 'Ranked' : 'Social');
export const routeName = mode => ({ inherit: 'Game relay', local: 'Local relay', custom: 'Custom relay' })[mode] || 'Game relay';
export function address(p) {
  try {
    return relayBase(p.mode === 'custom' ? p.url : p.mode === 'local' ? local : lobbyUrl());
  } catch {
    throw Error('Use an HTTPS relay or an HTTP loopback address without credentials, query or fragment.');
  }
}
export function preferences() {
  let p = {},
    name = '';
  try {
    p = JSON.parse(localStorage.getItem(key)) || {};
    name = localStorage.getItem('swr.mpname') || '';
  } catch {}
  return {
    ladder: p.ladder === 'ranked' ? 'ranked' : 'social',
    variant: variantOf(p.variant)?.id || variants[0].id,
    mode: ['local', 'custom'].includes(p.mode) ? p.mode : 'inherit',
    url: typeof p.url === 'string' ? p.url : '',
    name: ((typeof p.name === 'string' && p.name.trim()) || name.trim() || 'Commander ' + newGameId().slice(-4).toUpperCase()).slice(0, 24)
  };
}
export function savePreferences(p) {
  try {
    localStorage.setItem(key, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
function moveFocus(e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll('button')],
    i = buttons.indexOf(e.target);
  if (i < 0) return;
  e.preventDefault();
  buttons[
    e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  ].focus();
}
// Deliberate draft: browsing a dossier never silently changes the active queue.
export function matchSheet(root, kind, settings, apply, onClose, mapRotation) {
  const p = { ...settings },
    d = el('dialog', 'mm-sheet');
  d.setAttribute('aria-labelledby', 'mm-sheet-title');
  const head = el('header'),
    intro = el('div'),
    title = el('h2', '', kind === 'playlists' ? 'Select matchmaking playlist' : 'Network configuration');
  title.id = 'mm-sheet-title';
  intro.append(el('small', 'mm-eyebrow', 'Fleet command   /   ' + (kind === 'playlists' ? 'operations catalog' : 'communications')), title);
  head.append(intro);
  const main = el('div', 'mm-sheet-main'),
    foot = el('footer'),
    note = el('span', 'mm-sheet-note');
  note.setAttribute('role', 'status');
  d.append(head, main, foot);
  const back = action(foot, 'Back', () => close(), 'mm-back');
  back.setAttribute('aria-label', 'Back');
  back.prepend(el('kbd', '', 'Backspace'));
  foot.append(note);
  root.append(d);
  let probe,
    gone = false;
  function close() {
    if (gone) return;
    gone = true;
    probe?.abort();
    d.close();
    d.remove();
    onClose();
  }
  d.oncancel = e => {
    e.preventDefault();
    close();
  };
  d.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Backspace' && !e.target.closest('input,textarea,[contenteditable=true]'))) {
      e.preventDefault();
      close();
    }
  };
  d.onclick = e => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  };
  let initial;
  if (kind === 'playlists') {
    const lane = el('div', 'mm-shelf'),
      modes = el('div', 'mm-shelf'),
      dossier = el('section', 'mm-dossier');
    lane.setAttribute('aria-label', 'Playlist categories');
    modes.setAttribute('aria-label', 'Rulesets');
    lane.onkeydown = modes.onkeydown = moveFocus;
    main.append(lane, modes, dossier);
    lane.append(el('small', 'mm-eyebrow', '01   /   Category'));
    modes.append(el('small', 'mm-eyebrow', '02   /   Ruleset'));
    const laneButtons = ['social', 'ranked'].map(id => {
      const b = action(lane, ladderName(id) + ' playlists', () => {
        p.ladder = id;
        paint();
        modes.querySelector('[aria-pressed=true]')?.focus();
      });
      b.dataset.ladder = id;
      return b;
    });
    const modeButtons = variants.map(v => {
      const b = action(modes, v.name, () => {
        p.variant = v.id;
        paint();
      });
      b.dataset.variant = v.id;
      return b;
    });
    function paint() {
      const v = variantOf(p.variant);
      for (const b of laneButtons) b.setAttribute('aria-pressed', String(b.dataset.ladder === p.ladder));
      for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.variant === p.variant));
      dossier.dataset.domain = v.domain;
      dossier.style.setProperty('--mm-art', `url("art/briefings.svg#${v.art}")`);
      dossier.replaceChildren(
        el('small', 'mm-eyebrow', `${ladderName(p.ladder)}  /  ${v.domain}  /  1 v 1`),
        el('h3', '', v.name),
        el('p', '', v.pitch),
        el('strong', '', v.rule)
      );
      const rotation = el('div', 'mm-rotation'),
        maps = mapRotation?.(v.id) || [];
      rotation.append(
        el('small', 'mm-eyebrow', `Map pool  /  ${maps.length}`),
        el('span', '', maps.length ? maps.map(mapTitle).join(' · ') : 'No eligible maps mounted.')
      );
      dossier.append(rotation);
      note.textContent =
        p.ladder === 'ranked'
          ? 'Ranked · Prefer nearby ratings. Completed battles update this device’s record.'
          : 'Social · Play the same rules without recording a rank.';
    }
    paint();
    initial = lane.querySelector('[aria-pressed=true]');
    action(
      foot,
      'Use playlist',
      () => {
        apply(p);
        close();
      },
      'mm-primary'
    );
  } else {
    main.classList.add('mm-network');
    const fields = el('div', 'mm-fields'),
      brief = el('section', 'mm-dossier');
    main.append(fields, brief);
    brief.append(
      el('small', 'mm-eyebrow', 'Signal routing'),
      el('h3', '', 'Matchmaking only'),
      el('p', '', 'Choose the relay your queue uses. Your opponent needs the same relay, build, ordered mods and playlist.'),
      el('strong', '', 'Custom games and private lobby settings stay unchanged.')
    );
    const field = (label, control) => {
      const l = el('label', '', label);
      l.append(control);
      fields.append(l);
    };
    const select = el('select'),
      input = el('input'),
      name = el('input');
    for (const mode of ['inherit', 'local', 'custom']) option(select, mode, routeName(mode));
    select.value = p.mode;
    field('Matchmaking network', select);
    field('Relay address', input);
    field('Commander callsign', name);
    name.value = p.name;
    name.maxLength = 24;
    input.maxLength = 256;
    input.autocomplete = 'off';
    name.autocomplete = 'off';
    const update = () => {
      p.mode = select.value;
      input.readOnly = p.mode !== 'custom';
      input.value = p.mode === 'custom' ? p.url : p.mode === 'local' ? local : lobbyUrl();
    };
    update();
    const invalidate = () => {
      probe?.abort();
      probe = null;
      note.textContent = '';
    };
    select.onchange = () => {
      invalidate();
      update();
    };
    input.oninput = () => {
      invalidate();
      p.url = input.value;
    };
    const draft = () => {
      p.name = name.value.trim().slice(0, 24);
      if (!p.name) throw Error('Enter a commander callsign.');
      const url = address(p);
      if (p.mode === 'custom') p.url = url;
      return url;
    };
    action(fields, 'Test relay', async () => {
      invalidate();
      let ctl;
      try {
        const url = draft();
        ctl = probe = new AbortController();
        note.textContent = 'Contacting the room registry…';
        const rows = await listGames(AbortSignal.any([ctl.signal, AbortSignal.timeout(5000)]), url);
        if (!Array.isArray(rows)) throw Error();
        if (!gone && probe === ctl) note.textContent = 'Relay reachable. No queue ticket was created.';
      } catch (e) {
        if (!gone && (!ctl || probe === ctl)) note.textContent = ctl ? 'Relay unavailable. Check the address and try again.' : e.message;
      }
    });
    initial = select;
    action(
      foot,
      'Apply network',
      () => {
        try {
          draft();
          apply(p);
          close();
        } catch (e) {
          note.textContent = e.message;
        }
      },
      'mm-primary'
    );
  }
  d.showModal();
  initial?.focus();
  return close;
}
