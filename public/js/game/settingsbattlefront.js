import { shooterFields, loadShooterConfig, setShooterPreference } from './shooterpreferences.js';
import { action } from './commandui.js';
import { group, check, select, slider } from './settingsfields.js';

export function battlefrontFields(parent, game, section, label) {
  const g = group(parent, label),
    shooter = game.shooter,
    cfg = shooter?.cfg || loadShooterConfig();
  const defaults = [];
  for (const f of shooterFields.filter(f => f.section === section)) {
    const v = f.key === 'deployUI' && shooter ? shooter.deployUI : cfg[f.key];
    const save = value => setShooterPreference(shooter, f.key, value);
    const input = f.range
      ? slider(g, f.label, v, ...f.range, save, f.format)
      : f.choices
        ? select(g, f.label, f.choices, v, save)
        : check(g, f.label, v, save);
    defaults.push(() => {
      if (input.type === 'checkbox') input.checked = f.initial;
      else input.value = f.initial;
      input.dispatchEvent(new Event(f.range ? 'input' : 'change'));
    });
  }
  const restore = { feedback: 'Restore combat feedback defaults', navigation: 'Restore radar and compass defaults' }[section];
  if (restore) action(g, restore, () => defaults.forEach(reset => reset()), 'us-secondary');
}
