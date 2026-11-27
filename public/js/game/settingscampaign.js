import { el } from './commandui.js';
import { conditionNames, conditionPrefs, saveCondition, installedConditions } from './startingconditions.js';
import { openingFields, openingDefaults, setOpeningDefault } from './openingpreferences.js';
import { select, check, group } from './settingsfields.js';
import { campaignFields, campaignPreferences, setCampaignPreference, campaignValues, nativeValue } from './campaignpreferences.js';

const valueText = (k, v) =>
  k === 'payAsYouGo'
    ? v
      ? 'Installments'
      : 'Upfront'
    : k === 'treasury'
      ? `${v.toLocaleString()} credits`
      : k === 'politics'
        ? `${v} seconds`
        : `${+(v * 100).toFixed(2)}%`;
export function campaignDefaultsPanel(parent) {
  const box = el('details', 'us-disclosure'),
    summary = el('summary', '', 'New Galactic Conquest defaults'),
    content = el('div');
  box.append(summary, content);
  parent.append(box);
  let loading = false,
    loaded = false;
  box.ontoggle = async () => {
    if (!box.open || loading || loaded) return;
    loading = true;
    content.textContent = 'Reading installed rule sources…';
    try {
      const { campaignLibrary } = await import('./universalcampaign.js');
      const { profiles } = await campaignLibrary();
      if (!box.isConnected) return;
      loaded = true;
      content.replaceChildren(
        el(
          'p',
          'us-help',
          'Preselect rules in new, compatible campaigns. You can change them in campaign setup. Existing saves are not affected.'
        )
      );
      const g = group(content, 'Rules from installed games and mods'),
        prefs = campaignPreferences();
      for (const [k, title] of Object.entries(campaignFields)) {
        const choices = campaignValues(profiles, k);
        const useful = [...choices.keys()].some(v => profiles.some(p => nativeValue(p, k) !== undefined && nativeValue(p, k) !== v));
        if (!useful && !Object.hasOwn(prefs, k)) continue;
        const options = [...choices]
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([v, names]) => [String(v), `${valueText(k, v)} · ${names.join(' / ')}`]);
        const stale = Object.hasOwn(prefs, k) && !choices.has(prefs[k]);
        if (stale) options.push(['unavailable', `Unavailable · ${valueText(k, prefs[k])}`]);
        const field = select(g, title, [['', 'Campaign default'], ...options], stale ? 'unavailable' : String(prefs[k] ?? ''), value =>
          setCampaignPreference(k, value === '' ? undefined : JSON.parse(value))
        );
        if (stale) field.lastElementChild.disabled = true;
      }
      if (!g.querySelector('select')) g.append(el('p', '', 'No alternate rule values are declared by the installed profiles.'));
      const conditions = group(content, 'Native custom starting conditions'),
        savedConditions = conditionPrefs();
      conditions.append(
        el(
          'p',
          'us-help',
          'Only matching, configurable new starts use these choices. Native custom setup sets opening resources and tech for all sides. Fixed credits and tech used to choose an era stay with the campaign.'
        )
      );
      for (const [k, label] of Object.entries(conditionNames)) {
        const values = installedConditions(profiles, k);
        if (!values.length && savedConditions[k] === undefined) continue;
        const choices = [
          ['', 'Campaign default'],
          ...values.map(n => [n, k === 'autoResolve' ? (n === 0 ? 'Always auto-resolve' : 'Ask before battle') : n.toLocaleString()])
        ];
        if (savedConditions[k] !== undefined && !values.includes(savedConditions[k]))
          choices.push([savedConditions[k], `Unavailable · ${savedConditions[k]}`]);
        select(conditions, label, choices, savedConditions[k] ?? '', v => saveCondition(k, v === '' ? undefined : Number(v)));
      }
      if (!conditions.querySelector('select')) conditions.remove();
      const starts = [];
      for (const p of profiles)
        for (const r of p.rows || [])
          for (const v of r.variants || []) {
            const fields = openingFields(p, r, v);
            if (fields.length) starts.push({ p, r, v, fields });
          }
      if (starts.length) {
        const scoped = group(content, 'Defaults for specific openings'),
          body = el('div');
        scoped.append(
          el(
            'p',
            'us-help',
            'Only the selected opening and faction are affected. Requests for units or paint place normal mod orders after launch, including their costs. Leave them at campaign default to place no order.'
          )
        );
        const show = index => {
          body.replaceChildren();
          const start = starts[index];
          if (!start) return;
          const { p, r, v, fields } = start,
            values = openingDefaults(p, r, v);
          for (const f of fields) {
            const set = value => setOpeningDefault(p, r, v, f.option, value);
            if (f.choices)
              select(body, f.label, [['', 'Campaign default'], ...f.choices.map((name, i) => [i, name])], values[f.option] ?? '', s =>
                set(s === '' ? undefined : Number(s))
              );
            else check(body, f.label, values[f.option] === true, on => set(on ? true : undefined));
          }
        };
        select(
          scoped,
          'Campaign opening',
          [
            ['', 'Choose an opening…'],
            ...starts.map(({ p, r, v }, i) => [i, `${p.name} · ${r.label || r.id} · ${p.facts?.[r.faction]?.label || r.faction}`])
          ],
          '',
          show
        );
        scoped.append(body);
      }
    } catch {
      content.textContent = 'The rule catalog could not be read. Close and reopen this section to retry.';
    } finally {
      loading = false;
    }
  };
}
