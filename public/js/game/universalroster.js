import { planetCount } from './universalmaplist.js';
import { yearTrack } from './universalyeartrack.js';
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
export function campaignRoster(host, eras, { pickEra, pickPeriod, pickStory, pickMap, pickDate }) {
  const cards = group('Era', 'uc-era-strip'),
    periods = group('Time period', 'uc-periods'),
    tabs = node('div', 'uc-story-tabs'),
    list = node('div', 'uc-map-list'),
    branches = group('Starting variant', 'uc-branches');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Storyline');
  tabs.onkeydown = e => {
    const items = [...tabs.children],
      i = items.indexOf(e.target),
      n = items.length;
    const next = { ArrowLeft: (i + n - 1) % n, ArrowRight: (i + 1) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined || i < 0) return;
    e.preventDefault();
    items[next].focus();
    items[next].click();
  };
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Maps');
  const heading = node('h2', 'uc-nav-heading', 'Time period'),
    mapHeading = node('h2', 'uc-nav-heading', 'Map'),
    readout = node('span', 'uc-year-value'),
    dial = yearTrack(periods, readout, pickPeriod);
  heading.append(readout);
  host.append(cards, heading, periods, mapHeading, tabs, list);
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
  let shownEra,
    shownPeriod,
    shownStory,
    activeFamily,
    entries = new Map();
  list.onkeydown = e => {
    if (!e.target.matches('.uc-map-choice')) return;
    const buttons = [...entries.values()],
      n = buttons.indexOf(e.target);
    const dst = { ArrowDown: Math.min(n + 1, buttons.length - 1), ArrowUp: Math.max(0, n - 1), Home: 0, End: buttons.length - 1 }[e.key];
    if (dst !== undefined) {
      e.preventDefault();
      buttons[dst].focus();
    }
  };
  return {
    close: dial.close,
    show(era, period, story, family, date, variant) {
      if (era !== shownEra) {
        shownEra = era;
        [...cards.children].forEach((b, i) => press(b, eras[i] === era));
        dial.mount(era.periods);
      }
      if (period !== shownPeriod) {
        shownPeriod = period;
        shownStory = null;
        dial.show(period);
        tabs.replaceChildren();
        for (const p of new Set([...period.maps.keys()].map(f => f.p))) {
          const b = node('button', '', p.name);
          b.type = 'button';
          b.id = 'uc-story-' + p.id;
          b.dataset.profile = p.id;
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-controls', 'uc-story-panel');
          b.onclick = () => {
            if (shownStory !== p) pickStory(p);
          };
          tabs.append(b);
        }
        mapHeading.textContent = period.scenario ? 'Scenarios' : 'Maps';
        list.setAttribute('aria-label', period.scenario ? 'Scenarios' : 'Maps');
      }
      if (story !== shownStory) {
        shownStory = story;
        activeFamily = undefined;
        entries.clear();
        const section = node('section');
        section.dataset.profile = story.id;
        section.id = 'uc-story-panel';
        section.setAttribute('role', 'tabpanel');
        section.setAttribute('aria-labelledby', 'uc-story-' + story.id);
        list.replaceChildren(section);
        for (const b of tabs.children) {
          const active = b.dataset.profile === story.id;
          b.setAttribute('aria-selected', String(active));
          b.tabIndex = active ? 0 : -1;
          if (active) tabs.scrollLeft += b.getBoundingClientRect().left - tabs.getBoundingClientRect().left;
        }
        for (const f of period.maps.keys()) {
          if (f.p !== story) continue;
          const b = button('', () => pickMap(f), 'uc-map-choice');
          b.dataset.family = f.id;
          const label = node('span', '', f.title);
          if (f.span && f.span !== period.label) label.append(node('small', 'uc-map-span', f.span));
          b.append(label, node('small', 'uc-planet-count', planetCount(f, period.maps.get(f))));
          entries.set(f, b);
          section.append(b);
        }
        list.scrollTop = 0;
      }
      if (activeFamily !== family) {
        if (entries.has(activeFamily)) {
          const old = entries.get(activeFamily);
          press(old, false);
          old.lastElementChild.textContent = planetCount(activeFamily, period.maps.get(activeFamily));
        }
        branches.remove();
        branches.replaceChildren();
        activeFamily = family;
        if (family) {
          const b = entries.get(family);
          press(b, true);
          const dates = period.maps.get(family);
          if (dates.length > 1) {
            for (const d of dates) branches.append(button(d.label, () => pickDate(d)));
            b.after(branches);
          }
          b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
      for (const [f, b] of entries) b.tabIndex = f === (family || period.maps.keys().next().value) ? 0 : -1;
      if (family) {
        entries.get(family).lastElementChild.textContent = planetCount(family, period.maps.get(family), variant);
        [...branches.children].forEach((b, i) => press(b, period.maps.get(family)[i] === date));
      }
    },
    focus() {
      cards.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
  };
}
