// Disposable build worker. It reads the resolved local VFS, not Workshop names or remote data.
// The game database and temporary starting forces die with this worker; only setup metadata leaves it.
import { parentPort, workerData } from 'node:worker_threads';
import { openGame } from './megfs.mjs';
import { loadPack } from './universal-library.mjs';
import { portableRules } from './universal-rule-catalog.mjs';
import { db, loadGameData } from '../public/js/gamedata.js';
import { loadCampaignData, startingGalaxy } from '../public/js/game/galaxy.js';
import { campaignDefaults, campaignLimits, techAdjust } from '../public/js/game/campaignsettings.js';
import { ruleFields, expeditionSites } from '../public/js/game/universalrules.js';
import { parseRC } from '../public/js/game/dialogs.js';
import { menuTable, thrawnSelections } from './universal-loader-table.mjs';
import { campaignChoices } from '../public/js/game/universalcampaign.js';
const { game, home, folder, id, language } = workerData,
  pack = id === 'stock' ? null : loadPack(home, id, folder),
  archive = openGame(game, [], { packedLayer: pack?.entries, language });
const read = p => archive.read(archive.resolve(p));
globalThis.fetch = async input => {
  const u = new URL(String(input), 'http://local/');
  if (u.pathname === '/api/find') {
    const rx = new RegExp(u.searchParams.get('q') || '.', 'i');
    return Response.json([...archive.index.keys()].filter(k => rx.test(k)).sort());
  }
  const bytes = read(decodeURIComponent(u.pathname.replace(/^\/asset\//, '')));
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const label = t => db.t(t?.str('Text_ID')) || t?.name || '';
// Attested whole-pack revisions. An update, unknown loader, or incomplete set of destinations stays authored.
// These two reviewed shims only choose a target and difficulty. Do not flatten arbitrary Lua or mid-campaign transitions.
const dates = {
  d0e2f9c8a2856f38eb5ff254e3cb43a29a00d77ccc6dc900b97b9af2213786d1: ['22 BBY', '21 BBY', '20 BBY', '19 BBY'],
  '4cdb9e170cce2db5d6cee1fc3c81c58d2913a2c9cf0589131fce573a211dcfd7': ['3964 BBY', '3962 BBY', '3959 BBY', '3957 BBY']
};
try {
  await loadGameData(undefined, { language });
  const data = await loadCampaignData(),
    defs = parseRC(read('Data/Resources/GUIDialog/GUIDialogs.rc')?.toString('latin1') || ''),
    adv = defs.get('IDD_CAMPAIGN_ADVANCED_OPTIONS_DIALOG')?.controls || [],
    stage = defs.get('IDD_CUSTOM_CAMPAIGN_STAGING_DIALOG')?.controls || [];
  const slotNames = {
    credits: 'IDC_SKIRMISH_CREDITS_SLIDER',
    tech: 'IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER',
    maxTech: 'IDC_SKIRMISH_MAX_TECH_LEVEL_SLIDER',
    autoResolve: 'IDC_ALLOW_AUTORESOLVE_COMBO'
  };
  const slots = stage.some(c => c.id === 'IDC_SELECT_OPTIONS')
    ? Object.keys(slotNames).filter(k =>
        adv.some(
          c =>
            c.id === slotNames[k] &&
            (k === 'autoResolve' ? c.kind === 'COMBOBOX' : c.kind === 'CONTROL' && /trackbar/i.test(c.cls) && !/TBS_VERT/.test(c.style))
        )
      )
    : [];
  const yearLegend = adv.some(c => /^TEXT_ERA_\d+$/.test(c.text))
    ? adv
        .filter(c => c.kind === 'LTEXT' && c.id !== 'IDC_INTERNET_DIALOG_HEADER' && c.text && !/^(TEXT_|[=\s]+$)/.test(c.text))
        .map(c => c.text.trim())
        .join('\n')
    : '';
  const facts = {},
    planets = [],
    planetKeys = new Map(),
    maps = [],
    mapKeys = new Map(),
    rows = [];
  for (const f of db.factions.values()) {
    const rgb = f
      .str('Color')
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(Number);
    facts[f.name] = {
      label: label(f),
      color:
        rgb.length === 3
          ? '#' +
            rgb
              .map(n =>
                Math.min(255, Math.max(0, n | 0))
                  .toString(16)
                  .padStart(2, '0')
              )
              .join('')
          : '#898e97',
      adj: techAdjust(f.name)
    };
  }
  function variant(c, date) {
    const g = startingGalaxy(data, c),
      worlds = [],
      routes = [],
      idx = new Map();
    for (const p of g.planets) {
      if (p.background) continue;
      if (!planetKeys.has(p.name)) {
        planetKeys.set(p.name, planets.length);
        planets.push([p.name, label(p.type), p.pos[0], p.pos[1]]);
      }
      idx.set(p.index, worlds.length);
      worlds.push([planetKeys.get(p.name), p.owner]);
    }
    for (const r of g.routes) if (idx.has(r.a) && idx.has(r.b)) routes.push([idx.get(r.a), idx.get(r.b)]);
    const key = JSON.stringify([worlds, routes]);
    if (!mapKeys.has(key)) {
      mapKeys.set(key, maps.length);
      maps.push({ worlds, routes });
    }
    return {
      id: c.name,
      date,
      map: mapKeys.get(key),
      sites: expeditionSites(g, db.faction(g.active)?.list('Allies')).map(n => label(db.type(n)) || n)
    };
  }
  for (const c of campaignChoices(data.campaigns, n => db.faction(n))) {
    const faction = c.str('Starting_Active_Player'),
      loc = c.list('Locations'),
      plot = c.str('Underworld_Story_Name').replaceAll('\\', '/').toUpperCase(),
      known = dates[pack?.revision];
    let variants = null;
    if (known && loc.length === 1 && plot === 'CONQUESTS/PROGRESSIVE/STORY_PLOTS_SANDBOX_LOADER.XML') {
      const targets = known.map((date, i) => data.campaigns.get(`${loc[0]}_Era_${i + 2}_${faction}`.toUpperCase()));
      if (
        targets.every(
          t =>
            t &&
            t.str('Starting_Active_Player').toUpperCase() === faction.toUpperCase() &&
            t.list('Locations').length > 1 &&
            !t.bool('Is_Multiplayer') &&
            !t.bool('Tutorial')
        )
      )
        variants = targets.map((t, i) => variant(t, known[i]));
    }
    const base = campaignDefaults(c, faction),
      initial = variants && id === '3417277973' ? Math.max(0, Math.min(3, Math.floor(base.credits / 1000) - 1)) : 0;
    rows.push({
      id: c.name,
      label: label(c),
      description: db.t(c.str('Description_Text')),
      order: c.num('Sort_Order'),
      faction,
      base,
      limits: campaignLimits(c),
      slots: variants ? [] : slots,
      initial,
      variants: variants || [variant(c, '')],
      scripted: !variants && loc.length === 1
    });
  }
  if (id === '1125571106' && pack.revision === '5b2ceff618f502cf23a6d052d18d2cc895720a36462f9b4d28c5094515f311c4') {
    const menu = data.campaigns.get('GCMENU_REBEL');
    if (menu?.str('Story_Name').toUpperCase().includes('STORY_PLOTS_GCMENU.XML')) {
      const add = (c, variants, order, scripted = false) => {
        const faction = c.str('Starting_Active_Player');
        rows.push({
          id: c.name,
          label: label(c),
          description: db.t(c.str('Description_Text')),
          faction,
          base: campaignDefaults(c, faction),
          limits: campaignLimits(c),
          slots: [],
          initial: 0,
          variants,
          order,
          scripted
        });
      };
      // Keep the original menu reachable for warlord and custom starts with additional authored decisions.
      add(menu, [variant(menu, 'Original in-game selector')], 10000, true);
      const table = n => menuTable(read(`Data/Scripts/Story/GCMenu${n}.lua`).toString());
      for (const targets of thrawnSelections(table('Translator'), table('_FactionsbyMapEra'))) {
        const choices = targets
          .map(([name, date]) => [data.campaigns.get(name.toUpperCase()), date])
          .filter(
            ([c]) =>
              c &&
              !c.bool('Is_Multiplayer') &&
              !c.bool('Tutorial') &&
              c.list('Locations').length > 1 &&
              db.faction(c.str('Starting_Active_Player'))
          );
        if (choices.length)
          add(
            choices[0][0],
            choices.map(([c, date]) => variant(c, date)),
            -100 + choices[0][0].num('Sort_Order')
          );
      }
    }
  }
  rows.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  parentPort.postMessage({
    id,
    revision: pack?.revision || 'stock',
    facts,
    planets,
    maps,
    rows,
    yearLegend,
    levels: ['TEXT_DIFFICULTY_EASY_NAME', 'TEXT_DIFFICULTY_NORMAL_NAME', 'TEXT_DIFFICULTY_HARD_NAME'].map(k => db.t(k)),
    defaults: Object.fromEntries(Object.entries(ruleFields).map(([k, r]) => [k, db.constants.num(r.tag, r.fallback)])),
    donor: pack ? portableRules(pack) : null
  });
} finally {
  archive.close();
}
