// Report authored participants for a specific opening, not all factions in the
// primary pack. This is display metadata and is never a source of launch IDs.
export function campaignPresence(campaigns, facts, targets) {
  const known = new Map(Object.keys(facts).map(id => [id.toUpperCase(), id]));
  const result = {};
  for (const id of new Set([...targets, 'Full_Story_Campaign_Underworld'])) {
    const c = campaigns.get(id.toUpperCase());
    if (!c) continue;
    const sides = new Set(),
      locations = new Set(c.list('Locations').map(n => n.toUpperCase()));
    const add = n => {
      const f = known.get(n?.toUpperCase());
      if (f) sides.add(f);
    };
    add(c.str('Starting_Active_Player'));
    for (const k of ['AI_Player_Control', 'Starting_Credits', 'Home_Location']) for (const [f] of c.tuples(k)) add(f);
    for (const [f, world] of c.tuples('Starting_Forces')) if (locations.has(world?.toUpperCase())) add(f);
    result[id] = [...sides];
  }
  return result;
}
