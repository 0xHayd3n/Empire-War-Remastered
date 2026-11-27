import { appearances, appearanceEligible, validPaint } from './appearancechoices.js';
import { equalFootingStart, canonEligible, fractalEligible } from './universaleligibility.js';

const key = 'swr-reviewed-opening-defaults';
const fields = [
  { option: 'mercenaries', label: 'Offer mercenary contracts', eligible: equalFootingStart },
  { option: 'fighterSupport', label: 'Offer emergency fighter support', eligible: equalFootingStart },
  { option: 'flagship', label: 'Allow flagship commission', eligible: equalFootingStart },
  { option: 'canonUnits', label: 'Request Canon Units', eligible: canonEligible },
  { option: 'fractal', label: 'Request Fractalsponge Units', eligible: fractalEligible },
  ...Object.entries(appearances).map(([option, d]) => ({
    option,
    label: d.title,
    choices: d.choices,
    eligible: (p, r, v) => appearanceEligible(d, p, r, v)
  }))
];
const slot = (p, r, v) => JSON.stringify([p.id, p.revision || 'stock', r.id, v.id]);
export function openingFields(p, r, v) {
  return fields.filter(f => f.eligible(p, r, v));
}
function saved() {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export function openingDefaults(p, r, v) {
  const options = {},
    stored = saved()[slot(p, r, v)];
  for (const { option, choices } of openingFields(p, r, v)) {
    const value = stored?.[option];
    if (choices ? validPaint(appearances[option], value) : value === true) options[option] = value;
  }
  return options;
}
export function setOpeningDefault(p, r, v, option, value) {
  const field = openingFields(p, r, v).find(f => f.option === option);
  if (!field) return;
  const all = saved(),
    id = slot(p, r, v),
    options = openingDefaults(p, r, v);
  if (value === undefined) delete options[option];
  else if (field.choices ? validPaint(appearances[option], value) : value === true) options[option] = value;
  else return;
  if (Object.keys(options).length) all[id] = options;
  else delete all[id];
  try {
    localStorage.setItem(key, JSON.stringify(all));
  } catch {}
}
