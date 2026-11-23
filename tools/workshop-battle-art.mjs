// Local reviewed photographs only. The request selects a map, never a filesystem path.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mediaFile } from './workshop-media.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const artRoot = () => process.env.SWR_BATTLE_ART || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'EaWBrowserWorkshop', 'battle-art'));
const hash = /^[0-9a-f]{64}$/;
export function mapKey(value) {
  const key = String(value || '').replaceAll('\\', '/').toUpperCase();
  return /^DATA\/(?:ART\/MAPS|CUSTOMMAPS)\/[^/:*?"<>|\x00-\x1f]{1,180}\.TED$/.test(key) ? key : null;
}
export function photoKey(map, kind, planet = '') {
  const key = mapKey(map);
  if (!key || !['land', 'space'].includes(kind) || typeof planet !== 'string' || planet.length > 160 || /[\x00-\x1f]/.test(planet)) return null;
  return JSON.stringify([key, kind, planet.trim().toUpperCase()]);
}
// Include the winning art/XML/TED inventory, not just the primary mod or TED basename.
// A changed override, archive revision, or enabled-item order requires a fresh review.
export function stackKey(game, mods) {
  const h = createHash('sha256'), archives = new Map();
  h.update(JSON.stringify(['foc-photo-v1', mods.map(p => path.resolve(p))]));
  for (const [key,e] of game.index) {
    if (!/^DATA\\(?:ART|XML|CUSTOMMAPS)\\/.test(key)) continue;
    let stamp = e.mtimeMs;
    if (e.meg) {
      if (!archives.has(e.meg)) archives.set(e.meg, fs.statSync(e.meg).mtimeMs);
      stamp = archives.get(e.meg);
    }
    h.update(JSON.stringify([key,e.meg || e.file,e.off,e.size,stamp]));
  }
  return h.digest('hex');
}
export function photoStore(root, stack, game) {
  let rows = new Map();
  try {
    const file = root && hash.test(stack) && mediaFile(root, `${stack}.json`, 8*1024*1024);
    if (file) {
      const list = JSON.parse(fs.readFileSync(file.file, 'utf8'));
      if (list.version === 1 && list.stack === stack && Array.isArray(list.photos)) {
        for (const row of list.photos) {
          const id = photoKey(row.map, row.kind, row.planet);
          if (!id || !hash.test(row.mapSHA) || !hash.test(row.imageSHA) || row.source !== 'reviewed-map-capture') continue;
          rows.set(id, rows.has(id) ? null : row); // ambiguous capture: omit both
        }
      }
    }
  } catch { rows = new Map(); }
  return async (map, kind, planet) => {
    const row = rows.get(photoKey(map, kind, planet));
    if (!row) return null;
    try {
      const key = game.resolve(mapKey(map));
      const entry = key && game.index.get(key);
      if (!entry?.size) return null;
      const file = mediaFile(root, `${row.imageSHA}.jpg`, 12*1024*1024);
      if (!file) return null;
      // A photograph is optional: do not synchronously read/hash a large TED on the game server.
      const start = entry.off || 0, sha = createHash('sha256');
      for await (const chunk of fs.createReadStream(entry.meg || entry.file, {start, end:start+entry.size-1})) sha.update(chunk);
      if (sha.digest('hex') !== row.mapSHA) return null;
      const bytes = await fs.promises.readFile(file.file);
      return digest(bytes) === row.imageSHA ? { bytes, mapSHA: row.mapSHA } : null;
    } catch { return null; }
  };
}
