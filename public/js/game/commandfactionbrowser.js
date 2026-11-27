// Collections organize the cards; only a source profile + faction identifies
// a roster. Opening a card focuses its exhibit. It never assigns the player.
import { action, element } from './operationsetup.js';
import { commandCardArt, exhibitName } from './commandcardart.js';
import { commandColor } from './commandcolor.js';
import { commandGroups } from './commandgroups.js';
import { commandMark } from './skirmishcommandpicker.js';

// Sample distinct designs from the actual members. Prefer a different family
// before a second variant of one family (e.g. the New Republic starbird).
// This is a collage of members, never a new badge claiming to represent all.
function groupTile(group, rows, select) {
  const jump = action('', () => select({ group }), 'op-faction-group'),
    fan = element('span', 'op-group-fan'),
    seen = new Set(),
    families = new Set(),
    picks = [];
  const hasEmblem = r => Number(!!r.p.skirmishEmblems?.[r.id]);
  const ordered = [...rows].sort((a, b) => hasEmblem(b) - hasEmblem(a) || Number(b.p.id === 'stock') - Number(a.p.id === 'stock'));
  for (const distinctFamily of [true, false])
    for (const r of ordered) {
      const face = r.p.skirmishEmblems?.[r.id]?.source || 'marker:' + r.family;
      if (picks.length >= 3 || seen.has(face) || (distinctFamily && families.has(r.family))) continue;
      seen.add(face);
      families.add(r.family);
      picks.push(r);
    }
  fan.setAttribute('aria-hidden', 'true');
  for (const r of picks) {
    const mark = commandMark(r.p, r.id);
    mark.dataset.member = r.key;
    fan.append(mark);
  }
  jump.style.setProperty('--group-a', commandColor(picks[0]));
  jump.style.setProperty('--group-b', commandColor(picks.at(-1)));
  jump.dataset.group = group;
  jump.setAttribute('aria-label', 'Browse ' + group);
  jump.append(fan, element('span', 'op-group-title', group));
  return jump;
}

export function factionBrowser({ stage, search, toggle, covered, portraits, fold, choose }) {
  const panel = element('section', 'op-faction-browser'),
    list = element('div', 'op-faction-list'),
    empty = element('p', 'op-faction-empty', 'No matching commanders or factions.');
  panel.id = 'op-faction-browser';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Faction directory');
  empty.setAttribute('role', 'status');
  list.append(empty);
  panel.append(list);
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded', 'false');
  const label = search.getAttribute('aria-label');
  let saved = '',
    groups = [];

  function select(scope) {
    close();
    choose(scope);
    toggle.focus({ preventScroll: true });
  }
  function filter() {
    const q = fold(search.value),
      words = q.split(/\s+/);
    // 'Galactic Empire Remake' names a faction first, then narrows by pack;
    // it must not also match unrelated rosters in 'Galactic Civil War' from
    // 'Empire at War: Remake'. Otherwise keep partial, all-word search.
    let named = '';
    for (const group of groups)
      for (const entry of group.entries)
        for (const term of entry.names)
          if (term.length > named.length && (q === term || (term.includes(' ') && q.startsWith(term + ' ')))) named = term;
    let any = false;
    for (const group of groups) {
      let count = 0;
      for (const entry of group.entries) {
        entry.button.hidden = (named && !entry.names.includes(named)) || !words.every(w => entry.terms.includes(w));
        if (!entry.button.hidden) count++;
      }
      group.section.hidden = !count;
      if (count) any = true;
    }
    empty.hidden = any;
    list.scrollTop = 0;
  }
  function open(rows, current) {
    if (!panel.hidden) return;
    const byGroup = new Map();
    for (const row of rows) {
      if (!byGroup.has(row.group)) byGroup.set(row.group, []);
      byGroup.get(row.group).push(row);
    }
    const order = [...new Set([...commandGroups.map(g => g.name), ...byGroup.keys()])];
    for (const group of order) {
      const rosters = byGroup.get(group);
      if (!rosters) continue;
      const section = element('section', 'op-faction-section'),
        heading = element('h3'),
        members = element('div', 'op-faction-options'),
        entries = [],
        groupLabel = group || 'Other factions';
      if (group) heading.append(groupTile(group, rosters, select));
      else heading.textContent = groupLabel;
      section.setAttribute('aria-label', groupLabel);
      for (const row of rosters) {
        const b = action('', () => select({ section: row.section, preferred: row.key }), 'op-faction-option'),
          art = commandCardArt(row.p, row.id, portraits.bind, 'op-directory-art'),
          name = exhibitName(row.c) || row.label,
          caption = element('span', 'op-directory-caption');
        caption.append(element('strong', 'op-directory-name', name), element('span', 'op-directory-faction', row.label));
        const marker = art.querySelector('[data-crest-kind="standard"]');
        if (marker) art.append(element('small', 'op-directory-credit', 'Universal marker'));
        b.dataset.section = row.section;
        b.dataset.roster = row.key;
        b.style.setProperty('--roster-shade', commandColor(row));
        b.setAttribute('aria-current', String(row.key === current?.key));
        const context = [row.p.name, row.art?.kind === 'unit' ? 'Field representative' : '', marker ? 'Universal marker' : '']
          .filter(Boolean)
          .join(' · ');
        b.title = `${name} · ${row.label} · ${context}`;
        b.setAttribute('aria-description', context);
        b.append(art, caption);
        members.append(b);
        entries.push({ button: b, names: [row.heading, row.label, name, groupLabel].map(fold), terms: row.search });
      }
      section.append(heading, members);
      list.append(section);
      groups.push({ section, entries });
    }
    saved = search.value;
    search.value = '';
    search.placeholder = 'Find commander, faction or group';
    search.setAttribute('aria-label', 'Search directory by commander, faction, group or mod');
    toggle.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    stage.classList.add('is-browsing-factions');
    for (const el of covered) el.inert = true;
    filter();
    // Keep the start of the directory visible on touch and avoid opening its
    // software keyboard until the player explicitly touches Search.
    list.scrollTop = 0;
    (list.querySelector('button') || toggle).focus({ preventScroll: true });
  }
  function close(restoreFocus = false) {
    if (panel.hidden) return;
    for (const el of covered) el.inert = false;
    panel.hidden = true;
    stage.classList.remove('is-browsing-factions');
    toggle.setAttribute('aria-expanded', 'false');
    search.value = saved;
    search.placeholder = 'Search';
    search.setAttribute('aria-label', label);
    portraits.release(list);
    list.replaceChildren(empty);
    groups = [];
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }
  // This is a stage-local disclosure, not a modal over the Teams sidebar.
  stage.addEventListener('focusout', e => {
    if (e.relatedTarget && !stage.contains(e.relatedTarget)) close();
  });
  return {
    panel,
    open,
    close,
    filter,
    get shown() {
      return !panel.hidden;
    },
    first() {
      (list.querySelector('[data-section]:not([hidden])') || search).focus();
    }
  };
}
