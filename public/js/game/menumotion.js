// A player may reduce animated previews even when the OS does not. Never override an OS request for less motion.
const key = 'swr-reduce-menu-motion',
  media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
let forced = false;
try {
  forced = localStorage.getItem(key) === '1';
} catch {}
export const menuMotion = new EventTarget();
Object.defineProperty(menuMotion, 'matches', { get: () => forced || !!media?.matches });
export const reduceMenuMotion = () => forced;
export function setReduceMenuMotion(on) {
  forced = !!on;
  try {
    localStorage.setItem(key, forced ? '1' : '0');
  } catch {}
  changed();
}
function syncClass() {
  globalThis.document?.documentElement.classList.toggle('reduce-menu-motion', menuMotion.matches);
}
function changed() {
  syncClass();
  menuMotion.dispatchEvent(new Event('change'));
}
syncClass();
media?.addEventListener?.('change', changed);
