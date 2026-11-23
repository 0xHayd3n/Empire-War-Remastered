// Navigation inside the live game. Only the host may resolve a known era ID to its local content origin.
import { openChoiceSheet } from './universaldialog.js';
const names = {
  conquest: 'Galactic Conquest',
  story: 'Story campaign',
  skirmish: 'Skirmish',
  instant: 'Instant Battle',
  load: 'Load game'
};
const periods = {
  stock: 'Galactic Civil War',
  3417277973: 'Old Republic',
  1976399102: 'Clone Wars',
  3387971722: 'Clone Wars',
  1397421866: 'Galactic Civil War',
  1770851727: 'Galactic Civil War',
  1125571106: 'New Republic'
};
const chronology = ['Old Republic', 'Clone Wars', 'Galactic Civil War', 'New Republic'];
const briefing = {
  stock: 'The Empire, Rebellion and Zann Consortium contest the galaxy in Forces of Corruption.',
  3417277973: 'Return to the age of the Old Republic, from the Mandalorian Wars to the Jedi Civil War.',
  1976399102: 'Follow the Republic and the Separatist crisis through the final years of the Republic.',
  3387971722: 'Command the Republic or its rivals in Awakening’s take on the Clone Wars.',
  1397421866: 'Fight for control of the galaxy in Awakening’s Galactic Civil War campaigns.',
  1770851727: 'Explore the Galactic Civil War through Remake’s fleet and faction campaigns.',
  1125571106: 'In the aftermath of Endor, the New Republic and Imperial successor states struggle for control.'
};
export const eraMode = mode => Object.hasOwn(names, mode);
export function universalModeNavigation({ setup, current, host }) {
  let panel = null;
  const close = () => {
    panel?.close();
    panel?.remove();
    panel = null;
  };
  const open = (kicker, title, back) => {
    close();
    const d = document.createElement('dialog');
    d.className = 'era-panel';
    panel = d;
    d.innerHTML = '<small></small><h1></h1><p role="status"></p><div class="era-choices"></div><footer></footer>';
    d.querySelector('small').textContent = kicker;
    d.querySelector('h1').textContent = title;
    d.oncancel = e => {
      e.preventDefault();
      if (back && !d.querySelector('footer button:disabled')) {
        close();
        back();
      }
    };
    d.addEventListener('keydown', e => e.stopPropagation());
    if (back)
      button(d.querySelector('footer'), 'Back', () => {
        close();
        back();
      });
    document.body.append(d);
    d.showModal();
    return d;
  };
  function button(parent, text, action, disabled = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.disabled = disabled;
    b.onclick = action;
    parent.append(b);
    return b;
  }
  const home = (mode = 'title') => {
    if (window.parent === window) {
      location.assign('play.html');
      return;
    }
    window.parent.postMessage({ kind: 'universal-select', id: 'stock', mode }, host);
  };
  const localModes = () => {
    const d = open('EMPIRE WAR REMASTERED · UNIVERSAL', 'Single player', null);
    for (const [mode, name] of Object.entries(names)) button(d.querySelector('.era-choices'), name, () => pick(mode, localModes));
    button(d.querySelector('footer'), 'Main menu', () => home());
  };
  const pick = async (mode, back = localModes) => {
    if (!eraMode(mode)) return;
    close();
    let selected,
      closed = false,
      busy = false;
    const sheet = await openChoiceSheet({
      screen: 'eras',
      heading: names[mode] + ' — Choose your era',
      context: 'Select a time period, then a storyline.',
      section: 'Time period',
      back: () => {
        if (!busy) {
          finish();
          back();
        }
      },
      next: () => {
        if (busy || !selected?.ready) return;
        if (selected.id === current) {
          finish();
          run(mode, back);
          return;
        }
        if (window.parent === window) {
          sheet.info('Open the Universal game window to change eras.');
          return;
        }
        busy = sheet.el.inert = true;
        sheet.info('Loading ' + selected.name + '…');
        addEventListener('message', onError);
        window.parent.postMessage({ kind: 'universal-select', id: selected.id, mode }, host);
      }
    });
    function finish() {
      closed = true;
      removeEventListener('message', onError);
      sheet.close();
    }
    function onError(e) {
      if (e.source !== window.parent || e.origin !== host || e.data?.kind !== 'universal-error') return;
      removeEventListener('message', onError);
      busy = sheet.el.inert = false;
      sheet.info(e.data.error);
      sheet.focus();
    }
    sheet.allow(false);
    sheet.info('Reading available eras…');
    try {
      const r = await fetch('/api/universal/eras');
      if (!r.ok) throw Error('Era catalog is unavailable.');
      const rows = await r.json();
      if (closed) return;
      sheet.sections(
        chronology.filter(p => rows.some(r => periods[r.id] === p)).map(p => ({ key: p, label: p })),
        periods[current],
        ({ key: p }) => {
          const stories = rows
            .filter(r => periods[r.id] === p)
            .map(r => ({ ...r, key: r.id, label: r.ready ? r.name : r.name + ' (not built)' }));
          const first = stories.find(r => r.id === current) || stories.find(r => r.ready) || stories[0];
          sheet.values('Storyline', stories, first.key, r => {
            selected = r;
            sheet.allow(r.ready);
            sheet.info(
              (briefing[r.id] || r.name) +
                '\n' +
                (r.ready
                  ? mode === 'conquest'
                    ? 'Continue to faction, campaign map and difficulty.'
                    : 'Continue to ' + names[mode] + '.'
                  : 'Not built locally. Choose another storyline or build this pack.')
            );
          });
        }
      );
      sheet.focus();
    } catch (e) {
      if (!closed) sheet.info(e.message);
    }
  };
  const run = async (mode, back = () => home(mode === 'load' ? 'title' : 'modes')) => {
    close();
    const again = () => pick(mode, back);
    try {
      const ok = await setup(mode, again);
      if (ok !== false) return;
    } catch (e) {
      console.warn('Universal mode setup', e);
    }
    const d = open('UNIVERSAL · ' + names[mode].toUpperCase(), 'Setup unavailable', again);
    d.querySelector('[role=status]').textContent =
      `This era could not open ${names[mode]}. Its listed campaigns are available under Galactic Conquest.`;
  };
  const saves = (rows, load, back) => {
    const d = open('UNIVERSAL · SAVED CAMPAIGNS AND BATTLES', 'Load game', back),
      list = rows.filter(r => !r.mp);
    if (!list.length) d.querySelector('[role=status]').textContent = 'No single-player saves in this era.';
    for (const sv of list)
      button(d.querySelector('.era-choices'), sv.name || sv.id, () => {
        close();
        load(sv.id);
      });
    return true;
  };
  return { pick, run, localModes, home, saves, supports: eraMode };
}
