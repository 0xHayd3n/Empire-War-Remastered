import { planetCount } from './universalmaplist.js';
import { yearTrack } from './universalyeartrack.js';
import { sidebarTabs } from './universalsidebartabs.js';
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};
function group(title, cls) {
  const n = node('div', cls);
  n.setAttribute('role', 'group');
  n.setAttribute('aria-label', title);
  return n;
}
function button(label, act, cls) {
  const b = node('button', cls, label);
  b.type = 'button';
  b.onclick = act;
  b.setAttribute('aria-pressed', 'false');
  return b;
}
const heraldry = {
  'Old Republic': ['old-republic', 'Jedi Order / Sith Empire'],
  'Clone Wars': ['clone-wars', 'Galactic Republic / Separatist Alliance'],
  'Galactic Civil War': ['galactic-civil-war', 'Rebel Alliance / Galactic Empire'],
  'New Republic': ['new-republic-era', 'New Republic / Imperial Remnant']
};
const press = (b, on) => b.setAttribute('aria-pressed', String(on));
export function campaignRoster(host, eras, { pickEra, pickPeriod, pickMap, pickDate }) {
  const cards = group('Era', 'uc-era-strip'),
    calendar = group('Starting period', 'uc-calendar'),
    readout = node('span', 'uc-year-value'),
    track = node('div', 'uc-periods'),
    dial = yearTrack(track, readout, pickPeriod),
    table = node('table', 'uc-map-table'),
    branches = group('Starting variant', 'uc-branches'),
    branchRow = document.createElement('tr'),
    remembered = new Map(),
    entries = new Map();
  let shownEra, shownPeriod, activeFamily;
  const tabs = sidebarTabs('starts', 'Start type', ['Time-based', 'Scenario-based'], i => {
    if (i === Number(shownPeriod.scenario)) return;
    const next = i ? shownEra.periods.find(p => p.scenario) : remembered.get(shownEra) || shownEra.periods.find(p => !p.scenario);
    if (next) pickPeriod(next);
  });
  const caption = node('div', 'uc-year-caption');
  caption.append(node('span', '', 'Time period'), readout);
  calendar.append(caption, track);
  tabs.panels[0].append(calendar);
  host.append(cards, tabs.bar, ...tabs.panels);
  const headers = table.createTHead().insertRow();
  for (const title of ['Map', 'Category', 'Planets']) {
    const h = node('th', '', title);
    h.scope = 'col';
    headers.append(h);
  }
  const cell = branchRow.insertCell();
  cell.colSpan = 3;
  cell.append(branches);
  for (const e of eras) {
    const b = button('', () => pickEra(e), 'uc-era-card');
    b.dataset.era = e.name;
    const [id, pair] = heraldry[e.name],
      ns = 'http://www.w3.org/2000/svg',
      art = document.createElementNS(ns, 'svg'),
      use = document.createElementNS(ns, 'use');
    art.classList.add('uc-era-crest');
    art.setAttribute('viewBox', '0 0 100 100');
    art.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', '/art/era-crests.svg#' + id);
    art.append(use);
    b.append(art, node('span', '', e.name));
    b.disabled = !e.periods.length;
    b.title = [pair, ...e.missing].join('\n');
    cards.append(b);
  }
  table.onkeydown = e => {
    if (!e.target.matches('.uc-map-choice')) return;
    const buttons = [...entries.values()].map(r => r.b),
      n = buttons.indexOf(e.target),
      dst = { ArrowDown: Math.min(n + 1, buttons.length - 1), ArrowUp: Math.max(0, n - 1), Home: 0, End: buttons.length - 1 }[e.key];
    if (dst !== undefined) {
      e.preventDefault();
      buttons[dst].focus();
    }
  };
  function count(f, v) {
    const { b, number } = entries.get(f),
      text = planetCount(f, shownPeriod.maps.get(f), v);
    number.textContent = text.replace(/ planets?$/, '');
    number.title = text;
    b.setAttribute('aria-label', [f.title, f.span, f.p.name, text].filter(Boolean).join(' · '));
  }
  function selectRow(f, on) {
    const { b, tr } = entries.get(f);
    press(b, on);
    tr.classList.toggle('uc-selected-map', on);
  }
  return {
    close: dial.close,
    show(era, period, family, date, variant) {
      if (era !== shownEra) {
        shownEra = era;
        [...cards.children].forEach((b, i) => press(b, eras[i] === era));
        dial.mount(era.periods.filter(p => !p.scenario));
        tabs.buttons.forEach((b, i) => (b.disabled = !era.periods.some(p => Number(p.scenario) === i)));
      }
      if (period !== shownPeriod) {
        shownPeriod = period;
        const mode = Number(period.scenario);
        tabs.select(mode);
        tabs.panels[mode].append(table);
        if (!period.scenario) {
          remembered.set(era, period);
          dial.show(period);
        }
        table.setAttribute('aria-label', period.scenario ? 'Scenarios' : 'Maps');
        branchRow.remove();
        branches.replaceChildren();
        while (table.tBodies.length) table.tBodies[0].remove();
        entries.clear();
        activeFamily = undefined;
        // Each row closes over its exact profile-local family. Matching display names in
        // other categories never merge launch targets, starting variants or counts.
        const bodies = new Map();
        for (const f of period.maps.keys()) {
          let body = bodies.get(f.p);
          if (!body) {
            body = table.createTBody();
            body.dataset.profile = f.p.id;
            bodies.set(f.p, body);
          }
          const tr = body.insertRow(),
            b = button(f.title, () => pickMap(f), 'uc-map-choice');
          b.dataset.family = f.id;
          if (f.span && f.span !== period.label) b.append(node('small', 'uc-map-span', f.span));
          tr.insertCell().append(b);
          tr.insertCell().textContent = f.p.name;
          const number = tr.insertCell();
          number.className = 'uc-planet-count';
          entries.set(f, { b, tr, number });
          count(f);
          tr.onclick = e => {
            if (!b.contains(e.target)) {
              b.focus({ preventScroll: true });
              b.click();
            }
          };
        }
      }
      if (activeFamily !== family) {
        if (entries.has(activeFamily)) {
          selectRow(activeFamily, false);
          count(activeFamily);
        }
        branchRow.remove();
        branches.replaceChildren();
        activeFamily = family;
        if (family) {
          selectRow(family, true);
          const dates = period.maps.get(family);
          if (dates.length > 1) {
            for (const d of dates) branches.append(button(d.label, () => pickDate(d)));
            entries.get(family).tr.after(branchRow);
          }
        }
      }
      const tabStop = family || entries.keys().next().value;
      for (const [f, { b }] of entries) b.tabIndex = f === tabStop ? 0 : -1;
      if (family) {
        count(family, variant);
        [...branches.children].forEach((b, i) => press(b, period.maps.get(family)[i] === date));
      }
    },
    focus() {
      cards.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
  };
}
