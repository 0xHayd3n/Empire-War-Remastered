// Saved individual choices remain intact. Inherited properties (including AA, master shadows,
// render scale and HDR) stay live under either override; never serialize the effective view.
const original = { spacePresentation: 'inherit', surfaceRelief: 0, environmentLight: 0, materialFinish: 0,
  contactShade: 0, lensStreaks: 0, terrainLayers: 0, groundDaylight: false, rainSurfaces: false, cloudReceivers:false, litPuffs:false, mapReflections:false, leafLight:false, waterOptics:false, localSoil:false, aerialDepth: false, sharedWind: false, steadyDetail: false, planetAir: 0, orbitalLighting: 'map', closeHullEdges: false, fleetCoverage: false,
  closeHullShadows: false, sceneLight: false, hullBlastLight: false, hullDamageMarks: false, destroyerDetail: 'stock', destroyerSurface: 'stock' };
const realistic = { ...original, spacePresentation: 'deep-space', surfaceRelief: .55, environmentLight: .35,
  contactShade: .55, materialFinish: .7, terrainLayers: .85, groundDaylight: true, rainSurfaces: true, cloudReceivers:true, litPuffs:true, mapReflections:true, leafLight:true, waterOptics:true, localSoil:true, aerialDepth: true, sharedWind: true, steadyDetail: true, planetAir: .8, orbitalLighting: 'bounce', closeHullEdges: true,
  fleetCoverage: true, closeHullShadows: true, sceneLight: true, hullBlastLight: true, hullDamageMarks: true, destroyerDetail: 'finish', destroyerSurface: 'orbit' };
const cache = new WeakMap();
export function battlePrefs(prefs) {
  const mode = prefs.battleRealism;
  if (mode !== 'on' && mode !== 'off') return prefs;
  let pair = cache.get(prefs);
  if (!pair) cache.set(prefs, pair = {});
  return pair[mode] ||= Object.freeze(Object.assign(Object.create(prefs), mode === 'on' ? realistic : original));
}
