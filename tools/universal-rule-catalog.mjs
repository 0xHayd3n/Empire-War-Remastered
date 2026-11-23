import fs from 'node:fs';
import { parseXML } from '../public/js/xml.js';
import { ruleFields, validValue, revanId } from '../public/js/game/universalrules.js';
import { listPacks, loadPack } from './universal-library.mjs';

// Inspect only explicitly authored, allowlisted fields. No arbitrary Lua/JS is imported or run.
export function portableRules(pack) {
  const key = 'DATA\\XML\\GAMECONSTANTS.XML',
    e = pack.entries.get(key),
    values = {};
  if (e && e.size <= 8 * 1024 * 1024) {
    e.ensure();
    const node = parseXML(fs.readFileSync(e.file, 'latin1')).children[0];
    for (const [field, { tag }] of Object.entries(ruleFields)) {
      const raw = node?.val(tag),
        value = Number(raw);
      if (raw && validValue(field, value)) values[field] = value;
    }
  }
  const hasSearch =
    pack.mounted.workshop === revanId && [...pack.entries].some(([k, entry]) => entry && k.endsWith('\\GOVERNMENTSTARFORGESEARCH.LUA'));
  return { values, hasSearch };
}
export function campaignRulesCatalog(home, lib) {
  const donors = [],
    unavailable = [];
  for (const { id, name, ready } of listPacks(home)) {
    if (!ready) continue;
    try {
      if (lib.ambiguous?.has(id)) throw new Error('ambiguous');
      const pack = loadPack(home, id, lib.items.get(id)?.folder);
      donors.push({ id, name, ...portableRules(pack) });
    } catch {
      unavailable.push(name);
    }
  }
  return { donors, unavailable };
}
