import { group, select } from './settingsfields.js';
import { action, el } from './commandui.js';
import { preferredRules, ruleFields, saveRuleDefaults, standardRules } from './battlefrontrules.js';

export function battlefrontRuleDefaults(parent) {
  const g = group(parent, 'New solo Battlefront skirmishes'),
    rules = preferredRules(),
    inputs = new Map();
  for (const [key, label, , values, format] of ruleFields) {
    inputs.set(
      key,
      select(
        g,
        label,
        values.map(n => [n, format(n)]),
        rules[key],
        value => {
          rules[key] = Number(value);
          saveRuleDefaults(rules);
        }
      )
    );
  }
  g.append(
    el(
      'p',
      'us-help',
      'Defaults for the next solo land skirmish in Battlefront mode. The skirmish board can override them for one match. Shuttle rules apply only when Shuttle deploys is on.'
    )
  );
  action(
    g,
    'Restore standard skirmish rules',
    () => {
      Object.assign(rules, standardRules);
      saveRuleDefaults(rules);
      for (const [key, input] of inputs) input.value = rules[key];
    },
    'us-secondary'
  );
}
