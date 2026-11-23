// Only the active game may request another mount. While a conquest roster is loading, keep
// the current board on screen; reveal the replacement only after it has bound its controls.
let frame = document.querySelector('#game'),
  current = '',
  busy = false,
  pending = null;
const veil = document.querySelector('aside'),
  status = veil.querySelector('p'),
  retry = veil.querySelector('button');
async function mountedURL(id) {
  const r = await fetch('/api/mount/' + encodeURIComponent(id), { method: 'POST' });
  if (!r.ok) throw Error(await r.text());
  const u = new URL((await r.json()).url);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw Error('Unavailable local game.');
  return u;
}
function cancel() {
  if (pending) {
    clearTimeout(pending.timer);
    pending.frame?.remove();
    pending = null;
  }
}
function failed(p, message) {
  if (pending !== p) return;
  cancel();
  frame.contentWindow.postMessage({ kind: 'universal-board-error', id: p.id, error: message }, current);
}
async function prepare(id) {
  cancel();
  const p = (pending = { id });
  p.timer = setTimeout(() => failed(p, 'This storyline did not finish loading. You can try again.'), 120000);
  try {
    const u = await mountedURL(id);
    if (p !== pending) return;
    u.searchParams.set('universal-mode', 'conquest');
    u.searchParams.set('universal-prepare', '1');
    const f = (p.frame = frame.cloneNode(false));
    p.origin = u.origin;
    f.removeAttribute('id');
    f.inert = true;
    f.style.visibility = 'hidden';
    f.src = u.href;
    frame.after(f);
  } catch (e) {
    failed(p, e.message);
  }
}
async function enter(id, mode) {
  if (busy) return;
  cancel();
  busy = true;
  try {
    const u = await mountedURL(id);
    if (mode !== 'title') u.searchParams.set('universal-mode', mode);
    current = u.origin;
    veil.hidden = true;
    frame.src = u.href;
    frame.focus();
  } catch (e) {
    if (current) frame.contentWindow.postMessage({ kind: 'universal-error', error: e.message }, current);
    else {
      status.textContent = e.message;
      retry.hidden = false;
      retry.onclick = () => enter('stock', 'title');
    }
  } finally {
    busy = false;
  }
}
addEventListener('message', e => {
  const m = e.data,
    p = pending;
  if (p?.frame && e.source === p.frame.contentWindow && e.origin === p.origin) {
    if (m?.kind === 'universal-board-failed') failed(p, 'Could not load this storyline. Your previous setup is unchanged.');
    if (m?.kind !== 'universal-board-ready' || m.id !== p.id) return;
    clearTimeout(p.timer);
    pending = null;
    frame.remove();
    frame = p.frame;
    current = p.origin;
    frame.id = 'game';
    frame.style.visibility = '';
    frame.inert = false;
    frame.focus();
    frame.contentWindow.postMessage({ kind: 'universal-board-supported' }, current);
    return;
  }
  if (!current || e.source !== frame.contentWindow || e.origin !== current) return;
  if (m?.kind === 'universal-board-probe') {
    frame.contentWindow.postMessage({ kind: 'universal-board-supported' }, current);
    return;
  }
  if (m?.kind === 'universal-board-cancel') {
    cancel();
    return;
  }
  if (typeof m?.id !== 'string' || !/^(stock|\d+)$/.test(m.id)) return;
  if (m.kind === 'universal-board-prepare' && !busy) {
    prepare(m.id);
    return;
  }
  if (m.kind === 'universal-select' && ['title', 'modes', 'conquest', 'story', 'skirmish', 'instant', 'load'].includes(m.mode))
    enter(m.id, m.mode);
});
enter('stock', 'title');
