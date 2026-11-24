// Exact resolved bytes for the tiny, fixed set of textures used by this profile's
// preview lanes and rings. Absence is explicit. Oversize sets use the legacy VFS renderer.
import { parentPort, workerData } from 'node:worker_threads';
import { openGame } from './megfs.mjs';
import { loadPack } from './universal-library.mjs';
export function laneKit(archive, profile) {
  const kit = Object.create(null);
  let size = 0;
  for (const n of new Set([profile.overlay.ring, ...profile.looks.flatMap(l => [l.texture, l.spark])].filter(Boolean))) {
    const key = archive.resolve('Data/Art/Textures/' + (/\.[a-z0-9]{2,4}$/i.test(n) ? n : n + '.dds'));
    if (!key) {
      kit[n] = null;
      continue;
    }
    const len = archive.index.get(key)?.size;
    if (!len || len > 128 * 1024 || (size += len) > 512 * 1024) return null;
    kit[n] = archive.read(key).toString('base64');
  }
  return kit;
}
// Upgrade an existing private index without re-parsing campaigns or baking portraits.
if (parentPort && workerData?.kitOnly) {
  const { home, id, game, folder, language, profile } = workerData,
    pack = id === 'stock' ? null : loadPack(home, id, folder),
    archive = openGame(game, [], { packedLayer: pack?.entries, language });
  try {
    parentPort.postMessage(laneKit(archive, profile));
  } finally {
    archive.close();
  }
}
