import { mapFamilies } from './universalmaplist.js';
import { mapSections } from './universalmapgroups.js';

// The GC Story tab already identifies author-labeled story scenarios. Keep its
// exact family/variant membership; a translated display name isn't a launch ID.
export function soloStories(p, solo) {
  const groups = (solo?.native || []).map(c => ({
    p,
    title: c.title,
    choices: [{ id: c.id, faction: c.faction, description: c.description, credits: c.credits, native: c }]
  }));
  const families = mapFamilies(p),
    section = mapSections({ scenario: true, maps: new Map(families.map(f => [f, f.dates])) }).find(x => x.name === 'Story');
  for (const row of section?.rows || [])
    for (const leaf of row.children || [row]) {
      const f = leaf.f,
        title = row.children ? `${row.title} · ${leaf.title}` : leaf.title;
      for (const date of f.dates) {
        const choices = date.choices.map(s => ({
          id: s.variant.id,
          faction: s.row.faction,
          description: s.row.description,
          credits: s.variant.id === s.row.id ? s.row.base?.credits : undefined,
          scripted: s.row.scripted,
          map: s.variant.map,
          row: s.row.id,
          tech: s.tech
        }));
        if (choices.length) groups.push({ p, title: title + (f.dates.length > 1 ? ' · ' + date.label : ''), choices });
      }
    }
  return groups;
}
