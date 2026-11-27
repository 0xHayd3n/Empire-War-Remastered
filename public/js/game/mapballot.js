/**
 * Pre-staging map ballot for a matched playlist pair.
 *
 * The parent resolves both clients on one `playlist-paired` packet, then calls
 * exactly:
 *
 *   const map = await runMapBallot({ net, peer, slate, signal, name, onUpdate });
 *
 * `net` is the paired NetSession (`net.host` says which side hosts), `peer` is
 * the other client's link id (0 on the guest side), `slate` is the same array of
 * one to three eligible map filenames on both sides, `name` is the local
 * callsign, `signal` is an AbortSignal owned by the caller, and `onUpdate` is a
 * render callback. The promise resolves with the winning map filename, ready for
 * native staging, or rejects with `err.code` from MAP_BALLOT_ERRORS.
 *
 * This module never opens staging, never awards a rating, never touches storage
 * or the relay metadata, and needs no web APIs beyond timers (plus the caller's
 * AbortSignal). It runs identically under node with injected timers.
 *
 * Both clients call it after pairing and before opening native staging; each
 * promise resolves with the same `slate` filename. `cast` throws for an index
 * outside the slate or for a ballot that is already over, so a UI must catch it.
 *
 * Protocol (kind `playlist-ballot`, version 1)
 * --------------------------------------------
 * Both sides announce themselves, then the host owns the clock and the tally:
 *
 *   guest -> host  join  {slateId, name}     in the ballot; repeats until synced
 *   host  -> guest sync  {phase, votes, hostVote, guestVote, remaining, name}
 *   guest -> host  vote  {index|null}        last write wins before the deadline
 *   host  -> guest result{winner, map}       vote closed, reveal is running
 *   guest -> host  ack   {winner}            agrees with the result
 *   guest -> host  ready {winner}            its own reveal has elapsed
 *   host  -> guest commit{winner, map}       both agreed: open staging
 *   guest -> host  done  {winner}            best effort, ends the handshake
 *   either          abort {code, message}    fast, explicit failure for the peer
 *
 * Losing a message is harmless: join/vote/sync are retried or re-answered while
 * the vote runs, result is retried through the reveal until the guest acks and
 * reports ready. The host repeats commit until the guest confirms. Missing
 * agreement times out instead of letting a lone client enter staging.
 *
 * Time
 * ----
 * Only the host decides the deadline (`remaining` in ms is sent
 * as a duration, never as a timestamp), so a guest whose clock is hours off still
 * counts down correctly. The vote opens when the host learns the guest is in the
 * ballot (`join`, or a vote). A silent peer never starts the clock; the handshake
 * retries, then times out. Ties and empty ballots go to the lowest index,
 * i.e. the first map in the slate.
 */

const KIND = 'playlist-ballot';
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Wire protocol version; a mismatch fails clearly instead of stalling. */
export const MAP_BALLOT_PROTOCOL = 1;

/** Production durations. `cast` is accepted until the vote deadline ends.
 * The watchdog includes an allowance for the join and result exchanges. */
export const MAP_BALLOT_TIMING = Object.freeze({
  voteMs: 15000,
  revealMs: 1500,
  joinGraceMs: 2500,
  retryMs: 700,
  tickMs: 250,
  commitWaitMs: 1200
});

/** Ballot shape bounds. `name` matches the staging room's 24 character cap. */
export const MAP_BALLOT_LIMITS = Object.freeze({ maps: 3, map: 260, name: 24, reason: 200 });

/**
 * Rejection codes. `closed` and `choice` come from `cast`; everything else
 * arrives on the rejected promise. `invalid` is thrown before any wiring.
 */
export const MAP_BALLOT_ERRORS = Object.freeze({
  invalid: 'ballot-invalid',
  cancelled: 'ballot-cancelled',
  timeout: 'ballot-timeout',
  peerLeft: 'ballot-peer-left',
  roomClosed: 'ballot-room-closed',
  peerAbort: 'ballot-peer-abort',
  protocol: 'ballot-protocol',
  slateMismatch: 'ballot-slate-mismatch',
  closed: 'ballot-closed',
  choice: 'ballot-choice'
});

const realTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id)
};

function ballotError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  err.ballot = true;
  if (cause !== undefined) err.cause = cause;
  return err;
}

function invalid(message) {
  return ballotError(MAP_BALLOT_ERRORS.invalid, message);
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(CONTROL, '').trim().slice(0, MAP_BALLOT_LIMITS.name);
  return text || null;
}

function cleanReason(value, fallback) {
  const text = typeof value === 'string' ? value.replace(CONTROL, '').trim().slice(0, MAP_BALLOT_LIMITS.reason) : '';
  return text || fallback;
}

function isIndex(value, size) {
  return Number.isInteger(value) && value >= 0 && value < size;
}

function samePeer(a, b) {
  return a === b || (typeof a !== 'object' && typeof b !== 'object' && String(a) === String(b));
}

/** FNV-1a over the ordered filenames; both sides must agree on the slate. */
export function slateFingerprint(maps) {
  const text = String(MAP_BALLOT_PROTOCOL) + '\u001f' + (Array.isArray(maps) ? maps : []).join('\u001f');
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Deterministic winner: highest count, ties and an empty ballot go to the first
 * map. Kept pure so the tie rule can be checked without a session.
 */
export function winningIndex(votes) {
  if (!Array.isArray(votes) || !votes.length) return 0;
  let best = 0;
  for (let i = 1; i < votes.length; i++) {
    if (Number(votes[i]) > Number(votes[best])) best = i;
  }
  return best;
}

function normalizeTiming(overrides) {
  if (overrides != null && typeof overrides !== 'object') throw invalid('Map vote timing must be an object.');
  const given = overrides || {};
  const duration = (key, fallback, floor = 0) => {
    const value = given[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < floor) {
      throw invalid(`Map vote timing "${key}" must be a number of milliseconds.`);
    }
    return value;
  };
  const voteMs = duration('voteMs', MAP_BALLOT_TIMING.voteMs);
  const revealMs = duration('revealMs', MAP_BALLOT_TIMING.revealMs);
  const joinGraceMs = duration('joinGraceMs', MAP_BALLOT_TIMING.joinGraceMs);
  const retryMs = Math.max(1, duration('retryMs', MAP_BALLOT_TIMING.retryMs));
  const tickMs = Math.max(1, duration('tickMs', MAP_BALLOT_TIMING.tickMs));
  const commitWaitMs = duration('commitWaitMs', MAP_BALLOT_TIMING.commitWaitMs);
  const derived = joinGraceMs + voteMs + revealMs + commitWaitMs + 2000;
  const hardMs = Math.max(derived, duration('hardMs', derived));
  return { voteMs, revealMs, joinGraceMs, retryMs, tickMs, commitWaitMs, hardMs };
}

function normalizeTimers(timers) {
  if (timers == null) return realTimers;
  if (typeof timers !== 'object') throw invalid('Map vote timers must be an object.');
  const now = timers.now ?? realTimers.now;
  const set = timers.setTimeout ?? realTimers.setTimeout;
  const clear = timers.clearTimeout ?? realTimers.clearTimeout;
  if (typeof now !== 'function' || typeof set !== 'function' || typeof clear !== 'function') {
    throw invalid('Map vote timers need now(), setTimeout() and clearTimeout().');
  }
  return { now, setTimeout: set, clearTimeout: clear };
}

/** One wall of timeouts that can all be cancelled at once. */
function makeClock(timers) {
  const pending = new Set();
  const draw = fn => () => {
    try {
      fn();
    } catch {}
  };
  const api = {
    now: () => {
      const value = Number(timers.now());
      return Number.isFinite(value) ? value : 0;
    },
    after(ms, fn) {
      const id = timers.setTimeout(
        () => {
          pending.delete(id);
          draw(fn)();
        },
        Math.max(0, ms)
      );
      pending.add(id);
      return id;
    },
    cancel(id) {
      if (id == null) return;
      pending.delete(id);
      try {
        timers.clearTimeout(id);
      } catch {}
    },
    every(ms, fn) {
      let id = null,
        stopped = false;
      const step = () => {
        id = null;
        if (stopped) return;
        draw(fn)();
        if (!stopped) id = api.after(ms, step);
      };
      id = api.after(ms, step);
      return () => {
        stopped = true;
        api.cancel(id);
      };
    },
    clearAll() {
      for (const id of [...pending]) api.cancel(id);
    }
  };
  return api;
}

/**
 * Run the ballot. Throws synchronously on bad arguments; otherwise the returned
 * promise settles once, and all timers and session handlers are gone before it
 * does. Resolves with one of the `slate` filenames.
 *
 * `timing` and `timers` are test hooks. Production callers pass neither.
 */
export function runMapBallot(options) {
  const args = options && typeof options === 'object' ? options : {};
  const { net, peer, slate, signal, name, onUpdate } = args;

  if (!Array.isArray(slate) || slate.length < 1 || slate.length > MAP_BALLOT_LIMITS.maps) {
    throw invalid('A map ballot needs one to three maps.');
  }
  const maps = [];
  for (const entry of slate) {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > MAP_BALLOT_LIMITS.map || /[\u0000-\u001f\u007f]/.test(entry)) {
      throw invalid('Every map on the ballot must be a filename.');
    }
    if (maps.includes(entry)) throw invalid('The map ballot lists the same map twice.');
    maps.push(entry);
  }
  if (!net || typeof net.send !== 'function' || typeof net.on !== 'function') {
    throw invalid('The map ballot needs a paired network session.');
  }
  if (!isIndex(peer, Number.MAX_SAFE_INTEGER) && !(typeof peer === 'string' && peer.length)) {
    throw invalid('The map ballot needs the paired peer.');
  }
  if (signal != null && typeof signal.addEventListener !== 'function') {
    throw invalid('The map ballot needs an AbortSignal, not a signal-like object.');
  }
  if (onUpdate != null && typeof onUpdate !== 'function') throw invalid('onUpdate must be a function.');
  const timing = normalizeTiming(args.timing);
  const timers = normalizeTimers(args.timers);

  const freezeMaps = Object.freeze(maps.slice());
  const slateId = slateFingerprint(freezeMaps);
  const me = cleanName(name);
  const host = !!net.host;

  return new Promise((resolve, reject) => {
    const clock = makeClock(timers);
    const offs = [];
    let settled = false;
    let notified = false;
    let phase = 'waiting';
    let opponent = null;
    let localDeadline = null;
    let winnerIdx = null;

    // Host-authoritative per-side choice; the tally is always derived from these.
    let hostVote = null;
    let guestVote = null;
    // Guest's own intent; the host's echo repairs a lost vote.
    let myVote = null;

    let peerAck = false;
    let peerReady = false;
    let revealDone = false;
    let commitSent = false;
    let guestReady = false;

    let stopTick = null;
    let stopResult = null;
    let stopJoin = null;
    let stopVote = null;
    // Guest: last choice the host reported having counted.
    let echoedVote = null;
    let graceTimer = null;
    let deadlineTimer = null;
    let revealTimer = null;
    let stopCommit = null;
    let watchdog = null;
    let lastKey = '';
    let lastSyncSecond = null;

    const tally = () => freezeMaps.map((_, i) => (hostVote === i ? 1 : 0) + (guestVote === i ? 1 : 0));
    const remainingMs = () => (localDeadline == null ? timing.voteMs : Math.max(0, localDeadline - clock.now()));
    const remainingSec = () => Math.max(0, Math.ceil(remainingMs() / 1000));

    const send = message => {
      if (settled) return;
      try {
        net.send(peer, { k: KIND, v: MAP_BALLOT_PROTOCOL, ...message });
      } catch {
        // A dead link is reported by the session events or the watchdog.
      }
    };

    const listen = (event, fn) => {
      try {
        const off = net.on(event, fn);
        if (typeof off === 'function') offs.push(off);
        else if (typeof net.off === 'function') offs.push(() => net.off(event, fn));
      } catch {}
    };

    const cleanup = () => {
      stopTick?.();
      stopResult?.();
      stopJoin?.();
      stopVote?.();
      stopCommit?.();
      stopTick = stopResult = stopJoin = stopVote = stopCommit = null;
      clock.clearAll();
      graceTimer = deadlineTimer = revealTimer = watchdog = null;
      for (const off of offs.splice(0)) {
        try {
          off();
        } catch {}
      }
      if (signal) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch {}
      }
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    /** Local failure; tells the peer first so it never waits for the watchdog. */
    const fail = (error, notifyPeer = true) => {
      if (settled) return;
      if (notifyPeer && !notified) {
        notified = true;
        send({ t: 'abort', code: error.code || MAP_BALLOT_ERRORS.peerAbort, message: error.message });
      }
      finish(error);
    };

    const abortLocal = (code, message) => fail(ballotError(code, message));

    const failFromPeer = message => {
      const error = ballotError(
        MAP_BALLOT_ERRORS.peerAbort,
        cleanReason(message?.message, 'Your opponent closed the map vote.'),
        message?.code
      );
      error.peerCode = typeof message?.code === 'string' ? message.code : null;
      fail(error, false);
    };

    const onAbort = () => {
      const reason = signal?.reason;
      const error = ballotError(MAP_BALLOT_ERRORS.cancelled, 'The map vote was cancelled.', reason instanceof Error ? reason : undefined);
      if (reason instanceof Error && typeof reason.code === 'string') error.code = reason.code;
      fail(error);
    };

    // Mirrored counts on the guest side; the host recomputes its own.
    let guestCounts = freezeMaps.map(() => 0);

    const view = () => {
      const votes = host ? tally() : freezeMaps.map((_, i) => guestCounts[i] || 0);
      const mine = host ? hostVote : myVote;
      return {
        slate: freezeMaps,
        votes: Object.freeze(votes),
        mine,
        remaining: remainingSec(),
        opponent,
        winner: winnerIdx == null ? null : freezeMaps[winnerIdx],
        cast
      };
    };

    const emit = () => {
      const payload = view();
      const key = [phase, payload.votes.join(','), payload.mine, payload.remaining, payload.opponent, payload.winner].join('|');
      if (key === lastKey) return;
      lastKey = key;
      try {
        onUpdate?.(payload);
      } catch {
        // A broken renderer must never stop or deadlock the ballot.
      }
    };

    const stopTicking = () => {
      stopTick?.();
      stopTick = null;
    };

    const startTicking = () => {
      if (stopTick) return;
      stopTick = clock.every(timing.tickMs, () => {
        if (settled || winnerIdx != null) return;
        if (host && localDeadline != null) {
          const second = remainingSec();
          if (second !== lastSyncSecond) {
            lastSyncSecond = second;
            sendSync();
          }
        }
        emit();
      });
    };

    const cast = index => {
      if (settled) throw ballotError(MAP_BALLOT_ERRORS.closed, 'The map vote is already over.');
      if (host && localDeadline != null && remainingMs() === 0 && winnerIdx == null) finalize();
      if (winnerIdx != null) throw ballotError(MAP_BALLOT_ERRORS.closed, 'The map vote has closed.');
      let choice = null;
      if (index !== null && index !== -1 && index !== undefined) {
        if (!isIndex(index, freezeMaps.length)) throw ballotError(MAP_BALLOT_ERRORS.choice, 'Choose one of the maps on the ballot.');
        choice = index;
      }
      if (host) {
        if (hostVote === choice) return;
        hostVote = choice;
        sendSync();
        emit();
        return;
      }
      if (myVote === choice) return;
      myVote = choice;
      sendVote();
      emit();
      retryVote();
    };

    const sendVote = () => send({ t: 'vote', index: myVote, ...(me ? { name: me } : {}) });

    /** Keep offering the guest's choice until the host echoes it, so one lost vote self-heals. */
    const retryVote = () => {
      if (host || stopVote || winnerIdx != null || settled || myVote === echoedVote) return;
      stopVote = clock.every(timing.retryMs, () => {
        if (settled || winnerIdx != null || myVote === echoedVote) {
          stopVote?.();
          stopVote = null;
          return;
        }
        sendVote();
      });
    };

    const sendSync = () => {
      if (settled || winnerIdx != null) return;
      send({
        t: 'sync',
        slateId,
        phase: localDeadline == null ? 'waiting' : 'vote',
        votes: tally(),
        hostVote,
        guestVote,
        remaining: remainingMs(),
        ...(me ? { name: me } : {})
      });
    };

    const sendResult = () => {
      if (settled || winnerIdx == null) return;
      send({ t: 'result', winner: winnerIdx, map: freezeMaps[winnerIdx], votes: tally() });
    };

    const resolveLocal = () => {
      if (settled || winnerIdx == null) return;
      emit();
      finish(null, freezeMaps[winnerIdx]);
    };

    /* ------------------------------ host ------------------------------ */

    const startVote = () => {
      if (!host || settled || localDeadline != null || winnerIdx != null) return;
      if (graceTimer != null) {
        clock.cancel(graceTimer);
        graceTimer = null;
      }
      localDeadline = clock.now() + timing.voteMs;
      phase = 'vote';
      deadlineTimer = clock.after(timing.voteMs, finalize);
      startTicking();
    };

    const maybeCommit = () => {
      if (!host || settled || winnerIdx == null || commitSent) return;
      if (!revealDone || !peerAck || !peerReady) return;
      commitSent = true;
      phase = 'commit';
      stopResult?.();
      stopResult = null;
      stopTicking();
      const commit = () => send({ t: 'commit', winner: winnerIdx, map: freezeMaps[winnerIdx] });
      commit();
      if (!settled) stopCommit = clock.every(timing.retryMs, commit);
    };

    function finalize() {
      if (!host || settled || winnerIdx != null) return;
      stopTicking();
      if (deadlineTimer != null) {
        clock.cancel(deadlineTimer);
        deadlineTimer = null;
      }
      winnerIdx = winningIndex(tally());
      localDeadline = clock.now();
      phase = 'reveal';
      emit();
      sendResult();
      if (settled) return;
      stopResult = clock.every(timing.retryMs, () => {
        if (!settled && !(peerAck && peerReady)) sendResult();
      });
      revealTimer = clock.after(timing.revealMs, () => {
        revealDone = true;
        maybeCommit();
      });
    }

    const onHostMessage = m => {
      switch (m.t) {
        case 'join': {
          if (m.slateId !== slateId) {
            return abortLocal(MAP_BALLOT_ERRORS.slateMismatch, 'The matched commanders have different map choices.');
          }
          const remote = cleanName(m.name);
          if (remote) opponent = remote;
          if (winnerIdx != null) return sendResult();
          startVote();
          sendSync();
          return emit();
        }
        case 'vote': {
          if (winnerIdx == null && localDeadline != null && remainingMs() === 0) finalize();
          if (winnerIdx != null) return sendResult();
          const index = m.index;
          if (index !== null && !isIndex(index, freezeMaps.length)) return;
          const remote = cleanName(m.name);
          if (remote) opponent = remote;
          if (localDeadline == null) startVote();
          if (guestVote !== index) guestVote = index;
          sendSync();
          return emit();
        }
        case 'ack':
        case 'ready': {
          if (winnerIdx == null) return;
          if (!isIndex(m.winner, freezeMaps.length) || m.winner !== winnerIdx) return sendResult();
          if (m.t === 'ack') peerAck = true;
          else peerReady = true;
          maybeCommit();
          return;
        }
        case 'done': {
          if (winnerIdx == null || m.winner !== winnerIdx) return;
          peerAck = true;
          peerReady = true;
          if (commitSent) resolveLocal();
          return;
        }
        case 'abort':
          return failFromPeer(m);
        default:
          return;
      }
    };

    /* ------------------------------ guest ----------------------------- */

    let lastJoinAt = null;
    // Cheap throttle: a lost join is repeated at most once per retry window.
    const sendJoin = () => {
      if (settled || winnerIdx != null || localDeadline != null) return;
      const at = clock.now();
      if (lastJoinAt != null && at - lastJoinAt < timing.retryMs) return;
      lastJoinAt = at;
      send({ t: 'join', slateId, ...(me ? { name: me } : {}) });
    };

    const readCounts = value => {
      if (!Array.isArray(value) || value.length !== freezeMaps.length) return null;
      const out = [];
      for (const count of value) {
        if (!Number.isInteger(count) || count < 0 || count > 2) return null;
        out.push(count);
      }
      return out.reduce((a, b) => a + b, 0) <= 2 ? out : null;
    };

    const onGuestMessage = m => {
      switch (m.t) {
        case 'sync': {
          if (m.slateId !== slateId) {
            return abortLocal(MAP_BALLOT_ERRORS.slateMismatch, 'The matched commanders have different map choices.');
          }
          const counts = readCounts(m.votes);
          if (!counts) return;
          const remote = cleanName(m.name);
          if (remote) opponent = remote;
          if (winnerIdx != null) return emit();
          guestCounts = counts;
          const echoed = m.guestVote === undefined ? null : m.guestVote;
          if (echoed !== null && !isIndex(echoed, freezeMaps.length)) return;
          echoedVote = echoed;
          const matches = echoed === myVote;
          if (matches) {
            stopVote?.();
            stopVote = null;
          }
          if (m.phase === 'vote') {
            const remaining =
              typeof m.remaining === 'number' && Number.isFinite(m.remaining) ? Math.min(Math.max(m.remaining, 0), timing.voteMs) : 0;
            localDeadline = clock.now() + remaining;
            phase = 'vote';
            startTicking();
            stopJoin?.();
            stopJoin = null;
            emit();
          } else {
            emit();
            sendJoin();
          }
          if (settled || matches) return;
          // The host's echo repairs a lost vote; keep asking until it matches.
          sendVote();
          return retryVote();
        }
        case 'result': {
          const winner = m.winner;
          if (!isIndex(winner, freezeMaps.length) || m.map !== freezeMaps[winner]) {
            return abortLocal(MAP_BALLOT_ERRORS.protocol, 'The opponent proposed a map that is not on the ballot.');
          }
          if (winnerIdx != null && winnerIdx !== winner) {
            return abortLocal(MAP_BALLOT_ERRORS.protocol, 'The map vote result changed during the reveal.');
          }
          const finalCounts = readCounts(m.votes);
          if (!finalCounts || winningIndex(finalCounts) !== winner)
            return abortLocal(MAP_BALLOT_ERRORS.protocol, 'The final tally does not match the selected map.');
          if (winnerIdx == null) {
            guestCounts = finalCounts;
            winnerIdx = winner;
            localDeadline = clock.now();
            phase = 'reveal';
            stopTicking();
            stopJoin?.();
            stopJoin = null;
            emit();
            revealTimer = clock.after(timing.revealMs, () => {
              if (settled || winnerIdx == null) return;
              guestReady = true;
              send({ t: 'ready', winner: winnerIdx });
            });
          }
          send({ t: 'ack', winner });
          if (guestReady) send({ t: 'ready', winner });
          return;
        }
        case 'commit': {
          if (winnerIdx == null) return;
          if (m.winner !== winnerIdx) {
            return abortLocal(MAP_BALLOT_ERRORS.protocol, 'The opponent committed a different map.');
          }
          phase = 'commit';
          send({ t: 'done', winner: winnerIdx });
          return resolveLocal();
        }
        case 'abort':
          return failFromPeer(m);
        default:
          return;
      }
    };

    /* ------------------------------ wiring ---------------------------- */

    listen('message', (from, m) => {
      if (settled || !m || typeof m !== 'object' || m.k !== KIND) return;
      if (!samePeer(from, peer)) return;
      if (m.v !== MAP_BALLOT_PROTOCOL) {
        return abortLocal(MAP_BALLOT_ERRORS.protocol, 'The other commander is on a different map vote protocol.');
      }
      if (typeof m.t !== 'string') return;
      (host ? onHostMessage : onGuestMessage)(m);
    });

    listen('leave', who => {
      if (settled || !samePeer(who, peer)) return;
      fail(ballotError(MAP_BALLOT_ERRORS.peerLeft, 'Your opponent left the map vote.'), false);
    });

    listen('closed', () => {
      if (settled) return;
      fail(ballotError(MAP_BALLOT_ERRORS.roomClosed, 'The matchmaking room closed during the map vote.'), false);
    });

    if (signal) {
      if (signal.aborted) {
        finish(signal.reason instanceof Error ? signal.reason : ballotError(MAP_BALLOT_ERRORS.cancelled, 'The map vote was cancelled.'));
        return;
      }
      try {
        signal.addEventListener('abort', onAbort, { once: true });
      } catch {}
    }

    watchdog = clock.after(timing.hardMs, () =>
      fail(
        ballotError(MAP_BALLOT_ERRORS.timeout, host ? 'Your opponent did not answer the map vote.' : 'The map vote did not finish in time.')
      )
    );

    if (host) {
      // The ballot is open; the vote window starts once the guest is known to be here.
      graceTimer = clock.after(timing.joinGraceMs, sendSync);
      sendSync();
    } else {
      const join = () => sendJoin();
      join();
      if (!settled) stopJoin = clock.every(timing.retryMs, join);
    }

    emit();
  });
}
