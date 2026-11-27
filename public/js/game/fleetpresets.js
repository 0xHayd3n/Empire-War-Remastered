// Keep the v1 blueprint key and wire shape. Unit flight cards have their own store;
// neither feature edits XML types, campaign saves, or multiplayer setup.
import { loadContent } from '../content.js';
export const MAX_UNITS = 256;
export function fleetKey(content, pack = '') {
  const mods = content.mods.map(m => [m.workshop || m.name, m.version || '', m.packRevision || '']);
  // /api/mounted can fail closed (empty list) on static/offline clients. Never
  // fall through to stock if the Universal game document identifies a pack.
  if (pack && !mods.some(([id, , rev]) => `${id}:${rev}` === pack)) mods.unshift(['universal', pack]);
  return 'swr-fleet-presets-v1:' + JSON.stringify([content.edition, ...mods]);
}
export async function presetKey() {
  return fleetKey(await loadContent(), globalThis.document?.querySelector('meta[name="swr-pack-revision"]')?.content);
}
const cardKey = key => 'swr-unit-cards-v1:' + key;
const blueprint = p =>
  p &&
  typeof p.id === 'string' &&
  typeof p.name === 'string' &&
  typeof p.faction === 'string' &&
  Array.isArray(p.units) &&
  p.units.length > 0 &&
  p.units.length <= MAX_UNITS &&
  p.units.every(n => typeof n === 'string');
const quantity = n => Number.isInteger(n) && n >= 1 && n <= MAX_UNITS;
const cardShape = c =>
  c &&
  typeof c.faction === 'string' &&
  typeof c.lead === 'string' &&
  c.lead &&
  quantity(c.copies) &&
  (c.support === '' ? c.wing === 0 : typeof c.support === 'string' && c.support !== c.lead && quantity(c.wing)) &&
  c.copies + c.wing <= MAX_UNITS;
function rows(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return [];
  const a = JSON.parse(raw);
  if (!Array.isArray(a)) throw Error('Unreadable library');
  return a;
}
function read(key, shape, warn) {
  try {
    return rows(key).filter(shape);
  } catch {
    warn?.('Local presets could not be read. Existing data was left in place.');
    return [];
  }
}
// Read before every write. Refuse to overwrite damaged/blocked storage and
// retain unrecognized entries so old data is not destroyed by a filter.
function revise(key, change) {
  let old;
  try {
    old = rows(key);
  } catch {
    throw Error('The saved library cannot be read. Nothing was changed.');
  }
  const next = change(old);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    throw Error('Could not write to browser storage. Free space or allow local storage and try again.');
  }
}
export const readPresets = (key, warn) => read(key, blueprint, warn);
export const readCards = (key, warn) => read(cardKey(key), cardShape, warn);
export function savePreset(key, p) {
  if (!blueprint(p) || !p.name.trim()) throw Error('Name a non-empty blueprint first.');
  revise(key, old => {
    const all = old.filter(r => r?.id !== p.id);
    if (all.filter(blueprint).length >= 60) throw Error('This profile already has 60 presets. Remove one first.');
    return [...all, p];
  });
}
export const removePreset = (key, id) => revise(key, old => old.filter(r => r?.id !== id));
export function checkFleet(p, faction, roster, budget = Infinity) {
  if (!p || p.faction !== faction || !Array.isArray(p.units) || !p.units.length)
    return { error: 'Select a non-empty preset for this faction.' };
  if (p.units.length > MAX_UNITS) return { error: `A preset fleet can hold at most ${MAX_UNITS} units.` };
  const by = new Map(roster.map(r => [r.name, r])),
    seen = new Set();
  let cost = 0;
  for (const id of p.units) {
    const r = by.get(id);
    if (!r) return { error: 'A unit is no longer in this roster. Edit the preset in Customize.' };
    if (r.hero && seen.has(id)) return { error: 'This roster only allows one of each hero.' };
    seen.add(id);
    cost += r.cost;
  }
  return cost > budget
    ? { error: `Needs ${cost.toLocaleString()} credits. Increase the fleet budget or choose another preset.` }
    : { cost };
}
export function planCard(card, faction, roster, existing = [], budget = Infinity) {
  if (card?.faction !== faction) return { error: 'Select a flight card for this faction.' };
  if (!cardShape(card)) return { error: `Use whole unit counts, up to ${MAX_UNITS} units in total.` };
  const units = [...Array(card.copies).fill(card.lead), ...Array(card.wing).fill(card.support)];
  const check = checkFleet({ faction, units: [...existing, ...units] }, faction, roster, budget);
  return check.error ? check : { units, cost: check.cost };
}
const sameCard = (a, b) => a?.faction === b.faction && a?.lead === b.lead;
export function saveCard(key, card, faction, roster) {
  const { error } = planCard(card, faction, roster);
  if (error) throw Error(error);
  revise(cardKey(key), old => [...old.filter(c => !sameCard(c, card)), card]);
}
export const removeCard = (key, card) => revise(cardKey(key), old => old.filter(c => !sameCard(c, card)));
