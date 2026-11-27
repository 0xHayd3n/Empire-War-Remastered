import { battleScale } from './imagesampling.js';

// Fleet view uses the same single-frame scene resolve as detailed close-ups, but
// has more ships to shade. Keep a lower pixel ceiling, and respect low-power settings.
const PIXELS = 2880 * 1620;
export function fleetSampleRatio(prefs, w, h, maxDimension = 8192, webgl = false) {
  if (
    prefs.fleetCoverage !== true ||
    prefs.aa === false ||
    prefs.supersample > 1 ||
    prefs.scale < 1 ||
    battleScale(prefs) !== 1 ||
    !(w > 1 && h > 1)
  )
    return 1;
  const r = Math.min(webgl ? 1.25 : 1.5, Math.sqrt(PIXELS / (w * h)), maxDimension / Math.max(w, h));
  return r >= 1.15 ? r : 1; // skip a full-frame resolve for negligible coverage gain
}
