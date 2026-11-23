import { openDialog, skinImage } from './dialogs.js';
import { nativeSkin, staging, action, bindWindow, enableAction } from './universaldialog.js';
import { strategicPreview } from './universalpreview.js';
const control = (kind, id, x, y, w, h) => ({ kind, id, x, y, w, h, text: '', style: '' });
export async function atlasBoard(back, play, reset) {
  const controls = [
    control('LTEXT', 'IDC_INTERNET_DIALOG_HEADER', 22, 14, 960, 25),
    control('GROUPBOX', 'UC_PANEL', 16, 48, 309, 618),
    control('GROUPBOX', 'UC_CHART', 335, 48, 649, 618),
    control('PUSHBUTTON', 'IDC_CANCEL_BUTTON', 20, 691, 132, 24),
    control('PUSHBUTTON', 'UC_DEFAULTS', 163, 691, 162, 24),
    control('PUSHBUTTON', 'IDC_PLAY_BUTTON', 777, 691, 205, 24)
  ];
  let dlg = await openDialog(staging, { ...nativeSkin, anchor: 0, size: { w: 1000, h: 735 }, controls }).catch(() => null);
  if (!dlg) {
    const veil = document.createElement('div'),
      el = document.createElement('div');
    veil.className = 'uc-window uc-atlas-fallback';
    el.className = 'dlg';
    veil.append(el);
    document.body.append(veil);
    const nodes = {};
    for (const c of controls) {
      const n = document.createElement(c.kind === 'PUSHBUTTON' ? 'button' : 'div');
      el.append(n);
      nodes[c.id] = n;
      Object.assign(n.style, { position: 'absolute', left: c.x / 10 + '%', top: c.y / 7.35 + '%', width: c.w / 10 + '%' });
    }
    dlg = {
      el,
      veil,
      ctl: id => nodes[id],
      setText: (id, t) => (nodes[id].textContent = t),
      on: (id, fn) => (nodes[id].onclick = fn),
      enable: (id, b) => (nodes[id].disabled = !b),
      close: () => veil.remove()
    };
  }
  const close = bindWindow(dlg, 'campaign', 'Universal Galactic Conquest', back);
  dlg.setText('IDC_INTERNET_DIALOG_HEADER', 'Galactic Conquest  /  Strategic planning');
  action(dlg, 'IDC_CANCEL_BUTTON', 'Back', back);
  action(dlg, 'UC_DEFAULTS', 'Reset settings', reset);
  action(dlg, 'IDC_PLAY_BUTTON', 'Start campaign', play);
  const panel = document.createElement('div'),
    chart = document.createElement('section'),
    status = document.createElement('div');
  panel.className = 'uc-atlas-sidebar';
  chart.className = 'uc-atlas-chart';
  status.className = 'uc-atlas-status';
  status.setAttribute('role', 'status');
  dlg.el.append(panel, chart, status);
  const title = document.createElement('header'),
    mapHost = document.createElement('div'),
    summary = document.createElement('div');
  chart.append(title, mapHost, summary);
  mapHost.className = 'uc-map-view';
  summary.className = 'uc-map-summary';
  const map = strategicPreview(mapHost);
  // Use the mounted dialog's combo texture rather than downloading other eras' UI atlases.
  skinImage('Combo_Box_Text_Box')
    .then(im => {
      if (im && dlg.el.isConnected) panel.style.setProperty('--uc-input', `url(${im.url})`);
    })
    .catch(() => {});
  const fields = new Map();
  function field(id, title) {
    let entry = fields.get(id);
    if (entry) return entry;
    const l = document.createElement('label'),
      caption = document.createElement('span'),
      select = document.createElement('select');
    caption.textContent = title;
    select.setAttribute('aria-label', title);
    select.dataset.field = id;
    l.append(caption, select);
    panel.append(l);
    entry = { l, select, caption };
    fields.set(id, entry);
    return entry;
  }
  return {
    el: dlg.veil,
    close,
    map,
    title,
    summary,
    status,
    panel,
    allow: b => enableAction(dlg, 'IDC_PLAY_BUTTON', b),
    hide: id => {
      const e = fields.get(id);
      if (e) e.l.hidden = true;
    },
    field: (id, label, rows, value, change) => {
      const { l, select, caption } = field(id, label);
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
    },
    focus: () => panel.querySelector('select')?.focus()
  };
}
