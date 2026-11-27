import { db, skirmishFactions, factionColor } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { CLASS_GROUPS, instantRoster, shipsOf } from './instantbattle.js';
import { MAX_UNITS, presetKey, readPresets, savePreset, removePreset, checkFleet } from './fleetpresets.js';
import { el, action, option, universalHost, profile, switchProfile, askDesk } from './commandui.js';
import { loadContent } from '../content.js';
import { factionBadge } from './faction-badges.js';
import './armorystage.js';
import { flightCards } from './armorycard.js';
import { armoryStyle } from './armorystyle.js';

// Keep only the inspection selection within this title. Never restore discarded fleet/card drafts.
const lastInspection = new WeakMap();
const roles = ['Fighter', 'Bomber', 'Transport', 'Corvette', 'Frigate', 'Capital ship', 'Supercapital'];
const role = r => roles[r.cls] || 'Space unit';
const typeLabel = t => db.t(t.str('Text_ID')) || t.name.replaceAll('_', ' ');
const number = n => n.toLocaleString();
const qty = n => `${number(n)} ${n === 1 ? 'unit' : 'units'}`;
function thumbnail(url, label = '') {
  if (!url) return el('i', 'armory-no-icon', '—');
  const img = el('img');
  img.src = url;
  img.alt = label;
  return img;
}
export async function customizeDesk(root) {
  armoryStyle();
  const [key, content] = await Promise.all([presetKey(), loadContent()]);
  if (!root.isConnected) return;
  root.className = 'unit-armory';
  root.innerHTML = `<section class="inspection-bay" aria-label="Fleet inspection bay"><div class="bay-context"><small>Fleet registry <i>/</i> Inspection bay</small>
    <div class="bay-selectors"><label>Profile<select class="profile" aria-label="Mod profile"></select></label><label>Faction<select class="faction" aria-label="Faction"></select></label></div></div>
    <div class="stage-scene"><div class="record" aria-label="Unit dossier"></div><armory-live-stage></armory-live-stage></div>
    <section class="armory-index" aria-label="Unit roster"><header><div class="roster-caption"><small>On the flight line</small><strong class="result-count"></strong></div>
      <input type="search" aria-label="Search units" placeholder="Find a unit…"><select aria-label="Roster category" class="category"></select>
      <div class="roster-step"><button type="button" class="prev" aria-label="Inspect previous unit">‹</button><button type="button" class="next" aria-label="Inspect next unit">›</button></div></header>
      <div class="units" aria-label="Unit catalog"></div></section></section>
    <div class="unit-details"></div><div class="deployment-desk"><section class="flight-card" aria-label="Unit flight card"></section>
    <section class="armory-blueprint" aria-label="Fleet blueprint"><small>Deployment orders / Fleet</small><h2>Blueprint</h2>
      <label>Blueprint<select class="blueprints" aria-label="Blueprint"></select></label><label>Preset name<input class="preset-name" maxlength="50" placeholder="e.g. Outer Rim patrol"></label>
      <strong class="tally"></strong><div class="fleet-mix" aria-label="Fleet composition by class"></div><div class="manifest"></div><p class="fleet-validation"></p>
      <div class="desk-actions"></div><p class="blueprint-status" role="status"></p></section></div><p class="armory-warning" role="status"></p>`;
  const $ = s => root.querySelector(s),
    title = root.closest('.title-menu') || root,
    ps = $('.profile'),
    fs = $('.faction'),
    bs = $('.blueprints'),
    q = $('[type=search]'),
    category = $('.category'),
    catalog = $('.units'),
    input = $('.preset-name'),
    note = $('.blueprint-status'),
    warn = text => {
      $('.armory-warning').textContent = text;
    };
  option(
    ps,
    profile(),
    content.mods.map(m => m.name).join(' + ') || (content.edition === 'eaw' ? 'Empire at War' : 'Forces of Corruption')
  );
  ps.disabled = true;
  for (const f of skirmishFactions()) option(fs, f, db.t(db.faction(f)?.str('Text_ID')) || f);
  let faction,
    roster,
    by,
    shown = [],
    selected = null,
    rows = [],
    units = [],
    id = '',
    dirty = false;
  const draft = () => ({ id, name: input.value.trim(), faction, units: [...units] });
  const cards = flightCards({ root, key, notice: warn, fleet: () => units, append, refresh: update });
  function append(names) {
    units.push(...names);
    dirty = true;
    note.textContent = '';
    update();
  }
  const save = action(
    $('.armory-blueprint .desk-actions'),
    'Save preset',
    () => {
      try {
        const p = draft(),
          result = checkFleet(p, faction, roster);
        if (!p.name || result.error) throw Error(result.error || 'Name this preset first.');
        p.id = id || crypto.randomUUID();
        savePreset(key, p);
        id = p.id;
        dirty = false;
        choices();
        update();
        note.textContent = 'Saved. Select this preset in Instant Battle for this faction.';
      } catch (e) {
        note.textContent = e.message;
      }
    },
    'cmd-primary'
  );
  const discard = action($('.armory-blueprint .desk-actions'), 'Delete preset', () =>
    askDesk(root, 'Delete this saved fleet preset?', {
      label: 'Delete',
      run: () => {
        try {
          removePreset(key, id);
          reset();
          note.textContent = 'Preset deleted.';
          bs.focus();
        } catch (e) {
          note.textContent = e.message;
        }
      }
    })
  );
  function choices() {
    bs.replaceChildren();
    option(bs, '', 'New blueprint');
    for (const p of readPresets(key, warn).filter(p => p.faction === faction)) option(bs, p.id, p.name);
    bs.value = id;
  }
  function reset() {
    units = [];
    id = '';
    dirty = false;
    input.value = '';
    note.textContent = '';
    choices();
    update();
  }
  function inspect(r) {
    if (selected === r && $('.record').childElementCount) return;
    selected = r;
    root.style.setProperty('--faction-ink', factionColor(faction) || '#b3c5d3');
    const record = $('.record');
    record.replaceChildren();
    $('.unit-details').replaceChildren();
    const stage = $('armory-live-stage');
    $('.prev').disabled = shown.indexOf(r) <= 0;
    $('.next').disabled = !r || shown.indexOf(r) >= shown.length - 1;
    if (r) {
      lastInspection.set(title, { key, faction, unit: r.name });
      const portrait = iconUrl(r.icon),
        ships = shipsOf(r.type),
        hulls = ships.flatMap(s =>
          s.has('Space_Model_Name')
            ? [s]
            : s
                .list('Squadron_Units')
                .map(n => db.type(n))
                .filter(Boolean)
        );
      const hull = hulls.find(t => t.has('Space_Model_Name')),
        top = el('header', 'record-head');
      const identity = el('div');
      identity.append(el('small', '', r.hero ? 'Unique hero / Space forces' : 'Space forces / Unit dossier'), el('h2', '', r.label));
      top.append(identity);
      const owner = el('div', 'record-owner');
      owner.append(factionBadge(faction), el('span', '', fs.selectedOptions[0]?.textContent || faction));
      record.append(owner, top);
      stage.show({
        file: hull?.str('Space_Model_Name'),
        hull: hull ? typeLabel(hull) : r.label,
        label: r.label,
        portrait,
        color: factionColor(faction)
      });
      const data = el('dl', 'unit-data');
      for (const [field, value] of [
        ['Role', role(r)],
        ['Credits', number(r.cost)],
        ['Space pop.', number(r.pop)]
      ]) {
        const cell = el('div');
        cell.append(el('dt', '', field), el('dd', '', value));
        data.append(cell);
      }
      const more = el('details', 'unit-spec');
      more.append(el('summary', '', r.hero ? 'Unique hero · Unit record' : 'Unit record'));
      const text = [
        ...new Set(
          r.type
            .list('Encyclopedia_Text')
            .map(k => db.text.get(k.toUpperCase()))
            .filter(Boolean)
        )
      ]
        .join(' ')
        .trim();
      if (text) more.append(el('p', '', text));
      more.append(el('p', '', `Roster ID: ${r.name}`));
      const counts = new Map();
      for (const t of hulls) counts.set(t, (counts.get(t) || 0) + 1);
      if (counts.size) more.append(el('p', '', 'Space complement: ' + [...counts].map(([t, n]) => `${n} × ${typeLabel(t)}`).join(' · ')));
      if (hull) more.append(el('p', '', 'Hull source: ' + hull.str('Space_Model_Name')));
      record.append(data);
      $('.unit-details').append(more);
    } else {
      stage.show(null);
      record.append(
        el('small', '', '02 / Unit dossier'),
        el('h2', '', 'No unit selected'),
        el('p', '', 'Choose a roster entry to inspect its record.')
      );
    }
    cards.show($('.flight-card'), r, faction, roster);
    markRows();
  }
  function markRows() {
    const counts = new Map();
    for (const n of units) counts.set(n, (counts.get(n) || 0) + 1);
    rows.forEach(({ r, inspectBtn, plus, count, saved }) => {
      const n = counts.get(r.name) || 0;
      inspectBtn.setAttribute('aria-pressed', String(selected === r));
      inspectBtn.tabIndex = selected === r ? 0 : -1;
      plus.tabIndex = selected === r ? 0 : -1;
      plus.disabled = units.length >= MAX_UNITS || (r.hero && n > 0);
      count.textContent = n ? '×' + n : '';
      saved.hidden = !cards.has(faction, r.name);
    });
  }
  function filter() {
    const search = q.value.trim().toLowerCase(),
      cat = category.value;
    shown = roster.filter(
      r =>
        (cat === 'all' || (cat === 'hero' ? r.hero : CLASS_GROUPS.find(g => g.key === cat)?.of(r.cls))) &&
        `${r.label} ${r.name} ${role(r)}`.toLowerCase().includes(search)
    );
    catalog.replaceChildren();
    rows = [];
    $('.result-count').textContent = `${shown.length} / ${roster.length}`;
    for (const r of shown) {
      const row = el('div', 'armory-row'),
        inspectBtn = action(row, '', () => inspect(r), 'armory-inspect');
      inspectBtn.setAttribute('aria-label', `Inspect ${r.label}`);
      inspectBtn.dataset.inspect = r.name;
      const copy = el('span'),
        count = el('b', 'unit-count'),
        saved = el('i', 'card-flag', 'Card');
      const label = el('strong', '', r.label);
      label.append(saved);
      copy.append(label, el('small', '', `${r.hero ? 'Unique hero · ' : ''}${role(r)} · ${number(r.cost)} cr`));
      inspectBtn.append(thumbnail(iconUrl(r.icon)), copy, count);
      const plus = action(
        row,
        '+',
        () => {
          inspect(r);
          append([r.name]);
          note.textContent = `Added ${r.label}.`;
        },
        'unit-row'
      );
      plus.dataset.unit = r.name;
      plus.setAttribute('aria-label', 'Add one ' + r.label);
      plus.title = 'Add one to blueprint';
      rows.push({ r, inspectBtn, plus, count, saved });
      catalog.append(row);
    }
    if (!shown.length)
      catalog.append(
        el(
          'p',
          'desk-empty',
          !faction
            ? 'No playable factions in this profile.'
            : !roster.length
              ? 'This faction has no Instant Battle space units.'
              : 'No matching space units. Clear the search or choose another category.'
        )
      );
    inspect(shown.includes(selected) ? selected : shown[0] || null);
    markRows();
    catalog.scrollLeft = 0;
    $('.prev').disabled = shown.indexOf(selected) <= 0;
    $('.next').disabled = !selected || shown.indexOf(selected) >= shown.length - 1;
  }
  function step(n) {
    const i = shown.indexOf(selected) + n;
    if (!shown[i]) return;
    inspect(shown[i]);
    rows[i].inspectBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('.prev').onclick = () => step(-1);
  $('.next').onclick = () => step(1);
  catalog.onkeydown = e => {
    const i = rows.findIndex(row => row.inspectBtn === e.target);
    if (i < 0) return;
    const next = {
      ArrowRight: Math.min(i + 1, rows.length - 1),
      ArrowLeft: Math.max(0, i - 1),
      ArrowDown: Math.min(i + 1, rows.length - 1),
      ArrowUp: Math.max(0, i - 1),
      Home: 0,
      End: rows.length - 1
    }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      inspect(rows[next].r);
      rows[next].inspectBtn.focus();
    }
  };
  function update() {
    markRows();
    cards.update();
    const counts = new Map();
    let cost = 0;
    for (const n of units) {
      counts.set(n, (counts.get(n) || 0) + 1);
      cost += by.get(n)?.cost || 0;
    }
    $('.tally').textContent = `${qty(units.length)} · ${number(cost)} credits`;
    const mix = $('.fleet-mix');
    mix.replaceChildren();
    for (const [i, g] of CLASS_GROUPS.entries()) {
      const n = units.filter(name => by.has(name) && g.of(by.get(name).cls)).length,
        cell = el('div', 'fleet-lane');
      cell.title = g.label;
      cell.append(el('small', '', ['Wings', 'Light', 'Frigates', 'Capitals'][i]), el('b', '', String(n)));
      const line = el('i');
      line.style.width = (units.length ? (100 * n) / units.length : 0) + '%';
      cell.append(line);
      mix.append(cell);
    }
    const manifest = $('.manifest');
    manifest.replaceChildren();
    if (!counts.size) manifest.append(el('p', '', 'Use + in the roster or add a flight card.'));
    for (const [n, count] of counts) {
      const label = by.get(n)?.label || n + ' (unavailable)',
        row = el('div', 'manifest-row');
      row.append(el('span', '', `${count} × ${label}`));
      const minus = action(row, '−', () => {
        units.splice(units.lastIndexOf(n), 1);
        dirty = true;
        update();
        note.textContent = 'Removed one ' + label + '.';
        ([...manifest.querySelectorAll('button')].find(b => b.dataset.remove === n) || manifest.querySelector('button') || input).focus({
          preventScroll: true
        });
      });
      minus.dataset.remove = n;
      minus.setAttribute('aria-label', 'Remove one ' + label);
      manifest.append(row);
    }
    validate();
    discard.hidden = !id;
  }
  function validate() {
    const result = checkFleet(draft(), faction, roster);
    save.disabled = !input.value.trim() || !!result.error;
    $('.fleet-validation').textContent = units.length
      ? result.error || (!input.value.trim() ? 'Give this fleet a name to save it.' : dirty ? 'Unsaved blueprint' : 'Saved blueprint')
      : '';
  }
  const confirm = (needed, message, run) => (needed ? askDesk(root, message, { label: 'Discard changes', run }) : run());
  root.leaveDraft = run => confirm(dirty || cards.dirty(), 'Discard unsaved blueprint or flight card changes?', run);
  bs.onchange = () => {
    const next = bs.value;
    bs.value = id;
    confirm(dirty, 'Discard unsaved blueprint changes?', () => {
      const p = readPresets(key, warn).find(p => p.id === next && p.faction === faction);
      if (!p) return reset();
      id = bs.value = p.id;
      units = [...p.units];
      input.value = p.name;
      dirty = false;
      note.textContent = '';
      update();
    });
  };
  function openFaction(next, lastUnit) {
    fs.value = faction = next;
    roster = next ? instantRoster(next) : [];
    by = new Map(roster.map(r => [r.name, r]));
    category.replaceChildren();
    option(category, 'all', 'All classes');
    for (const g of CLASS_GROUPS) if (roster.some(r => g.of(r.cls))) option(category, g.key, g.label);
    if (roster.some(r => r.hero)) option(category, 'hero', 'Unique heroes');
    selected = by.get(lastUnit);
    q.value = '';
    cards.discardEdits();
    reset();
    filter();
  }
  fs.onchange = () => {
    const next = fs.value;
    fs.value = faction;
    root.leaveDraft(() => openFaction(next));
  };
  q.oninput = category.onchange = filter;
  input.oninput = () => {
    dirty = true;
    note.textContent = '';
    validate();
  };
  const last = lastInspection.get(title);
  const restore = last?.key === key && Array.from(fs.options).some(o => o.value === last.faction);
  openFaction(restore ? last.faction : fs.value, restore ? last.unit : undefined);
  if (universalHost())
    try {
      const res = await fetch('/api/universal/eras');
      if (!res.ok) throw Error();
      const entries = await res.json();
      ps.replaceChildren();
      for (const r of entries) {
        option(ps, r.id, r.name + (r.ready ? '' : ' · not built'));
        ps.lastChild.disabled = !r.ready;
      }
      ps.value = profile();
      ps.disabled = false;
      ps.onchange = () => {
        const next = ps.value;
        ps.value = profile();
        root.leaveDraft(() => switchProfile(next, 'customize'));
      };
    } catch {
      warn('Profile switcher unavailable. You can still use the mounted roster.');
    }
}
