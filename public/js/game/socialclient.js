import { deviceKey, relayBase } from '../socialidentity.js';
import { lobbyUrl } from '../net.js';
import { loadContent } from '../content.js';
import { BUILD } from '../build.js';

export const socialRelay = () => relayBase(lobbyUrl());
export function setRelay(value) {
  const base = value.trim() ? relayBase(value.trim()) : '';
  const u = new URL(location.href);
  u.searchParams.delete('lobby');
  if (base) localStorage.setItem('swr.lobby', base);
  else localStorage.removeItem('swr.lobby');
  history.replaceState(null, '', u);
}
async function key(relay, create) {
  const origin = document.querySelector('meta[name="swr-universal"]')?.content;
  if (!origin || window === parent) return deviceKey(relay, create);
  return new Promise((resolve, reject) => {
    const request = crypto.randomUUID();
    const finish = (token, error) => {
      clearTimeout(timer);
      removeEventListener('message', on);
      error ? reject(Error(error)) : resolve(token);
    };
    const on = e => {
      if (e.source === parent && e.origin === origin && e.data?.kind === 'universal-social-result' && e.data.request === request)
        finish(e.data.token, e.data.error);
    };
    const timer = setTimeout(() => finish(null, 'Universal device storage unavailable.'), 3000);
    addEventListener('message', on);
    parent.postMessage({ kind: 'universal-social-device', request, relay, create }, origin);
  });
}
export async function social(op, args = {}, signal) {
  const relay = socialRelay(),
    token = await key(relay, op === 'enable');
  if (!token) return null;
  let r;
  try {
    r = await fetch(relay + '/social/v1', {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, op }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000)
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw Error('Relay unreachable. Check your relay, then retry.');
  }
  if (r.status === 401 && op === 'state') return null;
  let data;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok || !data)
    throw Error(r.status === 404 ? 'This relay does not provide social features.' : data?.error || 'Social relay unavailable.');
  return data;
}
let identity;
export function contentStamp() {
  return (identity ??= (async () => {
    const content = await loadContent(),
      pack = document.querySelector('meta[name="swr-pack-revision"]')?.content || '',
      { dataFingerprint } = await import('./multiplayer.js');
    let build = BUILD,
      layers = content.mods;
    if (build === 'dev') {
      const r = await fetch((globalThis.SWR_BASE || '') + 'api/playlist-manifest', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000)
      });
      const manifest = r.ok && (await r.json());
      if (!/^[a-f0-9]{64}$/.test(manifest?.build) || !Array.isArray(manifest?.mods))
        throw Error('Cannot verify this development build. Use the local game server or a stamped release.');
      build = manifest.build;
      layers = [...manifest.mods, ...content.mods.filter(m => m.source === 'added')];
    }
    const mods = layers.map(m => [m.workshop || m.name, m.version || '', m.files || 0, m.packRevision || '']);
    const data = JSON.stringify([build, content.edition, mods, pack, dataFingerprint()]);
    return {
      profile: pack.split(':')[0] || (mods.length ? 'local' : 'stock'),
      stamp: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))), b =>
        b.toString(16).padStart(2, '0')
      ).join('')
    };
  })().catch(e => {
    identity = null;
    throw e;
  }));
}
export function joinUrl(room, kind) {
  if (!/^[a-z2-9]{9}$/.test(room) || !['internet', 'lan'].includes(kind)) throw Error('Invalid invitation.');
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('multiplayer', kind);
  u.searchParams.set('join', room);
  const base = socialRelay();
  if (new URLSearchParams(location.search).has('lobby') || localStorage.getItem('swr.lobby')) u.searchParams.set('lobby', base);
  return u.href;
}
