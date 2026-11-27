import { mapHeading } from './universalmapheading.js';

// The three solo setup screens share navigation, not launch state. The mode owns
// the selection, preview, validation and the exact setup handed to the game.
export function element(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function action(text, fn, cls = '') {
  const b = element('button', `op-action ${cls}`, text);
  b.type = 'button';
  b.onclick = fn;
  return b;
}

export function field(label, options, value, change) {
  const wrap = element('label', 'op-field');
  const select = element('select');
  for (const [key, text] of options) select.add(new Option(text, key));
  select.value = value;
  select.onchange = () => change(select.value);
  wrap.append(element('span', '', label), select);
  return wrap;
}

export function operationSetup({ title, library, scene = 'fleet', profiles, back, launch, launchLabel = 'Start battle' }) {
  const root = element('section', 'op-setup');
  root.dataset.scene = scene;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', title);
  const panel = element('div', 'op-panel');
  const body = element('div', 'op-body');
  const sidebar = element('section', 'op-library');
  const tools = element('div', 'op-tools');
  const list = element('div', 'op-list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', library);
  sidebar.append(tools, list);
  const detail = element('section', 'op-detail');
  body.append(sidebar, detail);
  const foot = element('footer', 'op-foot');
  const status = element('div', 'op-status');
  status.setAttribute('role', 'status');
  const go = action(launchLabel, launch, 'op-go');
  foot.append(status, go);
  const canvas = element('div', 'uc-canvas op-galaxy');
  const exit = mapHeading(canvas, title, back);
  const rail = element('div', 'uc-panel op-rail');
  const scroll = element('div', 'uc-content');
  scroll.append(body);
  rail.append(scroll, foot);
  panel.append(canvas, rail);
  root.append(panel);
  root.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.target.closest('#armyPainter, .dyn-seed-input')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      back();
    } else if (e.key === 'Tab') {
      const controls = [...root.querySelectorAll('button:enabled, select:enabled, input:enabled, [tabindex="0"]')].filter(
        el => el.getClientRects().length && !el.closest('[inert]')
      );
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey ? e.target === first : e.target === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    }
  });
  const focus = () => {
    const row = list.querySelector('[aria-pressed="true"]') || list.querySelector('button:enabled');
    if (row) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    (row || exit).focus({ preventScroll: true });
  };
  const ui = { root, panel, canvas, body, tools, list, detail, foot, status, exit, go, focus };
  profiles?.(ui);
  return ui;
}

export function choice(text, selected, pick, caption = '') {
  const row = action('', pick, 'op-choice');
  row.setAttribute('aria-pressed', String(selected));
  row.append(element('span', 'op-choice-name', text));
  if (caption) row.append(element('small', '', caption));
  return row;
}

export function markChoice(list, current) {
  for (const row of list.children) row.setAttribute('aria-pressed', String(row === current));
}
