// Resolve copy from the mounted battle location, never a placeholder planet.
export function battleBriefing(db, { map, mapFile, campaign }) {
  const clean = value => String(value ?? '').trim().replace(/^\[re\]\s*/i, '').trim();
  const valid = value => !!value && !/^(?:none|n\/a|text_none)$/i.test(value);
  const translated = id => {
    if (!valid(id)) return '';
    const value = clean(db.text.get(id.trim().toUpperCase()));
    return valid(value) ? value : '';
  };
  const file = (mapFile || '').split(/[\\/]/).pop().replace(/\.ted$/i, '');
  const fromFile = /^_MP_(?:SPACE|LAND)_(.+)$/i.exec(file)?.[1];
  const location = clean(map.planet);
  const literalTitle = /^\s*\[re\]/i.test(map.textId || '') ? clean(map.textId) : '';
  const mapLabel = translated(map.textId) || literalTitle || (valid(location) ? location : '') || (fromFile || file).replace(/_/g, ' ');
  const planetType = key => {
    const type = key && db.type(key);
    return type?.tag?.toLowerCase() === 'planet' ? type : null;
  };
  let planet = planetType(campaign?.planetType || location);
  // A TED can store a site label (e.g. 'Kuat Repair Yards') instead of a planet
  // ID. Accept its exact filename ID only when the site's own name agrees.
  if (!planet && !campaign && fromFile) {
    const id = fromFile.replace(/_/g, ' ').toLowerCase(), site = location.toLowerCase();
    if (site === id || site.startsWith(id + ' ')) planet = planetType(fromFile);
  }
  // Some maps are distributed under numbered or renamed TEDs. Resolve a named
  // facility only if its complete place prefix is itself an installed Planet ID.
  if (!planet && !campaign) {
    const facility = /^(.+?)\s+(?:repair yards|shipyards|orbital station|orbit)$/i.exec(mapLabel);
    if (facility) planet = planetType(facility[1].replace(/\s+/g, '_'));
  }
  const planetName = planet && (translated(planet.str('Text_ID')) || planet.name.replace(/_/g, ' '));
  const title = planetName || mapLabel || 'Tactical map';
  const site = mapLabel && mapLabel.toLowerCase() !== title.toLowerCase() ? mapLabel : '';
  const raw = planet?.str('Describe_History')?.trim();
  // Some mod planets inherit another world's history link but explicitly list
  // their own in the encyclopedia. Only consider history keys, never stat lines.
  const worldId = key => /^TEXT_PLANET_(.+)_INFO_HIS(?:_\d+)?$/i.exec(key || '')?.[1].toUpperCase();
  const identities = [planet?.name, planetName, planet?.str('Text_ID')?.replace(/^TEXT_OBJECT_(?:STAR_SYSTEM_|PLANET_)/i, '')]
    .filter(Boolean).map(s => s.replace(/\s+/g, '_').toUpperCase());
  const ownHistory = planet?.str('Encyclopedia_Text')?.split(/[\s,]+/).find(key => identities.includes(worldId(key)) && translated(key));
  const foreign = worldId(raw) && !identities.includes(worldId(raw)) && planetType(worldId(raw));
  const description = (!foreign && (translated(raw) || (valid(raw) && !/^TEXT_/i.test(raw) ? raw : ''))) || translated(ownHistory);
  return { title, site, description, planet };
}
