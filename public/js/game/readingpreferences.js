// Multipliers preserve the timing authored by the mounted pack at 1×. Cache for per-frame readers.
const key = 'swr-reading-speeds',
  defaults = { tooltip: 1, story: 1, credits: 1 };
export const reading = { ...defaults };
const allowed = [0.5, 1, 1.5, 2];
try {
  const stored = JSON.parse(localStorage.getItem(key));
  for (const k of Object.keys(defaults)) if (allowed.includes(stored?.[k])) reading[k] = stored[k];
} catch {}
export function setReading(k, value) {
  if (!Object.hasOwn(defaults, k) || !allowed.includes(+value)) return;
  reading[k] = +value;
  try {
    localStorage.setItem(key, JSON.stringify(reading));
  } catch {}
}
export const readingChoices = allowed.map(v => [v, v === 1 ? '1× · Game or mod default' : `${v}×`]);
