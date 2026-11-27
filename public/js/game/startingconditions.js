// Prefer native custom setup slots, not a change to any campaign's XML. Tech preferences use the levels the player sees.
const key = 'swr-new-conquest-conditions';
export const conditionNames = {
  credits: 'Opening credits',
  tech: 'Opening tech level',
  maxTech: 'Maximum tech level',
  autoResolve: 'Battle resolution'
};
export function conditionPrefs() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(key));
  } catch {}
  return Object.fromEntries(
    Object.keys(conditionNames)
      .filter(k => Number.isSafeInteger(saved?.[k]))
      .map(k => [k, saved[k]])
  );
}
export function saveCondition(k, value) {
  if (!Object.hasOwn(conditionNames, k)) return;
  const prefs = conditionPrefs();
  if (value === undefined) delete prefs[k];
  else if (Number.isSafeInteger(value)) prefs[k] = value;
  else return;
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {}
}
function available(p, r, k) {
  return (
    !r.scripted && r.limits?.custom && r.slots?.includes(k) && !((k === 'tech' || k === 'maxTech') && (p.yearLegend || r.eraProgression))
  );
}
function values(r, k) {
  if (k === 'autoResolve') return [0, 2];
  const l = r.limits,
    credit = k === 'credits',
    min = credit ? l.minCredits : l.minTech,
    max = credit ? l.maxCredits : l.maxTech,
    step = credit ? 1000 : 1;
  const list = [];
  for (let n = min; n <= max && list.length < (credit ? 1000 : 256); n += step) list.push(n);
  return list;
}
export function installedConditions(profiles, k) {
  const found = new Set();
  for (const p of profiles) for (const r of p.rows || []) if (available(p, r, k)) for (const n of values(r, k)) found.add(n);
  return [...found].sort((a, b) => a - b);
}
export function eligibleConditions(p, r, date, prefs) {
  const out = {};
  for (const [k, n] of Object.entries(prefs)) {
    if (!Object.hasOwn(conditionNames, k) || !available(p, r, k) || !values(r, k).includes(n)) continue;
    if (k === 'credits' && r.defaultFtguYear && r.defaultFtguYear === date.year) continue;
    const v = k === 'tech' || k === 'maxTech' ? n - (p.facts[r.faction].adj || 0) : n;
    if (v !== r.base[k]) out[k] = v;
  }
  // Do not silently grant a higher ceiling or lower the requested starting tech to make a preference fit.
  if ((out.tech ?? r.base.tech) > (out.maxTech ?? r.base.maxTech)) {
    delete out.tech;
    delete out.maxTech;
  }
  return out;
}
