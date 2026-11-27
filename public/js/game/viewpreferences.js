// Local profile preferences; never copied into a save, replay, or network order.
const key = 'swr-player-view-v1';
const rates = [0.5, 0.75, 1, 1.5, 2],
  levels = [0.25, 0.5, 0.75, 1];
const definition = {
  barMode: ['native', ['native', 'damaged', 'focus', 'off']],
  barWidth: [1, [0.75, 1, 1.25, 1.5, 2]],
  barShields: [true],
  groupCenter: ['selected', ['selected', 'always', 'never']],
  showWaypoints: [false],
  hazardShortcut: [true],
  orbitLook: [1, rates],
  orbitInvert: [false],
  chaseBlend: [1, [0, 0.5, 1, 1.5, 2]],
  chaseReticle: [1, [0.75, 1, 1.25, 1.5, 2]],
  chaseTip: [true],
  fireArcs: ['filled', ['filled', 'outline', 'off']],
  cineBars: [1, [0, 0.5, 1, 1.5]],
  cineTime: [1, rates],
  cineReturn: [false],
  speechMusic: [1, [0, 0.25, 0.5, 0.75, 1]],
  peaceDelay: [1, rates],
  touchHold: [450, [250, 350, 450, 600, 800]],
  touchSlop: [10, [6, 10, 16, 24]],
  touchPan: [1, rates],
  touchPinch: [1, rates],
  touchTwist: [1, [0, ...rates]],
  touchRing: [true],
  saveBeforeBattle: [true],
  saveCycles: [0, [0, 1, 3, 5]],
  pan: [1, rates],
  turn: [1, rates],
  wheel: [1, rates],
  invertWheel: [false],
  cursorZoom: [true],
  edgeWidth: [1, rates],
  multiClick: [1, [0, ...rates]],
  radarScale: [1, [0.75, 1, 1.25, 1.5, 2]],
  radarGrid: [true],
  radarView: [true],
  radarLine: [1, [1, 1.5, 2, 3]],
  labelScale: [1, [0.75, 1, 1.25, 1.5, 2]],
  radarShapes: [false],
  routeWidth: [1, [0.5, 0.75, 1, 1.5, 2]],
  routeSparks: [true],
  fleetTracks: ['visible', ['visible', 'mine', 'off']],
  advisorHold: [1, rates],
  tacticalHintInterval: [1, [0.5, 1, 2, 4]],
  stormFlash: [1, [0, 0.25, 0.5, 0.75, 1]],
  bombardFlash: [1, [0, 0.25, 0.5, 0.75, 1]],
  messageReader: [false],
  labelOutline: [false],
  whiteNames: [false],
  logMerge: [2, [0, 1, 2, 5]],
  logRows: [120, [20, 60, 120, 240]],
  logLocation: [false],
  replayRate: [16, [1, 2, 4, 8, 16]],
  captionScale: [1, [0.75, 1, 1.25, 1.5, 2]],
  captionInk: ['white', ['white', 'yellow', 'cyan']],
  captionPlate: ['none', ['none', 'dim', 'black']],
  captionPosition: ['bottom', ['bottom', 'top']],
  movieMix: [1, [0, 0.25, 0.5, 0.75, 1]],
  musicFade: [true],
  musicResume: [true],
  duckLevel: [0.3, [0.15, 0.3, 0.5, 0.75]],
  guiGain: [1, levels],
  ambientGain: [1, levels],
  replyGain: [1, levels],
  hudGain: [1, levels],
  messageTime: [1, rates],
  messageCount: [5, [2, 3, 5, 8]],
  spaceShake: [1, [0, 0.25, 0.5, 0.75, 1]]
};
export const viewOptions = Object.fromEntries(Object.entries(definition).map(([k, [initial]]) => [k, initial]));
export function viewChoices(k) {
  return definition[k][1];
}
export const defaultViewOption = k => definition[k][0];
const valid = (k, v) => Object.hasOwn(definition, k) && (definition[k][1]?.includes(v) ?? typeof v === 'boolean');
try {
  const v = JSON.parse(localStorage.getItem(key));
  for (const k of Object.keys(definition)) if (valid(k, v?.[k])) viewOptions[k] = v[k];
} catch {}
export function setViewOption(k, v) {
  if (!valid(k, v)) return;
  viewOptions[k] = v;
  try {
    localStorage.setItem(key, JSON.stringify(viewOptions));
  } catch {}
}
// Visibility is decided by the caller; this only chooses which eligible bars to paint.
export function showUnitVitals(native, focus, damaged) {
  switch (viewOptions.barMode) {
    case 'damaged':
      return damaged || focus;
    case 'focus':
      return focus;
    case 'off':
      return false;
    default:
      return native;
  }
}
export const wheelDirection = delta => (viewOptions.invertWheel ? -delta : delta);
export const tacticalWheel = delta => wheelDirection(delta) * viewOptions.wheel;
export const landZoomStep = delta => (wheelDirection(delta) > 0 ? 1.12 : 0.89) ** viewOptions.wheel;
