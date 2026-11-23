import { db } from '../gamedata.js';
import { ruleFields, validValue } from './universalrules.js';
import { openChoiceSheet } from './universaldialog.js';

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
export async function openRuleMenu({ campaign, catalog, options, sites, objectiveHint, back, start }) {
  const defaults = Object.fromEntries(fields.map(k => [k, db.constants.num(ruleFields[k].tag, ruleFields[k].fallback)]));
  const presets = [{ key: '', label: 'Campaign defaults', options: {} }, ...rulePresets(catalog.donors, defaults)];
  const sections = [
    { key: 'preset', label: 'Economy and politics preset' },
    { key: 'treasury', label: 'Treasury cap' },
    { key: 'politics', label: 'Political control' },
    { key: 'objective', label: 'Campaign objective' }
  ];
  const sheet = await openChoiceSheet({
    screen: 'rules',
    heading: 'Campaign rules',
    context: campaign,
    section: 'Setting',
    backLabel: 'Back',
    nextLabel: 'Start campaign',
    back: () => {
      sheet.close();
      back();
    },
    next: () => {
      sheet.close();
      start();
    }
  });
  const summary = () =>
    `${(options.treasury ?? defaults.treasury).toLocaleString()} credits per owned planet · ${options.politics ?? defaults.politics} seconds per political-control point`;
  sheet.sections(sections, 'preset', ({ key: k, label }) => {
    if (k === 'preset') {
      const matching = presets.find(p => fields.every(k => options[k] === p.options[k]));
      const rows = matching ? presets : [...presets, { key: 'custom', label: 'Custom mix' }];
      sheet.values(label, rows, matching?.key ?? 'custom', p => {
        if (p.options)
          for (const k of fields) {
            if (k in p.options) options[k] = p.options[k];
            else delete options[k];
          }
        sheet.info(p.label + '\n' + summary() + (catalog.unavailable.length ? '\nUnavailable: ' + catalog.unavailable.join(', ') : ''));
      });
    } else if (k === 'objective') {
      const rows = [{ key: false, label: 'Authored objectives' }];
      if (sites.length) rows.push({ key: true, label: 'Star Map Expedition' });
      sheet.values(label, rows, !!options.expedition, r => {
        if (r.key) options.expedition = true;
        else delete options.expedition;
        sheet.info(
          r.key
            ? `Capture ${sites.join(', ')} for a one-time 3,000-credit grant under this campaign’s credit limits. The original victory conditions still apply.`
            : objectiveHint
        );
      });
    } else {
      const { unit, label: detail } = ruleFields[k];
      const rows = [
        { key: '', label: `Campaign default — ${defaults[k].toLocaleString()} ${unit}` },
        ...ruleChoices(catalog.donors, k, defaults[k]).map(([key, names]) => ({
          key,
          label: `${key.toLocaleString()} ${unit} — ${names.join(' / ')}`
        }))
      ];
      sheet.values(detail, rows, options[k] ?? '', r => {
        if (r.key === '') delete options[k];
        else options[k] = r.key;
        sheet.info(r.label + '\n' + summary());
      });
    }
  });
  sheet.focus();
}
