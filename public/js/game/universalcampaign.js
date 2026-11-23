import { db } from '../gamedata.js';
import { loadCampaignData, startingGalaxy } from './galaxy.js';
import { expeditionSites, revanId, ruleFields } from './universalrules.js';
import { action, bindWindow, choices, enableAction } from './universaldialog.js';
import { campaignBackdrop, drawCampaignPreview, bindCampaignSettings } from './campaignmenu.js';
import { campaignDefaults, campaignLimits } from './campaignsettings.js';
import { ruleChoices, rulePresets } from './universalrulemenu.js';
import { periods, chronology } from './universalmodes.js';
import { openBoard, boardCombo } from './universalboard.js';
const label = type => db.t(type?.str('Text_ID')) || type?.name || '';
export function campaignChoices(campaigns, factionOf) {
  return [...campaigns.values()].filter(
    c =>
      c.bool('Is_Listed', true) &&
      !c.bool('Is_Multiplayer') &&
      !c.bool('Tutorial') &&
      c.list('Locations').length &&
      factionOf(c.str('Starting_Active_Player'))?.bool('Is_Playable')
  );
}
const get = async (url, fallback) => {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch {}
  return fallback;
};
export async function openUniversalCampaign({ start, back, profileId = 'stock', host }) {
  const [data, catalog, eras] = await Promise.all([
    loadCampaignData(),
    get('/api/universal/rules', { donors: [], unavailable: ['Rule catalog'] }),
    get('/api/universal/eras', [])
  ]);
  const { dlg, advanced, years, legend, hasPreview } = await openBoard();
  const current = profileId || 'stock',
    era = eras.find(e => e.id === current) || {
      id: current,
      name: current === 'stock' ? 'Forces of Corruption' : 'Current storyline',
      ready: true
    };
  if (!eras.length) eras.push(era);
  const campaigns = campaignChoices(data.campaigns, n => db.faction(n)),
    factions = [...new Set(campaigns.map(c => c.str('Starting_Active_Player')))].map(value => ({
      value,
      label: label(db.faction(value)) || value
    }));
  const defaults = Object.fromEntries(Object.entries(ruleFields).map(([k, r]) => [k, db.constants.num(r.tag, r.fallback)]));
  const presets = [{ key: '', label: 'Campaign defaults', options: {} }, ...rulePresets(catalog.donors, defaults)];
  let faction = factions[0]?.value,
    campaign,
    difficulty = 'medium',
    options = {},
    settings,
    sites = [],
    pending = '',
    closed = false,
    canPrepare = false,
    resetSettings;
  const el = dlg.veil;
  el.dataset.profile = current;
  const send = m => {
    if (window.parent !== window) window.parent.postMessage(m, host);
  };
  const status = t => dlg.setText('UC_STATUS', t);
  const close = bindWindow(dlg, 'campaign', 'Universal Galactic Conquest', () => leave());
  function finish() {
    closed = true;
    removeEventListener('message', message);
    close();
  }
  function leave() {
    if (pending) send({ kind: 'universal-board-cancel' });
    finish();
    back();
  }
  function play() {
    if (closed || pending || !campaign) return;
    finish();
    start({
      mode: 'galactic',
      players: [],
      teamFactions: [],
      campaign: campaign.name,
      faction: campaign.str('Starting_Active_Player'),
      difficulty,
      universalPath: 1,
      universalOptions: { ...options },
      ...(settings?.custom ? { campaignSettings: { ...settings } } : {})
    });
  }
  function message(e) {
    if (e.source !== window.parent || e.origin !== host) return;
    if (e.data?.kind === 'universal-board-supported') canPrepare = true;
    if (pending && ((e.data?.kind === 'universal-board-error' && e.data.id === pending) || e.data?.kind === 'universal-error')) {
      pending = '';
      roster();
      status(e.data.error);
    }
  }
  addEventListener('message', message);
  send({ kind: 'universal-board-probe' });
  const captions = {
    IDC_INTERNET_DIALOG_HEADER: 'Galactic Conquest',
    UC_ERAS_TITLE: 'Storyline  /  Time period',
    UC_MAP_TITLE: 'Campaign maps',
    UC_FACTION_TITLE: 'Faction',
    UC_BRIEF_TITLE: 'Campaign briefing',
    UC_RULE_TITLE: 'Campaign settings',
    UC_DIFFICULTY_TITLE: 'Difficulty',
    UC_PRESET_TITLE: 'Economy and politics preset',
    UC_TREASURY_TITLE: 'Treasury cap per owned planet',
    UC_POLITICS_TITLE: 'Time per political-control point',
    UC_PATH_TITLE: 'Campaign objective',
    UC_ADV_TITLE: years ? 'Starting year' : 'Starting conditions',
    UC_PERIOD: periods[current] + '  /  ' + era.name
  };
  for (const [id, t] of Object.entries(captions)) dlg.setText(id, t);
  dlg.ctl('UC_STATUS').setAttribute('role', 'status');
  const desc = dlg.ctl('IDC_CAMPAIGN_DESCRIPTION');
  desc.classList.add('uc-briefing');
  desc.tabIndex = 0;
  if (!hasPreview) {
    dlg.show('IDC_IMAGE', false);
    if (!el.matches('dialog')) Object.assign(desc.style, { top: '100px', height: '500px' });
  } else campaignBackdrop(dlg).catch(() => {});
  if (years) {
    dlg.setText('UC_YEAR_LEGEND', legend);
    const l = dlg.ctl('UC_YEAR_LEGEND');
    l.classList.add('uc-briefing');
    l.tabIndex = 0;
  }
  action(dlg, 'IDC_PLAY_BUTTON', 'Start campaign', play);
  action(dlg, 'IDC_CANCEL_BUTTON', 'Back', leave);
  action(dlg, 'UC_DEFAULTS', 'Reset settings', () => {
    if (pending) return;
    options = {};
    difficulty = 'medium';
    resetSettings?.();
    renderRules();
  });
  const combo = (id, name, rows, v, fn) =>
    boardCombo(dlg, id, name, rows, v, value => {
      dlg.ctl(id).dataset.value = String(value);
      fn(value);
    });
  function availability() {
    enableAction(dlg, 'IDC_PLAY_BUTTON', !!campaign && !pending);
    el.dataset.loading = pending;
    for (const node of el.querySelectorAll('[data-id]'))
      if (
        !['UC_STORIES', 'IDC_CANCEL_BUTTON'].includes(node.dataset.id) &&
        !node.closest('[data-id="UC_STORIES"]') &&
        node.matches('[role=listbox],[role=combobox],.dlg-slider,.dlg-btn,select,input')
      )
        node.inert = !!pending;
  }
  function inform() {
    if (pending) return;
    status(
      !campaign
        ? 'No listed playable campaigns in this storyline.'
        : options.expedition
          ? 'Expedition: capture ' + sites.join(', ') + ' for a one-time 3,000-credit grant.'
          : catalog.unavailable.length
            ? 'Unavailable rule sources: ' + catalog.unavailable.join(', ')
            : 'Original campaign objectives and victory conditions.'
    );
  }
  function roster() {
    const rows = [...eras]
      .sort((a, b) => chronology.indexOf(periods[a.id]) - chronology.indexOf(periods[b.id]))
      .map(e => ({
        ...e,
        key: e.id,
        label: e.name,
        columns: [{ text: e.name }, { text: e.ready ? periods[e.id] : 'Not built', at: 0.64 }]
      }));
    choices(dlg, 'UC_STORIES', 'Storylines', rows, current, row => {
      if (row.id === current) {
        if (pending) send({ kind: 'universal-board-cancel' });
        pending = '';
        availability();
        inform();
        return;
      }
      if (!row.ready || window.parent === window) {
        if (pending) send({ kind: 'universal-board-cancel' });
        pending = '';
        roster();
        status(
          row.ready
            ? 'Open the Universal game window to change storylines.'
            : row.name + ' is not built locally. Your selection has not changed.'
        );
        return;
      }
      pending = row.id;
      availability();
      status('Loading ' + row.name + '…');
      send(canPrepare ? { kind: 'universal-board-prepare', id: row.id } : { kind: 'universal-select', id: row.id, mode: 'conquest' });
    });
  }
  const levels = ['easy', 'medium', 'hard'].map((value, i) => ({
    value,
    label: db.t(['TEXT_DIFFICULTY_EASY_NAME', 'TEXT_DIFFICULTY_NORMAL_NAME', 'TEXT_DIFFICULTY_HARD_NAME'][i]) || value
  }));
  function renderRules() {
    combo('UC_DIFFICULTY', 'Difficulty', levels, difficulty, v => (difficulty = v));
    const match = presets.find(p => Object.keys(defaults).every(k => p.options[k] === options[k]));
    const prs = presets.map(({ key, label }) => ({ value: key, label }));
    if (!match) prs.push({ value: 'custom', label: 'Custom mix' });
    combo('UC_PRESET', 'Economy and politics preset', prs, match?.key ?? 'custom', v => {
      const p = presets.find(p => p.key === v);
      if (p) {
        for (const k of Object.keys(defaults)) {
          delete options[k];
          if (k in p.options) options[k] = p.options[k];
        }
        renderRules();
      }
    });
    for (const [k, r] of Object.entries(ruleFields)) {
      const rows = [
        { value: '', label: `Campaign default · ${defaults[k].toLocaleString()} ${r.unit}` },
        ...ruleChoices(catalog.donors, k, defaults[k]).map(([v, n]) => ({
          value: String(v),
          label: `${v.toLocaleString()} ${r.unit} — ${n.join(' / ')}`
        }))
      ];
      combo('UC_' + k.toUpperCase(), r.label, rows, options[k] ?? '', v => {
        if (v === '') delete options[k];
        else options[k] = Number(v);
        renderRules();
      });
    }
    const paths = [{ value: 'authored', label: 'Authored objectives' }];
    if (sites.length) paths.push({ value: 'expedition', label: 'Star Map Expedition' });
    combo('UC_PATH', 'Campaign objective', paths, options.expedition ? 'expedition' : 'authored', v => {
      if (v === 'expedition') options.expedition = true;
      else delete options.expedition;
      inform();
    });
    inform();
  }
  function inlineSettings() {
    const custom = !!advanced.length && !!campaign && campaignLimits(campaign).custom;
    for (const [id, name] of advanced) {
      for (const key of [id, id + '_LABEL']) dlg.show(key, custom);
      if (id.endsWith('_SLIDER')) dlg.show(id.replace('_SLIDER', '_VALUE'), custom);
      dlg.setText(id + '_LABEL', years ? 'Starting year selector' : name);
    }
    dlg.show('UC_YEAR_LEGEND', custom && years);
    dlg.show('UC_FIXED', !custom);
    dlg.setText('UC_FIXED', 'Starting conditions are set by this campaign.');
    settings = custom ? campaignDefaults(campaign, faction) : null;
    resetSettings = settings ? bindCampaignSettings(dlg, settings, campaign, faction) : null;
  }
  function refreshMaps() {
    const maps = campaigns
      .filter(c => c.str('Starting_Active_Player') === faction)
      .sort((a, b) => a.num('Sort_Order') - b.num('Sort_Order') || label(a).localeCompare(label(b)));
    const counts = new Map();
    for (const c of maps) counts.set(label(c), (counts.get(label(c)) || 0) + 1);
    const rows = maps.map(c => ({ key: c.name, c, label: counts.get(label(c)) > 1 ? `${label(c)} — ${c.name}` : label(c) }));
    const pick = r => {
      if (pending || (r && campaign === r.c)) return;
      campaign = r?.c;
      el.dataset.campaign = campaign?.name || '';
      el.dataset.faction = faction || '';
      dlg.setText(
        'IDC_CAMPAIGN_DESCRIPTION',
        campaign ? label(campaign) + '\n\n' + (db.t(campaign.str('Description_Text')) || '') : 'No listed playable campaign.'
      );
      desc.scrollTop = 0;
      if (hasPreview) drawCampaignPreview(dlg, campaign).catch(() => {});
      delete options.expedition;
      sites =
        campaign && current !== revanId && catalog.donors.some(d => d.id === revanId && d.hasSearch)
          ? expeditionSites(startingGalaxy(data, campaign), db.faction(faction)?.list('Allies')).map(n => label(db.type(n)) || n)
          : [];
      inlineSettings();
      renderRules();
      availability();
    };
    choices(dlg, 'IDC_STAGING_MAP_LIST', 'Campaign map', rows, rows[0]?.key, pick);
    if (!rows.length) pick(null);
  }
  combo('IDC_FACTION_COMBO', 'Faction', factions, faction, v => {
    faction = v;
    refreshMaps();
  });
  refreshMaps();
  roster();
  dlg.ctl('UC_STORIES').focus();
  return true;
}
