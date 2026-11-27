// Shared launch draft used by the map briefing and original player editor. No archives required.
import assert from 'node:assert/strict';
import { skirmishSetup, SPECTATOR_TEAM } from '../public/js/game/skirmishsetup.js';
import { travelDraft, applyTravel } from '../public/js/game/skirmishtravel.js';
import { dynamicMaps, isDynamic } from '../public/js/game/dynamicmap.js';

const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
const factions = ['Red', 'Blue', 'Green'];
const args = {
  maps: ['SPACE.TED', ...dynamicMaps()],
  landMaps: [],
  customMaps: { space: [], land: ['CUSTOM.TED'] },
  factions,
  init: {
    credits: 6000,
    popCap: 50,
    fog: true,
    mapFile: 'SPACE.TED',
    teamFactions: factions,
    players: [
      { human: true, team: 0, auto: true },
      { difficulty: 'medium', team: 1, auto: true }
    ]
  }
};
const model = skirmishSetup(args);
assert.equal(model.setup().mapFile, 'SPACE.TED');
Object.assign(model.slots[2], { kind: 'hard', team: 4 });
model.st.teamFactions[4] = factions[2];
model.syncTeams();
model.resolveMaps();
const battle = model.setup();
assert(isDynamic(battle.mapFile));
assert.deepEqual(
  battle.players.map(p => p.team),
  [0, 1, 2]
);
assert.deepEqual(battle.teamFactions, factions);
model.slots[0].team = SPECTATOR_TEAM;
model.syncTeams();
model.remember();
const { patchBattleDraft, readBattleDraft, saveBattleDraft, SKIRMISH_DRAFT, INSTANT_DRAFT } = await import(
  '../public/js/game/battledrafts.js'
);
const original = readBattleDraft(SKIRMISH_DRAFT);
patchBattleDraft(SKIRMISH_DRAFT, 'fog', false);
assert.deepEqual(readBattleDraft(SKIRMISH_DRAFT), { ...original, fog: false });
assert.equal(skirmishSetup(args).setup().fog, false);
saveBattleDraft(SKIRMISH_DRAFT, original);
const fleets = {
  players: [
    { kind: 'you', budget: 4200, army: ['Scout'] },
    { kind: 'medium', budget: 8000, army: ['Cruiser'] }
  ],
  mapFile: 'CUSTOM.TED',
  budget: 15000
};
saveBattleDraft(INSTANT_DRAFT, fleets);
patchBattleDraft(INSTANT_DRAFT, 'budget', 22000);
assert.deepEqual(readBattleDraft(INSTANT_DRAFT), { ...fleets, budget: 22000 });
const replay = skirmishSetup(args);
assert.deepEqual(replay.setup(), model.setup());
assert.equal(replay.setup().spectate, true);
assert.deepEqual(
  replay.setup().players.map(p => p.difficulty),
  ['medium', 'hard']
);
replay.st.mode = 'land';
replay.syncTeams();
replay.resolveMaps();
assert.equal(replay.st.mapFile, 'CUSTOM.TED');
assert(replay.st.custom);
assert.equal(replay.setup(), null, 'two land slots on team 1 cannot start');
replay.slots[1].team = 0;
replay.syncTeams();
assert.equal(replay.setup().mode, 'land');
assert.equal(replay.setup().popCap, 50);
replay.selectPlanet({ world: { id: 'Survey' }, domain: 'land', file: 'SURVEY.TED', authored: true });
assert(replay.resolveMaps().includes('SURVEY.TED'), 'editor keeps the selected campaign field');
assert.equal(replay.setup().mapFile, 'SURVEY.TED');
assert.deepEqual(replay.setup().planetBattle, { id: 'Survey', authored: true });
replay.st.custom = true;
replay.resolveMaps();
assert.equal(replay.setup().mapFile, 'CUSTOM.TED');
assert.equal(replay.setup().planetBattle, undefined, 'manual map changes must not retain a stale planet');
const empty = skirmishSetup({ ...args, maps: [], landMaps: [], customMaps: { space: [], land: [] } });
assert.equal(empty.setup(), null, 'no battlefield, no launch');
// Same internal name in two games is *not* permission to copy a faction.
const destination = skirmishSetup({ ...args, factions: ['Blue', 'Delta'] });
const before = [...destination.st.teamFactions];
const draft = travelDraft(model, { profile: 'target', faction: 'Delta', seat: 1 });
assert.equal(applyTravel(destination, draft, 'different', ['Blue', 'Delta']), false);
assert.equal(applyTravel(destination, draft, 'target', ['Blue']), false);
assert.deepEqual(destination.st.teamFactions, before);
assert.equal(applyTravel(destination, draft, 'target', ['Blue', 'Delta']), true);
assert.deepEqual(destination.st.teamFactions, before);
assert.equal(destination.seatFaction(destination.slots[1]), 'Delta');
assert.equal(applyTravel(destination, { ...draft, pick: { ...draft.pick, seat: 99 } }, 'target', ['Blue', 'Delta']), false);
assert.equal(destination.st.teamFactions[0], before[0]);
assert.deepEqual(
  destination.slots.map(s => [s.team, s.kind]),
  model.slots.map(s => [s.team, s.kind])
);
console.log('Skirmish draft: dynamic constraint, setup persistence, spectator, custom-only land, empty/invalid teams OK');
