// Independent of the archive's GraphicDetails levels and of the display calibration.
export const originalLook = Object.freeze({ surfaceRelief: 0, environmentLight: 0, lensStreaks: 0, contactShade: 0, materialFinish: 0 });
export const enhancedLook = Object.freeze({ ...originalLook, surfaceRelief: 0.8, environmentLight: 0.85, lensStreaks: 0.7 });
export const ultraLook = Object.freeze({ ...enhancedLook, contactShade: 0.85, materialFinish: 0.85 });
export const battleLooks = Object.freeze({ original: originalLook, enhanced: enhancedLook, ultra: ultraLook });
// A space-only override, not a fourth global slider preset. Read on draw; never overwrite the player's base look.
export const cinematicOrbit = Object.freeze({ ...originalLook, surfaceRelief: 0.55, environmentLight: 0.35, materialFinish: 0.7, bloomScale: 0.5, orbitStage: 1 });
const presentations = new Map([
  ['cinematic', cinematicOrbit],
  ['linear', Object.freeze({ ...cinematicOrbit, orbitStage: 2 })],
  ['orbital', Object.freeze({ ...cinematicOrbit, orbitStage: 3 })],
  ['deep-space', Object.freeze({ ...cinematicOrbit, environmentLight: 0, bloomScale: 0.88, orbitStage: 4 })]
]);
export const spacePresentation = prefs => presentations.has(prefs.spacePresentation) ? prefs.spacePresentation : 'inherit';
export const spaceBattleLook = prefs => presentations.get(prefs.spacePresentation) || prefs;
export const strength = n => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
export function battleLook(prefs) {
  const matches = values => Object.entries(values).every(([k, v]) => strength(prefs[k]) === v);
  return Object.keys(battleLooks).find(key => matches(battleLooks[key])) || 'custom';
}
