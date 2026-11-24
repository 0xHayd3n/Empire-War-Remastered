import { settingsControls } from './universalcontrols.js';
import { strategicPreview } from './universalpreview.js';

export function atlasBoard(back, play, reset) {
  const el = document.createElement('dialog');
  el.className = 'uc-atlas';
  el.dataset.universalScreen = 'campaign';
  el.setAttribute('aria-labelledby', 'uc-heading');
  el.innerHTML = `<div class="uc-canvas"></div><aside class="uc-panel" aria-label="Campaign settings"><h1 id="uc-heading">Galactic Conquest</h1><div class="uc-content"><div class="uc-roster" role="region" aria-label="Campaign maps"></div><div class="uc-fields"></div></div><footer><div role="status"></div><button type="button" class="uc-reset" aria-label="Reset settings">Reset</button><button type="button" class="uc-start" disabled>Start campaign</button></footer></aside>`;
  const panel = el.querySelector('.uc-fields'),
    start = el.querySelector('.uc-start'),
    fields = new Map();
  document.body.append(el);
  el.showModal();
  const map = strategicPreview(el.querySelector('.uc-canvas'));
  el.oncancel = e => {
    e.preventDefault();
    back();
  };
  el.querySelector('.uc-reset').onclick = reset;
  start.onclick = play;
  return {
    el,
    map,
    ...settingsControls(panel),
    panel: el.querySelector('.uc-content'),
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
      const { l, caption, select } = fields.get(id);
      l.hidden = false;
      caption.textContent = label;
      select.setAttribute('aria-label', label);
      select.replaceChildren(
        ...rows.map(r => {
          const o = new Option(r.label, r.value);
          o.disabled = !!r.disabled;
          return o;
        })
      );
      select.value = value;
      select.disabled = !rows.length;
      select.onchange = () => change(select.value);
    }
  };
}
