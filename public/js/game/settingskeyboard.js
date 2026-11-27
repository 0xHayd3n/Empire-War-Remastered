import {
  ACTIONS,
  bindingContext,
  bothButtonsRotate,
  setBothButtonsRotate,
  edgePan,
  setEdgePan,
  MAX_KEYS,
  bindings,
  setBindings,
  defaultBindings,
  modifierOf,
  comboFrom,
  sameCombo,
  keyName,
  keyNames,
  actionName
} from './keybinds.js';
import { el, action, option } from './commandui.js';
import { categories, group, check } from './settingsfields.js';
import { battlefrontFields } from './settingsbattlefront.js';
import { keyboardMap } from './settingskeymap.js';
import { cameraOptions, spaceOrderOptions, touchOptions, unitCameraOptions } from './settingsview.js';
import { replayControls } from './settingstweaks.js';

export function controlsTab(panel, game, signal) {
  const { main, pages } = categories(panel, 'Controls', ['General', 'Interface', 'Communication', 'Spectate', 'Replay']);
  cameraOptions(pages.General);
  touchOptions(pages.General);
  unitCameraOptions(pages.General);
  spaceOrderOptions(pages.General);
  battlefrontFields(pages.General, game, 'controls', 'Battlefront aiming');
  const work = bindings(),
    buttons = new Map();
  const name = id => {
    const n = actionName(id);
    return n.startsWith('TEXT_') ? id.toLowerCase().replaceAll('_', ' ') : n;
  };
  const mappings = () =>
    ACTIONS.flatMap(a =>
      work[a.id].flatMap(combo => {
        const entry = { combo, action: a, name: name(a.id), context: bindingContext(a.id) };
        if (a.id.startsWith('GROUP_') && !combo.includes('+'))
          return [entry, { ...entry, combo: 'Ctrl+' + combo, name: 'Assign group ' + a.id.slice(6), fixed: true }];
        return [entry];
      })
    );
  // A player with a compact keyboard can still assign a full-size key by clicking it.
  function chooseCommand(combo, trigger) {
    const picker = el('select'),
      form = el('div', 'us-actions');
    picker.setAttribute('aria-label', 'Command to bind');
    option(picker, '', 'Choose a command…');
    for (const a of ACTIONS) option(picker, a.id, `${bindingContext(a.id)} · ${name(a.id)}`);
    form.append(picker);
    const use = action(form, 'Edit binding', () =>
      editor(
        ACTIONS.find(a => a.id === picker.value),
        use,
        combo
      )
    );
    use.disabled = true;
    picker.onchange = () => {
      use.disabled = !picker.value;
    };
    trigger.replaceWith(form);
    picker.focus();
  }
  const refreshMap = keyboardMap(main, signal, mappings, editor, chooseCommand);
  function paint() {
    refreshMap();
    for (const [id, b] of buttons) {
      b.textContent = work[id].length ? keyNames(work[id]) : 'Unassigned';
      b.setAttribute('aria-label', `${name(id)}: ${b.textContent}`);
    }
    for (const filter of main.querySelectorAll('.us-search')) if (filter.value) filter.oninput();
  }
  function editor(a, trigger = buttons.get(a.id), candidate = null) {
    const d = el('dialog', 'us-editor');
    d.setAttribute('aria-labelledby', 'us-command');
    const title = el('h2', '', name(a.id));
    title.id = 'us-command';
    d.append(title, el('p', '', `Current: ${keyNames(work[a.id])}`));
    const prompt = el('p', 'us-record');
    prompt.setAttribute('role', 'status');
    const foot = el('div', 'us-actions');
    d.append(prompt, foot);
    panel.append(d);
    const close = () => {
      d.close();
      d.remove();
      (trigger.isConnected && !trigger.closest('[hidden]') ? trigger : main.querySelector('.us-inspection')).focus({ preventScroll: true });
    };
    let listening, mods, codes, held, combo;
    const save = (add, conflicts = []) => {
      for (const other of conflicts) work[other.id] = work[other.id].filter(k => !sameCombo(k, combo));
      work[a.id] = combo ? (add ? [...work[a.id], combo] : [combo]) : [];
      setBindings(work);
      paint();
      close();
    };
    function accept(add) {
      const conflicts = ACTIONS.filter(
        o => o !== a && bindingContext(o.id) === bindingContext(a.id) && work[o.id].some(k => sameCombo(k, combo))
      );
      if (!conflicts.length) return save(add);
      prompt.textContent = `${keyName(combo)} is assigned to ${conflicts.map(o => name(o.id)).join(', ')}. Reassign it to ${name(a.id)}?`;
      foot.replaceChildren();
      action(foot, 'Cancel', close).focus();
      action(foot, 'Reassign', () => save(add, conflicts));
    }
    function record() {
      listening = true;
      mods = [];
      codes = [];
      held = new Set();
      combo = null;
      prompt.textContent = 'Hold a shortcut, then release. Esc cancels.';
      controls();
      d.focus();
    }
    function controls() {
      foot.replaceChildren();
      const set = action(foot, 'Set', () => accept(false));
      set.disabled = !combo || listening;
      action(foot, 'Add', () => accept(true)).disabled =
        set.disabled || !work[a.id].length || work[a.id].length >= MAX_KEYS || work[a.id].some(k => sameCombo(k, combo));
      if (!listening) action(foot, 'Record again', record);
      action(foot, 'Unset', () => {
        combo = null;
        save(false);
      }).disabled = !work[a.id].length;
      action(foot, 'Cancel', close);
      return set;
    }
    d.tabIndex = -1;
    d.oncancel = e => {
      e.preventDefault();
      close();
    };
    d.onkeydown = e => {
      e.stopPropagation();
      if (!listening || e.code === 'Escape') return;
      e.preventDefault();
      const mod = modifierOf(e.code);
      if (e.repeat || !e.code || mod === null || e.metaKey) return;
      held.add(e.code);
      if (mod) {
        if (!mods.includes(mod)) mods.push(mod);
      } else if (codes.length < 4 && !codes.includes(e.code)) codes.push(e.code);
      if (codes.length) prompt.textContent = keyName(comboFrom(mods, codes));
    };
    d.onkeyup = e => {
      e.stopPropagation();
      if (!listening || !held.has(e.code)) return;
      e.preventDefault();
      held.delete(e.code);
      if (held.size) return;
      // A single modifier key (e.g. left Shift for sprint) is a physical binding too.
      if (!codes.length) {
        codes.push(e.code);
        mods = [];
      }
      combo = comboFrom(mods, codes);
      prompt.textContent = `New shortcut: ${keyName(combo)}`;
      listening = false;
      controls().focus();
    };
    d.showModal();
    if (candidate) {
      combo = candidate;
      listening = false;
      prompt.textContent = `New shortcut: ${keyName(combo)}`;
      controls().focus();
    } else record();
  }
  const sections = new Map();
  for (const a of ACTIONS) {
    const context = bindingContext(a.id);
    const category =
      context === 'Spectate'
        ? 'Spectate'
        : ['INITIATE_CHAT', 'PLACE_BEACON'].includes(a.id)
          ? 'Communication'
          : a.page === 3 || /^(ROTATE_|TILT_|TOGGLE_HUD|DIRECT_VIEW|SQUAD_CAM)/.test(a.id)
            ? 'Interface'
            : 'General';
    const section =
      context === 'Battlefront'
        ? context
        : {
            General: 'Game commands',
            Interface: 'Camera and interface',
            Communication: 'Team communication',
            Spectate: 'Spectator commands'
          }[category];
    if (!sections.has(section)) {
      const g = group(pages[category], section);
      const list = el('div', 'us-bindings');
      g.append(list);
      sections.set(section, list);
    }
    const line = el('div', 'us-row');
    line.append(el('span', 'us-label', name(a.id)));
    const b = action(line, '', () => editor(a));
    sections.get(section).append(line);
    buttons.set(a.id, b);
  }
  paint();
  for (const [category, page] of Object.entries(pages)) {
    const groups = [...page.querySelectorAll('.us-group:has(.us-bindings)')];
    if (!groups.length) continue;
    const filter = el('input', 'us-search');
    filter.type = 'search';
    filter.placeholder = 'Find a command…';
    filter.setAttribute('aria-label', `Find a command in ${category}`);
    const empty = el('p', '', 'No matching commands.');
    empty.hidden = true;
    page.prepend(filter, empty);
    const search = () => {
      const term = filter.value.trim().toLowerCase();
      for (const g of groups) {
        for (const line of g.querySelectorAll('.us-row')) line.hidden = !line.textContent.toLowerCase().includes(term);
        g.hidden = !g.querySelector('.us-row:not([hidden])');
      }
      empty.hidden = groups.some(g => !g.hidden);
    };
    filter.oninput = search;
  }
  const mouse = group(pages.General, 'Mouse');
  check(mouse, 'Rotate with both mouse buttons', bothButtonsRotate(), setBothButtonsRotate);
  check(mouse, 'Pan the camera at the screen edges', edgePan(), setEdgePan);
  replayControls(pages.Replay);
  const restore = action(
    main,
    'Restore keyboard defaults',
    () => {
      const d = el('dialog', 'us-editor');
      d.setAttribute('aria-label', 'Restore keyboard defaults?');
      d.append(el('h2', '', 'Restore keyboard defaults?'), el('p', '', 'This replaces all custom shortcuts.'));
      const foot = el('div', 'us-actions');
      d.append(foot);
      panel.append(d);
      const close = () => {
        d.close();
        d.remove();
        restore.focus();
      };
      action(foot, 'Cancel', close);
      action(foot, 'Restore defaults', () => {
        Object.assign(work, defaultBindings());
        setBindings(work);
        paint();
        close();
      });
      d.oncancel = e => {
        e.preventDefault();
        close();
      };
      d.showModal();
    },
    'us-secondary'
  );
}
