import { calendarYear } from './universalyeartrack.js';
import { chronology, periods as eraNames } from './universalmodes.js';
import { mapFamilies, mapStart, techCalendar } from './universalmaplist.js';

// A period is a filter over real starts, never a launch destination. A span on a historical
// scenario is descriptive: do not advertise every year inside it as a selectable start.
const scenario = 'Scenario starts';
export function periodOf(f, d) {
  if (d.year) return d.year;
  if (techCalendar(f.p, d.choices[0].row) && d.label !== 'Campaign default') return d.label;
  return scenario;
}
const time = label => calendarYear(label) ?? Infinity;
export function eraTimeline(data) {
  const profiles = new Map(data.profiles.map(p => [p.id, p]));
  return chronology.map(name => {
    const by = new Map(),
      missing = [];
    let first;
    for (const e of data.eras.filter(e => eraNames[e.id] === name)) {
      const p = profiles.get(e.id),
        maps = e.ready && p ? mapFamilies(p).filter(f => f.dates.length) : [];
      if (!maps.length) {
        missing.push(`${e.name} · ${!e.ready ? 'Not built' : !p ? 'Unavailable' : 'No listed maps'}`);
        continue;
      }
      for (const family of maps) {
        first ??= family;
        for (const date of family.dates) {
          const key = periodOf(family, date);
          if (!by.has(key)) by.set(key, new Map());
          const entries = by.get(key);
          if (!entries.has(family)) entries.set(family, []);
          entries.get(family).push(date);
        }
      }
    }
    const periods = [...by]
      .map(([label, maps]) => ({ label, maps }))
      .sort((a, b) => (a.label === scenario) - (b.label === scenario) || time(a.label) - time(b.label) || a.label.localeCompare(b.label));
    return { name, periods, missing, first };
  });
}
// Only choose within the selected map and the filtered subset. Keep faction keys profile-local.
export function startWithin(f, dates, prior, faction) {
  const authored = mapStart(f, null, faction).date;
  const pool = dates.filter(d => d.choices.some(s => s.row.faction === faction));
  const candidates = pool.length ? pool : dates;
  const date = candidates.find(d => d.label === prior?.label) || (candidates.includes(authored) ? authored : candidates[0]);
  return { date, choice: date.choices.find(s => s.row.faction === faction) || date.choices[0] };
}
