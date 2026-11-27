import { el, option } from './commandui.js';
import { tabPanels } from './playtabs.js';

export function categories(panel, label, names, { horizontal = false } = {}) {
  const shell = el('div', horizontal ? 'us-sections' : 'us-split'),
    rail = el('div', horizontal ? 'us-subnav' : 'us-rail'),
    main = el('div', 'us-config');
  shell.append(rail, main);
  panel.append(shell);
  const entries = names.map(label => ({ key: label.toLowerCase().replaceAll(' ', '-'), label }));
  tabPanels(rail, entries, entries[0].key, () => {}, {
    prefix: 'us-' + label.toLowerCase(),
    label: label + ' categories',
    panelClass: 'us-subpanel',
    vertical: !horizontal,
    retain: true,
    panelRoot: main
  });
  return { main, pages: Object.fromEntries(names.map((name, i) => [name, main.children[i]])) };
}

// A label, its live control and (for ranges) the value it represents share one row.
export function group(parent, name) {
  const g = el('fieldset', 'us-group');
  g.append(el('legend', '', name));
  parent.append(g);
  return g;
}
export function row(parent, name, control, tip) {
  const label = el('label', 'us-row');
  if (tip) label.title = tip;
  label.append(el('span', 'us-label', name), control);
  parent.append(label);
  return control;
}
export function check(parent, name, value, change, tip) {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = value;
  input.onchange = () => change(input.checked);
  return row(parent, name, input, tip);
}
export function slider(parent, name, value, min, max, step, change, format = String, tip) {
  const input = el('input'),
    box = el('span', 'us-slider'),
    readout = el('span', 'us-value');
  input.type = 'range';
  Object.assign(input, { min, max, step, value });
  input.setAttribute('aria-label', name);
  readout.ariaHidden = 'true';
  const show = () => {
    readout.textContent = format(input.valueAsNumber);
    input.setAttribute('aria-valuetext', readout.textContent);
  };
  input.oninput = () => {
    show();
    change(input.valueAsNumber);
  };
  show();
  box.append(input, readout);
  row(parent, name, box, tip);
  return input;
}
export function integer(parent, name, value, min, max, save, tip) {
  const input = el('input');
  Object.assign(input, { type: 'number', min, max, step: 1, required: true, value });
  input.onchange = () => {
    if (input.validity.valid && Number.isSafeInteger(input.valueAsNumber)) {
      value = input.valueAsNumber;
      save(value);
    } else {
      input.reportValidity();
      input.value = value;
    }
  };
  return row(parent, name, input, tip);
}
export function select(parent, name, choices, value, change) {
  const input = el('select');
  for (const [key, label] of choices) option(input, key, label);
  input.value = value;
  input.onchange = () => change(input.value);
  return row(parent, name, input);
}
export const percent = v => Math.round(v * 100) + '%';
export function remember(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}
export function flag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
