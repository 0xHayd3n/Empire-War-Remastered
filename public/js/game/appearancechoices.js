// Reviewed native option orders, not model overrides. Changing a mod revision hides the controls.
const fall = {
    id: '1976399102',
    revision: 'd0e2f9c8a2856f38eb5ff254e3cb43a29a00d77ccc6dc900b97b9af2213786d1',
    row: 'CloneWars_Small_Republic',
    target: 'Clone_Wars_Small_Era_2_Empire'
  },
  revan = {
    id: '3417277973',
    revision: '4cdb9e170cce2db5d6cee1fc3c81c58d2913a2c9cf0589131fce573a211dcfd7',
    row: 'Known_Galaxy_Medium_Republic',
    target: 'Known_Galaxy_Medium_Era_2_Empire'
  };
export const appearances = {
  clonePaint: {
    ...fall,
    title: 'Starting clone armor',
    type: 'Option_Cycle_Clones',
    flag: 'CLONE_DEFAULT',
    choices: ['Unpainted', '212th', '501st', '104th', '327th', '187th', '21st', '41st', 'Random squads', 'Random companies']
  },
  fleetMark: {
    ...fall,
    title: 'Starting fleet emblem',
    type: 'Option_Cycle_Rep_Fleet',
    flag: 'FLEET_EMBLEM',
    values: [null, 'OPEN_CIRCLE', 'KDY', 'ORSF', 'TAPANI'],
    choices: ['Unmarked', 'Open Circle', 'KDY', 'ORSF', 'Tapani']
  },
  saber: {
    ...revan,
    title: 'Revan’s starting lightsaber',
    type: 'Option_Cycle_Lightsaber_Revan',
    flag: 'DEFAULT_LIGHTSABER_REVAN',
    choices: ['Blue', 'Cyan', 'Green', 'Orange', 'Purple', 'Red', 'Yellow']
  }
};
export const appearanceEligible = (d, p, r, v) =>
  p?.id === d.id && p.revision === d.revision && !r?.scripted && r?.id === d.row && v?.id === d.target && r.faction === 'Empire';
export const validPaint = (d, n) => Number.isInteger(n) && n >= 0 && n < d.choices.length;
const pack = () => globalThis.document?.querySelector('meta[name="swr-pack-revision"]')?.content;
const exact = (d, g, active = g.active) =>
  g.universalPath === 1 &&
  !g.humans &&
  active === 'Empire' &&
  (g.campaign?.name ?? g.campaign) === d.target &&
  pack() === `${d.id}:${d.revision}`;
export function restorePaint(g, s) {
  delete g.paintKeys;
  delete g.paint;
  for (const [k, d] of Object.entries(appearances)) {
    if (!exact(d, g) || !Array.isArray(s?.keys) || !s.keys.includes(k)) continue;
    (g.paintKeys ||= []).push(k);
    const m = s.orders?.[k];
    if (!validPaint(d, m?.goal) || !validPaint(d, m.at) || !['start', 'wait', 'queue'].includes(m.phase)) continue;
    if (m.phase !== 'start' && (!Number.isSafeInteger(m.planet) || !g.planets[m.planet] || !Number.isFinite(m.deadline))) continue;
    (g.paint ||= {})[k] = {
      goal: m.goal,
      at: m.at,
      phase: m.phase,
      ...(m.phase === 'start' ? {} : { planet: m.planet, deadline: m.deadline })
    };
  }
}
// Bridge only the selected, reviewed cosmetic globals into the tactical script VM.
// Read the current native value before each battle, not the requested starting value.
const validValue = (d, v) => (d.values ? v != null && d.values.includes(v) : validPaint(d, v));
export function battlePaint(g, values) {
  const out = {};
  for (const k of g.paintKeys || []) {
    const d = appearances[k],
      v = values?.get(d.flag);
    if (exact(d, g) && validValue(d, v)) out[d.flag] = v;
  }
  return Object.keys(out).length ? { appearance: out } : {};
}
export function tacticalPaint(setup) {
  const map = new Map(),
    cb = setup?.campaign,
    s = cb?.galaxy;
  if (!cb?.appearance || setup.net || setup.linkedTactical || !s?.paintPolicy?.keys) return map;
  for (const [k, d] of Object.entries(appearances)) {
    const v = cb.appearance[d.flag];
    if (
      cb.campaignName === d.target &&
      cb.sides?.includes('Empire') &&
      exact(d, s, 'Empire') &&
      s.paintPolicy.keys.includes(k) &&
      validValue(d, v)
    )
      map.set(d.flag, v);
  }
  return map;
}
