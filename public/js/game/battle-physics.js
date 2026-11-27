import { RamImpacts, wantsRamming } from './ram-impacts.js';
import { TacticalMovement } from './tactical-movement.js';
import { GroundTravel } from './ground-travel.js';
import { BattleWeaponCasts } from './battle-weapon-casts.js';

// A solo battle has one authority: the page OR its simulation worker. This
// version describes changes to game state, not graphics quality. Never change
// the rules halfway through playback or on just one lockstep peer.
export const BATTLE_PHYSICS_RULE = 1;
export function motionRule(setup) {
  if (!wantsRamming(setup)) return 0;
  if (setup.replay) return setup.battlePhysicsRule === BATTLE_PHYSICS_RULE ? BATTLE_PHYSICS_RULE : 0;
  if (setup.restore) return setup.restore.battle?.physicsRule === BATTLE_PHYSICS_RULE ? BATTLE_PHYSICS_RULE : 0;
  return BATTLE_PHYSICS_RULE;
}
export function installBattlePhysics(w, R, domain, rule, cell) {
  w.weaponCasts?.dispose();
  w.weaponCasts = rule === BATTLE_PHYSICS_RULE ? new BattleWeaponCasts(R) : undefined;
  w.battlePhysicsRule = rule;
  w.ramImpacts =
    rule === BATTLE_PHYSICS_RULE
      ? new TacticalMovement(
          R,
          domain,
          domain === 'land' ? (a, b) => w.ally(a, b) : null,
          domain === 'land' ? (x, y) => w.groundZ(x, y) : null
        )
      : new RamImpacts(R, domain);
  if (rule === BATTLE_PHYSICS_RULE && domain === 'land' && cell > 0)
    w.ramImpacts.terrain = new GroundTravel(R, cell, (u, x, y) => w.isOpen(x, y, ((u.need || 1) & ~3) | 1));
}
