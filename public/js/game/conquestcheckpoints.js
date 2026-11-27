import { db } from '../gamedata.js';
import { cycleNumber } from './galacticeconomy.js';
import { snapshot, putSave } from './savegame.js';
import { viewOptions as prefs } from './viewpreferences.js';

export const cycleSlot = 'conquest-cycle';
const clocks = new WeakMap();

export function saveBeforeConflict(game) {
  if (game.noSave || game.net || game.setup.net || (game.setup.menuFamily === 'conquest' && !prefs.saveBeforeBattle)) return;
  try {
    return putSave(snapshot(game, db.t('TEXT_GUI_AUTO_SAVE')), 'autosave').catch(e => console.warn('Pre-battle save unavailable', e));
  } catch (e) {
    console.warn('Pre-battle save unavailable', e);
  }
}

// Anchor a new or restored session at its current fiscal cycle. Never backfill missed
// intervals. A busy map may defer one checkpoint; it must not queue a burst of writes.
export function cycleCheckpoint(game) {
  if (
    game.setup.menuFamily !== 'conquest' ||
    game.net ||
    game.setup.net ||
    game.galaxy.observer ||
    game.setup.benchmark ||
    game.setup.attract
  )
    return;
  const span = prefs.saveCycles,
    cycle = cycleNumber(game.galaxy);
  let clock = clocks.get(game);
  if (!clock) clocks.set(game, (clock = {}));
  if (clock.span !== span || cycle < clock.at) {
    clock.span = span;
    clock.at = cycle;
    return;
  }
  if (
    !span ||
    cycle - clock.at < span ||
    clock.writing ||
    game.paused ||
    game.noSave ||
    game.over ||
    game.busy ||
    game.held ||
    game.pendingBattle?.busy ||
    game.storyMovie?.pausesMode ||
    game.storyDialog?.opened ||
    game.menus?.open ||
    game.scriptUI?.modal
  )
    return;
  clock.at = cycle;
  const failed = error => {
    console.warn('Cycle checkpoint unavailable', error);
    game.message?.('The cycle checkpoint could not be saved. Use a manual save or download from the Save menu.');
  };
  try {
    clock.writing = putSave(snapshot(game, `Cycle checkpoint · ${game.saveName()}`), cycleSlot)
      .catch(failed)
      .finally(() => {
        clock.writing = null;
      });
    return clock.writing;
  } catch (e) {
    failed(e);
  }
}
