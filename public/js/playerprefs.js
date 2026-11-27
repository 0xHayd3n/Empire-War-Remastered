// Cross-mount preferences are explicit player choices, not a copy of profile storage.
// Flat string keys let the launcher merge edits without interpreting any game's files.
const scalars = new Set(`swr-master swr-audio-headphones swr-extra-fx swr-armory-portrait
swr-both-rotate swr-edge-pan swr-capturebars swr-alluniticons swr-record-battles swr-keylabels swr-multiplace
swr-reinforce-turn swr-line-move swr-direct swr-clear-shots swr-autofire swr-shooter swr-shooter-overlord
swr-shooter-cap swr-shooter-tickets swr-shooter-conquest swr-shooter-focus swr-shooter-blur swr-particle-cap
swr-strategic-game-speed swr-tactical-game-speed swr.hints swr-auto-resolve swr-spectator-team-vision swr-subtitles
swr-reduce-menu-motion swr-delay-tooltips swr-simplified-faction-colors swr-narrate-settings swr-settings-speech-rate
swr-new-campaign-difficulty swr-new-galaxy-overlays`.split(/\s+/));
const records = new Set(`swr-gfx swr-volume swr-sound-mix swr-voice-channels swr-player-view-v1 swr-keys
swr-reading-speeds swr-shooter-settings swr-observer-display swr-solo-battlefront-rules-v1 swr-skirmish-setup swr-instant-setup`.split(/\s+/));
// These two records also contain rosters, maps and seats. Only the scalar defaults
// that the Settings page actually edits may leave the profile.
const draftFields = new Map([['swr-skirmish-setup',['fog','preBuilt','credits','popCap']], ['swr-instant-setup',['fog','budget']]]);
const fieldOK = (key, field) => /^[\w-]{1,80}$/.test(field) && !['constructor','prototype','__proto__'].includes(field) &&
  (!draftFields.has(key) || draftFields.get(key).includes(field)) &&
  !(key === 'swr-gfx' && (field === 'battleRealism' || field === 'level')); // separate master; preset indexes are mount-specific
const detailFields = new Set(['texMip','shader','shadow','shadows','aa','supersample','scale','mesh','particle','bloom','heat','flare','soft']);
function record(text) {
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  return {};
}
export function preferenceSnapshot(storage, effective = {}) {
  const out = Object.create(null);
  for (const key of scalars) {
    const value = storage.getItem(key);
    if (value !== null) out[key] = value;
  }
  for (const key of records) {
    const values = effective[key] || record(storage.getItem(key));
    for (const [field,v] of Object.entries(values)) if (fieldOK(key,field)) out[key+'/'+field] = JSON.stringify(v);
  }
  return out;
}
export function preferenceChanges(before, after) {
  const patch = Object.create(null);
  for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    if (before[key] !== after[key]) patch[key] = after[key] ?? null;
  }
  return patch;
}
export function applyPreferences(storage, patch) {
  const touched = new Map();
  for (const [id,v] of Object.entries(patch || {})) {
    if (v !== null && (typeof v !== 'string' || v.length > 2048)) continue;
    if (scalars.has(id)) {
      if (storage.getItem(id) !== v) v === null ? storage.removeItem(id) : storage.setItem(id,v);
      continue;
    }
    const [key,field,...tail] = id.split('/');
    if (!field || tail.length || !records.has(key) || !fieldOK(key,field)) continue;
    let bag = touched.get(key);
    if (!bag) touched.set(key,bag = record(storage.getItem(key)));
    if (v === null) delete bag[field];
    else {
      try {
        const value = JSON.parse(v);
        if (key === 'swr-keys' ? Array.isArray(value) && value.every(x=>typeof x==='string') : ['string','boolean','number'].includes(typeof value)) {
          if (key === 'swr-gfx' && detailFields.has(field) && bag[field] !== value) bag.level = -1;
          bag[field] = value;
        }
      } catch {}
    }
  }
  for (const [key,bag] of touched) {
    // A new partial graphics record isn't a legacy save from before FSR was available.
    if (key === 'swr-gfx' && !storage.getItem(key) && 'battleScale' in bag && !bag.upscaleMethod) bag.upscaleMethod='fsr1';
    if (!Object.keys(bag).length) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(bag));
  }
}
export function settingsHost() {
  const host = document.querySelector('meta[name="swr-universal"]')?.content;
  return host && parent !== window && document.referrer && new URL(document.referrer).origin === host ? host : null;
}
// Modules such as gfx and keybinds read storage during import. Finish the handshake *before*
// loading them, not as an asynchronous side effect of starting the first battle.
export async function loadPlayerPreferences() {
  const host = settingsHost();
  if (!host) return;
  const request = crypto.randomUUID();
  await new Promise(resolve => {
    function finish() { clearTimeout(timer); removeEventListener('message', receive); resolve(); }
    function receive(e) {
      if (e.source !== parent || e.origin !== host || e.data?.kind !== 'player-preferences' || e.data.request !== request) return;
      try { applyPreferences(localStorage, e.data.values); } catch { /* storage unavailable: use local defaults */ }
      finish();
    }
    const timer = setTimeout(finish, 1500); // an old/unavailable host must not block play
    addEventListener('message',receive);
    parent.postMessage({kind:'read-player-preferences',request},host);
  });
}
