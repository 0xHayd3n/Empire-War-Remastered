import { recipes, packKey, isOutput, digest, refitID, endorID } from './recipes.js';
export const profile =
  typeof document !== 'undefined' && document.querySelector('meta[name="swr-universal"]')
    ? document.querySelector('meta[name="swr-pack-revision"]')?.content.split(':')[0] || 'stock'
    : null;
import { endorPreview,landPreview } from '../endor-preview.js';
export const alternateEdition = profile === 'stock' ? endorID : profile === '1976399102' ? refitID : null;
export function selectedEdition() {
  try {
    if (alternateEdition && localStorage.getItem(packKey(profile) + ':edition') === alternateEdition) return alternateEdition;
  } catch {}
  return profile;
}
export function chooseEdition(id) {
  if (!alternateEdition || ![profile, alternateEdition].includes(id)) throw Error('Unknown texture edition');
  localStorage.setItem(packKey(profile) + ':edition', id);
}
export const edition = selectedEdition(),
  entries = Object.hasOwn(recipes, edition) ? recipes[edition] : [];
export const key = packKey(edition);
export function enabled(id = edition) {
  try {
    return localStorage.getItem(packKey(id)) === 'on';
  } catch {
    return false;
  }
}
// A loaded map/texture context must not mix two pack versions. Preference changes apply on restart.
// Both sides of the Endor comparison require the unmodified stock winning sources.
export const active = !endorPreview && !landPreview && entries.length > 0 && enabled();
const byName = new Map(entries.map(r => [r.file, r]));
let db;
function open() {
  return (db ||= new Promise((ok, no) => {
    const r = indexedDB.open('swr-texture-showcase-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => {
      db = null;
      no(r.error);
    };
  }));
}
async function get(k) {
  const database = await open();
  return new Promise((ok, no) => {
    const r = database.transaction('files').objectStore('files').get(k);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function change(fn) {
  const database = await open();
  return new Promise((ok, no) => {
    const t = database.transaction('files', 'readwrite');
    t.oncomplete = ok;
    t.onabort = () => no(t.error || Error('Storage transaction failed'));
    fn(t.objectStore('files'));
  });
}
export const installed = (id = edition) => get(packKey(id));
export async function privateZip(id = edition) {
  const { storeZip } = await import('./archive.js');
  const rows = await Promise.all(
    recipes[id].map(async r => {
      const b = await get(packKey(id) + ':' + r.file);
      if (!b) throw Error('Pack is missing. Rebuild it from your installation.');
      return ['Data/Art/Textures/' + r.file, new Uint8Array(b)];
    })
  );
  return new Blob([storeZip(rows)], { type: 'application/zip' });
}
export async function installZip(a, id = edition) {
  const entries = recipes[id],
    key = packKey(id);
  const { readTextureZip } = await import('./archive.js');
  const files = readTextureZip(a, new Set(entries.map(r => 'Data/Art/Textures/' + r.file)));
  const rows = [];
  for (const r of entries) {
    const bytes = files.get('Data/Art/Textures/' + r.file);
    if (!isOutput(bytes, r) || (await digest(bytes)) !== r.output) throw Error('Not the reviewed showcase texture: ' + r.file);
    rows.push([key + ':' + r.file, bytes.slice().buffer]);
  }
  await change(s => {
    for (const [k, b] of rows) s.put(b, k);
    s.put(true, key);
  });
}
export async function removePack(id = edition) {
  const entries = recipes[id],
    key = packKey(id);
  await change(s => {
    s.delete(key);
    for (const r of entries) s.delete(key + ':' + r.file);
  });
  localStorage.removeItem(key);
}
export function matchTexture(path) {
  if (!active || edition === refitID) return null;
  const m = /^Data[\\/]Art[\\/]Textures[\\/](?:UXA(stock|\d+)_(?:stock|[0-9a-f]{64})__)?([^\\/]+)$/i.exec(path);
  if (!m || (m[1] && m[1].toLowerCase() !== profile)) return null;
  return byName.get(m[2].toUpperCase().replace(/\.TGA$/, '.DDS'));
}
// A hero variant can share the Venator's normal map without sharing its paint. Bind the refit
// only as a colour/normal pair in the reviewed material; never remap these generic VFS paths.
const prefix = 'SWR_SHIPYARD__';
export const usingRefit = active && edition === refitID;
// The armory's render worker asks its owning page for bytes; it must carry the material identity through that request.
let remotePair = false;
export function usePageRefit(on) {
  remotePair = typeof document === 'undefined' && on === true;
}
function splitName(name) {
  return /^(?:(UXA(?:stock|\d+)_(?:stock|[0-9a-f]{64})__))?([^\\/]+)$/i.exec(name || '');
}
export function refitMaterialName(name, base, normal) {
  if (!usingRefit && !remotePair) return name;
  const c = splitName(base),
    n = splitName(normal);
  if (!c || !n || c[1] !== n[1] || (c[1] && !/^UXA1976399102_/i.test(c[1]))) return name;
  const a = recipes[refitID].find(r => r.file === c[2].toUpperCase());
  return a?.role === 'refitPaint' && n[2].toUpperCase() === a.file.replace('_CM.', '_NM.') ? prefix + name : name;
}
const verifiedPairs = new Map();
export function readMaterialFile(name, read) {
  if (remotePair || !name.startsWith(prefix)) return read(name);
  const bare = name.slice(prefix.length),
    m = splitName(bare),
    scope = m?.[1] || '',
    r = byName.get(m?.[2].toUpperCase());
  if (!usingRefit || !r || (scope && !/^UXA1976399102_/i.test(scope))) return read(bare);
  const cm = r.file.replace('_NM.', '_CM.'),
    nm = cm.replace('_CM.', '_NM.'),
    id = scope + cm;
  if (!verifiedPairs.has(id))
    verifiedPairs.set(
      id,
      Promise.all(
        [cm, nm].map(async file => {
          const rec = byName.get(file),
            original = await read(scope + file);
          if (!original || (await digest(original)) !== rec.source) return false;
          const bytes = await get(key + ':' + file);
          return !!bytes && isOutput(new Uint8Array(bytes), rec);
        })
      )
        .then(x => x.every(Boolean))
        .catch(() => false)
    );
  return verifiedPairs.get(id).then(async ok => (ok ? (await get(key + ':' + r.file)) || read(bare) : read(bare)));
}
export async function showcaseBytes(r, input) {
  if (!input) return input;
  try {
    if ((await digest(input)) !== r.source) return input;
    const output = await get(key + ':' + r.file);
    return output && isOutput(new Uint8Array(output), r) ? output : input;
  } catch {
    return input;
  }
}
