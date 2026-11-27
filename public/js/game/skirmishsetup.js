import { preferredRules, ruleOverrides } from './battlefrontrules.js';
import { factionKey } from './skirmishdetachments.js';
import { factionColor } from './commandcolor.js';
import { autoColors } from '../gamedata.js';
import { mapHeader, mapTitle } from '../ted.js';
import { DYNAMIC_SIZES, isDynamic, dynamicSize, resizeDynamic, liveMaps } from './dynamicmap.js';
import { PALETTE, ROWS } from './slotrows.js';

import {SKIRMISH_DRAFT, readBattleDraft, saveBattleDraft} from './battledrafts.js';
const KINDS = ['you', 'closed', 'easy', 'medium', 'hard'];
export const MAX_TEAMS = 10;
export const SPECTATOR_TEAM = -1;

// Both the briefing and the restored staging dialog edit this same draft.
export function skirmishSetup({ maps, landMaps = [], customMaps = { space: [], land: [] }, factions, init, profiles }) {
  const saved = readBattleDraft(SKIRMISH_DRAFT);
  const battlefrontDefaults = profiles ? preferredRules() : null; // Launch with the defaults this board actually showed.
  const dynamic = maps.filter(isDynamic);
  const official = { space: maps.filter(m => !isDynamic(m)), land: landMaps };
  const listFor = (custom, mode) =>
    mode === 'space' ? liveMaps([...(custom ? customMaps.space : official.space), ...dynamic]) : (custom ? customMaps : official)[mode];
  const onlyCustom = mode => !official[mode].length && !!customMaps[mode].length;
  const st = {
    preBuilt: typeof saved.preBuilt === 'boolean' ? saved.preBuilt : true,
    mode: listFor(onlyCustom('space'), 'space').length ? 'space' : 'land',
    custom: false,
    mapFile: init.mapFile,
    teamFactions: Array.from(
      { length: MAX_TEAMS },
      (_, i) => [saved.teamFactions?.[i], init.teamFactions[i]].find(f => factions.includes(f)) || factions[i % factions.length]
    ),
    credits: Number.isSafeInteger(saved.credits) && saved.credits >= 0 ? saved.credits : init.credits,
    popCap: Number.isSafeInteger(saved.popCap) && saved.popCap >= 0 ? saved.popCap : init.popCap,
    fog: typeof saved.fog === 'boolean' ? saved.fog : init.fog,
    shooter: !!globalThis.shooterMode,
    ruleEdits: {}
  };
  const lastMap = { space: init.mapFile, land: landMaps.find(m => /TATOOINE/i.test(m)) || landMaps[0] };
  // A planet's invasion TED is usually not a listed multiplayer map. Keep the
  // chosen field in this draft so opening Players & options doesn't change it.
  let planet = null;
  const mapsOf = () => {
    const list = listFor(st.custom, st.mode);
    return planet?.authored && planet.domain === st.mode && !st.custom && !list.includes(planet.file) ? [...list, planet.file] : list;
  };
  const selectPlanet = (info, keepTeams = false) => {
    planet = info.file && info.world ? { id: info.world.id, domain: info.domain, file: info.file, authored: info.authored } : null;
    st.mode = info.domain;
    st.custom = customMaps[st.mode].includes(info.file);
    pick(info.file);
    syncTeams(keepTeams);
  };
  const lastKey = () => (st.custom ? 'custom ' : '') + st.mode;
  if (
    (saved.mode === 'space' || saved.mode === 'land') &&
    listFor(!!saved.custom || onlyCustom(saved.mode), saved.mode).includes(saved.mapFile)
  ) {
    st.mode = saved.mode;
    st.custom = !!saved.custom || onlyCustom(saved.mode);
    lastMap[lastKey()] = saved.mapFile;
  } else if (onlyCustom(st.mode)) {
    st.custom = true;
    if (customMaps[st.mode].includes(init.mapFile)) lastMap[lastKey()] = init.mapFile;
  }
  const savedSlots =
    Array.isArray(saved.slots) &&
    saved.slots.filter(s => s?.kind === 'you').length === 1 &&
    saved.slots.every(
      s =>
        KINDS.includes(s?.kind) &&
        Number.isInteger(s.team) &&
        (s.team >= 0 || (s.kind === 'you' && s.team === SPECTATOR_TEAM)) &&
        s.team < MAX_TEAMS
    )
      ? saved.slots
      : null;
  const slots = Array.from({ length: Math.max(ROWS, savedSlots?.length ?? init.players.length) }, (_, i) => {
    const p = init.players[i],
      s = savedSlots?.[i];
    return s
      ? {
          kind: s.kind,
          team: s.team,
          ...(profiles && s.rosterPick ? { rosterPick: s.rosterPick } : {}),
          ...(factions.includes(s.skirmishFaction) ? { skirmishFaction: s.skirmishFaction } : {}),
          color: typeof s.color === 'string' ? s.color : PALETTE[i % PALETTE.length],
          auto: s.auto !== false
        }
      : p && !savedSlots
        ? { kind: p.human ? 'you' : p.difficulty, team: p.team, color: p.color, auto: p.auto !== false }
        : { kind: 'closed', team: i % 2, color: PALETTE[i % PALETTE.length], auto: true };
  });
  const playing = s => s.kind !== 'closed' && s.team !== SPECTATOR_TEAM;
  let catalog = [],
    current = '';
  const configureRosters = (p, id) => {
    catalog = p;
    current = id;
    syncTeams(true);
  };
  const sourceOf = s => s?.rosterPick || { profile: current, faction: s?.skirmishFaction || st.teamFactions[s?.team] };
  const profileOf = s => catalog.find(p => p.id === sourceOf(s).profile);
  const nativeSeat = s => {
    const r = sourceOf(s);
    return (
      (!r.profile || r.profile === current) &&
      factions.includes(r.faction) &&
      profileOf(s)?.availability?.[r.faction]?.['native' + st.mode] !== false
    );
  };
  const seatFaction = s => {
    if(!s)return undefined;
    const r = sourceOf(s);
    return nativeSeat(s) ? r.faction : factionKey(r.profile, r.faction);
  };
  const rosterError = () => {
    for (const s of slots.filter(playing)) {
      if (nativeSeat(s)) continue;
      const r = sourceOf(s),
        p = profileOf(s);
      if (!p?.availability?.[r.faction]?.[st.mode])
        return `${p?.facts[r.faction]?.label || r.faction} has no available ${st.mode} detachment. Choose another faction or battlefield.`;
    }
    return '';
  };
  const teamFaction = team =>
    seatFaction(slots.find(s => s.team === team && s.kind === 'you') || slots.find(s => s.team === team && playing(s))) ||
    st.teamFactions[team];
  const teamsUsed = () => [...new Set(slots.filter(playing).map(s => s.team))].sort((a, b) => a - b);
  const syncTeams = (keepTeams = false) => {
    if (!keepTeams && st.mode === 'land') for (const s of slots) if (s.team !== SPECTATOR_TEAM) s.team = Math.max(0, Math.min(1, s.team));
    autoColors(slots.filter(playing), st.teamFactions, PALETTE, s => factionColor(profileOf(s), sourceOf(s).faction));
  };
  const mapRows = list =>
    list
      .map(m => {
        const name = mapTitle(m),
          n = mapHeader(m)?.players;
        return { key: m, name, label: (n ? `(${n}) ` : '') + name };
      })
      .sort(
        (a, b) =>
          isDynamic(b.key) - isDynamic(a.key) ||
          (isDynamic(a.key)
            ? DYNAMIC_SIZES.indexOf(dynamicSize(a.key)) - DYNAMIC_SIZES.indexOf(dynamicSize(b.key))
            : a.name.localeCompare(b.name))
      );
  const pick = file => {
    st.mapFile = lastMap[lastKey()] = file;
  };
  const forceDynamic = () => {
    if (st.mode !== 'space' || teamsUsed().length <= 2 || isDynamic(st.mapFile)) return false;
    pick(mapsOf().find(isDynamic) || resizeDynamic('medium'));
    return true;
  };
  const resolveMaps = () => {
    if (onlyCustom(st.mode) && !(planet?.authored && st.mode === planet.domain)) st.custom = true;
    const list = mapsOf();
    pick(list.includes(lastMap[lastKey()]) ? lastMap[lastKey()] : mapRows(list)[0]?.key || null);
    forceDynamic();
    return list;
  };
  const remember = () => {
    const { mode, custom, mapFile, preBuilt, credits, popCap, fog, teamFactions } = st;
    saveBattleDraft(SKIRMISH_DRAFT, { mode, custom, mapFile, preBuilt, credits, popCap, fog, teamFactions, slots });
  };
  const setup = () => {
    const used = teamsUsed();
    if (!st.mapFile || used.length < 2 || rosterError()) return null;
    const guests = new Map(
      slots.filter(s => playing(s) && !nativeSeat(s)).map(s => [seatFaction(s), { ...sourceOf(s), revision: profileOf(s).revision }])
    );
    const { mode, preBuilt, mapFile, credits, popCap, fog } = st;
    return {
      mode,
      preBuilt,
      ...(profiles && mode === 'land' && slots.some(s => s.kind === 'you' && playing(s)) ? {
        soloBattlefront: st.shooter ? { enabled: true, rules: { ...battlefrontDefaults, ...ruleOverrides(st.ruleEdits) } } : { enabled: false }
      } : {}),
      ...(guests.size ? { skirmishRosters: [...guests.values()] } : {}),
      ...(planet?.domain === mode && planet.file === mapFile ? { planetBattle: { id: planet.id, authored: planet.authored } } : {}),
      mapFile,
      credits,
      popCap,
      fog,
      teamFactions: used.map(teamFaction),
      players: slots.filter(playing).map(s => ({
        human: s.kind === 'you',
        team: used.indexOf(s.team),
        ...(seatFaction(s) !== teamFaction(s.team) ? { skirmishFaction: seatFaction(s) } : {}),
        color: s.color,
        auto: false,
        ...(s.kind !== 'you' ? { difficulty: s.kind } : {})
      })),
      ...(slots.some(s => s.kind === 'you' && s.team === SPECTATOR_TEAM) ? { spectate: true } : {})
    };
  };
  syncTeams(!!profiles);
  resolveMaps();
  return {
    st,
    battlefrontDefaults,
    slots,
    official,
    customMaps,
    dynamic,
    teamsUsed,
    seatFaction,
    sourceOf,
    profileOf,
    configureRosters,
    rosterError,
    isNativeSeat: nativeSeat,
    teamFaction,
    syncTeams,
    mapRows,
    pick,
    forceDynamic,
    resolveMaps,
    selectPlanet,
    remember,
    setup
  };
}
