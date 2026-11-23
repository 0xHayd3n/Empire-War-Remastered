import { pageOverlay } from '../vfs.js';
import { expansion } from '../edition.js';
import { mapSourceDigest } from '../ted.js';

export const battleMapLabel = title => String(title || '').replace(/^\s*\[re\]\s*/i, '').trim() || 'Tactical map';

export async function mountBattleArt(scene, { land, map, campaign }) {
  // Only a real, parsed TED on the local Workshop mount has an exact-photo identity.
  // An installed browser overlay may shadow any dependency of the server's map.
  if (globalThis.SWR_BASE || !map.sourcePath || !!map.terrain !== land || !expansion() || location.hostname !== '127.0.0.1' ||
      (campaign && !campaign.planetType) || await pageOverlay() || !scene.isConnected) return;
  const query = new URLSearchParams({ map: map.sourcePath, kind: land ? 'land' : 'space', planet: campaign?.planetType || '' });
  const res = await fetch('/api/battle-photo?' + query, {cache:'no-store'});
  if (!scene.isConnected || res.status !== 200 || res.headers.get('content-type') !== 'image/jpeg') return;
  // The browser can still have different TED bytes under the same mounted path.
  const sha = res.headers.get('X-Map-SHA256');
  if (!/^[0-9a-f]{64}$/.test(sha || '') || sha !== await mapSourceDigest(map) || !scene.isConnected) return;
  const url = URL.createObjectURL(await res.blob());
  try {
    if (!scene.isConnected) return;
    const image = new Image();
    image.alt = '';
    image.src = url;
    await image.decode();
    if (!scene.isConnected || image.naturalWidth < 1920 || image.naturalHeight < 1080 || image.naturalWidth <= image.naturalHeight) return;
    scene.append(image);
    return true;
  } finally { URL.revokeObjectURL(url); }
}
