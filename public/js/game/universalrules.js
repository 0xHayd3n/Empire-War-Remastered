// Per-campaign data only. Never mutate shared type definitions or use the simulation RNG to choose an objective.
export const ruleFields = {
  treasury: { tag: 'Credit_Cap_Per_Planet', label: 'Treasury cap per owned planet', unit: 'credits', fallback: 40000, min: 1, max: 1e9 },
  politics: {
    tag: 'Political_Control_Change_Time_Seconds',
    label: 'Base time per political-control point',
    unit: 'seconds',
    fallback: 7,
    min: 0.01,
    max: 86400
  }
};
import { equalFooting, canonStart } from './universaleligibility.js';
import { envoyEligible } from './universalobjectives.js';
export const rescueCampaign = equalFooting;
export const validLoss = n => Number.isFinite(n) && n >= 0 && n <= 1;
export const revanId = '3417277973';
export function validValue(field, value) {
  const def = Object.hasOwn(ruleFields, field) && ruleFields[field];
  return !!def && Number.isFinite(value) && value >= def.min && value <= def.max;
}
export function resolvedOptions(raw) {
  const out = {};
  for (const key of Object.keys(ruleFields)) if (validValue(key, raw?.[key])) out[key] = raw[key];
  if (typeof raw?.payAsYouGo === 'boolean') out.payAsYouGo = raw.payAsYouGo;
  if (validLoss(raw?.transportLosses)) out.transportLosses = raw.transportLosses;
  return out;
}
// Start from owned worlds and follow the campaign's own movement graph. Never add a planet, object, or faction.
const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
export function expeditionSites(g, allies = []) {
  const roots = g.planets.filter(p => !p.background && !p.destroyed && same(p.owner, g.active)).map(p => p.index);
  const queue = [...roots],
    seen = new Set(roots),
    sites = [];
  for (let i = 0; i < queue.length && sites.length < 3; i++) {
    for (const { to } of g.links[queue[i]] || []) {
      const p = g.planets[to];
      if (seen.has(to) || !p || p.background || p.destroyed) continue;
      seen.add(to);
      queue.push(to);
      if (
        p.selectable &&
        !p.restricted &&
        !same(p.owner, g.active) &&
        !allies.some(n => same(n, p.owner)) &&
        p.type.bool('Planet_Surface_Accessible', true)
      )
        sites.push(p.name);
      if (sites.length === 3) break;
    }
  }
  return sites;
}
export function beginUniversalRules(g, options, allies) {
  const rules = resolvedOptions(options);
  if (options?.heroRescue === true && g.campaign?.name === rescueCampaign && g.active === 'Rebel') rules.rescue = { state: 'ready' };
  if (options?.envoy === true && envoyEligible(g)) rules.envoy = { state: 'travel' };
  if (options?.canonUnits === true && g.campaign?.name === canonStart && g.active === 'Rebel') rules.canon = { state: 'request' };
  if (options?.expedition === true) {
    const sites = expeditionSites(g, allies);
    if (!sites.length) throw new Error('This campaign has no connected expedition sites. Choose the authored path instead.');
    rules.expedition = { owner: g.active, sites, found: [] };
  }
  if (Object.keys(rules).length) g.universalRules = rules;
}
export function restoreUniversalRules(raw) {
  const rules = resolvedOptions(raw),
    x = raw?.expedition;
  if (
    typeof x?.owner === 'string' &&
    x.owner &&
    Array.isArray(x.sites) &&
    x.sites.length > 0 &&
    x.sites.length <= 3 &&
    x.sites.every(s => typeof s === 'string' && s.length > 0) &&
    new Set(x.sites).size === x.sites.length &&
    Array.isArray(x.found)
  ) {
    rules.expedition = { owner: x.owner, sites: [...x.sites], found: x.sites.filter(s => x.found.includes(s)) };
  }
  const envoy = raw?.envoy,
    canon = raw?.canon;
  if (['travel', 'complete', 'unavailable'].includes(envoy?.state)) rules.envoy = { state: envoy.state };
  if (envoy?.state === 'report' && Number.isFinite(envoy.until) && envoy.until >= 0) rules.envoy = { state: 'report', until: envoy.until };
  if (['request', 'ordered', 'unavailable'].includes(canon?.state)) rules.canon = { state: canon.state };
  if (canon?.state === 'category' && typeof canon.planet === 'string' && Number.isFinite(canon.deadline))
    rules.canon = { state: 'category', planet: canon.planet, deadline: canon.deadline };
  const hold = raw?.rescue;
  if (['ready', 'complete'].includes(hold?.state)) rules.rescue = { state: hold.state };
  if (hold?.state === 'captive' && typeof hold.prison === 'string' && hold.prison && typeof hold.jailer === 'string' && hold.jailer)
    rules.rescue = { state: 'captive', prison: hold.prison, jailer: hold.jailer };
  return Object.keys(rules).length ? rules : null;
}
// A completed survey stays recorded if the planet changes hands again. Award exactly once, using the target campaign's credit rules.
export function surveySite(g, name, owner, award) {
  const x = g.universalRules?.expedition;
  if (!x || !same(owner, x.owner) || !x.sites.includes(name) || x.found.includes(name)) return false;
  x.found.push(name);
  if (x.found.length === x.sites.length) award(3000);
  return true;
}
