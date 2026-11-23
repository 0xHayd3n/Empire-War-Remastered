// Browsing uses only the setup catalog. Mount a runtime on confirmed Start or on entry to another mode.
const frame = document.querySelector('#game'),
  veil = document.querySelector('aside'),
  status = veil.querySelector('p'),
  retry = veil.querySelector('button');
let current = '',
  busy = false;
async function enter(id, mode, ticket) {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch('/api/mount/' + encodeURIComponent(id), { method: 'POST' });
    if (!r.ok) throw Error(await r.text());
    const u = new URL((await r.json()).url);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw Error('Unavailable local game.');
    if (ticket) u.searchParams.set('universal-start', ticket);
    else if (mode !== 'title') u.searchParams.set('universal-mode', mode);
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
  const m = e.data;
  if (!current || e.source !== frame.contentWindow || e.origin !== current || typeof m?.id !== 'string' || !/^(stock|\d+)$/.test(m.id))
    return;
  if (m.kind === 'universal-start' && typeof m.ticket === 'string' && /^[a-f0-9-]{36}$/.test(m.ticket)) enter(m.id, 'conquest', m.ticket);
  else if (m.kind === 'universal-select' && ['title', 'modes', 'conquest', 'story', 'skirmish', 'instant', 'load'].includes(m.mode))
    enter(m.id, m.mode);
});
enter('stock', 'title');
