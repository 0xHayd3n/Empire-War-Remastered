import { element, action } from './operationsetup.js';
import { operationTable, choiceRow } from './operationtable.js';
import { eraCard } from './universalera.js';
import { chronology, periods } from './universalmodes.js';
import { showPlanetCount } from './universalplanetcount.js';
import { iconUrl } from '../icons.js';

export function storyArchive(ui, stories, current, choose) {
  const eraOf = g => periods[g.p.id] || 'Other stories';
  const strip = element('div', 'uc-era-strip'),
    remembered = new Map(),
    rows = new Map();
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Story era');
  ui.tools.classList.add('uc-roster');
  ui.tools.append(strip);
  const table = operationTable('Story campaigns', ['Campaign', 'Variant', 'Mod', 'Planets']),
    body = table.createTBody();
  table.classList.add('op-campaign-table');
  ui.list.append(table);
  function mark(active, selected) {
    for (const [g, { b, count }] of rows) {
      const choices = g === active && selected ? [selected] : g.choices;
      const counts = choices.map(c => g.p.maps[c.map].worlds.length);
      const text = showPlanetCount(
        count,
        [Math.min(...counts), Math.max(...counts)],
        choices.every(c => c.scripted)
      );
      b.setAttribute('aria-label', `${g.title} · ${g.p.name} · ${text}`);
      b.setAttribute('aria-pressed', String(g === active));
    }
  }
  function display(era) {
    for (const b of strip.children) b.setAttribute('aria-pressed', String(b.dataset.era === era));
    rows.clear();
    body.replaceChildren();
    const available = stories.filter(g => eraOf(g) === era);
    function select(g) {
      remembered.set(era, g);
      const c = choose(g);
      mark(g, c);
    }
    for (const g of available) {
      const [category, ...parts] = g.title.split(/\s+·\s+/);
      // The era card or Mod cell already names many campaign families.
      const redundant = parts.length && [era, g.p.name].includes(category);
      const label = redundant ? parts.shift() : category;
      const b = action(label, () => select(g), 'op-story-card');
      b.title = g.title;
      b.dataset.story = g.choices[0].id;
      b.dataset.source = g.p.id;
      const variant = parts.join(' · ');
      const row = choiceRow(body, b, [variant || '—', g.p.name, '']);
      row.cells[1].title = variant;
      row.cells[2].title = g.p.name;
      rows.set(g, { b, count: row.cells[3] });
    }
    select(remembered.get(era) || available.find(g => g.p.id === current) || available[0]);
  }
  for (const era of [...chronology, 'Other stories']) {
    if (!stories.some(g => eraOf(g) === era)) continue;
    const b = chronology.includes(era) ? eraCard(era, () => display(era)) : action(era, () => display(era));
    b.dataset.era = era;
    strip.append(b);
  }
  display(eraOf(stories.find(g => g.p.id === current) || stories[0]));
  return mark;
}

export function storyInfo(panel, group, c) {
  const facts = element('dl', 'op-brief-facts');
  function stat(label, value, money = false) {
    const row = element('div'),
      n = element('dd', '', value);
    if (money) {
      const url = iconUrl('i_icon_credit.tga'),
        icon = url ? element('img') : element('span', 'op-credit-mark', '¤');
      if (url) {
        icon.src = url;
        icon.alt = '';
      }
      icon.setAttribute('aria-hidden', 'true');
      n.prepend(icon);
    }
    row.append(element('dt', '', label), n);
    facts.append(row);
  }
  const choices = c ? [c] : group.choices;
  const credits = [...new Set(choices.map(v => v.credits))];
  if (credits.every(Number.isFinite))
    stat(
      'Starting credits',
      [Math.min(...credits), Math.max(...credits)]
        .filter((n, i, a) => !i || n !== a[0])
        .map(n => n.toLocaleString())
        .join('–'),
      true
    );
  const counts = choices.map(v => group.p.maps[v.map].worlds.length);
  stat(
    choices.every(v => v.scripted) ? 'Setup planets' : 'Planets',
    Math.min(...counts) === Math.max(...counts) ? String(counts[0]) : `${Math.min(...counts)}–${Math.max(...counts)}`
  );
  const description =
    c?.description ||
    (choices.every(v => v.description === choices[0].description)
      ? choices[0].description
      : 'Choose a faction to see its opening details.');
  const prose = [];
  for (const line of (description || '').replaceAll('\\n', '\n').split(/\r?\n/)) {
    // Some authors append a stat block to the prose. Prefer actual start data;
    // retain authored notes (and unrecognized/localized descriptions) as text.
    const m = /^\s*(Playable Factions|Non-Playable(?: Active)? Factions|Planets|Credits)\s*:\s*(.+)$/i.exec(line);
    if (!m) prose.push(line);
    else if (/non-playable/i.test(m[1])) stat(m[1], m[2]);
  }
  panel.replaceChildren(facts);
  const text = prose.join('\n').trim();
  if (text && text !== group.title) panel.append(element('p', 'op-description', text));
}
