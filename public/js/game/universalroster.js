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
export function campaignRoster(host, eras, { pickEra, pickPeriod, pickMap, pickDate }) {
  const cards = group('Era', 'uc-era-strip'),
    periods = group('Time period', 'uc-periods'),
    list = node('div', 'uc-map-list'),
    branches = group('Starting variant', 'uc-branches');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Maps');
  const heading = node('h2', 'uc-nav-heading', 'Time period'),
    mapHeading = node('h2', 'uc-nav-heading', 'Map'),
    readout = node('span', 'uc-year-value'),
    dial = yearTrack(periods, readout, pickPeriod);
  heading.append(readout);
  host.append(cards, heading, periods, mapHeading, list);
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
    show(era, period, family, date) {
      if (era !== shownEra) {
        shownEra = era;
        [...cards.children].forEach((b, i) => press(b, eras[i] === era));
        dial.mount(era.periods);
      }
      if (period !== shownPeriod) {
        shownPeriod = period;
        activeFamily = undefined;
        entries.clear();
        list.replaceChildren();
        let previous, section;
        dial.show(period);
        mapHeading.textContent = period.scenario ? 'Scenarios' : 'Map';
        list.setAttribute('aria-label', period.scenario ? 'Scenarios' : 'Maps');
        for (const f of period.maps.keys()) {
          if (previous !== f.p) {
            previous = f.p;
            section = node('section');
            section.dataset.profile = f.p.id;
            section.append(node('h3', '', f.p.name));
            list.append(section);
          }
          const b = button('', () => pickMap(f), 'uc-map-choice');
          b.dataset.family = f.id;
          b.append(node('span', '', f.title));
          if (f.span && f.span !== period.label) b.append(node('small', '', f.span));
          entries.set(f, b);
          section.append(b);
        }
        list.scrollTop = 0;
      }
      if (activeFamily !== family) {
        if (entries.has(activeFamily)) press(entries.get(activeFamily), false);
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
      if (family) [...branches.children].forEach((b, i) => press(b, period.maps.get(family)[i] === date));
    },
    focus() {
      cards.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
  };
}
