// Universal adds two pages to the game's dialog system. Skin, sprites and fonts always come from
// the current VFS; control coordinates below describe new pages, not copies of mod resources.
import { openDialog } from './dialogs.js';

export const staging = 'IDD_CUSTOM_CAMPAIGN_STAGING_DIALOG';
const advanced = 'IDD_CAMPAIGN_ADVANCED_OPTIONS_DIALOG';
const left = 'IDC_STAGING_MAP_LIST',
  right = 'UC_VALUES',
  description = 'IDC_CAMPAIGN_DESCRIPTION',
  title = 'IDC_INTERNET_DIALOG_HEADER';
const control = (kind, id, x, y, w, h) => ({ kind, id, x, y, w, h, style: '', text: '' });
const layout = [
  control('LTEXT', title, 36, 22, 786, 30),
  control('LTEXT', 'UC_CONTEXT', 36, 57, 786, 30),
  control('LTEXT', 'UC_LEFT', 36, 106, 273, 24),
  control('LTEXT', 'UC_RIGHT', 331, 106, 488, 24),
  control('LISTBOX', left, 34, 133, 274, 174),
  control('LISTBOX', right, 329, 133, 492, 174),
  control('GROUPBOX', 'UC_BRIEF', 34, 324, 787, 122),
  control('LTEXT', description, 52, 339, 750, 95),
  control('PUSHBUTTON', 'IDC_CANCEL_BUTTON', 34, 464, 190, 24),
  control('PUSHBUTTON', 'IDC_PLAY_BUTTON', 631, 464, 190, 24)
];
export const nativeSkin = { modal: true, nativeImages: true, nativeLists: true, nativeFonts: true, cls: 'uc-window' };
export function action(dlg, id, label, fn) {
  const el = dlg.ctl(id);
  if (!el) return;
  if (label) {
    dlg.setText(id, label);
    el.setAttribute('aria-label', label);
  }
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  };
  dlg.on(id, () => {
    if (!el.classList.contains('off')) fn();
  });
}
export function enableAction(dlg, id, on) {
  dlg.enable(id, on);
  dlg.ctl(id).tabIndex = on ? 0 : -1;
  dlg.ctl(id).setAttribute('aria-disabled', String(!on));
}
export function bindWindow(dlg, screen, name, back) {
  const el = dlg.veil;
  el.dataset.universalScreen = screen;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', name);
  const escape = e => {
    if (e.key !== 'Escape' || el.hidden || el.inert || !el.isConnected) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    back();
  };
  addEventListener('keydown', escape, true);
  return () => {
    removeEventListener('keydown', escape, true);
    dlg.close();
  };
}
export function choices(dlg, id, label, rows, initial, pick) {
  const el = dlg.ctl(id),
    list = dlg.list(id, rows, pick);
  el.tabIndex = 0;
  el.setAttribute('aria-label', label);
  el.onkeydown = e => {
    if (!rows.length) return;
    const i = rows.indexOf(list.selected());
    const n = { ArrowDown: Math.min(rows.length - 1, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: rows.length - 1 }[e.key];
    if (n == null) return;
    e.preventDefault();
    e.stopPropagation();
    list.select(rows[n].key);
    el.focus();
  };
  if (initial !== undefined) list.select(initial);
}
// Text-only recovery for an incomplete local skin. Shares selection and launch logic with the native screen.
function plainSheet() {
  const veil = document.createElement('dialog');
  veil.className = 'era-panel uc-fallback';
  veil.innerHTML =
    '<h2></h2><p></p><section></section><section></section><p role="status"></p><footer><button>Back</button><button>Continue</button></footer>';
  document.body.append(veil);
  veil.showModal();
  veil.oncancel = e => e.preventDefault();
  const [a, b] = veil.querySelectorAll('section'),
    [prev, next] = veil.querySelectorAll('button');
  for (const s of [a, b]) s.append(document.createElement('label'), document.createElement('select'));
  const nodes = {
    [title]: veil.querySelector('h2'),
    UC_CONTEXT: veil.querySelector('p'),
    UC_LEFT: a.firstChild,
    UC_RIGHT: b.firstChild,
    [left]: a.lastChild,
    [right]: b.lastChild,
    [description]: veil.querySelector('[role=status]'),
    IDC_CANCEL_BUTTON: prev,
    IDC_PLAY_BUTTON: next
  };
  return {
    veil,
    ctl: id => nodes[id],
    setText: (id, text) => {
      nodes[id].textContent = text;
    },
    on: (id, fn) => nodes[id].addEventListener('click', fn),
    close: () => {
      veil.close();
      veil.remove();
    },
    enable: (id, on) => {
      nodes[id].disabled = !on;
    },
    list: (id, rows, pick) => {
      const s = nodes[id];
      s.replaceChildren(...rows.map(r => new Option(r.label, String(r.key))));
      s.onchange = () => {
        if (s.selectedIndex >= 0) pick(rows[s.selectedIndex]);
      };
      return {
        select: k => {
          const i = rows.findIndex(r => r.key === k);
          if (i >= 0) {
            s.selectedIndex = i;
            s.onchange();
          }
        },
        selected: () => rows[s.selectedIndex]
      };
    }
  };
}
export async function openChoiceSheet({ screen, heading, context, section, backLabel = 'Back', nextLabel = 'Continue', back, next }) {
  const dlg =
    (await openDialog(screen === 'rules' ? advanced : staging, {
      ...nativeSkin,
      anchor: 0,
      size: { w: 855, h: 515 },
      controls: layout
    }).catch(() => null)) || plainSheet();
  const close = bindWindow(dlg, screen, heading, back);
  dlg.setText(title, heading);
  dlg.setText('UC_CONTEXT', context);
  dlg.setText('UC_LEFT', section);
  dlg.ctl(description).setAttribute('aria-live', 'polite');
  action(dlg, 'IDC_CANCEL_BUTTON', backLabel, back);
  action(dlg, 'IDC_PLAY_BUTTON', nextLabel, next);
  return {
    close,
    el: dlg.veil,
    info: text => dlg.setText(description, text),
    context: text => dlg.setText('UC_CONTEXT', text),
    sections: (rows, key, pick) => choices(dlg, left, section, rows, key, pick),
    values: (label, rows, key, pick) => {
      dlg.setText('UC_RIGHT', label);
      choices(dlg, right, label, rows, key, pick);
    },
    allow: on => enableAction(dlg, 'IDC_PLAY_BUTTON', on),
    focus: () => dlg.ctl(left).focus()
  };
}
