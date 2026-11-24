// Presentation only. A period already contains the exact playable families and
// dates. Group within that set; never construct a campaign or infer a start.
export const scenarioTypes = ['Story', 'Random', 'Sandbox', 'Miscellaneous'];
const tag = /^(Story|Random|Sandbox)\s*(?:--?|[–—:])\s*(?=\S)/i;
function sizes(leaf) {
  const { f } = leaf;
  // mapFamilies disambiguates reused display names with the exact row ID. Keep
  // that full label on ungrouped rows and accessible names; it isn't a size.
  const tail = ' — ' + f.id,
    title = leaf.title.endsWith(tail) ? leaf.title.slice(0, -tail.length) : leaf.title;
  // Keep all authored qualifiers. For example, a Lite Big Campaign is not the
  // same as a Lite Campaign, nor is a Beginner Web Way an Imperial Web Way.
  const subtitle = /^(.+?)\s+--\s+((?:Full|Lite|Intro)(?: Big)? (?:Campaign|Random))$/i.exec(title);
  if (subtitle) {
    // Some authored subtitles repeat verbatim across the classic and big layouts.
    // Only use a distinguishing token explicitly present in the campaign set.
    const layout = /(?:^|_)(BIG|CLASSIC)(?:_|$)/i.exec(f.members[0].family || '')?.[1].toLowerCase();
    const extra = layout && !subtitle[2].toLowerCase().split(' ').includes(layout) ? ' · ' + layout[0].toUpperCase() + layout.slice(1) : '';
    return [subtitle[1], subtitle[2] + extra];
  }
  const suffix = /^(.+?)(?:\s+[-–—]\s+|\s+)(Large|Medium|Small|Lite|Standard|Grand)$/i.exec(title);
  if (suffix) return [suffix[1], suffix[2]];
  const layout = /^(Full|Lite) (.+ Layout)$/i.exec(title);
  return layout && [layout[2], layout[1]];
}
export function mapSections(period) {
  const by = new Map();
  for (const f of period.maps.keys()) {
    const match = period.scenario && tag.exec(f.title),
      section = period.scenario ? scenarioTypes.find(s => s.toLowerCase() === match?.[1]?.toLowerCase()) || 'Miscellaneous' : '';
    if (!by.has(section)) by.set(section, []);
    by.get(section).push({ f, title: match ? f.title.slice(match[0].length) : f.title });
  }
  return (period.scenario ? scenarioTypes : [''])
    .filter(s => by.has(s))
    .map(name => {
      const leaves = by.get(name),
        candidates = new Map(),
        forLeaf = new Map();
      for (const leaf of leaves) {
        const split = sizes(leaf);
        if (!split) continue;
        const [title, size] = split,
          { f } = leaf,
          key = JSON.stringify([f.p.id, name, title.toLowerCase(), f.span, f.members.every(r => r.scripted)]);
        if (!candidates.has(key)) candidates.set(key, { key, title, children: [] });
        const group = candidates.get(key);
        group.children.push({ f, title: size });
        forLeaf.set(leaf, group);
      }
      const rows = [],
        seen = new Set();
      for (const leaf of leaves) {
        const g = forLeaf.get(leaf);
        if (!g || g.children.length < 2 || new Set(g.children.map(c => c.title.toLowerCase())).size !== g.children.length) {
          rows.push(leaf);
          continue;
        }
        if (!seen.has(g)) {
          seen.add(g);
          rows.push(g);
        }
      }
      return { name, rows };
    });
}
