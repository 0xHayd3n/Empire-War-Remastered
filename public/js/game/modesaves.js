import { listSaves, getSave } from './savegame.js';
import { loadCampaignData } from './galaxy.js';

export const saveModes = ['conquest', 'story', 'skirmish', 'instant', 'tutorial'];
export const isLoadMode = mode =>
  mode === 'load' || (typeof mode === 'string' && mode.startsWith('load-') && saveModes.includes(mode.slice(5)));

// New sidecars carry the originating mode. Older galactic and invasion saves
// need their authored campaign definition; never guess from the player's save name.
const legacy = new Map();
async function legacyMode(row) {
  const key = row.id + '|' + row.saved;
  if (legacy.has(key)) return legacy.get(key);
  const snap = await getSave(row.id);
  if (!snap || snap.multiplayer) return null;
  const setup = snap.campaign?.setup?.campaign || snap.setup || {};
  const campaign = setup.campaignName || (snap.mode === 'galactic' && setup.campaign);
  let mode = setup.menuFamily;
  if (!saveModes.includes(mode)) {
    if (campaign) {
      const name = String(campaign).toUpperCase(),
        def = (await loadCampaignData()).campaigns.get(name);
      mode =
        setup.universalPath || setup.galaxy?.universalPath
          ? 'conquest'
          : def?.bool('Tutorial')
            ? 'tutorial'
            : /^FULL_STORY_CAMPAIGN_(REBEL|EMPIRE|UNDERWORLD)$/.test(name)
              ? 'story'
              : def
                ? 'conquest'
                : null;
    } else mode = setup.instant ? 'instant' : ['land', 'space'].includes(snap.mode) ? 'skirmish' : null;
  }
  legacy.set(key, mode);
  return mode;
}
export async function modeSaves(mode) {
  const rows = (await listSaves()).filter(r => !r.mp);
  if (!mode) return rows;
  const out = [];
  for (const row of rows) if ((row.family || (await legacyMode(row))) === mode) out.push(row);
  return out;
}
export async function lastConquest() {
  for (const row of await listSaves()) {
    if (!row.mp && row.id !== 'resume' && (row.family || (await legacyMode(row))) === 'conquest') return row;
  }
  return null;
}

// Each runtime owns its files. Only the newest checkpoint's display metadata
// goes to the enclosing Universal window; loading always rechecks the owning era.
export async function recentCampaign() {
  const local = await lastConquest(),
    host = document.querySelector('meta[name="swr-universal"]')?.content;
  if (!host || parent === window) return local;
  return new Promise(resolve => {
    const request = crypto.randomUUID();
    const finish = row => {
      clearTimeout(timer);
      removeEventListener('message', reply);
      resolve(row);
    };
    const reply = e => {
      if (e.source === parent && e.origin === host && e.data?.kind === 'universal-recent-result' && e.data.request === request)
        finish(e.data.row);
    };
    const timer = setTimeout(() => finish(local), 1500);
    addEventListener('message', reply);
    parent.postMessage({ kind: 'universal-recent', request, row: local && { name: local.name, saved: local.saved } }, host);
  });
}
