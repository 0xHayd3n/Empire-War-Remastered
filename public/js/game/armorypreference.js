const key = 'swr-armory-portrait';
export function preferredArmoryPreview() {
  try {
    if (localStorage.getItem(key) === '1') return 'portrait';
  } catch {}
  return 'live';
}
export function armoryPreview() {
  return globalThis.navigator?.connection?.saveData ? 'portrait' : preferredArmoryPreview();
}
export function saveArmoryPreview(mode) {
  try {
    localStorage.setItem(key, mode === 'portrait' ? '1' : '0');
  } catch {}
}
