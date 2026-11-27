import { activeLivery, sanitizeLivery } from './liveries.js';

// Ready carries the guest's own faction/paint pair. Start carries the final snapshot
// for every occupied player. There is no second cosmetic channel to race the launch.
export function readyPaint(slot, message, faction) {
  slot.liveryFaction = faction;
  slot.livery = message.on && message.faction === faction ? sanitizeLivery(message.livery) : null;
}
export function launchPaint(slot, faction, own) {
  if (!slot || (slot.kind !== 'human' && slot.kind !== 'you')) return null;
  return own ? activeLivery(faction) : slot.liveryFaction === faction ? sanitizeLivery(slot.livery) : null;
}
export const slotLivery = p => (p?.human ? sanitizeLivery(p.livery) : null);
export const liveriesForSides = players => players.map(slotLivery);

export function applySetupLiveries(setup) {
  for (const p of setup.players || []) {
    // Network/restore/replay: only trust the recorded slot, never read the observing device's library.
    const carried =
      Object.hasOwn(p, 'livery') || setup.net || setup.shooterNet || setup.restore || setup.replay || setup.attract || setup.spectate;
    p.livery = !p.human || carried ? slotLivery(p) : activeLivery(p.skirmishFaction || p.faction || setup.teamFactions?.[p.team]);
  }
}
