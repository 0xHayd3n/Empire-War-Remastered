/**
 * Device-local ranked ledger.
 *
 * This module only stores real, completed match outcomes that the caller has
 * already projected from the running game. It never talks to a relay, never
 * awards a result for joining, leaving, cancelling, social play, a manual
 * entry or a draw, and never advertises a public rating service.
 *
 * Scope
 * -----
 * A rating is kept per `{ relay, profile, variant }` triple:
 *   relay    normalized lobby relay base URL (http/https/ws/wss, no query)
 *   profile  content/profile fingerprint, e.g. contentStamp().stamp
 *   variant  the matched ruleset id, e.g. rules.id / setup.variant
 *
 * The paired match id (the room id) is idempotent inside its scope. Host and
 * guest keep their own device-local perspective, so the same room id can
 * legitimately exist in two different browsers.
 *
 * Rating
 * ------
 * Fixed bounded stake: +16 for a win, -16 for a loss, 0 for a draw. Rating is
 * clamped to [100, 3000] starting at 1000. A draw is recorded only to consume
 * its match id (so a later contradictory submission is rejected) and never
 * changes the rating.
 *
 * Persistence
 * -----------
 * One localStorage key holds at most `RANKED_LIMITS.scopes` scopes and
 * `RANKED_LIMITS.matchesPerScope` match ids per scope. When Web Locks are
 * available, result commits are serialized across tabs of the same origin.
 * Unreadable or invalid stored JSON is preserved at `<key>.damaged` (best
 * effort) before being replaced. Storage reads/writes never throw out of this
 * module; failures are reported as `{ ok: false, reason }`.
 *
 * Because only the newest match ids are retained, replaying an id that was
 * already evicted is indistinguishable from a new result. Idempotence covers
 * the retained window (128 matches per scope), which is far longer than any
 * retry or rejoin window.
 *
 * Integration sketch (the parent owns projection and queueing):
 *   const { stamp, profile } = await contentStamp();
 *   const result =
 *     winnerTeam == null ? 'draw' : winnerTeam === myTeam ? 'win' : 'loss';
 *   await commitRankedOutcome(
 *     { relay, profile: profile ? `${profile}:${stamp}` : stamp, variant: rules.id },
 *     { matchId: room, result, forfeit: leftMidMatch }
 *   );
 *   const loaded = loadRankedRecord({ relay, profile: ..., variant: rules.id });
 *
 * `forfeit` must only be set when a side actually left or resigned mid-match,
 * never for a staging join/leave/cancel; such a result is a win from the
 * remaining side and a loss from the forfeiting side, never a draw. The caller
 * must discard staging and pre-start departures before committing anything.
 */

export const RANKED_STORAGE_KEY = 'swr.ranked.ledger.v1';
export const RANKED_STORAGE_DAMAGE_SUFFIX = '.damaged';
export const RANKED_SCHEMA = 1;
export const RANKED_RATING = Object.freeze({ start: 1000, stake: 16, floor: 100, ceiling: 3000 });
export const RANKED_LIMITS = Object.freeze({ scopes: 16, matchesPerScope: 128 });

const MAX_COUNTER = 1_000_000_000;
const MAX_STORED_CHARS = 1_000_000;
const MAX_DELTA = RANKED_RATING.ceiling - RANKED_RATING.floor;
const MATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,63}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const RESULTS = new Set(['win', 'loss', 'draw']);
const CODE_OF = new Map([
  ['win', 'w'],
  ['loss', 'l'],
  ['draw', 'd']
]);
const RESULT_OF = new Map([
  ['w', 'win'],
  ['l', 'loss'],
  ['d', 'draw']
]);

function fnv1a(text) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function cleanField(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || CONTROL.test(text)) return null;
  return text;
}

function canonicalRelay(value) {
  const text = cleanField(value, 512);
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const href = url.href.replace(/\/+$/, '');
  return href || null;
}

/** Canonical scope, or null when the input cannot identify a ranked ladder. */
export function rankedScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const relay = canonicalRelay(input.relay);
  const profile = cleanField(input.profile, 128);
  const variant = cleanField(input.variant, 64);
  if (!relay || !profile || !variant) return null;
  return Object.freeze({ relay, profile, variant });
}

function scopeId(scope) {
  // Control characters are rejected by cleanField, so U+001F is unambiguous.
  return `${scope.relay}\u001f${scope.profile}\u001f${scope.variant}`;
}

function normalizeOutcome(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.matchId !== 'string' || !MATCH_ID.test(input.matchId)) return null;
  if (!RESULTS.has(input.result)) return null;
  const forfeit = input.forfeit === undefined ? false : input.forfeit;
  if (typeof forfeit !== 'boolean') return null;
  if (forfeit && input.result === 'draw') return null;
  return Object.freeze({ matchId: input.matchId, result: input.result, forfeit });
}

export function emptyRankedRecord() {
  return {
    rating: RANKED_RATING.start,
    wins: 0,
    losses: 0,
    draws: 0,
    played: 0,
    recorded: 0,
    updatedAt: 0,
    history: []
  };
}

function publicRecord(state) {
  const history = state.matches.map(m => ({
    matchId: m.matchId,
    outcome: m.outcome,
    delta: m.delta,
    forfeit: m.forfeit
  }));
  return {
    rating: state.rating,
    wins: state.wins,
    losses: state.losses,
    draws: state.draws,
    played: Math.min(MAX_COUNTER, state.wins + state.losses + state.draws),
    recorded: history.length,
    updatedAt: state.updatedAt,
    history
  };
}

function sanitizeRating(value) {
  if (value === undefined) return { value: RANKED_RATING.start, damaged: false };
  if (!Number.isFinite(value)) return { value: RANKED_RATING.start, damaged: true };
  const clamped = Math.max(RANKED_RATING.floor, Math.min(RANKED_RATING.ceiling, Math.round(value)));
  return { value: clamped, damaged: clamped !== value };
}

function sanitizeCount(value) {
  if (value === undefined) return { value: 0, damaged: false };
  if (!Number.isFinite(value)) return { value: 0, damaged: true };
  const clamped = Math.max(0, Math.min(MAX_COUNTER, Math.floor(value)));
  return { value: clamped, damaged: clamped !== value };
}

function sanitizeTimestamp(value) {
  if (value === undefined) return { value: 0, damaged: false };
  if (!Number.isFinite(value) || value < 0) return { value: 0, damaged: true };
  const clamped = Math.floor(value);
  return { value: clamped, damaged: clamped !== value };
}

function readMatch(item) {
  if (!Array.isArray(item) || item.length < 3 || item.length > 4) return null;
  const [matchId, code, delta, flag] = item;
  if (typeof matchId !== 'string' || !MATCH_ID.test(matchId)) return null;
  if (typeof code !== 'string') return null;
  const outcome = RESULT_OF.get(code);
  if (!outcome) return null;
  if (!Number.isInteger(delta) || Math.abs(delta) > MAX_DELTA) return null;
  if (flag !== undefined && flag !== 0 && flag !== 1) return null;
  return { matchId, outcome, delta, forfeit: flag === 1 };
}

function readScope(entry, scope, id) {
  let damaged = false;
  const rating = sanitizeRating(entry.rating);
  const wins = sanitizeCount(entry.wins);
  const losses = sanitizeCount(entry.losses);
  const draws = sanitizeCount(entry.draws);
  const updatedAt = sanitizeTimestamp(entry.updatedAt);
  damaged = damaged || rating.damaged || wins.damaged || losses.damaged || draws.damaged || updatedAt.damaged;

  const matches = [];
  if (entry.matches !== undefined) {
    if (!Array.isArray(entry.matches)) damaged = true;
    else {
      let items = entry.matches;
      if (items.length > RANKED_LIMITS.matchesPerScope) {
        items = items.slice(-RANKED_LIMITS.matchesPerScope);
        damaged = true;
      }
      for (const item of items) {
        const match = readMatch(item);
        if (!match || matches.some(m => m.matchId === match.matchId)) {
          damaged = true;
          continue;
        }
        matches.push(match);
      }
    }
  }
  if (matches.length > RANKED_LIMITS.matchesPerScope) {
    matches.splice(0, matches.length - RANKED_LIMITS.matchesPerScope);
    damaged = true;
  }

  return {
    damaged,
    state: {
      id,
      relay: scope.relay,
      profile: scope.profile,
      variant: scope.variant,
      rating: rating.value,
      wins: wins.value,
      losses: losses.value,
      draws: draws.value,
      updatedAt: updatedAt.value,
      matches
    }
  };
}

function readLedger(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw == null) return { kind: 'empty', scopes: [], damaged: false };
  if (typeof raw !== 'string') return { kind: 'damaged', raw: '', scopes: [], damaged: true };
  if (!raw.trim()) return { kind: 'empty', scopes: [], damaged: false };
  if (raw.length > MAX_STORED_CHARS) return { kind: 'damaged', raw, scopes: [], damaged: true };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'damaged', raw, scopes: [], damaged: true };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { kind: 'damaged', raw, scopes: [], damaged: true };
  if (Number.isSafeInteger(parsed.v) && parsed.v > RANKED_SCHEMA) return { kind: 'unsupported' };
  if (parsed.v !== RANKED_SCHEMA || !Array.isArray(parsed.scopes))
    return { kind: 'damaged', raw, scopes: [], damaged: true };

  let damaged = false;
  const seen = new Set();
  const scopes = [];
  for (const entry of parsed.scopes) {
    const scope = entry && typeof entry === 'object' && !Array.isArray(entry) ? rankedScope(entry) : null;
    if (!scope) {
      damaged = true;
      continue;
    }
    const id = scopeId(scope);
    if (seen.has(id)) {
      damaged = true;
      continue;
    }
    seen.add(id);
    const read = readScope(entry, scope, id);
    damaged = damaged || read.damaged;
    scopes.push(read.state);
  }
  if (scopes.length > RANKED_LIMITS.scopes) {
    scopes.splice(0, scopes.length - RANKED_LIMITS.scopes);
    damaged = true;
  }
  return { kind: damaged ? 'repaired' : 'ok', raw: damaged ? raw : null, scopes, damaged };
}

function encodeScope(state) {
  return {
    relay: state.relay,
    profile: state.profile,
    variant: state.variant,
    rating: state.rating,
    wins: state.wins,
    losses: state.losses,
    draws: state.draws,
    updatedAt: state.updatedAt,
    matches: state.matches.map(m => [m.matchId, CODE_OF.get(m.outcome), m.delta, m.forfeit ? 1 : 0])
  };
}

function writeLedger(storage, key, scopes) {
  let text;
  try {
    text = JSON.stringify({ v: RANKED_SCHEMA, scopes: scopes.map(encodeScope) });
  } catch {
    return false;
  }
  try {
    storage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

function preserveDamaged(storage, key, raw) {
  if (typeof raw !== 'string' || !raw) return;
  try {
    storage.setItem(key + RANKED_STORAGE_DAMAGE_SUFFIX, raw);
  } catch {
    // Preservation is best effort; the failed primary write is handled by the caller.
  }
}

function failure(reason, scope, record) {
  return {
    ok: false,
    applied: false,
    duplicate: false,
    created: false,
    reason,
    scope: scope || null,
    record: record || null,
    ratingDelta: 0
  };
}

function safeKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || CONTROL.test(value))
    return RANKED_STORAGE_KEY;
  return value;
}

async function runLocked(locks, name, fn) {
  if (!locks || typeof locks.request !== 'function') return fn();
  let started = false;
  try {
    return await locks.request(name, { mode: 'exclusive' }, () => {
      started = true;
      return fn();
    });
  } catch (error) {
    // The callback may have completed before a lock error surfaced. Only fall
    // back to an unlocked write when the commit never started.
    if (started) throw error;
    return fn();
  }
}

/**
 * Build an isolated ledger view. Storage and locks are resolved at call time so
 * the ledger can be created before a browser has exposed them.
 */
export function createRankedLedger(options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const key = safeKey(settings.key);

  const storageNow = () => {
    if (settings.storage !== undefined) {
      const storage = settings.storage;
      return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
        ? storage
        : null;
    }
    try {
      const storage = globalThis.localStorage;
      return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
        ? storage
        : null;
    } catch {
      return null;
    }
  };

  const locksNow = () => {
    if (settings.locks !== undefined) return settings.locks;
    try {
      return globalThis.navigator?.locks || null;
    } catch {
      return null;
    }
  };

  const nowMs = () => {
    try {
      const value = typeof settings.now === 'function' ? settings.now() : Date.now();
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : Date.now();
    } catch {
      return Date.now();
    }
  };

  function load(scopeInput) {
    const scope = rankedScope(scopeInput);
    if (!scope) return { ...failure('invalid-scope', null, null), found: false, damaged: false };
    const storage = storageNow();
    if (!storage)
      return {
        ...failure('storage-unavailable', scope, emptyRankedRecord()),
        found: false,
        damaged: false
      };

    const ledger = readLedger(storage, key);
    if (ledger.kind === 'unavailable')
      return {
        ...failure('storage-unavailable', scope, emptyRankedRecord()),
        found: false,
        damaged: false
      };
    if (ledger.kind === 'unsupported')
      return {
        ...failure('unsupported-version', scope, emptyRankedRecord()),
        found: false,
        damaged: false
      };

    const found = ledger.scopes.find(state => state.id === scopeId(scope));
    return {
      ok: true,
      applied: false,
      duplicate: false,
      created: false,
      reason: null,
      scope,
      record: found ? publicRecord(found) : emptyRankedRecord(),
      found: !!found,
      damaged: ledger.damaged,
      ratingDelta: 0
    };
  }

  async function commit(scopeInput, outcomeInput) {
    const scope = rankedScope(scopeInput);
    if (!scope) return failure('invalid-scope', null, null);
    const outcome = normalizeOutcome(outcomeInput);
    if (!outcome) return failure('invalid-outcome', scope, null);
    const storage = storageNow();
    if (!storage) return failure('storage-unavailable', scope, null);
    const id = scopeId(scope);

    try {
      return await runLocked(locksNow(), `swr-ranked-ledger:${fnv1a(key)}`, () => {
        const ledger = readLedger(storage, key);
        if (ledger.kind === 'unavailable') return failure('storage-unavailable', scope, null);
        if (ledger.kind === 'unsupported') return failure('unsupported-version', scope, null);
        if (ledger.damaged) preserveDamaged(storage, key, ledger.raw);

        const scopes = ledger.scopes;
        const target = scopes.find(state => state.id === id) || null;
        if (target) {
          const existing = target.matches.find(m => m.matchId === outcome.matchId);
          if (existing) {
            if (existing.outcome !== outcome.result || existing.forfeit !== outcome.forfeit)
              return failure('conflict', scope, publicRecord(target));
            if (ledger.damaged) writeLedger(storage, key, scopes);
            return {
              ok: true,
              applied: false,
              duplicate: true,
              created: false,
              reason: null,
              scope,
              record: publicRecord(target),
              ratingDelta: 0
            };
          }
        }

        const base = target
          ? { ...target, matches: target.matches.slice() }
          : {
              id,
              relay: scope.relay,
              profile: scope.profile,
              variant: scope.variant,
              rating: RANKED_RATING.start,
              wins: 0,
              losses: 0,
              draws: 0,
              updatedAt: 0,
              matches: []
            };
        const next = { ...base, matches: base.matches.slice() };
        let ratingDelta = 0;
        if (outcome.result === 'win') {
          const rating = Math.min(RANKED_RATING.ceiling, next.rating + RANKED_RATING.stake);
          ratingDelta = rating - next.rating;
          next.rating = rating;
          next.wins = Math.min(MAX_COUNTER, next.wins + 1);
        } else if (outcome.result === 'loss') {
          const rating = Math.max(RANKED_RATING.floor, next.rating - RANKED_RATING.stake);
          ratingDelta = rating - next.rating;
          next.rating = rating;
          next.losses = Math.min(MAX_COUNTER, next.losses + 1);
        } else {
          next.draws = Math.min(MAX_COUNTER, next.draws + 1);
        }
        next.updatedAt = nowMs();
        next.matches.push({
          matchId: outcome.matchId,
          outcome: outcome.result,
          delta: ratingDelta,
          forfeit: outcome.forfeit
        });
        if (next.matches.length > RANKED_LIMITS.matchesPerScope)
          next.matches.splice(0, next.matches.length - RANKED_LIMITS.matchesPerScope);

        const nextScopes = scopes.filter(state => state.id !== id);
        nextScopes.push(next);
        while (nextScopes.length > RANKED_LIMITS.scopes) nextScopes.shift();

        if (!writeLedger(storage, key, nextScopes))
          return failure('storage-failed', scope, target ? publicRecord(target) : emptyRankedRecord());

        return {
          ok: true,
          applied: true,
          duplicate: false,
          created: !target,
          reason: null,
          scope,
          record: publicRecord(next),
          ratingDelta
        };
      });
    } catch {
      return failure('storage-failed', scope, null);
    }
  }

  return Object.freeze({ key, load, commit });
}

/** Load the device-local record for one scope. Never throws. */
export function loadRankedRecord(scope, options) {
  return createRankedLedger(options).load(scope);
}

/** Commit one already-projected completed match. Never throws; returns a result object. */
export function commitRankedOutcome(scope, outcome, options) {
  return createRankedLedger(options).commit(scope, outcome);
}
