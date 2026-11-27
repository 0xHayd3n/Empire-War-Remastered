import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RANKED_LIMITS,
  RANKED_RATING,
  RANKED_STORAGE_KEY,
  commitRankedOutcome,
  createRankedLedger,
  emptyRankedRecord,
  loadRankedRecord,
  rankedScope
} from '../public/js/game/competitive.js';

const RELAY = 'https://relay.example.test';
const variant = 'RULESET_ONE';
const profile = 'stock:abc123';
const scope = (over = {}) => ({ relay: RELAY, profile, variant, ...over });
const matchId = n => `match-${String(n).padStart(4, '0')}`;
const now = () => 1_700_000_000_000;

class MemoryStorage {
  #data = new Map();
  constructor(seed = {}) {
    for (const [key, value] of Object.entries(seed)) this.#data.set(key, String(value));
  }
  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }
  setItem(key, value) {
    this.#data.set(key, String(value));
  }
  removeItem(key) {
    this.#data.delete(key);
  }
  get size() {
    return this.#data.size;
  }
  raw(key) {
    return this.getItem(key);
  }
  json(key) {
    return JSON.parse(this.getItem(key));
  }
}

class FlakyStorage extends MemoryStorage {
  failWrites = false;
  failReads = false;
  getItem(key) {
    if (this.failReads) throw new Error('read denied');
    return super.getItem(key);
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error('quota exceeded');
    return super.setItem(key, value);
  }
}

function serialLocks() {
  const calls = [];
  let tail = Promise.resolve();
  return {
    calls,
    request(name, options, fn) {
      calls.push({ name, mode: options?.mode });
      const run = tail.then(() => fn());
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
}

const ledgerFor = (storage, extra = {}) => createRankedLedger({ storage, now, ...extra });

test('fresh scopes start at 1000 and loading does not write', () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);
  const loaded = ledger.load(scope());

  assert.equal(loaded.ok, true);
  assert.equal(loaded.found, false);
  assert.equal(loaded.damaged, false);
  assert.deepEqual(loaded.record, emptyRankedRecord());
  assert.equal(storage.size, 0);
});

test('win and loss apply a bounded fixed stake and persist', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);

  const win = await ledger.commit(scope(), { matchId: matchId(1), result: 'win' });
  assert.equal(win.ok, true);
  assert.equal(win.applied, true);
  assert.equal(win.duplicate, false);
  assert.equal(win.created, true);
  assert.equal(win.ratingDelta, RANKED_RATING.stake);
  assert.equal(win.record.rating, 1016);
  assert.equal(win.record.wins, 1);
  assert.equal(win.record.losses, 0);
  assert.equal(win.record.played, 1);
  assert.equal(win.record.recorded, 1);

  // A new ledger instance on the same storage sees the durable result.
  const loaded = ledgerFor(storage).load(scope());
  assert.equal(loaded.ok, true);
  assert.equal(loaded.found, true);
  assert.equal(loaded.record.rating, 1016);
  assert.deepEqual(loaded.record.history, [
    { matchId: matchId(1), outcome: 'win', delta: 16, forfeit: false }
  ]);

  const loss = await ledger.commit(scope(), { matchId: matchId(2), result: 'loss' });
  assert.equal(loss.ok, true);
  assert.equal(loss.ratingDelta, -RANKED_RATING.stake);
  assert.equal(loss.record.rating, 1000);
  assert.equal(loss.record.wins, 1);
  assert.equal(loss.record.losses, 1);
  assert.equal(loss.record.played, 2);
});

test('scopes are separated by relay, profile and variant, with equivalent relays normalized', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);
  const a = scope();
  const b = scope({ profile: 'local:def456' });
  const c = scope({ variant: 'RULESET_TWO' });
  const d = scope({ relay: 'https://other-relay.example.test' });

  await ledger.commit(a, { matchId: matchId(1), result: 'win' });
  await ledger.commit(b, { matchId: matchId(1), result: 'loss' });
  await ledger.commit(c, { matchId: matchId(1), result: 'win' });
  await ledger.commit(d, { matchId: matchId(1), result: 'win' });

  assert.equal(ledger.load(a).record.rating, 1016);
  assert.equal(ledger.load(b).record.rating, 984);
  assert.equal(ledger.load(c).record.rating, 1016);
  assert.equal(ledger.load(d).record.rating, 1016);
  assert.equal(storage.json(RANKED_STORAGE_KEY).scopes.length, 4);

  // The same relay with a trailing slash or uppercase host is the same scope.
  for (const relay of ['https://relay.example.test/', 'https://RELAY.EXAMPLE.TEST']) {
    const loaded = ledger.load(scope({ relay }));
    assert.equal(loaded.found, true);
    assert.equal(loaded.record.rating, 1016);
    assert.equal(loaded.record.wins, 1);
  }
});

test('a paired match id is idempotent within its scope, including across instances', async () => {
  const storage = new MemoryStorage();
  const first = await ledgerFor(storage).commit(scope(), { matchId: matchId(7), result: 'win' });
  assert.equal(first.applied, true);

  const again = await ledgerFor(storage).commit(scope(), { matchId: matchId(7), result: 'win' });
  assert.equal(again.ok, true);
  assert.equal(again.applied, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.ratingDelta, 0);
  assert.equal(again.record.rating, 1016);
  assert.equal(again.record.wins, 1);

  // The same id is independent in a different scope.
  const otherScope = scope({ profile: 'stock:different' });
  const other = await ledgerFor(storage).commit(otherScope, { matchId: matchId(7), result: 'win' });
  assert.equal(other.created, true);
  assert.equal(other.record.rating, 1016);
});

test('a contradictory replay is rejected as a conflict without changing state', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);
  await ledger.commit(scope(), { matchId: matchId(9), result: 'win' });

  const conflict = await ledger.commit(scope(), { matchId: matchId(9), result: 'loss' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'conflict');
  assert.equal(conflict.applied, false);
  assert.equal(conflict.ratingDelta, 0);
  assert.equal(conflict.record.rating, 1016);
  assert.equal(ledger.load(scope()).record.losses, 0);

  const flagConflict = await ledger.commit(scope(), {
    matchId: matchId(9),
    result: 'win',
    forfeit: true
  });
  assert.equal(flagConflict.ok, false);
  assert.equal(flagConflict.reason, 'conflict');
});

test('invalid scopes and non-results are refused without writing', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);

  const badScopes = [
    null,
    undefined,
    42,
    {},
    [],
    scope({ relay: 'ftp://relay.example.test' }),
    scope({ relay: 'https://user:pass@relay.example.test' }),
    scope({ relay: 'https://relay.example.test/?token=1' }),
    scope({ relay: 'not a url' }),
    scope({ relay: '' }),
    scope({ profile: 'p'.repeat(129) }),
    scope({ variant: 'v'.repeat(65) }),
    scope({ profile: '\u0000bad' })
  ];
  for (const bad of badScopes) {
    const loaded = ledger.load(bad);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.reason, 'invalid-scope');
    assert.equal(loaded.record, null);
  }

  const badOutcomes = [
    null,
    undefined,
    {},
    { matchId: matchId(1) },
    { matchId: matchId(1), result: 'join' },
    { matchId: matchId(1), result: 'leave' },
    { matchId: matchId(1), result: 'cancel' },
    { matchId: matchId(1), result: 'social' },
    { matchId: matchId(1), result: 'manual' },
    { matchId: matchId(1), result: 'forfeit' },
    { matchId: 'short', result: 'win' },
    { matchId: 'bad id 123', result: 'win' },
    { matchId: 'x'.repeat(65), result: 'win' },
    { matchId: 42, result: 'win' },
    { matchId: matchId(1), result: 'win', forfeit: 'yes' },
    { matchId: matchId(1), result: 'win', forfeit: 1 },
    { matchId: matchId(1), result: 'draw', forfeit: true }
  ];
  for (const bad of badOutcomes) {
    const result = await ledger.commit(scope(), bad);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-outcome');
    assert.equal(result.applied, false);
    assert.equal(result.ratingDelta, 0);
  }

  assert.equal(storage.size, 0);
  assert.equal(ledger.load(scope()).record.rating, RANKED_RATING.start);
});

test('draws consume the match id but never earn rating', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);

  const draw = await ledger.commit(scope(), { matchId: matchId(3), result: 'draw' });
  assert.equal(draw.ok, true);
  assert.equal(draw.applied, true);
  assert.equal(draw.ratingDelta, 0);
  assert.equal(draw.record.rating, RANKED_RATING.start);
  assert.equal(draw.record.wins, 0);
  assert.equal(draw.record.losses, 0);
  assert.equal(draw.record.draws, 1);
  assert.equal(draw.record.played, 1);

  const replay = await ledger.commit(scope(), { matchId: matchId(3), result: 'draw' });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.record.draws, 1);

  // A late "win" for a drawn match is a conflict, not a free win.
  const late = await ledger.commit(scope(), { matchId: matchId(3), result: 'win' });
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'conflict');
  assert.equal(ledger.load(scope()).record.rating, RANKED_RATING.start);
});

test('forfeit is a real bounded result and is idempotent', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);

  const forfeited = await ledger.commit(scope(), {
    matchId: matchId(11),
    result: 'loss',
    forfeit: true
  });
  assert.equal(forfeited.ok, true);
  assert.equal(forfeited.ratingDelta, -RANKED_RATING.stake);
  assert.equal(forfeited.record.rating, 984);
  assert.deepEqual(forfeited.record.history[0], {
    matchId: matchId(11),
    outcome: 'loss',
    delta: -16,
    forfeit: true
  });

  const replay = await ledger.commit(scope(), {
    matchId: matchId(11),
    result: 'loss',
    forfeit: true
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.record.rating, 984);

  // The opponent's side of a forfeit is an ordinary win with the flag kept.
  const opponent = await ledger.commit(scope(), {
    matchId: matchId(12),
    result: 'win',
    forfeit: true
  });
  assert.equal(opponent.ok, true);
  assert.equal(opponent.record.rating, 1000);
  assert.equal(opponent.record.history.at(-1).forfeit, true);
});

test('rating is clamped to the documented floor and ceiling', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);

  for (let i = 0; i < 140; i++) {
    const result = await ledger.commit(scope(), { matchId: matchId(i), result: 'win' });
    assert.equal(result.ok, true);
  }
  assert.equal(ledger.load(scope()).record.rating, RANKED_RATING.ceiling);
  const cappedWin = await ledger.commit(scope(), { matchId: matchId(900), result: 'win' });
  assert.equal(cappedWin.ratingDelta, 0);
  assert.equal(cappedWin.record.rating, RANKED_RATING.ceiling);

  for (let i = 0; i < 220; i++) {
    const result = await ledger.commit(scope(), { matchId: matchId(1000 + i), result: 'loss' });
    assert.equal(result.ok, true);
  }
  assert.equal(ledger.load(scope()).record.rating, RANKED_RATING.floor);
  const cappedLoss = await ledger.commit(scope(), { matchId: matchId(950), result: 'loss' });
  assert.equal(cappedLoss.ratingDelta, 0);
  assert.equal(cappedLoss.record.rating, RANKED_RATING.floor);
});

test('the ledger stays bounded in match ids and in scopes', async () => {
  const storage = new MemoryStorage();
  const ledger = ledgerFor(storage);

  const totalMatches = RANKED_LIMITS.matchesPerScope + 6;
  for (let i = 0; i < totalMatches; i++) {
    await ledger.commit(scope(), { matchId: matchId(i), result: 'win' });
  }
  const bounded = ledger.load(scope()).record;
  assert.equal(bounded.recorded, RANKED_LIMITS.matchesPerScope);
  assert.equal(bounded.history.length, RANKED_LIMITS.matchesPerScope);
  assert.equal(bounded.history[0].matchId, matchId(6));
  assert.equal(bounded.history.at(-1).matchId, matchId(totalMatches - 1));
  assert.equal(bounded.wins, totalMatches);

  const totalScopes = RANKED_LIMITS.scopes + 4;
  for (let i = 0; i < totalScopes; i++) {
    await ledger.commit(scope({ profile: `profile-${i}` }), {
      matchId: matchId(500 + i),
      result: 'win'
    });
  }
  const stored = storage.json(RANKED_STORAGE_KEY);
  assert.equal(stored.scopes.length, RANKED_LIMITS.scopes);
  assert.equal(ledger.load(scope({ profile: 'profile-0' })).found, false);
  assert.equal(ledger.load(scope({ profile: `profile-${totalScopes - 1}` })).record.rating, 1016);
  for (const entry of stored.scopes) {
    assert.ok(entry.matches.length <= RANKED_LIMITS.matchesPerScope);
  }
});

test('damaged JSON is preserved before the ledger repairs itself', async () => {
  const damagedRaw = '{ this is not a ledger';
  const storage = new MemoryStorage({ [RANKED_STORAGE_KEY]: damagedRaw });
  const ledger = ledgerFor(storage);

  const loaded = ledger.load(scope());
  assert.equal(loaded.ok, true);
  assert.equal(loaded.found, false);
  assert.equal(loaded.damaged, true);
  assert.equal(loaded.record.rating, RANKED_RATING.start);
  // Loading is read-only: the damaged payload stays in place.
  assert.equal(storage.getItem(RANKED_STORAGE_KEY), damagedRaw);
  assert.equal(storage.getItem(RANKED_STORAGE_KEY + '.damaged'), null);

  const repaired = await ledger.commit(scope(), { matchId: matchId(1), result: 'win' });
  assert.equal(repaired.ok, true);
  assert.equal(storage.getItem(RANKED_STORAGE_KEY + '.damaged'), damagedRaw);
  assert.equal(ledger.load(scope()).record.rating, 1016);
  assert.equal(ledger.load(scope()).damaged, false);
});

test('individually malformed stored entries are dropped, not trusted', () => {
  const good = {
    relay: RELAY,
    profile: 'kept:profile',
    variant,
    rating: 1000,
    wins: 2,
    losses: 0,
    draws: 0,
    updatedAt: 5,
    matches: [
      ['good-match-1', 'w', 16, 0],
      ['bad id', 'w', 16, 0],
      ['good-match-2', 'x', 16, 0]
    ]
  };
  const storage = new MemoryStorage({
    [RANKED_STORAGE_KEY]: JSON.stringify({
      v: 1,
      scopes: [{ relay: 'broken', profile: 'x', variant: 'y' }, good]
    })
  });
  const ledger = ledgerFor(storage);
  const loaded = ledger.load(scope({ profile: 'kept:profile' }));

  assert.equal(loaded.ok, true);
  assert.equal(loaded.damaged, true);
  assert.equal(loaded.found, true);
  assert.equal(loaded.record.rating, 1000);
  assert.equal(loaded.record.wins, 2);
  assert.equal(loaded.record.recorded, 1);
  assert.deepEqual(loaded.record.history.map(m => m.matchId), ['good-match-1']);
});

test('oversized stored ledgers are trimmed defensively', async () => {
  const excess = RANKED_LIMITS.scopes + 8;
  const manyScopes = Array.from({ length: excess }, (_, i) => ({
    relay: RELAY,
    profile: `read-${i}`,
    variant,
    rating: 1000,
    wins: 0,
    losses: 0,
    draws: 0,
    updatedAt: i,
    matches: []
  }));
  const tooManyMatches = Array.from(
    { length: RANKED_LIMITS.matchesPerScope + 12 },
    (_, i) => [matchId(i), 'w', 16, 0]
  );
  manyScopes.push({
    ...manyScopes.at(-1),
    profile: 'read-heavy',
    matches: tooManyMatches
  });

  const storage = new MemoryStorage({
    [RANKED_STORAGE_KEY]: JSON.stringify({ v: 1, scopes: manyScopes })
  });
  const ledger = ledgerFor(storage);

  const oldest = ledger.load(scope({ profile: 'read-0' }));
  assert.equal(oldest.damaged, true);
  assert.equal(oldest.found, false);

  const heavy = ledger.load(scope({ profile: 'read-heavy' }));
  assert.equal(heavy.damaged, true);
  assert.equal(heavy.found, true);
  assert.equal(heavy.record.recorded, RANKED_LIMITS.matchesPerScope);
  assert.equal(heavy.record.history[0].matchId, matchId(12));
  assert.equal(heavy.record.history.at(-1).matchId, matchId(RANKED_LIMITS.matchesPerScope + 11));

  const repaired = await ledger.commit(scope({ profile: 'read-heavy' }), {
    matchId: 'repair-0001',
    result: 'win'
  });
  assert.equal(repaired.ok, true);
  assert.equal(storage.json(RANKED_STORAGE_KEY).scopes.length, RANKED_LIMITS.scopes);
});

test('an absurdly large stored payload is treated as damage', async () => {
  const huge = 'x'.repeat(1_000_001);
  const storage = new MemoryStorage({ [RANKED_STORAGE_KEY]: huge });
  const ledger = ledgerFor(storage);

  assert.equal(ledger.load(scope()).damaged, true);
  assert.equal(ledger.load(scope()).found, false);
  const repaired = await ledger.commit(scope(), { matchId: matchId(1), result: 'win' });
  assert.equal(repaired.ok, true);
  assert.equal(ledger.load(scope()).record.rating, 1016);
  assert.equal(storage.json(RANKED_STORAGE_KEY).v, 1);
});

test('a future schema is left untouched instead of being overwritten', async () => {
  const future = JSON.stringify({ v: 99, scopes: [] });
  const storage = new MemoryStorage({ [RANKED_STORAGE_KEY]: future });
  const ledger = ledgerFor(storage);

  const loaded = ledger.load(scope());
  assert.equal(loaded.ok, false);
  assert.equal(loaded.reason, 'unsupported-version');
  assert.equal(loaded.record.rating, RANKED_RATING.start);

  const committed = await ledger.commit(scope(), { matchId: matchId(1), result: 'win' });
  assert.equal(committed.ok, false);
  assert.equal(committed.reason, 'unsupported-version');
  assert.equal(storage.getItem(RANKED_STORAGE_KEY), future);
});

test('storage failures are reported and leave no partial rating', async () => {
  const storage = new FlakyStorage();
  const ledger = ledgerFor(storage);

  storage.failWrites = true;
  const failed = await ledger.commit(scope(), { matchId: matchId(1), result: 'win' });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'storage-failed');
  assert.equal(failed.applied, false);
  assert.equal(failed.ratingDelta, 0);
  assert.equal(failed.record.rating, RANKED_RATING.start);
  assert.equal(storage.getItem(RANKED_STORAGE_KEY), null);

  storage.failWrites = false;
  const retried = await ledger.commit(scope(), { matchId: matchId(1), result: 'win' });
  assert.equal(retried.ok, true);
  assert.equal(retried.ratingDelta, 16);
  assert.equal(retried.record.rating, 1016);

  storage.failReads = true;
  const unreadable = ledger.load(scope());
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.reason, 'storage-unavailable');
  assert.equal(unreadable.record.rating, RANKED_RATING.start);

  const unreadableCommit = await ledger.commit(scope(), { matchId: matchId(2), result: 'win' });
  assert.equal(unreadableCommit.ok, false);
  assert.equal(unreadableCommit.reason, 'storage-unavailable');
});

test('missing storage is unavailable, not a crash', async () => {
  const ledger = createRankedLedger({ storage: null, now });
  assert.equal(ledger.load(scope()).ok, false);
  assert.equal(ledger.load(scope()).reason, 'storage-unavailable');
  const committed = await ledger.commit(scope(), { matchId: matchId(1), result: 'win' });
  assert.equal(committed.ok, false);
  assert.equal(committed.reason, 'storage-unavailable');
});

test('concurrent commits are serialized through the provided lock manager', async () => {
  const storage = new MemoryStorage();
  const locks = serialLocks();
  const ledger = ledgerFor(storage, { locks });

  const [a, b] = await Promise.all([
    ledger.commit(scope(), { matchId: matchId(1), result: 'win' }),
    ledger.commit(scope(), { matchId: matchId(2), result: 'win' })
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(ledger.load(scope()).record.rating, 1032);
  assert.equal(locks.calls.length, 2);
  for (const call of locks.calls) {
    assert.match(call.name, /^swr-ranked-ledger:/);
    assert.equal(call.mode, 'exclusive');
  }

  const [first, second] = await Promise.all([
    ledger.commit(scope(), { matchId: matchId(3), result: 'win' }),
    ledger.commit(scope(), { matchId: matchId(3), result: 'win' })
  ]);
  assert.equal(first.applied !== second.applied, true);
  assert.equal(first.duplicate || second.duplicate, true);
  assert.equal(ledger.load(scope()).record.wins, 3);
  assert.equal(ledger.load(scope()).record.rating, 1048);
  await ledger.commit(scope({variant:'other-queue'}), { matchId: matchId(5), result:'win' });
  assert.equal(new Set(locks.calls.map(c=>c.name)).size, 1, 'all scopes share one storage key and must share the same write lock');
});

test('a fresh storage instance recovers the same durable record', async () => {
  const original = new MemoryStorage();
  await commitRankedOutcome(scope(), { matchId: matchId(1), result: 'win' }, { storage: original, now });
  await commitRankedOutcome(scope(), { matchId: matchId(2), result: 'loss' }, { storage: original, now });

  const restarted = new MemoryStorage({
    [RANKED_STORAGE_KEY]: original.getItem(RANKED_STORAGE_KEY)
  });
  const loaded = loadRankedRecord(scope(), { storage: restarted, now });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.found, true);
  assert.equal(loaded.record.rating, 1000);
  assert.equal(loaded.record.wins, 1);
  assert.equal(loaded.record.losses, 1);
  assert.deepEqual(loaded.record.history.map(m => m.outcome), ['win', 'loss']);
});

test('scope input is canonical and exported consistently', () => {
  assert.deepEqual(rankedScope(scope({ relay: 'https://relay.example.test/' })), {
    relay: 'https://relay.example.test',
    profile,
    variant
  });
  assert.equal(rankedScope(scope({ relay: 'https://relay.example.test/#frag' })), null);
  assert.equal(rankedScope(scope({ profile: '   ' })), null);
});
