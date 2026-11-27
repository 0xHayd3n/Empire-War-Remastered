// The setup board and battle installers use exactly the same names and costs.
// A preview is data only: browsing a fleet must not mutate the host database.
export const COMBAT_KIT = 3;
export const factionKey = (profile, faction) => `UXF_${profile}__${faction}`;
const sourcePattern = /^(?:stock|\d{1,20})$/;
export function checkSource({ profile, revision, faction }, domain) {
  if (
    !sourcePattern.test(profile) ||
    !(profile === 'stock' ? revision === 'stock' : /^[a-f0-9]{64}$/.test(revision)) ||
    !/^[-\w]{1,100}$/.test(faction) ||
    !['land', 'space'].includes(domain)
  )
    throw Error('Invalid tactical faction source.');
}
export function productName(k, r) {
  const root = factionKey(k.id, k.faction) + '__';
  return root + (k.domain === 'land' || r.members.length ? 'GROUP__' + r.name : r.body);
}
export const productCost = r => Math.max(50, Math.min(10000, r.cost || 350));
export function productList(k) {
  const classes = ['fighter', 'bomber', 'transport', 'corvette', 'frigate', 'capital', 'super'];
  return k.roster.map(r => {
    const props = k.defs[r.body || r.members[0]]?.props || {};
    const cls = classes.findIndex(name =>
      String(props.ship_class || '')
        .toLowerCase()
        .startsWith(name)
    );
    return {
      name: productName(k, r),
      label: r.label || r.name,
      cost: productCost(r),
      cls: cls < 0 ? (r.members.length ? 0 : 4) : cls,
      hero: false,
      icon: ''
    };
  });
}
// The opening is an autonomous detachment, unlike the full build/outfitting list.
// Don't make a seat's first exchange depend on a player deploying artillery or
// manually spawning payloads. Keep those products selectable at their real price.
export function openingProducts(k) {
  const conditional = r =>
    k.domain === 'land' &&
    (r.members.length ? r.members : [r.body]).every(n => {
      const p = k.defs[n]?.props;
      return /^(no|false|0)$/i.test(p?.fire_weapon_when_undeployed) || Number(p?.targeting_min_attack_distance) > 0;
    });
  return [...k.roster]
    .sort((a, b) => Number(conditional(a)) - Number(conditional(b)) || productCost(a) - productCost(b))
    .slice(0, 2)
    .map(r => productName(k, r));
}
export function guestRefs(refs) {
  const byKey = new Map();
  for (const ref of refs.filter(Boolean)) {
    const key = factionKey(ref.profile, ref.faction),
      prior = byKey.get(key);
    if (prior && prior.revision !== ref.revision) throw Error('Two revisions of the same faction were selected.');
    byKey.set(key, ref);
  }
  return [...byKey.values()];
}
const reads = new Map();
export function readDetachment(ref, domain, language) {
  checkSource(ref, domain);
  const { profile, revision, faction } = ref,
    query = new URLSearchParams({ profile, revision, faction, domain, language }),
    key = query.toString();
  if (!reads.has(key)) {
    const task = (async () => {
      const r = await fetch('/api/universal/atlas/roster?' + key);
      if (!r.ok) throw Error(`No ${domain} detachment for ${faction} at the selected revision.`);
      const k = await r.json();
      if (
        k.id !== profile ||
        k.revision !== revision ||
        k.faction !== faction ||
        k.domain !== domain ||
        !Array.isArray(k.roster) ||
        !k.roster.length
      )
        throw Error('Incorrect tactical roster source.');
      if (k.combatSchema !== COMBAT_KIT)
        throw Error('This Universal server has an older combat roster. Save open games and restart Universal to use cross-era forces.');
      return k;
    })().catch(e => {
      reads.delete(key);
      throw e;
    });
    reads.set(key, task);
  }
  return reads.get(key);
}
export function factionChoices(profiles, current, native, domain) {
  const choices = new Map();
  for (const p of profiles)
    for (const id of p.skirmishFactions || []) {
      const a = p.availability?.[id],
        home = p.id === current && native.includes(id) && a?.['native' + domain] !== false;
      if (!home && !a?.[domain]) continue;
      const ref = { profile: p.id, revision: p.revision, faction: id },
        key = home ? id : factionKey(p.id, id);
      const note = !home && a?.[domain + 'Note'];
      choices.set(key, {
        ref,
        home,
        label: [p.commanders?.[id]?.displayFaction || p.facts?.[id]?.label || p.commanders?.[id]?.family || id, p.name, note]
          .filter(Boolean)
          .join(' · ')
      });
    }
  return choices;
}
