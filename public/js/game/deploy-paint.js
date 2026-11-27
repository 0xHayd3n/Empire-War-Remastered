// Which model the deployment portrait shows, and which paint it wears.
//
// Kept out of the WebGL portrait so the rules can be checked without a browser:
// a unit may only have a space model, and the paint key is what decides whether
// a colour scrub needs a repaint.
import { liveryKey, normalizeLivery } from '../livery.js';

const name = (unit, key) => {
  const value = unit?.str?.(key);
  return typeof value === 'string' ? value.trim() : '';
};

// Land first, then the space model, so a space-only hero still gets a portrait.
export function previewFile(unit) {
  return name(unit, 'Land_Model_Name') || name(unit, 'Space_Model_Name');
}

// Animation clips are named after the model, so try both rigs. The override is
// shared by both: it is the rig the unit actually moves with.
export function previewAnimBases(file, override = '') {
  const seen = new Set();
  return [override, file]
    .map(value => String(value || '').trim())
    .filter(value => {
      const key = value.toUpperCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const teamHex = teamColor => (teamColor?.isColor ? teamColor.getHexString() : typeof teamColor === 'string' ? teamColor : '');

// Paint identity: team colour plus livery. Identical palettes compare equal so
// scrubbing back to a colour reuses the cached materials instead of piling up.
export function previewPaint(teamColor, livery) {
  const paint = normalizeLivery(livery, teamColor);
  return { key: [teamHex(teamColor) || '-', liveryKey(paint)].join('/'), livery: paint };
}
