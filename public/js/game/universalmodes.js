// Navigation inside the live game. Only the host may resolve a known era ID to its local content origin.
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
    const d = open('SINGLE PLAYER · ' + names[mode].toUpperCase(), 'Choose your era', back),
      status = d.querySelector('[role=status]');
    status.textContent = 'Reading available eras…';
    try {
      const r = await fetch('/api/universal/eras');
      if (!r.ok) throw Error('Era catalog is unavailable.');
      const rows = await r.json();
      if (panel !== d) return;
      status.textContent =
        mode === 'conquest' ? 'Next: choose your faction, campaign and optional rules.' : `Choose the setting for ${names[mode]}.`;
      for (const { id, name, ready } of rows) {
        const b = button(
          d.querySelector('.era-choices'),
          name,
          async () => {
            if (id === current) {
              close();
              await run(mode, back);
              return;
            }
            if (window.parent === window) {
              status.textContent = 'Open the Universal game window to change eras.';
              return;
            }
            const onError = e => {
              if (e.source === window.parent && e.origin === host && e.data?.kind === 'universal-error') {
                status.textContent = e.data.error;
                for (const el of d.querySelectorAll('[data-ready]')) el.disabled = false;
                d.querySelector('footer button').disabled = false;
                removeEventListener('message', onError);
              }
            };
            addEventListener('message', onError);
            status.textContent = `Loading ${name}…`;
            for (const el of d.querySelectorAll('button')) el.disabled = true;
            window.parent.postMessage({ kind: 'universal-select', id, mode }, host);
          },
          !ready
        );
        b.dataset.era = id;
        if (ready) b.dataset.ready = '';
        const meta = document.createElement('span');
        meta.textContent = ready ? periods[id] || '' : 'Not built locally';
        b.prepend(meta);
      }
    } catch (e) {
      status.textContent = e.message;
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
