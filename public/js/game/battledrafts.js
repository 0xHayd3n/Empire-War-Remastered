// The setup boards and Settings edit the same profile drafts. Patch one field without touching seats, rosters or maps.
export const SKIRMISH_DRAFT = 'swr-skirmish-setup',
  INSTANT_DRAFT = 'swr-instant-setup';
export function readBattleDraft(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
export function saveBattleDraft(key, draft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {}
}
export function patchBattleDraft(key, field, value) {
  saveBattleDraft(key, { ...readBattleDraft(key), [field]: value });
}
export function startingDifficulty() {
  try {
    const v = localStorage.getItem('swr-new-campaign-difficulty');
    if (['easy', 'hard'].includes(v)) return v;
  } catch {}
  return 'medium';
}
export function startingFilters() {
  try {
    return Number(localStorage.getItem('swr-new-galaxy-overlays')) & 15;
  } catch {
    return 0;
  }
}
