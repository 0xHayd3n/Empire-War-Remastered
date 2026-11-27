import { mapHeading } from './universalmapheading.js';
import { settingsControls } from './universalcontrols.js';
import { sidebarTabs } from './universalsidebartabs.js';
import { strategicPreview } from './universalpreview.js';

export function atlasBoard(back, play, reset) {
  const el = document.createElement('dialog');
  el.className = 'uc-atlas';
  el.dataset.universalScreen = 'campaign';
  el.setAttribute('aria-labelledby', 'uc-heading');
  el.toggleAttribute('data-await-map', true);
  el.innerHTML = `<div class="uc-canvas"></div><aside class="uc-panel" aria-label="Campaign settings"><div class="uc-content"><div class="uc-roster" role="region" aria-label="Campaign maps"></div></div><footer><div role="status"></div><button type="button" class="uc-reset" aria-label="Reset settings">Reset</button><button type="button" class="uc-start" disabled>Start campaign</button></footer></aside>`;
  const content = el.querySelector('.uc-content'),
    setup = sidebarTabs('setup', 'Campaign setup', ['Faction', 'Settings'], i => {
      setup.select(i);
      if (setup.panels[i].getBoundingClientRect().top > content.getBoundingClientRect().bottom - 50)
        setup.panels[i].scrollIntoView({ block: 'start' });
    }),
    [factions, panel] = setup.panels;
  setup.bar.classList.add('uc-setup-tabs');
  for (const pane of setup.panels) pane.className = 'uc-fields';
  content.append(setup.bar, ...setup.panels);
  const factionCards = settingsControls(factions),
    controls = settingsControls(panel);
  const start = el.querySelector('.uc-start'),
    fields = new Map();
  const canvas = el.querySelector('.uc-canvas');
  mapHeading(canvas, 'Galactic Conquest', back, 'uc-heading');
  document.body.append(el);
  el.showModal();
  const map = strategicPreview(canvas);
  el.oncancel = e => {
    e.preventDefault();
    back();
  };
  el.querySelector('.uc-reset').onclick = reset;
  start.onclick = play;
  return {
    el,
    map,
    slider: controls.slider,
    radios(id, ...args) {
      (id === 'faction' ? factionCards : controls).radios(id, ...args);
    },
    panel: content,
    roster: el.querySelector('.uc-roster'),
    status: el.querySelector('[role="status"]'),
    close(remember = false) {
      map.dispose(remember);
      el.close();
      el.remove();
    },
    allow(b) {
      start.disabled = !b;
      start.setAttribute('aria-disabled', String(!b));
    },
    hide(id) {
      if (fields.has(id)) fields.get(id).l.hidden = true;
    },
    field(id, label, rows, value, change) {
      if (!fields.has(id)) {
        const l = document.createElement('label'),
          caption = document.createElement('span'),
          select = document.createElement('select');
        select.dataset.field = id;
        l.append(caption, select);
        panel.append(l);
        fields.set(id, { l, caption, select });
      }
      const field = fields.get(id),
        { l, caption, select } = field;
      l.hidden = false;
      caption.textContent = label;
      select.setAttribute('aria-label', label);
      if (
        !field.rows ||
        field.rows.length !== rows.length ||
        rows.some((r, i) => r.value !== field.rows[i].value || r.label !== field.rows[i].label || !!r.disabled !== !!field.rows[i].disabled)
      ) {
        field.rows = rows;
        select.replaceChildren(
          ...rows.map(r => {
            const o = new Option(r.label, r.value);
            o.disabled = !!r.disabled;
            return o;
          })
        );
      }
      select.value = value;
      select.disabled = !rows.length;
      select.onchange = () => change(select.value);
    }
  };
}
