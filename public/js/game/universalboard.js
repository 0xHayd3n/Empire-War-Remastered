import { strategicPreview } from './universalpreview.js';

// An independent, full-viewport plate. Only this screen uses the briefing/launcher styling.
export function atlasBoard(back, play, reset) {
  const el = document.createElement('dialog');
  el.className = 'uc-atlas';
  el.dataset.universalScreen = 'campaign';
  el.setAttribute('aria-labelledby', 'uc-atlas-heading');
  // Static interface copy only. All campaign/pack text is assigned through DOM properties below.
  el.innerHTML = `
    <div class="uc-canvas"></div>
    <header class="uc-masthead">
      <div class="uc-brand"><span class="uc-glyph" aria-hidden="true">Galactic atlas</span><span class="uc-overline">Strategic atlas</span><h1 id="uc-atlas-heading">Galactic Conquest</h1></div>
      <nav aria-label="Setup actions"><button type="button" class="uc-back" aria-label="Back">← <span>Back</span></button><button type="button" class="uc-toggle" aria-controls="uc-drawer"><span aria-hidden="true">☷</span> Configure</button></nav>
    </header>
    <aside id="uc-drawer" class="uc-drawer" aria-label="Campaign configuration">
      <header><div><small class="uc-overline">Mission planning</small><h2>Configuration</h2></div><button type="button" class="uc-dismiss" aria-label="Close configuration">×</button></header>
      <div class="uc-scroll"><fieldset class="uc-scenario"><legend><b>01</b> Scenario</legend></fieldset><fieldset class="uc-rules"><legend><b>02</b> Rules &amp; conditions</legend></fieldset>
      <details class="uc-brief"><summary>Campaign briefing</summary><div class="uc-map-summary"></div></details>
      <button type="button" class="uc-reset">Reset settings</button></div>
    </aside>
    <footer class="uc-dock"><div class="uc-selection"><div class="uc-context uc-overline"></div><h2 class="uc-campaign-name"></h2><div class="uc-atlas-status" role="status"></div></div><button type="button" class="uc-launch" disabled>Start campaign <span aria-hidden="true">→</span></button></footer>`;
  const get = s => el.querySelector(s),
    drawer = get('.uc-drawer'),
    toggle = get('.uc-toggle'),
    start = get('.uc-launch');
  document.body.append(el);
  el.showModal();
  const map = strategicPreview(get('.uc-canvas'));
  function configure(open, moveFocus = true) {
    el.dataset.drawer = open ? 'open' : 'closed';
    drawer.inert = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    if (moveFocus) (open ? get('.uc-dismiss') : toggle).focus({ preventScroll: true });
  }
  configure(!matchMedia('(max-width: 720px), (max-height: 460px)').matches, false);
  toggle.onclick = () => configure(drawer.inert);
  get('.uc-dismiss').onclick = () => configure(false);
  // Browser handles the top layer, inert background and focus restoration; Escape closes the drawer first.
  el.oncancel = ev => {
    ev.preventDefault();
    if (!drawer.inert) configure(false);
    else back();
  };
  get('.uc-back').onclick = back;
  start.onclick = play;
  get('.uc-reset').onclick = reset;
  const panel = get('.uc-scroll'),
    fields = new Map();
  function field(id) {
    if (!fields.has(id)) {
      const l = document.createElement('label'),
        caption = document.createElement('span'),
        select = document.createElement('select');
      select.dataset.field = id;
      l.append(caption, select);
      get(['story', 'faction', 'campaign', 'date', 'difficulty'].includes(id) ? '.uc-scenario' : '.uc-rules').append(l);
      fields.set(id, { l, caption, select });
    }
    return fields.get(id);
  }
  return {
    el,
    map,
    panel,
    context: get('.uc-context'),
    title: get('.uc-campaign-name'),
    summary: get('.uc-map-summary'),
    status: get('.uc-atlas-status'),
    close() {
      map.dispose();
      el.close();
      el.remove();
    },
    allow(b) {
      start.disabled = !b;
      start.setAttribute('aria-disabled', String(!b));
    },
    focus() {
      (drawer.inert ? toggle : get('[data-field="story"]'))?.focus({ preventScroll: true });
    },
    hide(id) {
      const entry = fields.get(id);
      if (entry) entry.l.hidden = true;
    },
    field(id, label, rows, value, change) {
      const { l, select, caption } = field(id);
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
