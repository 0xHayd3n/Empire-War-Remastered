import { rosterColor } from './commandgroups.js';
// Exhibition ink belongs to the focused roster, never the artwork donor or participant paint.
export function factionColor(p, id) {
  return rosterColor(p?.id, id) || p?.facts?.[id]?.color;
}
export const commandColor = r => factionColor(r.p, r.id) || '#71838c';
