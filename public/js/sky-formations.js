// Cloud shapes describe the air, not a second forecast. No random rolls or accumulated
// phase timers: asking for the same map, forecast and battle second reproduces the sky.
// Shape: high filaments, rising cells, parallel rolls, continuous deck.
// Optics: distant fall streaks, ice halo, auroral curtain, low horizon bank.
const form = (shape, optics = [0, 0, 0, 0]) => ({ shape, optics });
export const skyFormations = {
  open: form([0, 0, 0, 0]),
  maresTails: form([0.93, 0, 0, 0.06]),
  fairCumulus: form([0.04, 0.94, 0, 0.12]),
  cloudStreets: form([0.1, 0.66, 0.87, 0.22]),
  mackerel: form([0.32, 0.42, 1, 0.32]),
  sunsetBars: form([0.34, 0.12, 0.75, 0.27], [0, 0, 0, 0.2]),
  highIce: form([0.84, 0, 0.17, 0.21], [0, 0.88, 0, 0.09]),
  luminousVeil: form([0.58, 0, 0, 0.61], [0, 0.46, 0, 0.38]),
  lowStratus: form([0.12, 0, 0, 0.93], [0, 0, 0, 0.47]),
  brokenDeck: form([0.03, 0.74, 0.13, 0.66]),
  rainCurtains: form([0.07, 0.41, 0, 0.86], [0.94, 0, 0, 0.32]),
  squallLine: form([0, 0.64, 0.82, 0.87], [0.73, 0, 0, 0.44]),
  anvil: form([0.73, 0.96, 0, 0.78], [0.89, 0, 0, 0.25]),
  snowBands: form([0.15, 0.18, 0.91, 0.72], [0.43, 0.12, 0, 0.4]),
  whiteout: form([0.7, 0, 0.24, 0.96], [0.52, 0, 0, 0.9]),
  valleyMist: form([0.16, 0, 0.11, 0.32], [0, 0, 0, 0.98]),
  dryHaze: form([0.09, 0, 0, 0.1], [0, 0, 0, 0.67]),
  dustFront: form([0.19, 0.43, 0.24, 0.36], [0, 0, 0, 0.92]),
  blowingSand: form([0.88, 0.03, 0.82, 0.18], [0, 0, 0, 0.75]),
  ashPlumes: form([0.08, 0.96, 0.06, 0.56], [0.61, 0, 0, 0.6]),
  ashVeil: form([0.85, 0.1, 0.33, 0.75], [0.24, 0, 0, 0.68]),
  starfield: form([0, 0, 0, 0.02]),
  moonlessVeil: form([0.61, 0.03, 0, 0.38]),
  auroralArc: form([0.08, 0, 0, 0.06], [0, 0, 0.93, 0.03])
};
const pools = {
  clear: ['open', 'fairCumulus', 'maresTails', 'cloudStreets', 'mackerel'],
  lowSun: ['sunsetBars', 'maresTails', 'fairCumulus', 'luminousVeil'],
  woodlandDawn: ['sunsetBars', 'valleyMist', 'luminousVeil'],
  dryClear: ['open', 'maresTails', 'dryHaze'],
  polarDay: ['highIce', 'open', 'mackerel', 'luminousVeil'],
  night: ['starfield', 'moonlessVeil'],
  polarNight: ['auroralArc', 'starfield', 'moonlessVeil'],
  thin: ['open', 'maresTails'],
  volcanic: ['dryHaze', 'ashVeil'],
  cloudSea: ['cloudStreets', 'fairCumulus', 'brokenDeck'],
  overcast: ['lowStratus', 'brokenDeck', 'mackerel'],
  haze: ['dryHaze', 'valleyMist'],
  mist: ['valleyMist', 'luminousVeil'],
  fog: ['lowStratus', 'valleyMist'],
  drizzle: ['valleyMist', 'lowStratus', 'rainCurtains'],
  rain: ['rainCurtains', 'brokenDeck', 'squallLine'],
  downpour: ['squallLine', 'rainCurtains'],
  thunderstorm: ['anvil', 'squallLine'],
  flurries: ['highIce', 'brokenDeck', 'snowBands'],
  snow: ['snowBands', 'luminousVeil', 'brokenDeck'],
  sleet: ['rainCurtains', 'snowBands'],
  blizzard: ['whiteout', 'snowBands'],
  sandstorm: ['blowingSand', 'dustFront', 'dryHaze'],
  ash: ['ashPlumes', 'ashVeil']
};
export function localSkyFamily(family, ctx) {
  if (ctx.night && family === 'night') return ctx.polar ? 'polarNight' : 'night';
  if (family === 'clear') return ctx.polar ? 'polarDay' : ctx.arid ? 'dryClear' : 'clear';
  if (family === 'lowSun' && ctx.woodland) return 'woodlandDawn';
  return family;
}
// Hold each pattern long enough to read, then dissolve it into the next over ~50s.
// Sequence differs by environment. Both endpoints of a weather ease sample the same clock.
function addForm(U, ctx, family, clock, weight) {
  if (weight <= 0) return;
  const pool = pools[localSkyFamily(family, ctx)] || pools.clear;
  const cycle = clock / (116 + ctx.patternSeed * 66) + ctx.patternSeed * pool.length;
  const step = Math.floor(cycle),
    p = Math.max(0, (cycle - step - 0.56) / 0.44),
    mix = p * p * (3 - 2 * p);
  const a = skyFormations[pool[step % pool.length]],
    b = skyFormations[pool[(step + 1) % pool.length]];
  const wa = weight * (1 - mix),
    wb = weight * mix;
  const accum = (v, x, y) => {
    v.x += x[0] * wa + y[0] * wb;
    v.y += x[1] * wa + y[1] * wb;
    v.z += x[2] * wa + y[2] * wb;
    v.w += x[3] * wa + y[3] * wb;
  };
  accum(U.wxFormation.value, a.shape, b.shape);
  accum(U.wxPhenomena.value, a.optics, b.optics);
}
export function sampleFormations(U, ctx, clock, base, a, b, k, ka, kb) {
  const time = Number.isFinite(clock) ? Math.max(0, clock) : 0;
  U.wxFormation.value.set(0, 0, 0, 0);
  U.wxPhenomena.value.set(0, 0, 0, 0);
  addForm(U, ctx, base.family, time, k);
  addForm(U, ctx, a.family, time, ka);
  addForm(U, ctx, b.family, time, kb);
  if (ctx.night || ctx.arid) U.wxPhenomena.value.y = 0; // A solar ice halo is not a dust halo.
}
