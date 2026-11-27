export const logFilters = [
  ['all', 'All teams'],
  ['tracked', 'Followed team'],
  ['production', 'Production']
];
const PREF = 'swr-observer-display';
const defaultDisplay = { log: true, balance: true, clock: true, filter: 'all', graph: 'Combat power' };
export function observerDisplay() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(PREF));
  } catch {}
  return Object.fromEntries(Object.entries(defaultDisplay).map(([k, v]) => [k, typeof saved?.[k] === typeof v ? saved[k] : v]));
}
export function saveObserverDisplay(k, v) {
  if (!Object.hasOwn(defaultDisplay, k) || typeof defaultDisplay[k] !== typeof v) return;
  try {
    localStorage.setItem(PREF, JSON.stringify({ ...observerDisplay(), [k]: v }));
  } catch {}
}
const KEY = 'swr-spectator-team-vision';
export function spectatorTeamVision() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function setSpectatorTeamVision(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {}
}
