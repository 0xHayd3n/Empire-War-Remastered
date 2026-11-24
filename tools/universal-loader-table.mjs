// Read only the literal tables used by attested selector revisions. Never execute a pack's Lua in Node.
export function menuTable(source) {
  const tokens = source.replace(/--[^\r\n]*/g, '').match(/"[A-Za-z0-9_.]*"|[A-Za-z]+|\S/g) || [];
  let i = 0;
  function eat(t) {
    if (tokens[i++] !== t) throw Error('Unrecognized selector table');
  }
  function value() {
    const t = tokens[i];
    if (t === '{') return table();
    i++;
    if (t === 'true' || t === 'false') return t === 'true';
    if (/^"[\w.]*"$/.test(t)) return t.slice(1, -1);
    throw Error('Non-literal selector value');
  }
  function table() {
    eat('{');
    const obj = Object.create(null),
      list = [];
    while (tokens[i] !== '}') {
      if (tokens[i] === '[') {
        eat('[');
        const key = value();
        eat(']');
        eat('=');
        obj[key] = value();
      } else list.push(value());
      if (tokens[i] !== '}') eat(',');
    }
    eat('}');
    if (list.length && Object.keys(obj).length) throw Error('Mixed selector table');
    return list.length ? list : obj;
  }
  eat('return');
  const result = table();
  if (i !== tokens.length) throw Error('Trailing selector code');
  return result;
}
// This release enables the first seven progressive era buttons. A map/date/faction must also be enabled
// in the authored availability table and resolve to a real single-player scenario in the mounted VFS.
export { thrawnRevision } from '../public/js/game/universaleligibility.js';
export const customOpenings = new Map(['Small', 'Medium', 'Large', 'FTGU', 'Influencers'].map(size => ['Custom_' + size, size]));
export function thrawnSelections(trans, availability) {
  const rows = [];
  // Only the 4 ABY Custom/FTGU opening is translated. Later starts, including
  // the additional 6 ABY Imperial regime dialog, remain in the native selector.
  const ftgu = (trans.CustomMaps || []).filter(m => m === 'FTGU' || customOpenings.has(m));
  for (const map of [...trans.ProgressiveMaps, ...trans.RegionalMaps, ...trans.HistoricalMaps, ...ftgu]) {
    const historical = trans.HistoricalMaps.includes(map);
    for (const faction of trans.AllFactions) {
      if (faction === 'IMPERIAL_PROTEUS') continue; // separate subfaction chooser, not an ordinary start
      const targets = [];
      for (const era of historical ? ['Historical'] : trans.ProgressiveEras.slice(0, 7)) {
        if (ftgu.includes(map) && era !== '4ABY') continue;
        if (availability[map]?.[era]?.[faction] !== true) continue;
        const base = [map, historical ? '' : trans.Era_XML_Nums[era], faction].filter(Boolean).join('_'),
          date = historical ? '' : era.replace('ABY', ' ABY');
        if (era === '6ABY' && faction === 'EMPIRE' && /known|full|westernreaches|borderlands|stars_align/i.test(map)) {
          targets.push([base, date + ' · Isard'], [base + '_CCoGM', date + ' · Central Committee']);
        } else targets.push([base, date]);
      }
      if (targets.length) rows.push({ map, targets });
    }
  }
  return rows;
}
