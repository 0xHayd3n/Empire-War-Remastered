import { db } from '../gamedata.js';
import { loadCampaignData, startingGalaxy } from './galaxy.js';
import { expeditionSites, ruleFields, revanId, validValue } from './universalrules.js';

const label = type => db.t(type?.str('Text_ID')) || type?.name || '';
export function campaignChoices(campaigns, factionOf) {
  return [...campaigns.values()].filter(
    c =>
      c.bool('Is_Listed', true) &&
      !c.bool('Is_Multiplayer') &&
      !c.bool('Tutorial') &&
      c.list('Locations').length > 0 &&
      factionOf(c.str('Starting_Active_Player'))?.bool('Is_Playable')
  );
}
// Group equivalent donors instead of presenting the same rule as several supposedly unique systems.
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
export async function openUniversalCampaign({ start, back, profileId }) {
  const [data, catalog] = await Promise.all([
    loadCampaignData(),
    fetch('/api/universal/rules')
      .then(r => {
        if (!r.ok) throw Error('rules unavailable');
        return r.json();
      })
      .catch(() => ({ donors: [], unavailable: ['Rule catalog'] }))
  ]);
  const campaigns = campaignChoices(data.campaigns, n => db.faction(n));
  const root = document.createElement('main');
  root.id = 'universal-campaign';
  root.innerHTML = `<form><header><small>UNIVERSAL · SINGLE PLAYER</small><h1>New campaign</h1><p id="uc-profile"></p></header><section><label>Faction<select id="uc-faction"></select></label><label>Campaign<select id="uc-campaign"></select></label><label>Difficulty<select id="uc-difficulty"><option value="easy">Easy</option><option selected value="medium">Medium</option><option value="hard">Hard</option></select></label></section><fieldset><legend>Campaign path</legend><label>Objective<select id="uc-path"></select></label><p id="uc-sites" aria-live="polite"></p></fieldset><fieldset id="uc-rules"><legend>Optional rules from your library</legend><p>Keep the campaign defaults, or borrow one setting at a time. Changes apply to this campaign only.</p></fieldset><p id="uc-status" role="status"></p><footer><button type="button" id="uc-back">Back to game menu</button><button id="uc-start">Start campaign</button></footer></form>`;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'universal-campaign.css';
  document.head.append(style);
  document.body.append(root);
  const el = id => root.querySelector('#uc-' + id),
    opt = (sel, text, value) => sel.add(new Option(text, value));
  const donor = catalog.donors.find(d => d.id === profileId);
  el('profile').textContent = 'Base ruleset: ' + (donor?.name || (profileId ? 'Mounted Workshop profile' : 'Stock Forces of Corruption'));
  const faction = el('faction'),
    campaign = el('campaign'),
    path = el('path');
  for (const name of new Set(campaigns.map(c => c.str('Starting_Active_Player')))) opt(faction, label(db.faction(name)) || name, name);
  const selected = () => data.campaigns.get(campaign.value.toUpperCase());
  const search = catalog.donors.some(d => d.id === revanId && d.hasSearch) && profileId !== revanId;
  function refreshPath() {
    const c = selected();
    path.replaceChildren();
    opt(path, 'Authored campaign only', 'authored');
    let sites = [];
    if (c && search) sites = expeditionSites(startingGalaxy(data, c), db.faction(faction.value)?.list('Allies'));
    if (sites.length) opt(path, 'Star Map Expedition · Revan-inspired', 'expedition');
    const explain = () => {
      el('sites').textContent =
        path.value === 'expedition'
          ? 'Additional objective: survey ' +
            sites.map(n => label(db.type(n)) || n).join(', ') +
            ' by taking control of each. Complete the set for a 3,000-credit grant, subject to normal credit limits. The authored victory conditions still apply.'
          : !search
            ? profileId === revanId
              ? 'Play Revan’s authored path here. The portable expedition is not layered on top of it.'
              : 'Build Revan’s Revenge to unlock the portable Star Map Expedition.'
            : sites.length
              ? 'Play the original objectives, or add an expedition on this map.'
              : 'No eligible expedition sites on this map.';
    };
    path.onchange = explain;
    explain();
    el('start').disabled = !c;
  }
  function refreshCampaigns() {
    campaign.replaceChildren();
    const rows = campaigns
      .filter(c => c.str('Starting_Active_Player') === faction.value)
      .sort((a, b) => a.num('Sort_Order') - b.num('Sort_Order') || label(a).localeCompare(label(b)));
    const names = new Map();
    for (const c of rows) names.set(label(c), (names.get(label(c)) || 0) + 1);
    for (const c of rows) opt(campaign, names.get(label(c)) > 1 ? `${label(c)} — ${c.name}` : label(c), c.name);
    refreshPath();
  }
  faction.onchange = refreshCampaigns;
  campaign.onchange = refreshPath;
  refreshCampaigns();
  for (const [field, { tag, unit, label: text, fallback }] of Object.entries(ruleFields)) {
    const line = document.createElement('label'),
      sel = document.createElement('select');
    sel.id = 'uc-' + field;
    line.textContent = text;
    line.append(sel);
    el('rules').append(line);
    const native = db.constants.num(tag, fallback);
    opt(sel, `Campaign default (${native.toLocaleString()} ${unit})`, '');
    for (const [val, sources] of ruleChoices(catalog.donors, field, native))
      opt(sel, `${val.toLocaleString()} ${unit} — ${sources.join(' / ')}`, String(val));
    sel.disabled = sel.options.length < 2;
  }
  el('status').textContent = !campaigns.length
    ? 'This profile has no listed, playable single-player conquest campaign.'
    : catalog.unavailable.length
      ? 'Could not read: ' + catalog.unavailable.join(', ') + '. Authored play is still available.'
      : '';
  const close = () => {
    root.remove();
    style.remove();
  };
  el('back').onclick = () => {
    close();
    back();
  };
  root.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const c = selected();
    if (!c) return;
    const universalOptions = {};
    for (const k of Object.keys(ruleFields)) if (el(k).value) universalOptions[k] = Number(el(k).value);
    if (path.value === 'expedition') universalOptions.expedition = true;
    const difficulty = el('difficulty').value;
    close();
    start({
      mode: 'galactic',
      players: [],
      teamFactions: [],
      campaign: c.name,
      faction: c.str('Starting_Active_Player'),
      difficulty,
      universalPath: 1,
      universalOptions
    });
  };
  faction.focus();
}
