import { db } from '../gamedata.js';

export const painterFactions = () => [...db.factions.values()].filter(f => f.bool('Is_Playable') && !f.bool('Is_Neutral')).map(f => f.name);
export const displayName = t => db.t(t?.str('Text_ID')) || t?.name.replace(/_/g, ' ') || '';
const modelFile = file => file && !/^(?:none|null|no)$/i.test(file.trim());

// Catalog bodies rather than company wrappers. A type can specify both a landed body and a space hull.
export function painterRoster(faction) {
  const rows = [],
    seen = new Set();
  for (const type of db.types.values()) {
    if (!type.list('Affiliation').some(f => f.toUpperCase() === faction.toUpperCase())) continue;
    const landBeh = type.list('LandBehavior'),
      spaceBeh = type.list('SpaceBehavior');
    for (const [domain, column, behaviors] of [
      ['Ground', 'Land_Model_Name', landBeh],
      ['Space', 'Space_Model_Name', spaceBeh]
    ]) {
      const file = type.str(column);
      if (!modelFile(file) || /death_clone|^cin_|_cinematic|_dummy/i.test(type.name)) continue;
      const mobile = [...behaviors, ...type.list('Behavior')].some(b => /_LOCOMOTOR$/i.test(b));
      if (!mobile && !(domain === 'Ground' ? /^(groundinfantry|groundvehicle)$/i : /^spaceunit$/i).test(type.tag)) continue;
      const label = displayName(type),
        key = domain + '|' + label + '|' + file.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // The deploy portrait ordinarily chooses land first. Hide the other body for this inspection only;
      // never mutate the mounted ObjType (the battle renderer may be using it at this very moment).
      const body = Object.create(type);
      body.str = (k, fallback) => (k === (domain === 'Space' ? 'Land_Model_Name' : 'Space_Model_Name') ? '' : type.str(k, fallback));
      rows.push({ type, body, label, domain, rank: domain === 'Space' ? 2 : /^GroundInfantry$/i.test(type.tag) ? 0 : 1 });
    }
  }
  return rows.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}
