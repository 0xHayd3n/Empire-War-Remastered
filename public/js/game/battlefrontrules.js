// Match rules, not live Shooter HUD preferences. Only the solo land skirmish board stamps a launch.
const KEY = 'swr-solo-battlefront-rules-v1';
const seconds = n => `${n} s`;
const mapTime = n => (n === 1 ? 'Map default' : `${n}× map time`);
export const ruleFields = [
  ['infantryCost', 'Tickets lost per infantry casualty', 1, [1, 2, 3], String],
  ['vehicleCost', 'Tickets lost per vehicle casualty', 2, [1, 2, 3, 5], String],
  ['drainSeconds', 'Ticket drain for holding a majority', 5, [0, 2, 5, 10, 20], n => (n ? `1 ticket every ${n} s` : 'Off')],
  ['postNeutralTime', 'Time to neutralize a command post', 1, [0.5, 1, 1.5, 2], mapTime],
  ['postCaptureTime', 'Time to capture a command post', 1, [0.5, 1, 1.5, 2], mapTime],
  ['playerDelay', 'Player redeployment delay', 5, [3, 5, 8, 12], seconds],
  ['botDelayScale', 'Bot reinforcement delay', 1, [0.5, 1, 1.5, 2], n => `${10 * n} s · ${4 * n} s when behind`],
  ['squadSpawnMax', 'Squad deployment points', 4, [0, 1, 2, 4], n => (n ? `Up to ${n}` : 'Off')],
  ['squadSpawnCalm', 'Squad deployment wait after leader is hit', 5, [3, 5, 8, 12], seconds],
  ['shuttleFirst', 'First shuttle wave delay', 3, [1, 3, 6, 10], seconds],
  ['shuttleEvery', 'Time between shuttle waves', 15, [10, 15, 20, 30], seconds],
  ['shuttleSeats', 'Infantry per shuttle', 8, [4, 6, 8], String],
  ['heroPoints', 'Points per hero deployment', 1500, [500, 1000, 1500, 2000, 3000], n => n.toLocaleString()],
  ['fieldRegen', 'Infantry healing away from friendly posts and bases', 5, [0, 2.5, 5, 10], n => (n ? `${n}% health per second` : 'Off')]
];
export const standardRules = Object.freeze(Object.fromEntries(ruleFields.map(([key, , initial]) => [key, initial])));
export function ruleOverrides(source) {
  return Object.fromEntries(ruleFields.filter(([key, , , values]) => values.includes(source?.[key])).map(([key]) => [key, source[key]]));
}
// A negative lead removes an owner; an abandoned attempt unwinds at the speed it began.
export function postTransitionSeconds(point, lead, rules) {
  if (!point.reinforce || !rules) return point.seconds;
  const neutralizing = lead === point.side ? point.taker === -2 : lead < 0;
  return point.seconds * (neutralizing ? rules.postNeutralTime : rules.postCaptureTime);
}
export function preferredRules() {
  try {
    return { ...standardRules, ...ruleOverrides(JSON.parse(localStorage.getItem(KEY))) };
  } catch {
    return { ...standardRules };
  }
}
export function saveRuleDefaults(source) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ruleOverrides(source)));
  } catch {}
}
// Undefined means no board decision: preserve the pre-existing launch path, including MP/mission authority.
export function boardBattlefront(setup) {
  if (
    setup?.mode !== 'land' ||
    setup.net ||
    setup.shooterNet ||
    setup.spectate ||
    setup.campaign ||
    setup.linkedTactical ||
    setup.tacticalStoryPlot ||
    setup.restore ||
    setup.instant ||
    setup.benchmark ||
    setup.attract ||
    setup.replay
  )
    return undefined;
  const stamp = setup.soloBattlefront;
  return typeof stamp?.enabled === 'boolean' ? stamp.enabled : undefined;
}
export function matchRules(setup) {
  return boardBattlefront(setup) === true
    ? Object.freeze({ ...standardRules, ...ruleOverrides(setup.soloBattlefront.rules) })
    : standardRules;
}
