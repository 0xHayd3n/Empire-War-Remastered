import { mapTable } from './universalmaptable.js';
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
const heraldry = {
  'Old Republic': ['old-republic', 'Jedi Order / Sith Empire'],
  'Clone Wars': ['clone-wars', 'Galactic Republic / Separatist Alliance'],
  'Galactic Civil War': ['galactic-civil-war', 'Rebel Alliance / Galactic Empire'],
  'New Republic': ['new-republic-era', 'New Republic / Imperial Remnant']
};
export function campaignRoster(host, eras, { pickEra, pickPeriod, pickMap, pickDate }) {
  const cards = group('Era', 'uc-era-strip'),
    calendar = group('Starting period', 'uc-calendar'),
    readout = node('span', 'uc-year-value'),
    track = node('div', 'uc-periods'),
    dial = yearTrack(track, readout, pickPeriod),
    maps = mapTable(pickMap, pickDate),
    remembered = new Map();
  let shownEra, shownPeriod;
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
  for (const e of eras) {
    const b = node('button', 'uc-era-card');
    b.type = 'button';
    b.onclick = () => pickEra(e);
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
  return {
    close: dial.close,
    show(era, period, family, date, variant) {
      if (era !== shownEra) {
        shownEra = era;
        [...cards.children].forEach((b, i) => b.setAttribute('aria-pressed', String(eras[i] === era)));
        dial.mount(era.periods.filter(p => !p.scenario));
        tabs.buttons.forEach((b, i) => (b.disabled = !era.periods.some(p => Number(p.scenario) === i)));
      }
      if (period !== shownPeriod) {
        shownPeriod = period;
        const mode = Number(period.scenario);
        tabs.select(mode);
        tabs.panels[mode].append(maps.table);
        if (!period.scenario) {
          remembered.set(era, period);
          dial.show(period);
        }
      }
      maps.show(period, family, date, variant);
    },
    focus() {
      cards.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
  };
}
