// Disposable build worker. It reads the resolved local VFS, not Workshop names or remote data.
// The game database and temporary starting forces die with this worker; only setup metadata leaves it.
import { campaignPresence } from './campaign-presence.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import { openGame } from './megfs.mjs';
import { loadPack } from './universal-library.mjs';
import { portableRules, productionPayment, constructionTime } from './universal-rule-catalog.mjs';
import { combatCatalog } from './universal-combat-catalog.mjs';
import { parseXML } from '../public/js/xml.js';
import { db, loadGameData, loadFileList } from '../public/js/gamedata.js';
import { loadCampaignData, startingGalaxy } from '../public/js/game/galaxy.js';
import { campaignDefaults, campaignLimits, techAdjust } from '../public/js/game/campaignsettings.js';
import { ruleFields, expeditionSites } from '../public/js/game/universalrules.js';
import { parseRC } from '../public/js/game/dialogs.js';
import { routeSettings, routeStyle } from '../public/js/game/galacticroutes.js';
import { galacticLight } from '../public/js/game/galacticlighting.js';
import { laneKit } from './universal-lane-kit.mjs';
import { planetSheets } from './universal-planet-portraits.mjs';
import { catalogFactionArt } from './universal-faction-art.mjs';
import { fallCustomLayouts, fallCustomRevision } from './universal-fall-layouts.mjs';
import { menuTable, thrawnSelections, thrawnRevision, customOpenings } from './universal-loader-table.mjs';
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
  [fallCustomRevision]: ['22 BBY', '21 BBY', '20 BBY', '19 BBY'],
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
  // Same base command-bar components as GalacticGame.buildNames; no HUD models or scripts are needed.
  const menus = await loadFileList('CommandBarComponentFiles.xml'),
    components = new Map();
  for (const file of menus.length ? menus : ['CommandBarComponents.xml']) {
    const bytes = read('Data/XML/' + file);
    if (!bytes) continue;
    for (const top of parseXML(bytes.toString('latin1')).children)
      for (const c of top.children) if (c.attrs.Name) components.set(c.attrs.Name.toUpperCase(), c);
  }
  const ring = components.get('G_PLANET_RING'),
    name = components.get('G_PLANET_NAME');
  const overlay = {
    ring: ring ? ring.val('Icon_Texture_Name').trim() : 'planet_ring.tga',
    scale: ring?.num('Scale', 1) ?? 1,
    alpha:
      (ring
        ?.val('Color')
        .trim()
        .split(/[\s,]+/)
        .map(Number)[3] ?? 255) / 255,
    font: name?.val('Font_Name') || 'EmpireAtWar-Bold',
    pt: name?.num('Font_Point_Size', 7) ?? 7
  };
  const facts = {},
    planets = [],
    planetKeys = new Map(),
    maps = [],
    mapKeys = new Map(),
    rows = [],
    looks = [],
    lookKeys = new Map();
  for (const f of db.factions.values()) {
    const rgb = f
      .str('Color')
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(Number);
    facts[f.name] = {
      label: label(f),
      ink: f
        .str('Display_Font_Color')
        .trim()
        .split(/[\s,]+/)
        .slice(0, 3)
        .map(Number),
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
      idx = new Map(),
      scenery = [];
    for (const p of g.planets) {
      // Keep differing placements if a loader supplies one. Owner/route rows already
      // refer to these exact indices; the shared chart is presentation, never topology.
      const location = JSON.stringify([p.name, ...p.pos]);
      if (!planetKeys.has(location)) {
        planetKeys.set(location, planets.length);
        const t = p.type;
        planets.push([
          p.name,
          label(t),
          ...p.pos,
          t.str('Galactic_Model_Name'),
          t.num('Scale_Factor', 1),
          t.bool('In_Background') ? 1 : t.bool('In_Midground') ? 2 : t.bool('In_Midforeground') ? 3 : 0,
          t.bool('Exclude_From_Distance_Fade')
        ]);
      }
      if (p.background) {
        scenery.push(planetKeys.get(location));
        continue;
      }
      idx.set(p.index, worlds.length);
      worlds.push([planetKeys.get(location), p.owner]);
    }
    for (const r of g.routes)
      if (idx.has(r.a) && idx.has(r.b)) {
        const a = g.planets[r.a].owner,
          b = g.planets[r.b].owner,
          f = db.faction(a),
          line = data.lines.get((r.type.str('Visible_Line_Name') || 'Default').toUpperCase()) || data.lines.get('DEFAULT');
        const allied = (a, b) =>
          a?.toUpperCase() === b?.toUpperCase() ||
          db
            .faction(a)
            ?.list('Allies')
            .some(n => n.toUpperCase() === b?.toUpperCase());
        let style = routeStyle(a, b, f, db.constants, g.active, false, allied);
        if (!line?.sub('Settings_For_Faction').some(n => n.attrs.Name?.toUpperCase() === style.toUpperCase()))
          style = routeStyle(a, b, f, db.constants, g.active, true, allied);
        const look = routeSettings(line, style),
          key = JSON.stringify(look);
        if (!lookKeys.has(key)) {
          lookKeys.set(key, looks.length);
          looks.push(look);
        }
        routes.push([idx.get(r.a), idx.get(r.b), lookKeys.get(key)]);
      }
    const key = JSON.stringify([worlds, routes, scenery]);
    if (!mapKeys.has(key)) {
      mapKeys.set(key, maps.length);
      maps.push({ worlds, routes, scenery });
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
      family: c.str('Campaign_Set').trim().toUpperCase(),
      ...(known && id === '1976399102' && plot === 'CONQUESTS/CLONEWARSFTGU/STORY_PLOTS_SANDBOX_FTGU_CONTAINER.XML'
        ? { prewarFtgu: true }
        : {}),
      // GCPlayerAgnosticFTGU reads local credits / 1000 + 1. This exact plot and its
      // zero-credit faction default start Era 1 without changing any other player's treasury.
      ...(known && id === '3417277973' && plot === 'CONQUESTS/FTGU/STORY_PLOTS_SANDBOX_FTGU_CONTAINER.XML' && base.credits === 0
        ? { defaultFtguYear: '3996 BBY' }
        : {}),
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
    // Keep the original listed loader, its credits/tech slots, and every existing start.
    // Direct layout rows use only destination defaults, as the native LOAD_CAMPAIGN reward does.
    for (const { c: target, button } of fallCustomLayouts(id, pack?.revision, c, data.campaigns)) {
      const layout = label(db.type(button)),
        group = label(c);
      rows.push({
        id: target.name,
        family: target.str('Campaign_Set').toUpperCase(),
        label: `${group} · ${layout}`,
        layout: { group, name: layout },
        description: db.t(target.str('Description_Text')),
        order: c.num('Sort_Order'),
        faction,
        base: campaignDefaults(target, faction),
        limits: campaignLimits(target),
        slots: [],
        initial: 0,
        variants: [variant(target, '')],
        scripted: false
      });
    }
  }
  if (id === '1125571106' && pack.revision === thrawnRevision) {
    const menu = data.campaigns.get('GCMENU_REBEL');
    if (menu?.str('Story_Name').toUpperCase().includes('STORY_PLOTS_GCMENU.XML')) {
      const add = (c, variants, order, family, scripted = false) => {
        const faction = c.str('Starting_Active_Player'),
          layout = customOpenings.get(family.replace(/^selector:/, ''));
        rows.push({
          id: c.name,
          family,
          ...(family === 'selector:FTGU' ? { eraProgression: true } : {}),
          ...(layout ? { customOpening: true, layout: { group: label(c), name: layout } } : {}),
          label: layout ? `${label(c)} · ${layout}` : label(c),
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
      add(menu, [variant(menu, 'Original in-game selector')], 10000, '', true);
      const nameMatchesFaction = c => c.name.toUpperCase().endsWith('_' + c.str('Starting_Active_Player').toUpperCase());
      const table = n => menuTable(read(`Data/Scripts/Story/GCMenu${n}.lua`).toString());
      for (const { map, targets } of thrawnSelections(table('Translator'), table('_FactionsbyMapEra'))) {
        const choices = targets
          .map(([name, date]) => [data.campaigns.get(name.toUpperCase()), date])
          .filter(
            ([c]) =>
              c &&
              !c.bool('Is_Multiplayer') &&
              !c.bool('Tutorial') &&
              c.list('Locations').length > 1 &&
              db.faction(c.str('Starting_Active_Player')) &&
              (!customOpenings.has(map) || (nameMatchesFaction(c) && campaignDefaults(c, c.str('Starting_Active_Player')).maxTech >= 5))
          );
        if (choices.length)
          add(
            choices[0][0],
            choices.map(([c, date]) => variant(c, date)),
            map === 'FTGU' ? -1000 : -100 + choices[0][0].num('Sort_Order'),
            'selector:' + map
          );
      }
    }
  }
  rows.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  catalogFactionArt(archive, db, id, facts, rows, maps);
  parentPort.postMessage({
    id,
    revision: pack?.revision || 'stock',
    overlay,
    laneKit: laneKit(archive, { overlay, looks }),
    sheets: planetSheets(archive, planets, maps, home),
    camera: {
      pitch: db.constants.num('GMC_InitialPitchAngleDegrees', -30),
      plane: db.constants.num('Galactic_Scroll_Plane', 10),
      light: galacticLight(
        db.constants.vec('Galactic_Zoom_Out_Light_Angle', [0, 160, 58]),
        db.constants.vec('Galactic_Zoom_In_Light_Angle', [0, 235, 18]),
        db.constants.num('Galactic_Zoom_Light_Level', 0.5),
        0
      )
    },
    looks,
    facts,
    presence: campaignPresence(data.campaigns,facts,rows.flatMap(r=>r.variants.map(v=>v.id))),
    planets,
    maps,
    rows,
    yearLegend,
    levels: ['TEXT_DIFFICULTY_EASY_NAME', 'TEXT_DIFFICULTY_NORMAL_NAME', 'TEXT_DIFFICULTY_HARD_NAME'].map(k => db.t(k)),
    defaults: Object.fromEntries(Object.entries(ruleFields).map(([k, r]) => [k, db.constants.num(r.tag, r.fallback)])),
    combat: combatCatalog(archive, pack, data.campaigns),
    payment: productionPayment(archive, pack),
    buildTime: constructionTime(archive, pack),
    donor: pack ? portableRules(pack) : null
  });
} finally {
  archive.close();
}
