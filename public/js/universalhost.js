// Browsing uses only the setup catalog. Mount a runtime on confirmed Start or on entry to another mode.
import { deviceKey } from './socialidentity.js';
const frame = document.querySelector('#game'),
  veil = document.querySelector('aside'),
  status = veil.querySelector('p'),
  retry = veil.querySelector('button');
const plate = document.querySelector('.battle-plate'),
  stage = plate.querySelector('[role="status"]'),
  expose = plate.querySelector('#expose');
let currentProfile = 'stock';
let recents = {};
try { recents = JSON.parse(localStorage.getItem('universal-conquest-checkpoints') || '{}') || {}; } catch {}
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
async function enter(id, mode, ticket, field, endorLook) {
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
    if (field) {
      u.searchParams.set('world',field.world); u.searchParams.set('domain',field.domain);
      if (typeof field.file === 'string') u.searchParams.set('field-map', field.file.slice(0, 260));
      if(field.query) u.searchParams.set('field-search',String(field.query).slice(0,150));
      if (['skirmish','instant'].includes(mode) && field.draft) {
        const draft = JSON.stringify(field.draft);
        if (draft.length > 4096) throw Error('This setup is too large to transfer. Reduce the number of fleets or unit types before switching mods.');
        u.searchParams.set('field-draft', draft);
      }
    }
    // Keep the existing battle-realism handoff for older profile frames.
    try {
      const realism = localStorage.getItem('universal-battle-realism');
      if (['custom','on','off'].includes(realism)) u.searchParams.set('universal-realism', realism);
    } catch {}
    if(id==='stock' && ['ultra','showers','original'].includes(endorLook)){
      u.searchParams.set('endor-presentation',endorLook==='showers'?'ultra':endorLook);
      if(endorLook==='showers')u.searchParams.set('endor-forecast','showers');
    }
    if(id==='stock' && /^(yavin|tatooine|hoth|geonosis|naboo|utapau)-(remaster|original)$/.test(endorLook)){const [planet,mode]=endorLook.split('-');u.searchParams.set(planet+'-presentation',mode==='remaster'?'ultra':'original');}
    if (id === 'stock' && ['vehicle-wrecks', 'infantry-ragdolls', 'combined-arms', 'ground-offensive'].includes(endorLook))
      u.searchParams.set('wreck-battle', endorLook === 'vehicle-wrecks' ? 'armor' : endorLook === 'combined-arms' ? 'combined' : endorLook === 'ground-offensive' ? 'offensive' : 'infantry');
    current = u.origin;
    currentProfile = id;
    veil.hidden = true;
    frame.src = u.href;
    if (!presentation) frame.focus();
  } catch (e) {
    if (presentation) uncover();
    if (current) frame.contentWindow.postMessage({ kind: 'universal-error', error: e.message }, current);
    else {
      status.textContent = e.message;
      retry.hidden = false;
      retry.onclick = () => enter(id,mode,ticket,field,endorLook);
    }
  } finally {
    busy = false;
  }
}
addEventListener('message', e => {
  const m = e.data;
  if (!current || e.source !== frame.contentWindow || e.origin !== current) return;
  if (m?.kind === 'read-player-preferences' || m?.kind === 'save-player-preferences') {
    // A private launcher record, never a request to read or write an arbitrary storage key.
    // Read the current record for each merge so another tab's unrelated edit survives.
    const key = 'universal-player-preferences-v1';
    let values = Object.create(null);
    try { Object.assign(values, JSON.parse(localStorage.getItem(key) || '{}')); } catch {}
    if (m.kind === 'read-player-preferences') {
      frame.contentWindow.postMessage({kind:'player-preferences',request:m.request,values}, current);
    } else if (m.patch && typeof m.patch === 'object') {
      for (const [id,v] of Object.entries(m.patch)) {
        if (/^swr[-.][\w-]{1,80}(\/[\w-]{1,80})?$/.test(id) && (v === null || typeof v === 'string' && v.length <= 2048)) values[id] = v;
      }
      const json = JSON.stringify(values);
      if (json.length <= 65536) try { localStorage.setItem(key,json); } catch {}
    }
    return;
  }
  if (m?.kind === 'universal-battle-realism' && ['custom','on','off'].includes(m.mode)) {
    try { localStorage.setItem('universal-battle-realism', m.mode); } catch {}
    return;
  }
  if (m?.kind === 'universal-social-device' && /^[a-f0-9-]{36}$/.test(m.request)) {
    try {
      const token=deviceKey(m.relay,m.create===true);
      frame.contentWindow.postMessage({kind:'universal-social-result',request:m.request,token},current);
    } catch { frame.contentWindow.postMessage({kind:'universal-social-result',request:m.request,error:'Device storage unavailable.'},current); }
    return;
  }
  if (m?.kind === 'universal-recent' && typeof m.request === 'string') {
    if (m.row && Number.isFinite(Date.parse(m.row.saved))) recents[currentProfile] = { profile:currentProfile, name:String(m.row.name || '').slice(0,160), saved:m.row.saved };
    else delete recents[currentProfile];
    try { localStorage.setItem('universal-conquest-checkpoints', JSON.stringify(recents)); } catch {}
    const row = Object.values(recents).sort((a,b)=>Date.parse(b.saved)-Date.parse(a.saved))[0] || null;
    frame.contentWindow.postMessage({kind:'universal-recent-result',request:m.request,row},current);
    return;
  }
  if (m?.kind === 'universal-plate') {
    transition(m);
    return;
  }
  if (typeof m?.id !== 'string' || !/^(stock|\d+)$/.test(m.id)) return;
  if (m.kind === 'universal-start' && typeof m.ticket === 'string' && /^[a-f0-9-]{36}$/.test(m.ticket)) enter(m.id, 'conquest', m.ticket);
  else if (m.kind === 'universal-field' && ['instant','skirmish'].includes(m.mode) && ['land','space'].includes(m.domain) && typeof m.world === 'string' && m.world.length<=256) enter(m.id,m.mode,null,m);
  else if (m.kind === 'universal-select' && ['title', 'modes', 'customize', 'campaigns', 'profile-play', 'conquest', 'story', 'skirmish', 'instant', 'continue', 'load', 'load-conquest', 'load-story', 'load-skirmish', 'load-instant', 'load-tutorial'].includes(m.mode))
    enter(m.id, m.mode);
});
const play=location.hash.slice(1);
enter('stock','title',null,null,['vehicle-wrecks','infantry-ragdolls','combined-arms','ground-offensive'].includes(play) || /^(yavin|tatooine|hoth|geonosis|naboo|utapau)-(remaster|original)$/.test(play)?play:play==='endor-showers'?'showers':play==='endor-ultra'?'ultra':play==='endor-original'?'original':null);
