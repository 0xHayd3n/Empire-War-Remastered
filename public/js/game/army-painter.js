import * as THREE from 'three';
import { db, factionColor } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { DeployPreview } from './deploy-preview.js';
import { painterFactions, painterRoster, displayName } from './painter-roster.js';
import { PATTERNS, MAX_LIVERIES, NAME_LIMIT, factionLiveries, saveLivery, deleteLivery, equipStock } from './liveries.js';

const channels = ['Primary', 'Secondary', 'Trim', 'Detail'];
const NEW = ':draft';
const markup = `
  <div class="ap-layout">
    <header class="ap-heading"><small>Faction markings</small><h1 id="ap-title">Army Painter</h1></header>
    <section class="ap-controls" aria-label="Paint controls">
      <label class="ap-field">Faction<select id="ap-faction" autofocus></select></label>
      <label class="ap-field" for="ap-unit">Preview unit</label>
      <div class="ap-row"><button id="ap-prev" aria-label="Previous unit">‹</button><select id="ap-unit"></select><button id="ap-next" aria-label="Next unit">›</button></div>
      <label class="ap-field" for="ap-preset">Livery</label>
      <div class="ap-row"><select id="ap-preset"></select><button id="ap-new" title="Create livery" aria-label="Create livery">+</button><button id="ap-remove" title="Delete livery" aria-label="Delete livery"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 10v7m4-7v7"/></svg></button></div>
      <label class="ap-name" hidden>Livery name<input id="ap-name" type="text" autocomplete="off" spellcheck="false"></label>
      <fieldset><legend>Materials</legend><div class="ap-materials"></div></fieldset>
      <fieldset><legend>Pattern</legend><div class="ap-patterns"></div></fieldset>
    </section>
    <figure class="ap-stage"><div class="ap-model" role="img"></div><figcaption><button class="ap-turn" title="Rotate the preview by 45 degrees" disabled>Rotate unit ↻</button><small class="ap-domain"></small><h2 class="ap-unit-name"></h2><span class="ap-art-state" role="status"></span></figcaption></figure>
    <footer><button id="ap-back">Back</button><p class="ap-status" role="status"></p><button id="ap-save">Save &amp; equip</button></footer>
  </div>`;

export function openArmyPainter({ faction: initial, factions = painterFactions(), owner = document.body, alternate = null } = {}) {
  if (document.querySelector('#armyPainter[open]')) return Promise.resolve(false);
  const d = document.createElement('dialog');
  d.id = 'armyPainter';
  d.setAttribute('aria-labelledby', 'ap-title');
  d.innerHTML = markup;
  owner.append(d);
  const $ = s => d.querySelector(s);
  const fac = $('#ap-faction'),
    units = $('#ap-unit'),
    presets = $('#ap-preset'),
    name = $('#ap-name'),
    add = $('#ap-new'),
    remove = $('#ap-remove'),
    save = $('#ap-save'),
    status = $('.ap-status'),
    host = $('.ap-model');
  name.maxLength = NAME_LIMIT;
  let faction = factions.includes(initial) ? initial : factions.find(f => /^empire$/i.test(f)) || factions[0];
  let roster = [],
    state,
    id = '',
    paint,
    dirty = false,
    changed = false,
    frame = 0,
    stamp = 0,
    serial = 0;
  let finished;
  const result = new Promise(resolve => {
    finished = resolve;
  });
  const opener = document.activeElement;
  d.showModal();
  const preview = new DeployPreview(host);
  $('.ap-turn').onclick = () => preview.turn(Math.PI / 4);
  // Native confirm() is suppressed in cross-origin Universal game frames.
  function ask(message, verb, accept) {
    const dialog = document.createElement('dialog');
    dialog.className = 'ap-confirm';
    dialog.setAttribute('aria-label', message);
    const question = document.createElement('p'),
      no = document.createElement('button'),
      yes = document.createElement('button');
    question.textContent = message;
    no.textContent = 'Cancel';
    yes.textContent = verb;
    dialog.append(question, no, yes);
    d.append(dialog);
    no.onclick = () => dialog.close();
    yes.onclick = () => {
      dialog.close();
      accept();
    };
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
  }
  const guard = run => (dirty ? ask('Discard unsaved livery changes?', 'Discard', run) : run());
  const close = () => guard(() => d.close());
  d.oncancel = e => {
    e.preventDefault();
    close();
  };
  $('#ap-back').onclick = close;
  if (alternate) {
    const button = document.createElement('button');
    button.textContent = alternate;
    button.onclick = () => guard(() => d.close('alternate'));
    $('#ap-back').after(button);
  }
  // Keep attract-mode and lobby hotkeys out of text editing and native selects.
  d.onkeydown = d.onkeyup = e => e.stopPropagation();
  const dispose = () => {
    ++serial;
    cancelAnimationFrame(frame);
    preview.dispose();
    d.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    finished(d.returnValue === 'alternate' ? 'alternate' : changed);
  };
  d.addEventListener('close', dispose, { once: true });
  function tick(t) {
    if (!d.isConnected) {
      dispose();
      return;
    } // An MP room can close remotely.
    preview.tick((t - stamp) / 1000);
    stamp = t;
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  for (const f of factions) fac.add(new Option(displayName(db.faction(f)) || f, f));
  const inputs = channels.map((label, i) => {
    const wrap = document.createElement('label'),
      chip = document.createElement('span'),
      text = document.createElement('span'),
      input = document.createElement('input');
    wrap.className = 'ap-material';
    chip.className = 'ap-chip';
    text.textContent = label;
    input.type = 'color';
    input.setAttribute('aria-label', label + ' color');
    input.oninput = () => {
      ensureDraft();
      paint.colors[i] = input.value;
      edited();
    };
    wrap.append(chip, text, input);
    $('.ap-materials').append(wrap);
    return input;
  });
  const tiles = PATTERNS.map(pattern => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.dataset.pattern = pattern;
    tile.textContent = pattern[0].toUpperCase() + pattern.slice(1);
    tile.onclick = () => {
      ensureDraft();
      paint.pattern = pattern;
      edited();
    };
    $('.ap-patterns').append(tile);
    return tile;
  });
  const defaults = () => ({ colors: ['#c1c6c4', factionColor(faction) || '#526b80', '#475360', '#bf9863'], pattern: 'standard' });
  function drawPresets() {
    const option = (label, key) => new Option(label + (key === state.active ? ' · equipped' : ''), key);
    presets.replaceChildren(option('Stock markings', ''), ...state.presets.map(p => option(p.name, p.id)));
    if (id === NEW) presets.add(new Option('New livery · draft', NEW));
    presets.value = id;
  }
  function selectPreset(key) {
    id = key;
    const p = state.presets.find(x => x.id === id);
    paint = p ? { colors: [...p.colors], pattern: p.pattern } : defaults();
    name.value = p?.name || '';
    dirty = false;
    drawPresets();
    refresh();
    renderUnit();
  }
  function initFaction() {
    fac.value = faction;
    state = factionLiveries(faction);
    roster = painterRoster(faction);
    units.replaceChildren();
    for (const domain of ['Ground', 'Space']) {
      const group = document.createElement('optgroup');
      group.label = domain;
      roster.forEach((r, i) => {
        if (r.domain === domain) group.append(new Option(r.label, String(i)));
      });
      if (group.childElementCount) units.append(group);
    }
    if (!roster.length) units.add(new Option('No units available', ''));
    const trooper = roster.findIndex(r => /^(Stormtrooper|Rebel_Trooper)$/i.test(r.type.name));
    if (roster.length) units.value = String(Math.max(0, trooper));
    units.disabled = !roster.length;
    $('#ap-prev').disabled = $('#ap-next').disabled = roster.length < 2;
    selectPreset(state.active);
  }
  function ensureDraft() {
    if (!id) newDraft();
  }
  function newDraft() {
    let n = 1;
    while (state.presets.some(p => p.name === `Livery ${n}`)) n++;
    name.value = `Livery ${n}`;
    id = NEW;
    dirty = true;
    drawPresets();
  }
  function refresh() {
    const stock = !id,
      equipped = id === state.active && !dirty;
    name.closest('label').hidden = stock;
    add.disabled = state.presets.length >= MAX_LIVERIES;
    remove.disabled = stock || id === NEW;
    inputs.forEach((input, i) => {
      input.value = paint.colors[i];
      input.parentElement.style.setProperty('--chip', paint.colors[i]);
      d.style.setProperty('--ap-p' + i, paint.colors[i]);
    });
    tiles.forEach(t => t.setAttribute('aria-pressed', String(!stock && t.dataset.pattern === paint.pattern)));
    save.textContent = stock
      ? equipped
        ? 'Stock equipped'
        : 'Equip stock'
      : equipped
        ? 'Livery equipped'
        : dirty
          ? 'Save & equip'
          : 'Equip livery';
    save.disabled = equipped || (!stock && !name.value.trim());
    status.textContent = dirty
      ? 'Unsaved · applies to this faction, not just the preview unit.'
      : stock
        ? 'Stock uses the original markings. Choose + or a material to paint.'
        : 'Equipped liveries are used in solo and multiplayer battles.';
  }
  async function renderUnit() {
    const r = roster[+units.value],
      request = ++serial;
    const label = r?.label || 'No preview unit';
    $('.ap-domain').textContent = r ? r.domain + ' unit' : 'Unit preview';
    $('.ap-unit-name').textContent = label;
    host.setAttribute('aria-label', label + ' model preview');
    host.setAttribute('aria-busy', 'true');
    const note = $('.ap-art-state');
    note.textContent = r && !preview.inst ? 'Loading model…' : '';
    const icon = r && iconUrl(r.type.str('Icon_Name'));
    await preview.show(r?.body, new THREE.Color(factionColor(faction) || '#ffffff'), icon, id ? paint : null);
    if (request !== serial) return;
    host.setAttribute('aria-busy', 'false');
    $('.ap-turn').disabled = !preview.inst;
    note.textContent = !r
      ? 'No tactical models in the mounted roster.'
      : preview.inst
        ? ''
        : icon
          ? 'Model unavailable · original unit icon'
          : 'Model preview unavailable';
  }
  function edited() {
    dirty = true;
    refresh();
    renderUnit();
  }
  fac.onchange = () => {
    const next = fac.value;
    fac.value = faction;
    guard(() => {
      faction = next;
      initFaction();
    });
  };
  presets.onchange = () => {
    const next = presets.value;
    presets.value = id;
    guard(() => selectPreset(next));
  };
  units.onchange = renderUnit;
  const step = by => {
    units.value = String((+units.value + by + roster.length) % roster.length);
    renderUnit();
  };
  $('#ap-prev').onclick = () => step(-1);
  $('#ap-next').onclick = () => step(1);
  add.onclick = () =>
    guard(() => {
      newDraft();
      refresh();
      renderUnit();
      name.focus();
      name.select();
    });
  name.oninput = () => {
    dirty = true;
    refresh();
  };
  remove.onclick = () =>
    ask(`Delete “${state.presets.find(p => p.id === id)?.name}” for this faction?`, 'Delete', () => {
      try {
        deleteLivery(faction, id);
        changed = true;
        state = factionLiveries(faction);
        selectPreset(state.active);
        status.textContent = 'Livery deleted.';
      } catch (e) {
        status.textContent = e.message;
      }
    });
  save.onclick = () => {
    try {
      if (id) saveLivery(faction, id === NEW ? '' : id, name.value, paint);
      else equipStock(faction);
      changed = true;
      state = factionLiveries(faction);
      selectPreset(state.active);
      status.textContent = `${id ? name.value : 'Stock markings'} equipped for ${fac.selectedOptions[0].text}.`;
    } catch (e) {
      status.textContent = e.message;
    }
  };
  if (faction) initFaction();
  else {
    for (const control of $('.ap-controls').querySelectorAll('button,input,select')) control.disabled = true;
    save.disabled = true;
    status.textContent = 'No playable factions in the mounted game data.';
  }
  return result;
}
