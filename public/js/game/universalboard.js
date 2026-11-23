// One stable, three-column layout across packs: roster, briefing and command settings.
// Geometry is Universal's. Frames, typography, lists, sliders and button art resolve in the selected VFS.
import { loadDialogs, openDialog } from './dialogs.js';
import { staging, nativeSkin } from './universaldialog.js';
const c = (kind, id, x, y, w, h, extra = {}) => ({ kind, id, x, y, w, h, text: '', style: '', ...extra });
const text = (id, x, y, w, h = 20) => c('LTEXT', id, x, y, w, h);
const combo = (id, x, y, w, h = 126) => c('COMBOBOX', id, x, y, w, h);
const box = (id, x, y, w, h) => c('GROUPBOX', id, x, y, w, h);
const button = (id, x, y, w) => c('PUSHBUTTON', id, x, y, w, 24);
const advancedSlots = [
  ['IDC_SKIRMISH_CREDITS_SLIDER', 'Starting credits'],
  ['IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER', 'Starting tech'],
  ['IDC_SKIRMISH_MAX_TECH_LEVEL_SLIDER', 'Maximum tech'],
  ['IDC_ALLOW_AUTORESOLVE_COMBO', 'Auto-resolve']
];
const advancedID = 'IDD_CAMPAIGN_ADVANCED_OPTIONS_DIALOG';
export async function openBoard() {
  const defs = (await loadDialogs().catch(() => null))?.dialogs;
  const stage = defs?.get(staging),
    adv = defs?.get(advancedID);
  const has = (d, id) => d?.controls.some(c => c.id === id);
  const advanced = has(stage, 'IDC_SELECT_OPTIONS')
    ? advancedSlots.filter(([id]) =>
        adv?.controls.some(
          c =>
            c.id === id &&
            (id.endsWith('_COMBO') ? c.kind === 'COMBOBOX' : c.kind === 'CONTROL' && /trackbar/i.test(c.cls) && !/TBS_VERT/.test(c.style))
        )
      )
    : [];
  const years = !!advanced.length && adv.controls.some(c => /^TEXT_ERA_\d+$/.test(c.text));
  const legend = years
    ? adv.controls
        .filter(c => c.kind === 'LTEXT' && c.id !== 'IDC_INTERNET_DIALOG_HEADER' && c.text && !/^(TEXT_|[=\s]+$)/.test(c.text))
        .map(c => c.text.trim())
        .join('\n')
    : '';
  const controls = [
    text('IDC_INTERNET_DIALOG_HEADER', 28, 18, 510, 28),
    text('UC_PERIOD', 551, 24, 419),
    text('UC_ERAS_TITLE', 28, 64, 309),
    c('LISTBOX', 'UC_STORIES', 26, 86, 311, 158),
    text('UC_FACTION_TITLE', 28, 259, 310),
    combo('IDC_FACTION_COMBO', 26, 281, 311, 150),
    text('UC_MAP_TITLE', 28, 323, 310),
    c('LISTBOX', 'IDC_STAGING_MAP_LIST', 26, 346, 311, 270),
    text('UC_BRIEF_TITLE', 354, 64, 300),
    box('UC_BRIEF_FRAME', 351, 86, 300, 530),
    text('IDC_CAMPAIGN_DESCRIPTION', 362, 308, 278, 294),
    c('CONTROL', 'IDC_IMAGE', 362, 99, 278, 192, { cls: 'PETROGLYPH_DIALOG_IMAGE' }),
    text('UC_RULE_TITLE', 672, 64, 310),
    box('UC_RULE_FRAME', 666, 86, 308, 299),
    text('UC_DIFFICULTY_TITLE', 677, 97, 280),
    combo('UC_DIFFICULTY', 676, 116, 287),
    text('UC_PRESET_TITLE', 677, 151, 280),
    combo('UC_PRESET', 676, 171, 287),
    text('UC_TREASURY_TITLE', 677, 205, 280),
    combo('UC_TREASURY', 676, 225, 287),
    text('UC_POLITICS_TITLE', 677, 260, 280),
    combo('UC_POLITICS', 676, 280, 287),
    text('UC_PATH_TITLE', 677, 315, 280),
    combo('UC_PATH', 676, 335, 287),
    text('UC_ADV_TITLE', 672, 400, 298),
    box('UC_ADV_FRAME', 666, 424, 308, 192),
    text('UC_FIXED', 678, 445, 280, 118),
    text('UC_STATUS', 30, 635, 935, 45),
    button('IDC_CANCEL_BUTTON', 26, 690, 162),
    button('UC_DEFAULTS', 401, 690, 198),
    button('IDC_PLAY_BUTTON', 770, 690, 204)
  ];
  advanced.forEach(([id], i) => {
    const y = 435 + i * 44;
    controls.push(text(id + '_LABEL', 678, y, 210));
    if (id.endsWith('_SLIDER'))
      controls.push(
        text(id.replace('_SLIDER', '_VALUE'), 893, y, 66),
        c('CONTROL', id, 678, y + 19, 279, 14, { cls: 'msctls_trackbar32' })
      );
    else controls.push(combo(id, 678, y + 17, 279, 73));
  });
  if (years) controls.push(text('UC_YEAR_LEGEND', 678, 488, 278, 119));
  const dlg = stage && (await openDialog(staging, { ...nativeSkin, anchor: 0, size: { w: 1000, h: 738 }, controls }).catch(() => null));
  return { dlg: dlg || plainBoard(controls), advanced, years, legend, hasPreview: has(stage, 'IDC_IMAGE') };
}
// A missing RC/skin must not reintroduce a wizard. Keep the same controls and handlers in a scrolling dialog.
function plainBoard(controls) {
  const veil = document.createElement('dialog'),
    nodes = new Map();
  veil.className = 'era-panel uc-plain-board';
  document.body.append(veil);
  veil.showModal();
  veil.oncancel = e => e.preventDefault();
  for (const c of controls) {
    if (c.kind === 'GROUPBOX') continue;
    const tag = {
      LISTBOX: 'select',
      COMBOBOX: 'select',
      PUSHBUTTON: 'button',
      LTEXT: 'div',
      CONTROL: c.cls?.includes('trackbar') ? 'input' : 'div'
    }[c.kind];
    const el = document.createElement(tag);
    if (tag === 'input') {
      el.type = 'range';
      el.min = 0;
      el.max = 1;
      el.step = 'any';
    }
    if (c.kind === 'LISTBOX') el.size = 6;
    el.dataset.id = c.id;
    nodes.set(c.id, el);
    veil.append(el);
  }
  function fill(id, rows, value, change) {
    const e = nodes.get(id);
    if (!e) return;
    e.replaceChildren(...rows.map(r => new Option(r.label, r.value)));
    e.value = value;
    e.onchange = () => change(e.value);
    return {
      set: v => {
        e.value = v;
      }
    };
  }
  return {
    veil,
    ctl: id => nodes.get(id),
    setText: (id, t) => {
      const e = nodes.get(id);
      if (e) e.textContent = t;
    },
    show: (id, b) => {
      const e = nodes.get(id);
      if (e) e.hidden = !b;
    },
    enable: (id, b) => {
      const e = nodes.get(id);
      if (e) e.disabled = !b;
    },
    on: (id, fn) => nodes.get(id)?.addEventListener('click', fn),
    close: () => {
      veil.close();
      veil.remove();
    },
    combo: fill,
    list: (id, rows, pick) => {
      const s = fill(
        id,
        rows.map(r => ({ value: r.key, label: r.label })),
        '',
        v => pick(rows.find(r => r.key === v))
      );
      return {
        select: k => {
          const r = rows.find(r => r.key === k);
          if (r) {
            s.set(k);
            pick(r);
          }
        },
        selected: () => rows.find(r => r.key === nodes.get(id).value)
      };
    },
    slider: (id, v, change, steps) => {
      const e = nodes.get(id);
      if (e) {
        e.step = steps > 1 ? 1 / (steps - 1) : 'any';
        e.value = v;
        e.oninput = () => change(+e.value);
      }
    },
    check() {},
    setImage: (id, url) => {
      nodes.get(id).style.backgroundImage = `url(${url})`;
    }
  };
}
// Bind arrows as well as the mounted skin's mouse dropdown. Rebinding does not append handlers.
export function boardCombo(dlg, id, label, rows, value, change) {
  const el = dlg.ctl(id);
  if (!el) return;
  const combo = dlg.combo(id, rows, value, change);
  el.setAttribute('aria-label', label);
  el.dataset.value = String(value);
  if (el.tagName === 'SELECT') return;
  el.setAttribute('role', 'combobox');
  el.tabIndex = 0;
  el.onkeydown = e => {
    const i = rows.findIndex(r => String(r.value) === el.dataset.value),
      step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !rows.length) return;
    e.preventDefault();
    const v = rows[Math.max(0, Math.min(rows.length - 1, i + step))].value;
    combo.set(v);
    el.dataset.value = String(v);
    change(v);
  };
}
