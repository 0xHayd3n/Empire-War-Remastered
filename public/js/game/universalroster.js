import { eraCard } from './universalera.js';
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
export function campaignRoster(host, eras, { pickEra, pickPeriod, pickMap, pickDate, clearChoice }) {
  const cards = group('Era', 'uc-era-strip'),
    calendar = group('Starting period', 'uc-calendar'),
    readout = node('span', 'uc-year-value'),
    track = node('div', 'uc-periods'),
    dial = yearTrack(track, readout, pickPeriod),
    maps = mapTable(pickMap, pickDate, clearChoice),
    remembered = new Map();
  let shownEra, shownPeriod;
  const tabs = sidebarTabs('starts', 'Start type', ['Time-based', 'Scenario-based'], i => {
    if (i === Number(shownPeriod.scenario)) return;
    const next = i ? shownEra.views.find(p => p.scenario) : remembered.get(shownEra) || shownEra.views.find(p => !p.scenario);
    if (next) pickPeriod(next);
  });
  const caption = node('div', 'uc-year-caption');
  caption.append(node('span', '', 'Time period'), readout);
  calendar.append(caption, track);
  tabs.panels[0].append(calendar);
  host.append(cards, tabs.bar, ...tabs.panels);
  for (const e of eras) {
    const b = eraCard(e.name, () => pickEra(e));
    b.disabled = !e.views.length;
    b.classList.toggle('uc-discovery-era', !e.first && e.offers.length > 0);
    b.title = [b.title, ...e.missing].join('\n');
    cards.append(b);
  }
  return {
    close: dial.close,
    show(era, period, family, date, variant) {
      if (era !== shownEra) {
        shownEra = era;
        [...cards.children].forEach((b, i) => b.setAttribute('aria-pressed', String(eras[i] === era)));
        dial.mount(era.periods.filter(p => !p.scenario));
        tabs.buttons.forEach((b, i) => (b.disabled = !era.views.some(p => Number(p.scenario) === i)));
      }
      if (period !== shownPeriod) {
        shownPeriod = period;
        const mode = Number(period.scenario);
        tabs.select(mode);
        tabs.panels[mode].append(maps.host);
        calendar.hidden = !!period.discovery;
        if (!period.scenario) {
          remembered.set(era, period);
          if (!period.discovery) dial.show(period);
        }
      }
      maps.show(period, family, date, variant, era.offers);
    },
    focus() {
      cards.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
  };
}
