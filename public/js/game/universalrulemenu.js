import { ruleFields, validValue } from './universalrules.js';

// Equal values get one row, with attribution. Never resolve a preset to an override for a native value.
export function ruleChoices(donors, field, native) {
  const by = new Map();
  for (const d of donors) {
    const value = d.values[field];
    if (value === native || !validValue(field, value)) continue;
    if (!by.has(value)) by.set(value, []);
    by.get(value).push(d.name);
  }
  return [...by].sort(([a], [b]) => a - b);
}
const fields = Object.keys(ruleFields);
export function rulePresets(donors, defaults) {
  const groups = new Map();
  for (const d of donors) {
    if (!fields.every(k => validValue(k, d.values[k]))) continue;
    const overrides = Object.fromEntries(fields.filter(k => d.values[k] !== defaults[k]).map(k => [k, d.values[k]]));
    if (!Object.keys(overrides).length) continue;
    const key = JSON.stringify(overrides);
    if (!groups.has(key)) groups.set(key, { key, options: overrides, names: [] });
    groups.get(key).names.push(d.name);
  }
  return [...groups.values()].map(g => ({ ...g, label: g.names.join(' / ') }));
}
