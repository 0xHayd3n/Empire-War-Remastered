export const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
// The persistent Universal window is deliberately on a different origin. Linked tactical/MP frames still share their parent game's origin.
export function gameRootWindow() {
  if (!document.querySelector('meta[name="swr-universal"]')) return window.top;
  let root = window;
  while (root.parent !== root) {
    try { if (root.parent.location.origin !== location.origin) break; } catch { break; }
    root = root.parent;
  }
  return root;
}
export const topFrame = () => typeof window === 'undefined' || window === window.top || gameRootWindow() === window;
