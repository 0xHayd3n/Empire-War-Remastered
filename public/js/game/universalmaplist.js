// Display group identity is never a launch ID. Each selectable start retains its exact atlas row and variant.
const yearAtStart = /^(\d+(?:\.\d+)?)\s*(BBY|ABY)\b/i;
const datePrefix = /^((?:\d+(?:\.\d+)?\s*(?:[-–]\s*\d+(?:\.\d+)?\s*)?)(?:BBY|ABY))\s*:\s*(.+)$/i;
function dateParts(label) {
  const m = yearAtStart.exec(label);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : '';
}
export function techCalendar(p, r) {
  return r.limits.custom && r.slots.includes('tech') && !!p.yearLegend;
}
function startsFor(p, r, prefix) {
  const first = r.variants[r.initial] || r.variants[0];
  if (r.defaultFtguYear) {
    const year = r.defaultFtguYear;
    return [
      { row: r, variant: first, label: year, year, ftgu: true, initial: true },
      { row: r, variant: first, label: 'Configurable start', year: '', initial: false }
    ];
  }
  if (!techCalendar(p, r))
    return r.variants.map(v => {
      const label = v.date || prefix || 'Authored start';
      return { row: r, variant: v, label, year: dateParts(label), ftgu: r.eraProgression, initial: v === first };
    });
  const legend = new Map([...p.yearLegend.matchAll(/^(\d+)\.\s*-\s*(.+)$/gm)].map(m => [+m[1], m[2].trim()])),
    adj = p.facts[r.faction].adj,
    starts = [];
  for (let n = r.limits.minTech; n <= r.limits.maxTech && starts.length < 256; n++) {
    const tech = n - adj,
      initial = tech === r.base.tech,
      description = legend.get(n) || String(n),
      year = dateParts(description);
    const ftgu = n === 1 && r.prewarFtgu,
      label = ftgu ? 'FTGU · pre-22 BBY' : r.scripted && /FTGU-only/i.test(description) ? `Starting tech ${n}` : year || description;
    starts.push({ row: r, variant: first, label, year, ftgu, initial, tech: initial ? undefined : tech });
  }
  if (!starts.some(s => s.initial)) starts.unshift({ row: r, variant: first, label: 'Campaign default', year: '', initial: true });
  return starts;
}
export function mapFamilies(p) {
  const buckets = new Map();
  for (const row of p.rows) {
    const k = JSON.stringify(row.family ? ['set', row.family] : ['row', row.id]);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(row);
  }
  const result = [];
  for (const rows of buckets.values()) {
    // Malformed/reused sets can have multiple distinct starts for the same faction. Keep every exact row reachable.
    const ambiguous = new Set(rows.map(r => r.faction)).size !== rows.length;
    for (const members of ambiguous ? rows.map(r => [r]) : [rows]) {
      const r = members[0],
        label = r.label.replace(/\s+/g, ' ').trim(),
        prefix = datePrefix.exec(label),
        starts = new Map();
      for (const member of members) {
        const choices = startsFor(p, member, prefix && yearAtStart.test(prefix[1]) ? prefix[1] : '');
        for (const s of choices) {
          let key = s.label;
          if (choices.filter(c => c.label === s.label).length > 1) key += ' — ' + (s.tech ?? s.variant.id);
          if (!starts.has(key)) starts.set(key, { label: key, year: s.year, ftgu: s.ftgu, choices: [] });
          starts.get(key).choices.push(s);
        }
      }
      let dates = [...starts.values()];
      if (dates.every(d => d.year)) {
        const time = d => parseFloat(d.year) * (d.year.endsWith('BBY') ? -1 : 1);
        dates.sort((a, b) => time(a) - time(b));
      }
      result.push({ p, id: r.id, title: prefix?.[2] || label, span: prefix?.[1] || '', members, dates });
    }
  }
  // Display-name collisions across different authored sets are not grounds to combine them.
  const names = new Map();
  for (const f of result) {
    const k = f.title + '|' + f.span;
    names.set(k, (names.get(k) || 0) + 1);
  }
  for (const f of result) if (names.get(f.title + '|' + f.span) > 1) f.title += ' — ' + f.id;
  return result;
}
export function mapStart(family, priorDate, preferredFaction) {
  const base = family.members.find(r => r.faction === preferredFaction) || family.members[0];
  const authored = family.dates.find(d => d.choices.some(s => s.row === base && s.initial)) || family.dates[0];
  const matches = priorDate?.year ? family.dates.filter(d => d.year === priorDate.year) : [];
  const date = matches.find(d => d.label === priorDate.label) || (matches.length === 1 ? matches[0] : authored);
  const choice = date.choices.find(s => s.row === base) || date.choices[0];
  return { date, choice };
}
