// Keep playable rows (and their exact launch values) intact. Other sides
// present in this opening are read-only, including those without a homeworld.
export function campaignFactionCards(p, playable, openings) {
  const seen = new Set(playable.map(r => r.faction));
  const others = [];
  for (const { id, map } of openings) {
    for (const f of [...(p.presence?.[id] || []), ...(p.maps[map]?.worlds || []).map(w => w[1])]) {
      if (!f || seen.has(f) || !p.facts[f]) continue;
      seen.add(f);
      const fact = p.facts[f];
      others.push({ value: 'unavailable:' + f, label: fact.label?.trim() || f, fact, disabled: true });
    }
  }
  return playable.concat(others.sort((a, b) => a.label.localeCompare(b.label)));
}
