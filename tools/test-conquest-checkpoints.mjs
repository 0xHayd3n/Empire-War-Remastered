import assert from 'node:assert/strict';
import { cycleCheckpoint, saveBeforeConflict, cycleSlot } from '../public/js/game/conquestcheckpoints.js';
import { setViewOption as set } from '../public/js/game/viewpreferences.js';
import { getSave, putSave } from '../public/js/game/savegame.js';
const store = new Map();
globalThis.localStorage = { setItem: (k, v) => store.set(k, v), getItem: k => store.get(k) ?? null };
const game = {
  galactic: true,
  setup: { menuFamily: 'conquest' },
  galaxy: { fiscal: { cycle: 50 } },
  saveName: () => 'Sample',
  galacticSnapshot(name, header) {
    return {
      ...header,
      format: 'sw-revival-save',
      mode: 'galactic',
      setup: { campaign: 'test' },
      name,
      summary: { cycle: this.galaxy.fiscal.cycle + 1 },
      galaxy: { planets: [] }
    };
  }
};
const tick = () => cycleCheckpoint(game);
await putSave(game.galacticSnapshot('Manual', {}), 's123');
await saveBeforeConflict(game);
assert(await getSave('autosave'), 'existing battle checkpoint on by default');
set('saveBeforeBattle', false);
game.galaxy.fiscal.cycle++;
await saveBeforeConflict(game);
assert.equal((await getSave('autosave')).summary.cycle, 51, 'disabling autosave preserves the previous slot');
set('saveCycles', 3);
await tick();
assert.equal(await getSave(cycleSlot), null, 'restoring at cycle 52 does not immediately save');
game.galaxy.fiscal.cycle += 2;
await tick();
assert.equal(await getSave(cycleSlot), null);
game.galaxy.fiscal.cycle++;
for (const [key, v] of [
  ['paused', true],
  ['net', {}],
  ['noSave', true],
  ['pendingBattle', { busy: true }],
  ['storyDialog', { opened: true }]
]) {
  game[key] = v;
  await tick();
  delete game[key];
  assert.equal(await getSave(cycleSlot), null, key);
}
await tick();
assert.equal((await getSave(cycleSlot)).summary.cycle, 55);
set('saveCycles', 0);
game.galaxy.fiscal.cycle += 10;
await tick();
assert.equal((await getSave(cycleSlot)).summary.cycle, 55);
game.setup.menuFamily = 'story';
await saveBeforeConflict(game);
assert.equal((await getSave('autosave')).summary.cycle, 65, 'story battle recovery is not configurable');
assert.equal((await getSave('s123')).name, 'Manual');
console.log(
  'PASS: restored-cycle anchoring, save guards, isolated slots, story pre-battle recovery, and opt-out without deleting existing saves.'
);
