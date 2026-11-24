// Browsing uses only the setup catalog. Mount a runtime on confirmed Start or on entry to another mode.
const frame = document.querySelector('#game'),
  veil = document.querySelector('aside'),
  status = veil.querySelector('p'),
  retry = veil.querySelector('button');
const plate = document.querySelector('.battle-plate'),
  stage = plate.querySelector('[role="status"]'),
  expose = plate.querySelector('#expose');
let current = '',
  busy = false,
  presentation = '',
  stalled;
const orbit = new Image();
orbit.alt = '';
orbit.src = '/campaign-orbit.jpg';
orbit
  .decode()
  .then(() => plate.querySelector('.battle-scene').append(orbit))
  .catch(() => {});
function working(text) {
  stage.textContent = text;
  clearTimeout(stalled);
  expose.hidden = true;
  stalled = setTimeout(() => {
    expose.hidden = false;
  }, 30000);
}
function uncover() {
  clearTimeout(stalled);
  presentation = '';
  plate.hidden = true;
  frame.inert = false;
  frame.focus();
}
expose.onclick = uncover;
function transition(m) {
  if (!/^[a-f0-9-]{36}$/.test(m.token)) return;
  if (m.action === 'begin' && !presentation) {
    presentation = m.token;
    plate.querySelector('h2').textContent = String(m.title || 'Galactic Conquest').slice(0, 200);
    plate.querySelector('.battle-aurebesh').textContent = plate.querySelector('h2').textContent;
    plate.querySelector('.battle-subtitle').textContent = String(m.subtitle || '').slice(0, 280);
    working('Preparing campaign');
    frame.inert = true;
    plate.hidden = false;
  } else if (m.token === presentation) {
    if (m.action === 'stage' && typeof m.text === 'string') working(m.text.slice(0, 160));
    if (m.action === 'end') uncover();
  }
}
async function enter(id, mode, ticket) {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch('/api/mount/' + encodeURIComponent(id), { method: 'POST' });
    if (!r.ok) throw Error(await r.text());
    const u = new URL((await r.json()).url);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw Error('Unavailable local game.');
    if (ticket) {
      u.searchParams.set('universal-start', ticket);
      if (presentation) {
        u.searchParams.set('universal-launch', presentation);
        working('Opening the selected mod');
      }
    } else if (mode !== 'title') u.searchParams.set('universal-mode', mode);
    current = u.origin;
    veil.hidden = true;
    frame.src = u.href;
    if (!presentation) frame.focus();
  } catch (e) {
    if (presentation) uncover();
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
  if (!current || e.source !== frame.contentWindow || e.origin !== current) return;
  if (m?.kind === 'universal-plate') {
    transition(m);
    return;
  }
  if (typeof m?.id !== 'string' || !/^(stock|\d+)$/.test(m.id)) return;
  if (m.kind === 'universal-start' && typeof m.ticket === 'string' && /^[a-f0-9-]{36}$/.test(m.ticket)) enter(m.id, 'conquest', m.ticket);
  else if (m.kind === 'universal-select' && ['title', 'modes', 'conquest', 'story', 'skirmish', 'instant', 'load'].includes(m.mode))
    enter(m.id, m.mode);
});
enter('stock', 'title');
