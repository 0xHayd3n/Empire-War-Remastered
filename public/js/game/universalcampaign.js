import { db } from '../gamedata.js';
import { loadCampaignData, startingGalaxy } from './galaxy.js';
import { expeditionSites, revanId } from './universalrules.js';
import { openChoiceSheet, nativeSkin, staging, action, bindWindow, choices, enableAction } from './universaldialog.js';
import { openRuleMenu } from './universalrulemenu.js';
import { openDialog } from './dialogs.js';
import { campaignBackdrop, drawCampaignPreview, campaignOptionsDialog } from './campaignmenu.js';
import { campaignDefaults, campaignLimits } from './campaignsettings.js';

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
  const factions = [...new Set(campaigns.map(c => c.str('Starting_Active_Player')))].map(key => ({
    key,
    label: label(db.faction(key)) || key
  }));
  const period = catalog.donors.find(d => d.id === profileId)?.name || (profileId ? 'Mounted storyline' : 'Forces of Corruption');
  const search = profileId !== revanId && catalog.donors.some(d => d.id === revanId && d.hasSearch);
  const options = {};
  let faction = factions[0]?.key,
    campaign,
    difficulty = 'medium',
    settings,
    screen,
    close,
    busy = false;
  const rows = () => {
    const variants = campaigns
      .filter(c => c.str('Starting_Active_Player') === faction)
      .sort((a, b) => a.num('Sort_Order') - b.num('Sort_Order') || label(a).localeCompare(label(b)));
    const counts = new Map();
    for (const c of variants) counts.set(label(c), (counts.get(label(c)) || 0) + 1);
    return variants.map(c => ({ key: c.name, label: counts.get(label(c)) > 1 ? `${label(c)} — ${c.name}` : label(c), campaign: c }));
  };
  const select = r => {
    if (campaign !== r?.campaign) {
      campaign = r?.campaign;
      delete options.expedition;
      settings = campaign && campaignDefaults(campaign, faction);
    }
  };
  const cancel = () => {
    if (!busy) {
      close();
      back();
    }
  };
  const showAgain = () => {
    busy = false;
    screen.hidden = screen.inert = false;
    if (screen instanceof HTMLDialogElement && !screen.open) screen.showModal();
    screen.querySelector('[data-id="IDC_PLAY_BUTTON"],footer button:last-child')?.focus();
  };
  const proceed = async () => {
    if (busy || !campaign) return;
    busy = screen.inert = true;
    if (screen instanceof HTMLDialogElement) screen.close();
    const name = label(campaign);
    try {
      const sites = search
        ? expeditionSites(startingGalaxy(data, campaign), db.faction(faction)?.list('Allies')).map(n => label(db.type(n)) || n)
        : [];
      await openRuleMenu({
        campaign: `${period} · ${label(db.faction(faction)) || faction} · ${name}`,
        catalog,
        options,
        sites,
        objectiveHint: sites.length
          ? 'Play the original objectives, or add a Star Map Expedition to this campaign.'
          : profileId === revanId
            ? 'Play Revan’s authored path without layering another expedition on top.'
            : search
              ? 'Original objectives. This map has no eligible expedition sites.'
              : 'Original objectives. Build Revan’s Revenge to unlock the optional expedition.',
        back: showAgain,
        start: () => {
          close();
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
      });
      screen.hidden = true;
    } catch (e) {
      showAgain();
      console.error('Campaign rules', e);
    }
  };
  // Stock has two map-source buttons here. Our list already contains the exact mounted variants;
  // use their slots as a map heading instead of leaving dead buttons or a blank band.
  const dlg = await openDialog(staging, {
    ...nativeSkin,
    adjust: c => (c.id === 'IDC_SELECT_OFFICIAL_MAPS' ? { ...c, kind: 'LTEXT', y: c.y + 10 } : null)
  }).catch(() => null);
  const required = [
    'IDC_PLAY_BUTTON',
    'IDC_CANCEL_BUTTON',
    'IDC_STAGING_MAP_LIST',
    'IDC_FACTION_COMBO',
    ...['EASY', 'MEDIUM', 'HARD'].map(v => 'IDC_RADIO_CUSTOM_' + v)
  ];
  if (!dlg || !required.every(id => dlg.ctl(id))) {
    dlg?.close();
    const sheet = await openChoiceSheet({
      screen: 'campaign',
      heading: 'Galactic Conquest',
      context: period,
      section: 'Campaign setup',
      nextLabel: 'Continue',
      back: cancel,
      next: proceed
    });
    screen = sheet.el;
    close = sheet.close;
    const pickMap = r => {
      select(r);
      sheet.info(r ? r.label + '\n' + db.t(campaign.str('Description_Text')) : 'No listed playable campaigns.');
      sheet.allow(!!r);
    };
    pickMap(rows()[0]);
    sheet.sections(
      ['Faction', 'Campaign', 'Difficulty'].map(key => ({ key, label: key })),
      'Faction',
      ({ key }) => {
        if (key === 'Campaign') sheet.values(key, rows(), campaign?.name, pickMap);
        else if (key === 'Difficulty')
          sheet.values(
            key,
            ['easy', 'medium', 'hard'].map(key => ({ key, label: key })),
            difficulty,
            r => {
              difficulty = r.key;
            }
          );
        else
          sheet.values(key, factions, faction, r => {
            if (faction !== r.key) {
              faction = r.key;
              pickMap(rows()[0]);
            }
          });
      }
    );
    sheet.focus();
    return true;
  }
  screen = dlg.veil;
  close = bindWindow(dlg, 'campaign', period + ' — Galactic Conquest', cancel);
  dlg.setText(dlg.ctl('IDC_INTERNET_DIALOG_HEADER') ? 'IDC_INTERNET_DIALOG_HEADER' : 'IDC_STATIC_HEADER', period);
  dlg.setText('IDC_SELECT_OFFICIAL_MAPS', 'Campaign maps');
  for (const id of ['IDC_SELECT_CUSTOM_MAPS', 'IDC_DIALOG_CLOSE_BUTTON']) dlg.show(id, false);
  action(dlg, 'IDC_PLAY_BUTTON', 'Continue', proceed);
  action(dlg, 'IDC_CANCEL_BUTTON', 'Back', cancel);
  const description = dlg.ctl('IDC_CAMPAIGN_DESCRIPTION');
  if (description) description.classList.add('uc-briefing');
  const list = 'IDC_STAGING_MAP_LIST',
    refresh = () => {
      const maps = rows();
      const pick = r => {
        select(r);
        screen.dataset.campaign = campaign?.name || '';
        dlg.setText(
          'IDC_CAMPAIGN_DESCRIPTION',
          campaign ? db.t(campaign.str('Description_Text')) || label(campaign) : 'No listed playable campaigns.'
        );
        if (description) description.scrollTop = 0;
        enableAction(dlg, 'IDC_PLAY_BUTTON', !!campaign);
        dlg.show('IDC_SELECT_OPTIONS', !!campaign && campaignLimits(campaign).custom);
        drawCampaignPreview(dlg, campaign);
      };
      choices(dlg, list, 'Campaign map', maps, maps[0]?.key, pick);
      if (!maps.length) pick(null);
    };
  const combo = dlg.combo(
    'IDC_FACTION_COMBO',
    factions.map(r => ({ value: r.key, label: r.label })),
    faction,
    v => {
      faction = v;
      refresh();
    }
  );
  const factionControl = dlg.ctl('IDC_FACTION_COMBO');
  factionControl.tabIndex = 0;
  factionControl.setAttribute('role', 'combobox');
  factionControl.setAttribute('aria-label', 'Faction');
  factionControl.onkeydown = e => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !factions.length) return;
    e.preventDefault();
    faction = factions[Math.max(0, Math.min(factions.length - 1, factions.findIndex(f => f.key === faction) + step))].key;
    combo.set(faction);
    refresh();
  };
  const levels = ['easy', 'medium', 'hard'],
    ids = levels.map(k => 'IDC_RADIO_CUSTOM_' + k.toUpperCase());
  dlg.radios(ids, ids[1], id => {
    difficulty = levels[ids.indexOf(id)];
  });
  ids.forEach((id, i) => {
    const textId = ['TEXT_DIFFICULTY_EASY_NAME', 'TEXT_DIFFICULTY_NORMAL_NAME', 'TEXT_DIFFICULTY_HARD_NAME'][i];
    dlg.ctl(id).setAttribute('aria-label', db.t(textId) || levels[i]);
  });
  action(dlg, 'IDC_SELECT_OPTIONS', null, async () => {
    if (busy || !settings || !campaignLimits(campaign).custom) return;
    busy = screen.inert = true;
    const draft = { ...settings };
    try {
      if (await campaignOptionsDialog(draft, campaign, faction, { cls: 'uc-window', literalText: true })) settings = draft;
    } finally {
      showAgain();
    }
  });
  refresh();
  campaignBackdrop(dlg);
  dlg.ctl(list).focus();
  return true;
}
