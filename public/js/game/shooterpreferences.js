const KEY = 'swr-shooter-settings';
const mult = n => `${n.toFixed(2)}×`;
const percent = n => `${Math.round(n * 100)}%`;
export function padAxis(input, config) {
  const d = config.padDead ?? 0.16,
    a = Math.abs(input);
  return a <= d
    ? 0
    : Math.sign(input) * ((Math.min(1, a) - d) / (1 - d)) ** (config.padCurve === 'linear' ? 1 : config.padCurve === 'fine' ? 2.2 : 1.6);
}
// Both presentations use the same choices, bounds and defaults as the live Battlefront controller.
export const shooterFields = [
  { section: 'video', key: 'fov', label: 'Field of view', initial: 70, range: [55, 100, 1], format: n => `${n}°` },
  { section: 'controls', key: 'sens', label: 'Mouse sensitivity', initial: 1, range: [0.3, 2.5, 0.05], format: mult },
  { section: 'controls', key: 'ads', label: 'Aiming sensitivity', initial: 1, range: [0.3, 2, 0.05], format: mult },
  { section: 'controls', key: 'invert', label: 'Invert look', initial: false },
  {
    section: 'controls',
    key: 'aimMode',
    label: 'Zoom input',
    initial: 'hold',
    choices: [
      ['hold', 'Hold to zoom'],
      ['toggle', 'Toggle zoom']
    ]
  },
  {
    section: 'gameplay',
    key: 'vehicleView',
    label: 'Vehicle view',
    initial: 'chase',
    choices: [
      ['chase', 'Chase camera'],
      ['seat', 'Driver / gunner view']
    ]
  },
  {
    section: 'gameplay',
    key: 'view',
    label: 'Infantry view',
    initial: 'third',
    choices: [
      ['third', 'Third person'],
      ['first', 'First person']
    ]
  },
  {
    section: 'hud',
    key: 'deployUI',
    label: 'Deployment screen',
    initial: '2005',
    choices: [
      ['2005', 'Battlefront 2005'],
      ['original', 'Browser original']
    ]
  },
  {
    section: 'hud',
    key: 'crosshair',
    label: 'Crosshair',
    initial: 'ring',
    choices: [
      ['ring', 'Battlefront 2005'],
      ['dot', 'Dot'],
      ['cross', 'Cross']
    ]
  },
  ...[
    ['radarVisible', 'Local radar', 'radar'],
    ['compassVisible', 'Compass', 'compass'],
    ['tagsVisible', 'Unit markers', 'tagCv'],
    ['feedVisible', 'Elimination feed', 'feedEl'],
    ['hitsVisible', 'Hit markers', 'mark'],
    ['helpVisible', 'Controls reminder', 'controlsTip'],
    ['annVisible', 'Battle announcements', 'annEl']
  ].map(([key, label, node]) => ({ section: 'hud', key, label, node, initial: true })),
  { section: 'navigation', key: 'radarNorth', label: 'Keep north at the top of the radar', initial: false },
  { section: 'navigation', key: 'radarZoom', label: 'Local radar zoom', initial: 1, range: [1, 2, 0.25], format: mult },
  { section: 'navigation', key: 'radarTerrain', label: 'Radar terrain opacity', initial: 0.4, range: [0, 1, 0.05], format: percent },
  { section: 'navigation', key: 'radarCone', label: 'Show camera view cone on radar', initial: true },
  { section: 'navigation', key: 'radarPins', label: 'Pin distant command posts to radar edge', initial: true },
  {
    section: 'navigation',
    key: 'compassLabels',
    label: 'Compass bearings',
    initial: 'cardinal',
    choices: [
      ['cardinal', 'Four directions'],
      ['eight', 'Eight directions'],
      ['degrees', 'Degrees from north']
    ]
  },
  { section: 'navigation', key: 'compassPosts', label: 'Show command post letters on compass', initial: true },
  { section: 'feedback', key: 'sightScale', label: 'Crosshair size', initial: 1, range: [0.5, 1.75, 0.05], format: percent },
  { section: 'feedback', key: 'sightOpacity', label: 'Crosshair opacity', initial: 0.2, range: [0.1, 1, 0.05], format: percent },
  { section: 'feedback', key: 'sightSpread', label: 'Expand crosshair with weapon spread', initial: true },
  { section: 'feedback', key: 'targetHealth', label: 'Aimed target name and health', initial: true },
  { section: 'feedback', key: 'damageArcs', label: 'Directional damage indicators', initial: true },
  { section: 'feedback', key: 'pointDistance', label: 'Distance beneath capture point markers', initial: true },
  { section: 'feedback', key: 'scorePopups', label: 'Score pop-ups near the crosshair', initial: true },
  {
    section: 'feedback',
    key: 'feedScope',
    label: 'Eliminations shown',
    initial: 'nearby',
    choices: [
      ['nearby', 'Nearby and personal'],
      ['personal', 'Personal only']
    ]
  },
  { section: 'feedback', key: 'feedSeconds', label: 'Elimination feed display time', initial: 6, range: [2, 12, 1], format: n => `${n} s` },
  { section: 'motion', key: 'damageTint', label: 'Damage vignette', node: 'vig', initial: true },
  { section: 'motion', key: 'bob', label: 'Head bob', initial: true },
  { section: 'motion', key: 'impactShake', label: 'Impact camera shake', initial: 1, range: [0, 1, 0.1], format: percent },
  { section: 'motion', key: 'speedFov', label: 'Widen view during sprint and boost', initial: true },
  { section: 'controls', key: 'padLook', label: 'Gamepad look speed multiplier', initial: 1, range: [0.25, 2.5, 0.05], format: mult },
  { section: 'controls', key: 'padDead', label: 'Gamepad stick dead zone', initial: 0.16, range: [0, 0.4, 0.01], format: percent },
  {
    section: 'controls',
    key: 'padCurve',
    label: 'Gamepad stick response',
    initial: 'standard',
    choices: [
      ['linear', 'Linear'],
      ['standard', 'Standard'],
      ['fine', 'Fine control']
    ]
  },
  { section: 'controls', key: 'swapSticks', label: 'Swap move and look sticks', initial: false },
  { section: 'gameplay', key: 'shuttle', label: 'Shuttle deploys', initial: true },
  { section: 'colour', key: 'colorblind', label: 'Colourblind-safe markers', initial: false },
  { section: 'controls', key: 'assist', label: 'Gamepad aim assist', initial: true }
];
export function shooterPreferences() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}
export function loadShooterConfig() {
  const saved = shooterPreferences();
  return Object.fromEntries(
    shooterFields.map(f => {
      const v = saved[f.key];
      const valid = f.range
        ? Number.isFinite(v) && v >= f.range[0] && v <= f.range[1]
        : f.choices
          ? f.choices.some(([k]) => k === v)
          : typeof v === 'boolean';
      return [f.key, valid ? v : f.initial];
    })
  );
}
export function saveShooterPreferences(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
export function setShooterPreference(shooter, key, value) {
  if (shooter) shooter.setCfg(key, value);
  else saveShooterPreferences({ ...shooterPreferences(), [key]: value });
}
