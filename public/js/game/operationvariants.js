// One rules card per queue. Modes here describe the actual engines used at launch, not lobby filters.
export const operations = [
  { id: 'establish', name: 'Build a foothold', pitch: 'Start small. Turn infrastructure into an advantage.', art: 'chart' },
  { id: 'strike', name: 'Strike now', pitch: 'Skip the build-up. Execute a focused combat objective.', art: 'fleet' }
];
export const variants = [
  {
    id: 'orbital-foundry',
    op: 'establish',
    name: 'Orbital Foundry',
    domain: 'space',
    type: 'space',
    art: 'fleet',
    pitch: 'Protect your shipyard, earn credits and dismantle the rival fleet.',
    rule: '3,500 opening credits · fog of war · 18 population',
    credits: 3500,
    fog: true,
    popCap: 18,
    preBuilt: true
  },
  {
    id: 'beachhead',
    op: 'establish',
    name: 'Beachhead',
    domain: 'land',
    type: 'land',
    art: 'surface',
    pitch: 'Land on an undeveloped front. Choose which buildings to buy before pushing into enemy territory.',
    rule: '9,000 opening credits · no pre-built base · fog of war',
    credits: 9000,
    fog: true,
    popCap: 0,
    preBuilt: false
  },
  {
    id: 'last-flight',
    op: 'strike',
    name: 'Last Flight',
    domain: 'space',
    type: 'instant',
    art: 'fleet',
    pitch: 'Jump in with a command ship and two escorts. Eliminate the opposing force. There is no shipyard to replace losses.',
    rule: 'Issued battle group · zero budget · open sensors',
    credits: 0,
    fog: false,
    popCap: 0,
    preBuilt: false
  },
  {
    id: 'signal-lock',
    op: 'strike',
    name: 'Signal Lock',
    domain: 'land',
    type: 'control',
    art: 'surface',
    pitch: 'Seize every domination point and hold through the native victory countdown. Losing a point breaks the lock.',
    rule: 'Control maps only · pre-built bases · open sensors',
    credits: 6000,
    fog: false,
    popCap: 0,
    preBuilt: true
  }
];
export const variantOf = id => variants.find(v => v.id === id);
export function issuedFleet(roster) {
  // Match the rules to the mounted faction's real, non-hero roster. Stable internal names, never localized sorting.
  const pool = roster.filter(r => !r.hero).sort((a, b) => b.cost - a.cost || (a.name < b.name ? -1 : 1));
  const lead = pool.find(r => r.cls >= 3 && r.cls <= 4) || pool[0];
  const escort = pool.find(r => r !== lead && r.cls >= 2 && r.cls <= 3) || pool.find(r => r !== lead) || lead;
  return lead ? [lead.name, escort.name, escort.name] : [];
}
