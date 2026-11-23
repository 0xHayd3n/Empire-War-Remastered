// One uninterrupted game window. Only its content frame is replaced when changing era.
const frame = document.querySelector('#game'),
  veil = document.querySelector('aside'),
  status = veil.querySelector('p'),
  retry = veil.querySelector('button');
let current = '',
  busy = false;
async function enter(id, mode) {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch('/api/mount/' + encodeURIComponent(id), { method: 'POST' });
    if (!r.ok) throw Error(await r.text());
    const u = new URL((await r.json()).url);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw Error('Unavailable local game.');
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
  const m = e.data;
  if (!current || e.origin !== current || e.source !== frame.contentWindow || m?.kind !== 'universal-select') return;
  if (
    typeof m.id !== 'string' ||
    !/^(stock|\d+)$/.test(m.id) ||
    !['title', 'modes', 'conquest', 'story', 'skirmish', 'instant', 'load'].includes(m.mode)
  )
    return;
  enter(m.id, m.mode);
});
enter('stock', 'title');
