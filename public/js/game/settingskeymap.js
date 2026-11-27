import { el, action } from './commandui.js';
import { comboFrom, keyName, modifierOf, sameCombo } from './keybinds.js';

// Physical positions (KeyboardEvent.code), not characters typed using the current IME.
const letters = s => [...s].map(c => 'Key' + c).join(' ');
const rows = [
  'Escape:Esc _ F1 F2 F3 F4 _::0.5 F5 F6 F7 F8 _::0.5 F9 F10 F11 F12',
  'Backquote:` Digit1:1 Digit2:2 Digit3:3 Digit4:4 Digit5:5 Digit6:6 Digit7:7 Digit8:8 Digit9:9 Digit0:0 Minus:- Equal:= Backspace:⌫:2',
  `Tab:Tab:1.5 ${letters('QWERTYUIOP')} BracketLeft:[ BracketRight:] Backslash:\\:1.5`,
  `CapsLock:Caps:1.75 ${letters('ASDFGHJKL')} Semicolon:; Quote:' Enter:Enter:2.25`,
  `ShiftLeft:Shift:2.25 ${letters('ZXCVBNM')} Comma:, Period:. Slash:/ ShiftRight:Shift:2.75`,
  'ControlLeft:Ctrl:1.25 MetaLeft:OS:1.25 AltLeft:Alt:1.25 Space:Space:6.25 AltRight:Alt:1.25 MetaRight:OS:1.25 ContextMenu:Menu:1.25 ControlRight:Ctrl:1.25'
];
const navRows = [
  'PrintScreen:Prt ScrollLock:Scr Pause',
  'Insert:Ins Home PageUp:Pg↑',
  'Delete:Del End PageDown:Pg↓',
  '_ _ _',
  '_ ArrowUp:↑ _',
  'ArrowLeft:← ArrowDown:↓ ArrowRight:→'
];
const numRows = [
  '_',
  'NumLock:Num NumpadDivide:/ NumpadMultiply:* NumpadSubtract:-',
  'Numpad7:7 Numpad8:8 Numpad9:9 NumpadAdd:+:1:2',
  'Numpad4:4 Numpad5:5 Numpad6:6',
  'Numpad1:1 Numpad2:2 Numpad3:3 NumpadEnter:Enter:1:2',
  'Numpad0:0:2 NumpadDecimal:.'
];

export function keyboardMap(host, signal, getMappings, edit, chooseCommand) {
  const box = el('section', 'us-keymap'),
    bar = el('div', 'us-keybar'),
    board = el('div', 'us-board');
  const result = el('div', 'us-inspection'),
    heading = el('h3', '', 'Full-size keyboard');
  result.setAttribute('role', 'status');
  result.tabIndex = -1;
  const keys = new Map(),
    held = new Set();
  let selected = '',
    chord = '',
    testing = false,
    mappings = [],
    keyFocus;
  const tester = action(bar, 'Test keys', () => setTesting(!testing));
  tester.setAttribute('aria-pressed', 'false');
  const bed = el('div', 'us-keybed');
  board.append(bed);
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', 'Full-size 104-key keyboard');
  bar.prepend(heading);
  box.append(bar, board, result);
  host.prepend(box);
  // Quarter-unit columns preserve the stagger, wide modifiers and double-height keypad keys.
  function block(lines, units, name) {
    const block = el('div', 'us-keyblock');
    block.setAttribute('role', 'group');
    block.setAttribute('aria-label', name);
    block.style.gridTemplateColumns = `repeat(${units * 4}, minmax(0,1fr))`;
    for (const [i, line] of lines.entries()) {
      let end = 1;
      for (const token of line.split(' ')) {
        const [code, label = code.replace(/^Key/, ''), width = 1, height = 1] = token.split(':');
        const start = end;
        end += width * 4;
        if (code === '_') continue;
        const b = action(block, label, () => {
          rove(code);
          inspect(code);
        });
        b.dataset.code = code;
        b.tabIndex = -1;
        b.style.gridColumn = `${start} / ${end}`;
        b.style.gridRow = `${i === 0 ? 1 : i + 2} / span ${height}`;
        b.onfocus = () => rove(code);
        keys.set(code, b);
      }
    }
    bed.append(block);
  }
  block(rows, 15, 'Main keys');
  block(navRows, 3, 'Navigation keys');
  block(numRows, 4, 'Number pad');
  function rove(code) {
    if (keyFocus) keyFocus.tabIndex = -1;
    keyFocus = keys.get(code);
    keyFocus.tabIndex = 0;
  }
  rove('KeyW');
  function forKey(code) {
    const mod = modifierOf(code);
    return mappings.filter(m => m.combo.split('+').some(k => k === code || k === mod));
  }
  function inspect(code, combo = '') {
    selected = code;
    chord = combo;
    for (const [k, b] of keys) b.setAttribute('aria-pressed', String(k === code));
    result.replaceChildren();
    if (!code) {
      result.textContent = 'Select or press a key to see its commands.';
      return;
    }
    const matches = combo ? mappings.filter(m => sameCombo(m.combo, combo)) : forKey(code);
    result.append(el('strong', '', keyName(combo || code)));
    if (!matches.length) result.append(el('span', '', 'No mapped command'));
    for (const m of matches) {
      const label = `${m.context} · ${m.name}${!combo && m.combo !== code ? ` (${keyName(m.combo)})` : ''}`;
      if (m.fixed) result.append(el('span', '', label));
      else action(result, label, e => edit(m.action, e.currentTarget));
    }
    if (code === 'Escape' || modifierOf(code) === null) result.append(el('span', '', 'Reserved for menus or the operating system'));
    else action(result, 'Assign command…', e => chooseCommand(combo || code, e.currentTarget));
  }
  function refresh() {
    mappings = getMappings();
    for (const [k, b] of keys) {
      const commands = forKey(k);
      b.toggleAttribute('data-mapped', !!commands.length);
      b.title = [keyName(k), ...commands.map(m => `${m.context}: ${m.name}`)].join(' · ');
      b.setAttribute('aria-label', b.title);
    }
    inspect(selected, chord);
  }
  function clearHeld() {
    for (const k of held) keys.get(k)?.removeAttribute('data-held');
    held.clear();
  }
  function setTesting(on) {
    clearHeld();
    testing = on;
    tester.setAttribute('aria-pressed', String(on));
    tester.textContent = on ? 'Stop testing (Esc)' : 'Test keys';
    tester.focus({ preventScroll: true });
  }
  board.onkeydown = e => {
    const b = e.target.closest('button');
    if (!b || !['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    // Move in physical space, including across the two gaps between key clusters.
    const horizontal = ['ArrowRight', 'ArrowLeft'].includes(e.key),
      forward = ['ArrowRight', 'ArrowDown'].includes(e.key);
    const axes = key => {
      const r = key.getBoundingClientRect();
      return horizontal ? [r.left, r.right, r.top, r.bottom] : [r.top, r.bottom, r.left, r.right];
    };
    const [a, bound, lo, hi] = axes(b);
    let target,
      best = Infinity;
    for (const key of keys.values()) {
      const [l, r, t, u] = axes(key),
        distance = forward ? l - bound : a - r;
      if (distance < -0.5 || t >= hi || u <= lo) continue;
      const score = distance + Math.abs(t + u - lo - hi) / 4;
      if (score < best) {
        target = key;
        best = score;
      }
    }
    if (target) {
      target.focus();
      inspect(target.dataset.code);
    }
  };
  const dialog = host.closest('.universal-settings');
  dialog.addEventListener(
    'keydown',
    e => {
      if (
        !e.code ||
        e.repeat ||
        e.isComposing ||
        e.target.closest('dialog') !== dialog ||
        e.target.closest('input,select,textarea,[contenteditable=true]')
      )
        return;
      if (testing && e.code === 'Escape') {
        e.preventDefault();
        setTesting(false);
        return;
      }
      if (!testing && (['Tab', 'Enter', 'Space', 'Escape', 'Home', 'End'].includes(e.code) || e.code.startsWith('Arrow'))) return;
      if (testing) e.preventDefault();
      held.add(e.code);
      keys.get(e.code)?.setAttribute('data-held', '');
      const codes = [...held].filter(k => modifierOf(k) === ''),
        mods = [...held].map(modifierOf).filter(Boolean);
      inspect(e.code, codes.length && held.size > 1 ? comboFrom(mods, codes) : '');
    },
    { signal }
  );
  dialog.addEventListener(
    'keyup',
    e => {
      held.delete(e.code);
      keys.get(e.code)?.removeAttribute('data-held');
    },
    { signal }
  );
  // A click/Tab away from the tester restores normal navigation; a lost keyup never leaves a key lit.
  tester.addEventListener('blur', () => {
    if (testing) {
      testing = false;
      tester.setAttribute('aria-pressed', 'false');
      tester.textContent = 'Test keys';
      clearHeld();
    }
  });
  window.addEventListener('blur', clearHeld, { signal });
  refresh();
  return refresh;
}
