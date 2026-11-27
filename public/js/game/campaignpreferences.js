import { ruleFields, resolvedOptions, validLoss, validValue } from './universalrules.js';

const KEY = 'swr-new-conquest-defaults';
export const campaignFields = {
  treasury: ruleFields.treasury.label,
  politics: ruleFields.politics.label,
  payAsYouGo: 'Your production payments',
  buildTime: 'Your construction time',
  transportLosses: 'Your transport losses on auto-resolve'
};
export function campaignPreferences() {
  try {
    return resolvedOptions(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return {};
  }
}
export function setCampaignPreference(key, value) {
  const next = resolvedOptions({ ...campaignPreferences(), [key]: value });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}
// Only explicit declarations are donors. Preserve false (upfront payments) and zero (losses).
function source(p, k) {
  if (k in ruleFields) return p.donor?.values[k];
  const info = k === 'transportLosses' ? p.combat?.transport : k === 'payAsYouGo' ? p.payment : p.buildTime;
  return info?.declared ? info.native : undefined;
}
export function campaignValues(profiles, k) {
  const values = new Map();
  for (const p of profiles) {
    const v = source(p, k);
    if (
      !(k in ruleFields
        ? validValue(k, v)
        : k === 'payAsYouGo'
          ? typeof v === 'boolean'
          : k === 'buildTime'
            ? [1, 0.8].includes(v)
            : validLoss(v))
    )
      continue;
    if (!values.has(v)) values.set(v, []);
    values.get(v).push(p.name);
  }
  return values;
}
export function nativeValue(p, k) {
  return k in ruleFields
    ? p.defaults?.[k]
    : k === 'buildTime'
      ? p.buildTime?.native
      : k === 'payAsYouGo'
        ? p.payment?.native
        : p.combat?.transport?.native;
}
export function eligibleCampaignPreferences(profiles, p, row, variant, prefs) {
  const out = {};
  if (!variant || row.scripted) return out;
  for (const [k, v] of Object.entries(resolvedOptions(prefs))) {
    if (!campaignValues(profiles, k).has(v)) continue;
    const native = nativeValue(p, k);
    if (native === undefined || v === native || (k === 'transportLosses' && !p.combat.transport.allowed.includes(variant.id))) continue;
    out[k] = v;
  }
  return out;
}
