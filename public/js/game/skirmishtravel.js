// A new battlefield may open in another mod. Transfer seats and ordinary rules,
// including profile-qualified faction choices, never definitions, art or scripts.
// Destination catalog/launch preparation validates source, domain and revision.
import { ruleOverrides } from './battlefrontrules.js';
import { MAX_SLOTS } from './slotrows.js';
import { MAX_TEAMS, SPECTATOR_TEAM } from './skirmishsetup.js';
const kinds = ['easy', 'medium', 'hard', 'closed', 'you'];
const teamId = i => Number.isInteger(i) && i >= 0 && i < MAX_TEAMS;
export function travelDraft({ slots, st, sourceOf }, pick) {
  const { credits, popCap, fog, preBuilt } = st;
  return {
    seats: slots.map(({ kind, team, color, auto }) => (auto === false ? [kind, team, color] : [kind, team])),
    ...(sourceOf && slots.some(s => s.kind !== 'closed' && sourceOf(s).profile)
      ? { picks: slots.map(s => (s.kind === 'closed' || s.team < 0 ? null : [sourceOf(s).profile, sourceOf(s).faction])) }
      : {}),
    ...(st.boardShooterChanged ? { boardShooter: !!st.shooter } : {}),
    ...(Object.keys(st.ruleEdits || {}).length ? { ruleEdits: ruleOverrides(st.ruleEdits) } : {}),
    credits,
    popCap,
    fog,
    preBuilt,
    pick
  };
}
export function applyTravel(model, draft, current, factions) {
  if (!draft) return true;
  const { st, slots } = model,
    { seats, picks, pick, credits, popCap, fog, preBuilt } = draft;
  if (
    !Array.isArray(seats) ||
    !seats.length ||
    seats.length > MAX_SLOTS ||
    !seats.every(
      s =>
        Array.isArray(s) &&
        (s[2] === undefined || /^#[0-9a-f]{6}$/i.test(s[2])) &&
        kinds.includes(s[0]) &&
        (teamId(s[1]) || (s[0] === 'you' && s[1] === SPECTATOR_TEAM))
    ) ||
    (picks &&
      (!Array.isArray(picks) ||
        picks.length !== seats.length ||
        !picks.every(
          r => r === null || (Array.isArray(r) && r.length === 2 && /^(?:stock|\d{1,20})$/.test(r[0]) && /^[-\w]{1,100}$/.test(r[1]))
        ))) ||
    seats.filter(s => s[0] === 'you').length !== 1 ||
    !Number.isSafeInteger(credits) || credits < 0 ||
    !Number.isSafeInteger(popCap) || popCap < 0 ||
    typeof fog !== 'boolean' ||
    typeof preBuilt !== 'boolean' ||
    (pick &&
      (pick.profile !== current ||
        !Number.isInteger(pick.seat) ||
        !seats[pick.seat] ||
        seats[pick.seat][0] === 'closed' ||
        !teamId(seats[pick.seat][1]) ||
        !factions.includes(pick.faction)))
  )
    return false;
  while (slots.length < seats.length) slots.push({});
  for (const [i, s] of slots.entries()) {
    delete s.skirmishFaction;
    delete s.rosterPick;
    if (picks?.[i]) s.rosterPick = { profile: picks[i][0], faction: picks[i][1] };
    s.kind = seats[i]?.[0] || 'closed';
    s.team = seats[i]?.[1] ?? i % 2;
    s.auto = !seats[i]?.[2];
    if (!s.auto) s.color = seats[i][2];
  }
  Object.assign(st, { credits, popCap, fog, preBuilt, ruleEdits: ruleOverrides(draft.ruleEdits) });
  if (typeof draft.boardShooter === 'boolean') Object.assign(st, { shooter: draft.boardShooter, boardShooterChanged: true });
  if (pick) slots[pick.seat].skirmishFaction = pick.faction;
  // selectPlanet synchronizes the seats once the destination domain is known.
  return true;
}
