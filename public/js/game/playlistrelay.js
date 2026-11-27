import { NetSession, listGames, newGameId } from '../net.js';

// These are rendezvous tickets, not public games. Legacy Internet browsers already hide `started` listings.
// The relay bounds `mode` to 16 chars and `mod` to 64. Never advertise mod names, paths or player names.
const protocol = 'eaw-ballot-4';
const laneMode = ladder => ladder === 'ranked' ? 'eaw-ranked-4' : 'eaw-social-4';
const pollMs = 2500,
  leaseMs = 20000,
  searchMs = 90000;

export async function playlistKey({ type, variant, ladder = 'social', version, data, content, pack, maps, factions }) {
  const mods = content.mods.map(m => [
    m.workshop ? 'id:' + m.workshop : 'name:' + m.name.toLowerCase(),
    m.version || '',
    m.files ?? null,
    m.packRevision || ''
  ]);
  const bytes = new TextEncoder().encode(
    JSON.stringify([protocol, ladder, type, variant, version, data, content.edition, mods, pack, maps, factions])
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// Prefer the nearest reported device rating among currently dialable compatible tickets, not a global skill service.
export function rankedDistance(ladder, rating, reported) {
  if (ladder !== 'ranked') return 0;
  return /^\d{3,4}$/.test(reported) && +reported>=100 && +reported<=3000 ? Math.abs(+reported-rating) : 10000;
}

// One owner per live ticket. If two clients advertise simultaneously, only the higher room ID dials the lower one.
// A guest can't reach staging on a stale listing: it must receive the host's explicit acceptance over the actual game link.
export function searchRelay({ variant, ladder = 'social', rating, relay, version, key, name, signal, status, telemetry }) {
  return new Promise((resolve, reject) => {
    let net,
      pollTimer,
      linkTimer,
      deadline,
      renewed = 0,
      missingSince = 0,
      done = false;
    const skipped = new Set(), owned = new Set(),
      stop = new AbortController();
    const unbind = [];
    const release = keep => {
      clearTimeout(linkTimer);
      unbind.splice(0).forEach(fn => fn());
      if (net && !keep) net.close();
      net = null;
    };
    const finish = (err, peer) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(pollTimer);
      stop.abort();
      signal.removeEventListener('abort', cancel);
      const matched = net;
      release(!err);
      if (err) reject(err);
      else resolve({ net: matched, peer });
    };
    const cancel = () => finish(signal.reason || new DOMException('Cancelled', 'AbortError'));
    const failService = () => finish(Error('Matchmaking relay unavailable. Check your connection or relay address, then retry.'));
    const next = () => {
      if (!done) pollTimer = setTimeout(poll, pollMs);
    };
    const reconnect = () => {
      skipped.add(net.gameId);
      release(false);
      status('That rendezvous closed. Searching for another commander…');
      next();
    };
    async function connect(id, host) {
      release(false);
      const room = (net = new NetSession());
      if (host) owned.add(id);
      linkTimer = setTimeout(failService, 12000);
      try {
        await room.connect(id, { host, name, relay });
      } catch {
        if (done) return;
        return host ? failService() : reconnect();
      }
      if (done) return;
      clearTimeout(linkTimer);
      unbind.push(room.on('away', failService), room.on('closed', host ? failService : reconnect));
      if (host) {
        unbind.push(
          room.on('message', (peer, m) => {
            if (m?.k !== 'playlist-request') return;
            if (m.key !== key) {
              room.send(peer, { k: 'playlist-declined' });
              return;
            }
            room.setListing(null);
            room.send(peer, { k: 'playlist-paired', key });
            finish(null, peer);
          })
        );
        advertise();
        missingSince = 0;
        status('Registering your flight with the relay…');
        next();
      } else {
        unbind.push(
          room.on('message', (peer, m) => {
            if (peer !== 0) return;
            if (m?.k === 'playlist-paired' && m.key === key) finish(null, 0);
            else if (m?.k === 'playlist-declined') reconnect();
          })
        );
        linkTimer = setTimeout(reconnect, 30000);
        status('Compatible ticket found. Confirming the staging room…');
        room.send(0, { k: 'playlist-request', key });
      }
    }
    function advertise() {
      net.setListing({
        name: 'Fleet rendezvous',
        host: ladder === 'ranked' ? String(rating) : '', // Advertise only a device rating, never a player's callsign.
        mode: laneMode(ladder),
        map: variant, // Existing relay metadata field; not a playable map until paired.
        mod: key,
        version,
        players: 1,
        slots: 2,
        locked: true,
        started: true
      });
      renewed = Date.now();
    }
    async function poll() {
      try {
        const rows = await listGames(AbortSignal.any([stop.signal, AbortSignal.timeout(10000)]), relay);
        if (done) return;
        const lane = rows.filter(g => g.mode === laneMode(ladder) && g.map === variant && g.started && g.locked && /^[a-z2-9]{9}$/.test(g.id) && !owned.has(g.id));
        telemetry?.({ tickets: lane.length, compatible: lane.filter(g => g.mod === key && g.version === version && !skipped.has(g.id)).length });
        const target = lane
          .filter(
            g =>
              g.mod === key &&
              g.version === version &&
              !skipped.has(g.id) &&
              (!net || g.id < net.gameId)
          )
          .sort((a,b) => rankedDistance(ladder,rating,a.host)-rankedDistance(ladder,rating,b.host) || a.id.localeCompare(b.id))[0];
        if (target) return await connect(target.id, false);
        if (!net) return await connect(newGameId(), true);
        if (rows.some(g => g.id === net.gameId && g.mod === key)) {
          missingSince = 0;
          status('No compatible commander yet. Your flight is open.');
        } else {
          missingSince ||= Date.now();
          if (Date.now() - missingSince > 10000)
            return finish(Error('The relay did not register this search. Retry or open a custom game.'));
        }
        if (Date.now() - renewed > leaseMs) advertise();
        next();
      } catch {
        if (!done) failService();
      }
    }
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) return cancel();
    deadline = setTimeout(() => finish(Error('No compatible commander found. Try another playlist or search again.')), searchMs);
    poll();
  });
}
