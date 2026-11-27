// Stored by the Universal shell (or by the standalone game). Never put device keys in join links.
export function relayBase(value) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
  )
    throw Error('Social requires an HTTPS relay or localhost.');
  return u.href.replace(/\/$/, '');
}
export function deviceKey(value, create = false) {
  const key = 'swr.social.device.v1:' + relayBase(value);
  let token = localStorage.getItem(key);
  if (token && !/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid device identity.');
  if (!token && create) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), v => v.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, token);
  }
  return token;
}
