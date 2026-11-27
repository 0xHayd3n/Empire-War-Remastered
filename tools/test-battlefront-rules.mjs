import assert from 'node:assert/strict';
import { standardRules, matchRules, preferredRules, saveRuleDefaults, boardBattlefront } from '../public/js/game/battlefrontrules.js';
import { skirmishSetup } from '../public/js/game/skirmishsetup.js';
import { travelDraft, applyTravel } from '../public/js/game/skirmishtravel.js';
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) };
assert.deepEqual(preferredRules(), standardRules);
saveRuleDefaults({
  infantryCost: 2,
  drainSeconds: 0,
  unknown: 4,
  fieldRegen: '10',
  heroPoints: -1,
  shuttleSeats: 12,
  shuttleEvery: 0,
  shuttleFirst: -1,
  postCaptureTime: 0,
  postNeutralTime: '2',
  squadSpawnMax: -1,
  squadSpawnCalm: 0
});
assert.deepEqual(preferredRules(), { ...standardRules, infantryCost: 2, drainSeconds: 0 });
const args = {
  maps: [],
  landMaps: ['LAND.TED'],
  profiles: () => {},
  factions: ['Red', 'Blue'],
  init: {
    mapFile: 'LAND.TED',
    credits: 6000,
    popCap: 50,
    fog: true,
    teamFactions: ['Red', 'Blue'],
    players: [
      { human: true, team: 0 },
      { team: 1, difficulty: 'easy' }
    ]
  }
};
const m = skirmishSetup(args);
m.st.shooter = true;
m.st.boardShooterChanged = true;
m.st.ruleEdits = { heroPoints: 500, infantryCost: 3, extra: 'bad' };
const battle = m.setup(),
  active = matchRules(battle);
assert.equal(boardBattlefront(battle), true);
assert.deepEqual(active, { ...standardRules, infantryCost: 3, drainSeconds: 0, heroPoints: 500 });
saveRuleDefaults({ heroPoints: 3000 });
m.st.ruleEdits.heroPoints = 1000;
assert.equal(matchRules(battle).heroPoints, 500);
assert(Object.isFrozen(active));
assert.equal(m.setup().soloBattlefront.rules.heroPoints, 1000);
assert.equal(m.setup().soloBattlefront.rules.drainSeconds, 0, 'another profile write cannot change an already displayed board');
m.remember();
assert.deepEqual(skirmishSetup(args).st.ruleEdits, {});
const d = travelDraft(m),
  dest = skirmishSetup(args);
assert(applyTravel(dest, d, 'stock', args.factions));
assert.deepEqual(dest.st.ruleEdits, { heroPoints: 1000, infantryCost: 3 });
assert(dest.st.shooter);
for (const flag of [
  'net',
  'shooterNet',
  'campaign',
  'spectate',
  'instant',
  'restore',
  'replay',
  'linkedTactical',
  'tacticalStoryPlot',
  'benchmark',
  'attract'
]) {
  assert.equal(boardBattlefront({ ...battle, [flag]: true }), undefined, flag);
  assert.equal(matchRules({ ...battle, [flag]: true }), standardRules, flag);
}
assert.equal(boardBattlefront({ ...battle, mode: 'space' }), undefined);
assert.equal(matchRules({ mode: 'land' }), standardRules);
m.st.shooter = false;
assert.equal(boardBattlefront(m.setup()), false);
assert.equal(matchRules(m.setup()), standardRules);
m.slots[0].team = -1;
m.slots[2].kind = 'easy';
m.slots[2].team = 0;
assert.equal(m.setup().soloBattlefront, undefined);
console.log('PASS: validated preferences, one-match overrides, immutable launch snapshots, travel and excluded sessions.');
