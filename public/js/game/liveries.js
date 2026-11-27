// Only paint crosses the network. Names, preset ids and the previewed unit are not match state.
export const PATTERNS = Object.freeze(['standard', 'banded', 'split', 'chevron']);
export const MAX_LIVERIES = 32;
export const NAME_LIMIT = 40;
const hex = /^#[a-f\d]{6}$/i;
const validId = id => typeof id === 'string' && /^[a-z\d-]{1,64}$/i.test(id);

export function sanitizeLivery(value) {
  if (!value || !PATTERNS.includes(value.pattern) || !Array.isArray(value.colors) || value.colors.length !== 4) return null;
  const colors = [];
  for (const c of value.colors) {
    if (typeof c !== 'string' || !hex.test(c)) return null;
    colors.push(c.toLowerCase());
  }
  return { colors, pattern: value.pattern };
}

let profile = 'stock';
export function setLiveryProfile(content, revision = '') {
  profile = JSON.stringify([
    content.edition,
    revision,
    ...content.mods.map(m => [m.workshop || m.name, m.version || '', m.packRevision || ''])
  ]);
}
const key = faction => 'swr-army-liveries.v1:' + profile + ':' + String(faction).trim().toUpperCase();
export function factionLiveries(faction, writing = false) {
  const presets = [];
  let active = '';
  try {
    const item = localStorage.getItem(key(faction));
    if (item !== null) {
      const raw = JSON.parse(item);
      if (!Array.isArray(raw?.presets)) throw new Error();
      for (const p of raw.presets.slice(0, MAX_LIVERIES)) {
        const paint = sanitizeLivery(p);
        if (paint && validId(p.id) && !presets.some(x => x.id === p.id) && typeof p.name === 'string' && p.name.trim()) {
          presets.push({ id: p.id, name: p.name.trim().slice(0, NAME_LIMIT), ...paint });
        }
      }
      if (presets.some(p => p.id === raw.active)) active = raw.active;
    }
  } catch {
    if (writing) throw new Error('The saved livery library cannot be read. Nothing was changed.');
  }
  return { presets, active };
}

export function activeLivery(faction) {
  const { presets, active } = factionLiveries(faction);
  return sanitizeLivery(presets.find(p => p.id === active));
}

// One key per faction: updating Empire never rewrites the Rebel registry.
// Let write failures reach the editor; never claim to have equipped an unsaved preset.
function store(faction, value) {
  if (!faction) throw new Error('Choose a faction first.');
  try {
    localStorage.setItem(key(faction), JSON.stringify(value));
  } catch {
    throw new Error('Could not save on this device. Check browser storage and try again.');
  }
}

export function saveLivery(faction, id, name, value) {
  const state = factionLiveries(faction, true),
    paint = sanitizeLivery(value);
  name = String(name || '')
    .trim()
    .slice(0, NAME_LIMIT);
  if (!paint || !name) throw new Error('Choose four colors, a pattern and a livery name.');
  if (state.presets.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase()))
    throw new Error('That livery name is already in use for this faction.');
  const at = state.presets.findIndex(p => p.id === id);
  if (id && at < 0) throw new Error('That livery no longer exists. Create a new one.');
  if (at < 0 && state.presets.length >= MAX_LIVERIES) throw new Error(`A faction can have up to ${MAX_LIVERIES} liveries.`);
  const preset = { id: id || crypto.randomUUID(), name, ...paint };
  if (at < 0) state.presets.push(preset);
  else state.presets[at] = preset;
  state.active = preset.id;
  store(faction, state);
  return preset.id;
}

export function equipStock(faction) {
  const state = factionLiveries(faction, true);
  state.active = '';
  store(faction, state);
}

export function deleteLivery(faction, id) {
  const state = factionLiveries(faction, true);
  state.presets = state.presets.filter(p => p.id !== id);
  if (state.active === id) state.active = '';
  store(faction, state);
}
