import { factionChoices, factionKey, readDetachment, productList, openingProducts } from './tacticalroster.js';
import { activeLanguage } from '../language.js';

// Private to this setup screen. A late reply can warm a kit but never change the
// currently selected seat. The launch carries only immutable source references.
export function instantForces(catalog, current, native) {
  const choices = Object.fromEntries(['land', 'space'].map(d => [d, factionChoices(catalog, current, native, d)]));
  const ready = new Map();
  const get = (domain, value) => choices[domain].get(value);
  function resolve(domain, ref) {
    if (!ref || typeof ref !== 'object') return null;
    const value = ref.profile === current && get(domain, ref.faction)?.home ? ref.faction : factionKey(ref.profile, ref.faction);
    const c = get(domain, value);
    return c && c.ref.revision === ref.revision ? value : null;
  }
  const id = (domain, value) => domain + ':' + value;
  async function load(domain, value) {
    const c = get(domain, value);
    if (!c) throw Error('This faction or revision is not available. Choose another faction.');
    if (!c.home && !ready.has(id(domain, value))) {
      const k = await readDetachment(c.ref, domain, activeLanguage);
      ready.set(id(domain, value), { roster: productList(k), opening: openingProducts(k) });
    }
  }
  return {
    get,
    resolve,
    load,
    options: d => [...choices[d]].map(([k, c]) => [k, c.label]),
    guest: (d, v) => !!get(d, v) && !get(d, v).home,
    roster: v => ready.get(id('space', v))?.roster || [],
    groundRoster: v => ready.get(id('land', v))?.roster || [],
    ground: (v, company = '') => {
      const kit = ready.get(id('land', v));
      if (!kit) return [];
      return company ? (kit.roster.some(r => r.name === company) ? [company] : []) : kit.opening;
    }
  };
}

// Moving a battle between local origins sends quantities rather than thousands of repeated names.
export function packArmy(army) {
  const runs = [];
  for (const name of army) {
    const last = runs.at(-1);
    if (last?.[0] === name) last[1]++;
    else runs.push([name, 1]);
  }
  return runs;
}
export function unpackArmy(counts) {
  if (!Array.isArray(counts) || counts.length > 4000) throw Error('Invalid fleet draft.');
  const army = [];
  for (const row of counts) {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      typeof row[0] !== 'string' ||
      row[0].length > 400 ||
      !Number.isInteger(row[1]) ||
      row[1] < 1 ||
      row[1] > 4000 - army.length
    )
      throw Error('Invalid fleet quantity.');
    army.push(...Array(row[1]).fill(row[0]));
  }
  return army;
}
