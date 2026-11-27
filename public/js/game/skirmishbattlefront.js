import { action, element, field } from './operationsetup.js';
import { ruleFields } from './battlefrontrules.js';

// Edit the transient board draft. Neither a one-match override nor this checkbox writes profile defaults.
export function skirmishBattlefront(model) {
  const { st } = model,
    root = element('section', 'op-bf-rules'),
    toggle = element('label', 'op-check'),
    check = element('input'),
    fields = element('div', 'op-bf-fields'),
    inputs = new Map();
  root.setAttribute('aria-label', 'Battlefront match rules');
  check.type = 'checkbox';
  toggle.append(check, 'Play this match in Battlefront mode');
  const defaults = model.battlefrontDefaults;
  for (const [key, label, , values, format] of ruleFields) {
    const row = field(
      label,
      [['', `Use default · ${format(defaults[key])}`], ...values.map(n => [n, format(n)])],
      st.ruleEdits[key] ?? '',
      v => {
        if (v === '') delete st.ruleEdits[key];
        else st.ruleEdits[key] = Number(v);
      }
    );
    inputs.set(key, row.querySelector('select'));
    fields.append(row);
  }
  fields.append(
    action('Use my defaults for this match', () => {
      st.ruleEdits = {};
      for (const input of inputs.values()) input.value = '';
    })
  );
  root.append(toggle, fields);
  const update = eligible => {
    root.hidden = !eligible;
    check.checked = st.shooter;
    fields.hidden = !st.shooter;
  };
  check.onchange = () => {
    st.shooter = check.checked;
    st.boardShooterChanged = true;
    fields.hidden = !check.checked;
  };
  return { root, update };
}
