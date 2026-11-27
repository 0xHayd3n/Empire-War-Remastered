// This bridge is installed only on the live NetSession at ranked launch. It is never accepted from a save or a peer's payload.
import { loadContent } from '../content.js';
let profile;
function contentId() {
  return (profile ??= (async () => {
    const c = await loadContent(),
      pack = document.querySelector('meta[name="swr-pack-revision"]')?.content || '';
    const data = JSON.stringify([
      c.edition,
      pack,
      c.mods.map(m => [m.workshop || m.name, m.version || '', m.files || 0, m.packRevision || ''])
    ]);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))), x =>
      x.toString(16).padStart(2, '0')
    ).join('');
  })().catch(e => {
    profile = null;
    throw e;
  }));
}
async function scope(relay, variant) {
  return { relay, profile: await contentId(), variant };
}
export async function lobbyRecord(relay, variant) {
  const { loadRankedRecord } = await import('./competitive.js');
  const r = loadRankedRecord(await scope(relay, variant));
  return r.ok && !r.damaged ? r.record : null;
}
export function rankedFinish({ relay, variant, room, players, me, peer, session }) {
  const mine = players.find(p => p.peer === me),
    other = players.find(p => p.peer === peer);
  if (
    players.length !== 2 ||
    !mine?.human ||
    !other?.human ||
    mine === other ||
    mine.team === other.team ||
    ![mine.team, other.team].every(t => t === 0 || t === 1)
  )
    return;
  let closed = false;
  return winner => {
    if (closed || session.closing || !session.links.has(peer) || ![mine.team, other.team].includes(winner)) return;
    closed = true;
    const outcome = winner === mine.team ? 'win' : 'loss';
    return Promise.all([import('./competitive.js'), scope(relay, variant)])
      .then(([{ commitRankedOutcome }, s]) => commitRankedOutcome(s, { matchId: room, result: outcome }))
      .catch(() => {});
  };
}
