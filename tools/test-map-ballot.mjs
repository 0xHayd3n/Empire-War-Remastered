import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAP_BALLOT_ERRORS,
  MAP_BALLOT_PROTOCOL,
  MAP_BALLOT_TIMING,
  runMapBallot,
  slateFingerprint,
  winningIndex
} from '../public/js/game/mapballot.js';

const MAPS = ['_MP_SPACE_GEONOSIS.TED', '_MP_SPACE_KESSEL.TED', '_MP_SPACE_BESPIN.TED'];
const ONE = ['_MP_SPACE_SOLO.TED'];

// Short, injected durations; the real ones are 15000 / 1500 ms (asserted below).
const FAST = { voteMs: 3000, revealMs: 300, joinGraceMs: 200, retryMs: 100, tickMs: 50, commitWaitMs: 200, hardMs: 6000 };

/* ------------------------------------------------------------------ fakes */

class VirtualClock {
  constructor(start = 1_700_000_000_000) {
    this.time = start;
    this.timers = new Map();
    this.sequence = 0;
  }
  now = () => this.time;
  setTimeout = (fn, ms) => {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.time + Math.max(0, Number(ms) || 0), fn });
    return id;
  };
  clearTimeout = id => {
    this.timers.delete(id);
  };
  get size() {
    return this.timers.size;
  }
  advance(ms) {
    const target = this.time + Math.max(0, ms);
    for (let guard = 0; ; guard++) {
      assert.ok(guard < 100_000, 'timer loop did not settle');
      let nextId = null;
      let next = null;
      for (const [id, timer] of this.timers) {
        if (timer.at > target) continue;
        if (!next || timer.at < next.at || (timer.at === next.at && id < nextId)) {
          next = timer;
          nextId = id;
        }
      }
      if (!next) break;
      this.timers.delete(nextId);
      this.time = next.at;
      next.fn();
    }
    this.time = target;
  }
}

/** Fake paired NetSession: synchronous delivery, JSON copies, link loss, drops. */
class FakeNet {
  constructor({ host, linkPeer, inboundFrom }) {
    this.host = host;
    this.linkPeer = linkPeer;
    this.inboundFrom = inboundFrom;
    this.target = null;
    this.handlers = new Map();
    this.log = [];
    this.drop = null;
    this.always = null;
  }
  on(event, fn) {
    const list = this.handlers.get(event) || [];
    list.push(fn);
    this.handlers.set(event, list);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    this.handlers.set(
      event,
      (this.handlers.get(event) || []).filter(entry => entry !== fn)
    );
  }
  listeners(event) {
    return [...(this.handlers.get(event) || [])];
  }
  get bound() {
    let total = 0;
    for (const list of this.handlers.values()) total += list.length;
    return total;
  }
  emit(event, ...args) {
    for (const fn of this.listeners(event)) fn(...args);
  }
  send(peer, message) {
    assert.equal(peer, this.linkPeer, 'send addresses the paired link');
    const copy = JSON.parse(JSON.stringify(message));
    this.log.push(copy);
    if (this.always && this.always(copy)) return;
    if (this.drop && this.drop(copy)) {
      this.drop = null;
      return;
    }
    this.target.emit('message', this.target.inboundFrom, copy);
  }
  dropNext(predicate) {
    this.drop = predicate;
  }
  sent(type) {
    return this.log.filter(message => message.t === type);
  }
}

function pair(linkId = 7) {
  // The host addresses the guest by its session id; the guest addresses the host as 0.
  const host = new FakeNet({ host: true, linkPeer: linkId, inboundFrom: linkId });
  const guest = new FakeNet({ host: false, linkPeer: 0, inboundFrom: 0 });
  host.target = guest;
  guest.target = host;
  return { host, guest, hostPeer: linkId, guestPeer: 0 };
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function track(promise) {
  const box = { state: 'pending', value: undefined, error: undefined, promise };
  promise.then(
    value => {
      box.state = 'resolved';
      box.value = value;
    },
    error => {
      box.state = 'rejected';
      box.error = error;
    }
  );
  return box;
}

function clocks(offset = 0) {
  const clock = new VirtualClock();
  const hostTimers = { now: () => clock.now(), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  const guestTimers =
    offset === 0 ? hostTimers : { now: () => clock.now() + offset, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  return { clock, hostTimers, guestTimers };
}

function ballotPair(options = {}) {
  const { clock, hostTimers, guestTimers } = clocks(options.offset ?? 0);
  const nets = pair(options.linkId ?? 7);
  if (options.hostDrop) nets.host.drop = options.hostDrop;
  if (options.guestDrop) nets.guest.drop = options.guestDrop;
  if (options.guestDropAlways) nets.guest.always = options.guestDropAlways;
  const timing = { ...FAST, ...(options.timing || {}) };
  const hostUpdates = [];
  const guestUpdates = [];
  const hostSignal = new AbortController();
  const guestSignal = new AbortController();
  const render = into =>
    options.throwOnUpdate
      ? () => {
          throw new Error('the renderer exploded');
        }
      : update => into.push(update);
  const runs = { host: null, guest: null };
  const start = role =>
    (runs[role] ??= track(
      runMapBallot({
        net: nets[role],
        peer: role === 'host' ? nets.hostPeer : nets.guestPeer,
        slate: (role === 'host' ? options.hostSlate : options.guestSlate) ?? MAPS,
        signal: role === 'host' ? hostSignal.signal : guestSignal.signal,
        name: role === 'host' ? (options.hostName ?? 'Vanguard') : (options.guestName ?? 'Nomad'),
        onUpdate: render(role === 'host' ? hostUpdates : guestUpdates),
        timing,
        timers: role === 'host' ? hostTimers : guestTimers
      })
    ));
  for (const role of options.order ?? ['host', 'guest']) start(role);
  return {
    clock,
    nets,
    timing,
    hostUpdates,
    guestUpdates,
    hostSignal,
    guestSignal,
    get hostRun() {
      return runs.host;
    },
    get guestRun() {
      return runs.guest;
    },
    get host() {
      return runs.host;
    },
    get guest() {
      return runs.guest;
    }
  };
}

const latest = updates => updates[updates.length - 1];

function cleanAfter(game) {
  assert.equal(game.clock.size, 0, 'no timers left running');
  assert.equal(game.nets.host.bound, 0, 'host handlers removed');
  assert.equal(game.nets.guest.bound, 0, 'guest handlers removed');
}
const kinds = net => new Set(net.log.map(message => message.k));

/* ------------------------------------------------------------------ tests */

test('production ballot shape: three maps, a fifteen second vote, a 1.5 s reveal', () => {
  assert.equal(MAP_BALLOT_PROTOCOL, 1);
  assert.equal(MAP_BALLOT_TIMING.voteMs, 15000);
  assert.equal(MAP_BALLOT_TIMING.revealMs, 1500);
  assert.equal(winningIndex([0, 1, 1]), 1);
  assert.equal(winningIndex([1, 1, 0]), 0, 'a tie goes to the first map');
  assert.equal(winningIndex([0, 0, 0]), 0, 'no votes go to the first map');
  assert.equal(winningIndex([]), 0);
  assert.notEqual(slateFingerprint(MAPS), slateFingerprint([MAPS[2], MAPS[1], MAPS[0]]));
});

test('bad arguments are refused before anything is wired up', () => {
  const { host } = pair();
  const base = { net: host, peer: 7, slate: MAPS, name: 'Vanguard', onUpdate: () => {} };
  const invalid = (over, pattern) =>
    assert.throws(
      () => runMapBallot({ ...base, ...over }),
      error => {
        assert.equal(error.code, MAP_BALLOT_ERRORS.invalid);
        assert.match(error.message, pattern);
        return true;
      }
    );
  invalid({ slate: [] }, /one to three maps/);
  invalid({ slate: [MAPS[0], MAPS[1], MAPS[2], ONE[0]] }, /one to three maps/);
  invalid({ slate: [MAPS[0], MAPS[0]] }, /same map twice/);
  invalid({ slate: [''] }, /filename/);
  invalid({ slate: [42] }, /filename/);
  invalid({ net: null }, /paired network session/);
  invalid({ net: { on() {} } }, /paired network session/);
  invalid({ peer: undefined }, /paired peer/);
  invalid({ peer: -1 }, /paired peer/);
  invalid({ signal: {} }, /AbortSignal/);
  invalid({ onUpdate: 3 }, /onUpdate/);
  assert.equal(host.bound, 0);
});

test('both sides see each other, the counts and their own choice', async () => {
  const game = ballotPair();
  assert.equal(latest(game.hostUpdates).opponent, 'Nomad');
  assert.equal(latest(game.guestUpdates).opponent, 'Vanguard');
  assert.deepEqual(latest(game.hostUpdates).votes, [0, 0, 0]);
  assert.equal(latest(game.guestUpdates).remaining, 3);
  assert.equal(latest(game.guestUpdates).mine, null);
  assert.equal(latest(game.guestUpdates).winner, null);
  assert.deepEqual(latest(game.guestUpdates).slate, MAPS);
  assert.ok(Object.isFrozen(latest(game.guestUpdates).slate));
  assert.equal(latest(game.guestUpdates).cast, game.guestUpdates[0].cast, 'cast stays stable for the renderer');

  latest(game.hostUpdates).cast(0);
  await flush();
  assert.deepEqual(latest(game.hostUpdates).votes, [1, 0, 0]);
  assert.deepEqual(latest(game.guestUpdates).votes, [1, 0, 0]);
  assert.equal(latest(game.guestUpdates).mine, null, 'the guest only shows its own choice');

  latest(game.guestUpdates).cast(2);
  await flush();
  assert.deepEqual(latest(game.hostUpdates).votes, [1, 0, 1]);
  assert.equal(latest(game.hostUpdates).mine, 0);
  assert.equal(latest(game.guestUpdates).mine, 2);
  assert.deepEqual(latest(game.guestUpdates).votes, [1, 0, 1]);

  game.clock.advance(game.timing.voteMs);
  await flush();
  assert.equal(latest(game.hostUpdates).winner, MAPS[0], 'a 1-1 tie resolves to the first map');
  assert.equal(latest(game.guestUpdates).winner, MAPS[0]);
  assert.equal(latest(game.guestUpdates).remaining, 0);
  game.clock.advance(game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.state, 'resolved');
  assert.equal(game.guest.state, 'resolved');
  assert.equal(game.host.value, MAPS[0]);
  assert.equal(game.guest.value, MAPS[0]);
  cleanAfter(game);
});

test('the same map wins on both sides and the promise waits out the reveal', async () => {
  const game = ballotPair();
  latest(game.guestUpdates).cast(1);
  latest(game.hostUpdates).cast(1);
  await flush();
  assert.deepEqual(latest(game.hostUpdates).votes, [0, 2, 0]);

  game.clock.advance(game.timing.voteMs);
  await flush();
  assert.equal(game.host.state, 'pending', 'the host is still revealing');
  assert.equal(game.guest.state, 'pending', 'the guest is still revealing');
  assert.equal(latest(game.hostUpdates).winner, MAPS[1]);
  assert.equal(latest(game.hostUpdates).remaining, 0);

  game.clock.advance(game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.state, 'resolved');
  assert.equal(game.guest.state, 'resolved');
  assert.equal(game.host.value, MAPS[1]);
  assert.equal(game.guest.value, MAPS[1]);
  assert.ok(kinds(game.nets.host).has('playlist-ballot'));
  cleanAfter(game);
});

test('an empty ballot resolves to the first map', async () => {
  const game = ballotPair();
  game.clock.advance(game.timing.voteMs + game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.state, 'resolved');
  assert.equal(game.guest.state, 'resolved');
  assert.equal(game.host.value, MAPS[0]);
  assert.equal(game.guest.value, MAPS[0]);
  assert.deepEqual(latest(game.hostUpdates).votes, [0, 0, 0]);
  cleanAfter(game);
});

test('votes can change until the deadline, including back to no vote', async () => {
  const game = ballotPair();
  const cast = latest(game.guestUpdates).cast;
  cast(2);
  await flush();
  assert.deepEqual(latest(game.guestUpdates).votes, [0, 0, 1]);
  assert.equal(latest(game.guestUpdates).mine, 2);
  cast(0);
  await flush();
  assert.deepEqual(latest(game.guestUpdates).votes, [1, 0, 0]);
  assert.equal(latest(game.guestUpdates).mine, 0);
  cast(null);
  await flush();
  assert.deepEqual(latest(game.guestUpdates).votes, [0, 0, 0]);
  assert.equal(latest(game.guestUpdates).mine, null);
  cast(-1);
  await flush();
  assert.deepEqual(latest(game.guestUpdates).votes, [0, 0, 0]);

  assert.throws(
    () => cast(3),
    error => error.code === MAP_BALLOT_ERRORS.choice
  );
  assert.throws(
    () => cast(0.5),
    error => error.code === MAP_BALLOT_ERRORS.choice
  );
  assert.throws(
    () => cast('1'),
    error => error.code === MAP_BALLOT_ERRORS.choice
  );
  assert.deepEqual(latest(game.guestUpdates).votes, [0, 0, 0], 'illegal choices change nothing');

  game.clock.advance(game.timing.voteMs);
  await flush();
  assert.throws(
    () => cast(0),
    error => error.code === MAP_BALLOT_ERRORS.closed
  );
  game.clock.advance(game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.state, 'resolved');
  assert.equal(game.host.value, MAPS[0], 'no counted vote means the first map');
  assert.throws(
    () => cast(0),
    error => error.code === MAP_BALLOT_ERRORS.closed
  );
  cleanAfter(game);
});

test('a one-map ballot resolves that map without a tie', async () => {
  const game = ballotPair({ hostSlate: ONE, guestSlate: ONE });
  latest(game.guestUpdates).cast(0);
  latest(game.hostUpdates).cast(0);
  await flush();
  assert.deepEqual(latest(game.hostUpdates).votes, [2]);
  game.clock.advance(game.timing.voteMs + game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.value, ONE[0]);
  assert.equal(game.guest.value, ONE[0]);
  cleanAfter(game);
});

test('outsiders, illegal indexes and duplicate votes are ignored', async () => {
  // Host only: no guest intent can arrive to overwrite the injected peer votes.
  const { host } = pair();
  const clock = new VirtualClock();
  const updates = [];
  const run = track(
    runMapBallot({
      net: host,
      peer: 7,
      slate: MAPS,
      signal: new AbortController().signal,
      name: 'Vanguard',
      onUpdate: update => updates.push(update),
      timing: FAST,
      timers: { now: () => clock.now(), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }
    })
  );
  const vote = index => host.emit('message', 7, { k: 'playlist-ballot', v: 1, t: 'vote', index });
  const counts = () => latest(updates).votes;

  const before = counts();
  host.emit('message', 'intruder', { k: 'playlist-ballot', v: 1, t: 'vote', index: 2 });
  host.emit('message', 99, { k: 'playlist-ballot', v: 1, t: 'vote', index: 1 });
  vote(9);
  vote('1');
  vote(1.5);
  vote(-1);
  host.emit('message', 7, { k: 'other', v: 1, t: 'vote', index: 1 });
  host.emit('message', 7, null);
  host.emit('message', 7, 'vote');
  await flush();
  assert.deepEqual(counts(), before, 'nothing illegal is counted');

  vote(2);
  vote(2);
  vote(2);
  await flush();
  assert.deepEqual(counts(), [0, 0, 1], 'one peer counts once per map');
  assert.equal(run.state, 'pending');

  vote(0);
  await flush();
  assert.deepEqual(counts(), [1, 0, 0], 'the last write wins');
  assert.equal(latest(updates).remaining, 3);

  clock.advance(FAST.voteMs + 1);
  await flush();
  vote(1);
  await flush();
  assert.deepEqual(counts(), [1, 0, 0], 'votes after the deadline are ignored');
  clock.advance(FAST.hardMs);
  await flush();
  assert.equal(run.state, 'rejected', 'a silent peer still fails the host');
  assert.equal(run.error.code, MAP_BALLOT_ERRORS.timeout);
  assert.equal(clock.size, 0);
  assert.equal(host.bound, 0);
});

test('a lost join and a lost vote self-heal, and the pair still resolves', async () => {
  const game = ballotPair({
    guestDrop: message => message.t === 'join'
  });
  latest(game.guestUpdates).cast(1);
  // The join was dropped; the retry (and the host grace timer) must still open the vote.
  game.clock.advance(game.timing.retryMs + game.timing.joinGraceMs);
  await flush();
  assert.equal(game.host.state, 'pending');
  assert.equal(game.guest.state, 'pending');
  assert.ok(game.nets.host.sent('sync').some(message => message.phase === 'vote'));
  assert.deepEqual(latest(game.hostUpdates).votes, [0, 1, 0], 'the guest vote is counted');

  game.clock.advance(game.timing.voteMs + game.timing.revealMs + 100);
  await flush();
  assert.equal(game.host.value, MAPS[1]);
  assert.equal(game.guest.value, MAPS[1]);
  cleanAfter(game);
});

test('a lost result and a lost ack are repaired by the reveal retries', async () => {
  const lostResult = ballotPair({ hostDrop: message => message.t === 'result' });
  latest(lostResult.guestUpdates).cast(0);
  latest(lostResult.hostUpdates).cast(0);
  lostResult.clock.advance(lostResult.timing.voteMs + lostResult.timing.revealMs + lostResult.timing.retryMs + 10);
  await flush();
  assert.equal(lostResult.host.state, 'resolved');
  assert.equal(lostResult.guest.state, 'resolved');
  assert.equal(lostResult.host.value, MAPS[0]);
  cleanAfter(lostResult);

  const lostAck = ballotPair({ guestDrop: message => message.t === 'ack' || message.t === 'ready' });
  latest(lostAck.guestUpdates).cast(2);
  latest(lostAck.hostUpdates).cast(2);
  lostAck.clock.advance(lostAck.timing.voteMs + lostAck.timing.revealMs + lostAck.timing.retryMs + 10);
  await flush();
  assert.equal(lostAck.host.state, 'resolved');
  assert.equal(lostAck.guest.state, 'resolved');
  assert.equal(lostAck.host.value, MAPS[2]);
  cleanAfter(lostAck);
});

test('the host waits for readiness, and a lost ready is bounded', async () => {
  const game = ballotPair({ guestDropAlways: message => message.t === 'ready' });
  latest(game.hostUpdates).cast(1);
  latest(game.guestUpdates).cast(1);
  game.clock.advance(game.timing.voteMs + game.timing.revealMs + game.timing.retryMs);
  await flush();
  assert.equal(latest(game.guestUpdates).winner, MAPS[1], 'the reveal is already showing');
  assert.equal(game.host.state, 'pending', 'no ready yet: the host has not committed');
  assert.equal(game.guest.state, 'pending');
  assert.ok(game.nets.host.sent('result').length > 0);
  game.clock.advance(game.timing.hardMs + 5000);
  await flush();
  assert.equal(game.host.state, 'rejected', 'no paired staging without guest readiness');
  assert.equal(game.guest.state, 'rejected');
  assert.equal(game.clock.size, 0);
});

test('a guest cancel fails both sides fast and leaves nothing running', async () => {
  const game = ballotPair();
  latest(game.guestUpdates).cast(1);
  assert.equal(game.clock.size > 0, true);

  game.guestSignal.abort();
  await flush();
  assert.equal(game.guest.state, 'rejected');
  assert.equal(game.guest.error.code, MAP_BALLOT_ERRORS.cancelled);
  assert.equal(game.host.state, 'rejected');
  assert.equal(game.host.error.code, MAP_BALLOT_ERRORS.peerAbort);
  assert.match(game.host.error.message, /cancelled/i);
  assert.equal(game.clock.size, 0, 'every timer is gone');
  assert.equal(game.nets.host.bound, 0, 'every handler is gone');
  assert.equal(game.nets.guest.bound, 0);

  const settledUpdates = game.hostUpdates.length;
  game.nets.host.emit('message', 7, { k: 'playlist-ballot', v: 1, t: 'vote', index: 1 });
  await flush();
  assert.equal(game.hostUpdates.length, settledUpdates, 'a settled ballot ignores late votes');
});

test('a host cancel fails the guest fast instead of at the watchdog', async () => {
  const game = ballotPair();
  game.hostSignal.abort();
  await flush();
  assert.equal(game.host.state, 'rejected');
  assert.equal(game.host.error.code, MAP_BALLOT_ERRORS.cancelled);
  assert.equal(game.guest.state, 'rejected');
  assert.equal(game.guest.error.code, MAP_BALLOT_ERRORS.peerAbort);
  assert.match(game.guest.error.message, /cancelled/i);
  assert.equal(game.clock.size, 0);
  assert.equal(game.nets.host.bound, 0);
  assert.equal(game.nets.guest.bound, 0);
});

test('an already aborted signal leaves no handlers behind', async () => {
  const { host } = pair();
  const controller = new AbortController();
  controller.abort();
  const promise = runMapBallot({
    net: host,
    peer: 7,
    slate: MAPS,
    signal: controller.signal,
    name: 'Vanguard',
    onUpdate: () => {}
  });
  await assert.rejects(promise, error => error.name === 'AbortError' || error.code === MAP_BALLOT_ERRORS.cancelled);
  assert.equal(host.bound, 0);
});

test('losing the peer fails clearly on both link and room events', async () => {
  const left = ballotPair();
  left.nets.host.emit('leave', 7);
  left.nets.guest.emit('closed', 'host left');
  await flush();
  assert.equal(left.host.state, 'rejected');
  assert.equal(left.host.error.code, MAP_BALLOT_ERRORS.peerLeft);
  assert.match(left.host.error.message, /left the map vote/);
  assert.equal(left.guest.state, 'rejected');
  assert.equal(left.guest.error.code, MAP_BALLOT_ERRORS.roomClosed);
  assert.match(left.guest.error.message, /matchmaking room/);
  assert.equal(left.clock.size, 0);
  assert.equal(left.nets.host.bound, 0);
  assert.equal(left.nets.guest.bound, 0);
});

test('a silent guest times the host out and the host cleans up', async () => {
  const { host } = pair();
  const clock = new VirtualClock();
  const updates = [];
  const run = track(
    runMapBallot({
      net: host,
      peer: 7,
      slate: MAPS,
      signal: new AbortController().signal,
      name: 'Vanguard',
      onUpdate: update => updates.push(update),
      timing: FAST,
      timers: { now: () => clock.now(), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }
    })
  );
  clock.advance(FAST.joinGraceMs + 1);
  await flush();
  assert.ok(
    host.sent('sync').every(message => message.phase === 'waiting'),
    'a silent peer never starts the timer'
  );
  clock.advance(FAST.hardMs);
  await flush();
  assert.equal(run.state, 'rejected');
  assert.equal(run.error.code, MAP_BALLOT_ERRORS.timeout);
  assert.equal(clock.size, 0);
  assert.equal(host.bound, 0);
  assert.ok(host.sent('abort').length === 1, 'the peer is told, not left hanging');
  assert.equal(latest(updates).winner, null, 'no result before both commanders are present');
});

test('a guest alone times out with a clear message', async () => {
  const { guest } = pair();
  const clock = new VirtualClock();
  const timers = { now: () => clock.now(), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  const run = track(
    runMapBallot({
      net: guest,
      peer: 0,
      slate: MAPS,
      signal: new AbortController().signal,
      name: 'Nomad',
      onUpdate: () => {},
      timing: FAST,
      timers
    })
  );
  clock.advance(FAST.hardMs);
  await flush();
  assert.equal(run.state, 'rejected');
  assert.equal(run.error.code, MAP_BALLOT_ERRORS.timeout);
  assert.equal(clock.size, 0);
  assert.equal(guest.bound, 0);
});

test('a mismatched slate fails both sides immediately', async () => {
  const game = ballotPair({ guestSlate: [MAPS[0], MAPS[2]] });
  await flush();
  assert.equal(game.host.state, 'rejected');
  assert.equal(game.host.error.code, MAP_BALLOT_ERRORS.slateMismatch);
  assert.match(game.host.error.message, /different map choices/);
  assert.equal(game.guest.state, 'rejected');
  assert.equal(game.guest.error.code, MAP_BALLOT_ERRORS.peerAbort);
  assert.equal(game.clock.size, 0);
  assert.equal(game.nets.host.bound, 0);
});

test('a foreign protocol version fails instead of stalling', async () => {
  const { host } = pair();
  const clock = new VirtualClock();
  const timers = { now: () => clock.now(), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  const run = track(
    runMapBallot({
      net: host,
      peer: 7,
      slate: MAPS,
      signal: new AbortController().signal,
      name: 'Vanguard',
      onUpdate: () => {},
      timing: FAST,
      timers
    })
  );
  host.emit('message', 7, { k: 'playlist-ballot', v: 2, t: 'join', slateId: slateFingerprint(MAPS), name: 'Nomad' });
  await flush();
  assert.equal(run.state, 'rejected');
  assert.equal(run.error.code, MAP_BALLOT_ERRORS.protocol);
  assert.equal(clock.size, 0);
  assert.equal(host.bound, 0);
});

test('a guest that starts first is picked up by the host that starts later', async () => {
  const game = ballotPair({ order: ['guest'] });
  latest(game.guestUpdates).cast(2);
  // No host yet: the guest's join is lost, then retried.
  game.clock.advance(game.timing.retryMs);
  await flush();
  assert.equal(game.guest.state, 'pending');
  assert.equal(game.nets.guest.sent('join').length >= 2, true);
  // The host binds its handlers only now.
  const hostRun = track(
    runMapBallot({
      net: game.nets.host,
      peer: game.nets.hostPeer,
      slate: MAPS,
      signal: game.hostSignal.signal,
      name: 'Vanguard',
      onUpdate: update => game.hostUpdates.push(update),
      timing: game.timing,
      timers: { now: () => game.clock.now(), setTimeout: game.clock.setTimeout, clearTimeout: game.clock.clearTimeout }
    })
  );
  assert.equal(game.guestUpdates.length > 0, true);
  await flush();
  assert.equal(hostRun.state, 'pending');
  assert.deepEqual(latest(game.hostUpdates).votes, [0, 0, 1], 'the resent vote is counted');
  game.clock.advance(game.timing.voteMs + game.timing.revealMs + 100);
  await flush();
  assert.equal(hostRun.state, 'resolved');
  assert.equal(game.guest.state, 'resolved');
  assert.equal(hostRun.value, MAPS[2]);
  assert.equal(game.guest.value, MAPS[2]);
  assert.equal(game.clock.size, 0);
});

test('the countdown is local, so an hours-off guest clock changes nothing', async () => {
  const game = ballotPair({ offset: 7 * 60 * 60 * 1000 });
  assert.equal(latest(game.guestUpdates).remaining, 3, 'the guest starts from the full window');
  latest(game.guestUpdates).cast(0);
  latest(game.hostUpdates).cast(2);
  await flush();
  assert.deepEqual(latest(game.guestUpdates).votes, [1, 0, 1]);
  game.clock.advance(game.timing.voteMs);
  await flush();
  assert.equal(latest(game.guestUpdates).remaining, 0);
  assert.equal(latest(game.hostUpdates).remaining, 0);
  game.clock.advance(game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.value, MAPS[0], 'the 1-1 tie still goes to the first map');
  assert.equal(game.guest.value, MAPS[0]);
  cleanAfter(game);
});

test('a throwing renderer cannot break the ballot', async () => {
  const game = ballotPair({ throwOnUpdate: true });
  game.clock.advance(game.timing.voteMs + game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.state, 'resolved');
  assert.equal(game.guest.state, 'resolved');
  assert.equal(game.host.value, MAPS[0]);
  cleanAfter(game);
});

test('the countdown is whole seconds and follows the host', async () => {
  const game = ballotPair();
  assert.equal(latest(game.hostUpdates).remaining, 3);
  game.clock.advance(1000);
  await flush();
  assert.equal(latest(game.hostUpdates).remaining, 2);
  assert.equal(latest(game.guestUpdates).remaining, 2);
  game.clock.advance(1000);
  await flush();
  assert.equal(latest(game.hostUpdates).remaining, 1);
  assert.equal(latest(game.guestUpdates).remaining, 1);
  game.clock.advance(1000);
  await flush();
  assert.equal(latest(game.hostUpdates).remaining, 0);
  assert.equal(latest(game.guestUpdates).remaining, 0);
  assert.equal(latest(game.hostUpdates).winner, MAPS[0]);
  game.clock.advance(game.timing.revealMs + 10);
  await flush();
  assert.equal(game.host.value, MAPS[0]);
  cleanAfter(game);
});

test('the winner is revealed through onUpdate before the promise settles', async () => {
  const game = ballotPair();
  latest(game.guestUpdates).cast(1);
  latest(game.hostUpdates).cast(1);
  game.clock.advance(game.timing.voteMs);
  await flush();
  const seen = game.guestUpdates.map(update => update.winner);
  assert.equal(seen.includes(null), true);
  assert.equal(seen.at(-1), MAPS[1]);
  assert.equal(game.guest.state, 'pending');
  assert.equal(latest(game.guestUpdates).remaining, 0);
});

test('every message uses the ballot kind and protocol version', async () => {
  const game = ballotPair();
  latest(game.guestUpdates).cast(0);
  game.clock.advance(game.timing.voteMs + game.timing.revealMs + 10);
  await flush();
  for (const net of [game.nets.host, game.nets.guest]) {
    assert.equal(net.log.length > 0, true);
    for (const message of net.log) {
      assert.equal(message.k, 'playlist-ballot');
      assert.equal(message.v, MAP_BALLOT_PROTOCOL);
    }
  }
  assert.equal(game.host.state, 'resolved');
  cleanAfter(game);
});

test('a caller abort keeps its reason as the cause and tells the peer', async () => {
  const game = ballotPair();
  game.hostSignal.abort(new Error('You left the playlist'));
  await flush();
  assert.equal(game.host.state, 'rejected');
  assert.equal(game.host.error.code, MAP_BALLOT_ERRORS.cancelled);
  assert.match(game.host.error.message, /cancelled/);
  assert.equal(game.host.error.cause?.message, 'You left the playlist');
  assert.equal(game.guest.state, 'rejected');
  assert.equal(game.guest.error.code, MAP_BALLOT_ERRORS.peerAbort);
  cleanAfter(game);
});
