// Build-time only. Use the same TED parser, virtual paths and layer precedence as the game.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {edgeIntake} from './outskirts.mjs';
import { parseMapHeader, parseTED } from '../../public/js/ted.js';
import { groundHashes } from '../../public/js/endor-stock-ground.js';
import { reviewedEndor } from '../../public/js/forestfloor.js';
import { openGame } from '../megfs.mjs';
import { primaries } from '../universal-library.mjs';
export const sha = b => createHash('sha256').update(b).digest('hex');
// Parsers take an ArrayBuffer. Reuse the allocation instead of copying a multi-MB map or texture.
const ab = b => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
export const fingerprint = o => sha(JSON.stringify(o));
// One plan mounts the same installed bytes under many scopes (stock layers, primaries, saved
// orders): read, SHA-256 and TED-parse each source once per process instead of once per mount.
// Source keys carry the size and the stat the mount itself took, so a remount after an edit looks
// elsewhere rather than returning stale bytes. Nothing here is written to disk or reused across
// runs, and every receipt value is still taken from the bytes read for that job.
export function intakeCache() {
  return { headers: new Map(), files: new Map(), maps: new Map(), textures: new Map(), archives: new Map() };
}
function physical(vfs, key, cache) {
  const e = vfs.index.get(key);
  if (!e) return null;
  if (!e.meg) return `file:${e.file}:${e.size}:${e.mtimeMs}`;
  let stamp = cache.archives.get(e.meg);
  if (stamp === undefined) {
    const st = fs.statSync(e.meg);
    stamp = `${st.size}:${st.mtimeMs}`;
    cache.archives.set(e.meg, stamp);
  }
  return `meg:${e.meg}:${e.off}:${e.size}:${stamp}`;
}
function memo(map, key, compute) {
  if (!map || !key) return compute();
  if (map.has(key)) return map.get(key);
  const value = compute();
  map.set(key, value);
  return value;
}
const fileOf = n => (/\.[a-z0-9]{2,4}$/i.test(n) ? n : n + '.dds');
export function sourceKey(name) {
  return 'Data/Art/Textures/' + fileOf(name);
}
export function scope(lib, key) {
  if (!lib.game) throw Error('Game installation not found: set SWR_GAME to the installed game root');
  if (key === 'eaw' || key === 'foc') return { key, edition: key, order: [], name: 'Stock ' + key.toUpperCase() };
  const order = key.split(',');
  if (!order.every(x => /^\d{1,20}$/.test(x) && lib.items.has(x) && !lib.ambiguous.has(x)) || new Set(order).size !== order.length)
    throw Error('Missing, repeated or ambiguous Workshop ID: ' + key);
  return { key, edition: 'foc', order, name: order.map(id => lib.items.get(id).name).join(' > ') };
}
export function installedScopes(lib) {
  return [...new Set(['eaw', 'foc', ...[...primaries.keys()].filter(id => lib.items.has(id)), ...lib.cards.map(c => c.order.join(','))])];
}
export function openScope(lib, s, options = null) {
  return openGame(lib.game, s.order.map(id => lib.items.get(id).folder).reverse(), { expansion: s.edition === 'foc', ...options });
}
export function catalog(vfs, cache = null) {
  const rows = [];
  for (const key of [...vfs.index.keys()].sort()) {
    if (!/^DATA\\(?:ART\\MAPS|CUSTOMMAPS)\\.*\.TED$/i.test(key)) continue;
    const h = header(vfs, key, cache);
    rows.push({
      key,
      planet: h.planet,
      players: h.players,
      domain: { 1: 'land', 2: 'space' }[h.kind] || 'unknown',
      custom: h.custom,
      headerEligible:
        /^DATA\\(?:ART\\MAPS|CUSTOMMAPS)\\[^\\]+\.TED$/i.test(key) &&
        [1, 2].includes(h.kind) &&
        h.players >= 2 &&
        h.f3 >= 0 &&
        (key.startsWith('DATA\\CUSTOMMAPS\\') ? h.custom === 1 : [0, 1].includes(h.custom))
    });
  }
  return rows;
}
// Header fields only: the same map bytes are mounted by every scope that includes that mod.
function header(vfs, key, cache) {
  return memo(cache?.headers, cache ? physical(vfs, key, cache) : null, () => {
    const h = parseMapHeader(ab(vfs.readPart(key, 0, 4096)));
    return { planet: h.planet || null, players: h.players, kind: h.kind, f3: h.f3, custom: h.custom };
  });
}
const base = n => (n || '').toUpperCase().replace(/\.(?:TGA|DDS)$/, '');
export function resolver(vfs, cache = null) {
  const seen = new Map();
  return name => {
    if (!name) return null;
    const key = vfs.resolve(sourceKey(name));
    if (!key) return { name, key: null, hash: null };
    let hash = seen.get(key);
    if (hash === undefined) {
      hash = cache ? physicalHash(vfs, key, cache) : undefined;
      if (hash === undefined) hash = sha(vfs.read(key));
      seen.set(key, hash);
    }
    return { name, key, hash };
  };
}
// A texture is hashed once per installed source per process, not once per mount of that source.
function physicalHash(vfs, key, cache) {
  const phys = physical(vfs, key, cache);
  if (!phys) return sha(vfs.read(key));
  let hash = cache.textures.get(phys);
  if (hash === undefined) cache.textures.set(phys, (hash = sha(vfs.read(key))));
  return hash;
}
export const pairId = (a, b) => (a?.hash && (!b || b.hash) ? `${a.hash}:${b?.hash || '-'}` : null);
// Only seed from the actual paired layers of the accepted Endor, not permutations of known files.
export function referencePairs(vfs, edition, groundFamily, families) {
  const out = new Map(),
    b = vfs.read(vfs.resolve('Data/Art/Maps/_MP_LAND_ENDOR.TED'));
  if (!b || !reviewedEndor(edition, sha(b))) return out;
  const t = parseTED(ab(b)).terrain,
    resolve = resolver(vfs);
  for (const slot of t.layers) {
    const id = groundFamily(slot);
    if (id < 0 || slot.hole) continue;
    const a = resolve(slot.texture),
      s = resolve(slot.bump);
    if (a?.hash !== groundHashes[base(slot.texture)] || !a?.hash || !s?.hash || s.hash !== groundHashes[base(slot.bump)]) continue;
    out.set(pairId(a, s), families[id]);
  }
  return out;
}
// Everything that depends only on the TED bytes. A physical source is read once per process and a
// content hash keys the parsed record, so scopes that mount the same installed map share one read,
// one SHA-256 and one parse. Only compact counts are kept (no per-vertex arrays, no slot hashes),
// so a full plan never retains parsed maps.
function terrain(vfs, key, cache) {
  if (!cache) {
    const bytes = vfs.read(key);
    return inspect(bytes, sha(bytes));
  }
  const phys = physical(vfs, key, cache),
    known = phys && cache.files.get(phys);
  if (known && cache.maps.has(known)) return cache.maps.get(known);
  const bytes = vfs.read(key),
    ted = sha(bytes),
    parsed = cache.maps.get(ted);
  if (phys) cache.files.set(phys, ted);
  if (parsed) return parsed;
  const value = inspect(bytes, ted);
  cache.maps.set(ted, value);
  return value;
}
function inspect(bytes, ted) {
  const map = parseTED(ab(bytes)),
    t = map.terrain;
  if (!t?.layerIndex) throw Error('No decoded land terrain');
  const n = t.layers.length,
    slots = t.layers.map((l, index) => ({
      index,
      tile: l.tile,
      turn: l.turn,
      tilt: l.tilt,
      hole: !!l.hole,
      vertices: 0,
      submerged: 0,
      textureName: l.texture,
      bumpName: l.bump
    }));
  let unassigned = 0,
    darkShadeVertices = 0;
  let minShade = 255,
    maxShade = 0;
  // Adjacent vertices are counted per painted slot pair here and totalled against the winning
  // source pairs below, which keeps the patch intake identical without a second pass over the map.
  const edges = new Int32Array(n * n);
  for (let y = 0; y < t.height; y++)
    for (let x = 0; x < t.width; x++) {
      const i = y * t.size + x,
        a = t.layerIndex[i],
        s = slots[a];
      if (!s) {
        unassigned++;
        continue;
      }
      s.vertices++;
      const shade = t.shade[i];
      minShade = Math.min(minShade, shade);
      maxShade = Math.max(maxShade, shade);
      if (shade < 24) darkShadeVertices++;
      if (t.water?.mode === 1 && t.heights[i] < t.water.level) s.submerged++;
      // Padding outside the authored rectangle holds 255, which names no layer.
      if (x) {
        const b = t.layerIndex[i - 1];
        if (b < n) edges[a * n + b]++;
      }
      if (y) {
        const b = t.layerIndex[i - t.size];
        if (b < n) edges[a * n + b]++;
      }
    }
  const adjacency = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (edges[a * n + b]) adjacency.push([a, b, edges[a * n + b]]);
  return {
    ted,
    width: t.width,
    height: t.height,
    unassigned,
    slots,
    adjacency,
    shadeRange: [minShade, maxShade],
    darkShadeVertices,
    waterMode: t.water?.mode ?? 0,
    water: t.water && { mode: t.water.mode, level: t.water.level },
    outskirtsIntake: edgeIntake(t, map),
    environments: map.environments.map(e => ({ name: e.name, weather: e.weather, sky: Object.keys(e.skyAngles) })),
    placedObjects: map.objects.length
  };
}
export function survey(vfs, meta, sc, resolve, known, cache = null) {
  const t = terrain(vfs, meta.key, cache),
    slots = t.slots.map(s => ({
      index: s.index,
      tile: s.tile,
      turn: s.turn,
      tilt: s.tilt,
      hole: s.hole,
      vertices: s.vertices,
      submerged: s.submerged,
      texture: resolve(s.textureName),
      bump: resolve(s.bumpName)
    }));
  for (const s of slots) {
    s.pair = pairId(s.texture, s.bump);
    s.suggestion = !s.hole && s.pair ? known.get(s.pair) || null : null;
  }
  // Cheap whole-board intake, grouped by winning source pair (not aliases). The release
  // audit uses local reviewed physical families, masks and connected components instead.
  let neighbors=0,boundaries=0;
  const pairs=slots.map(s=>!s.hole&&s.pair);
  for(const [a,b,count] of t.adjacency){const p=pairs[a],q=pairs[b];if(!p||!q)continue;neighbors+=count;if(p!==q)boundaries+=count;}
  const identity = {
    edition: sc.edition,
    order: sc.order,
    path: meta.key,
    ted: t.ted,
    slots: slots.map(s => [s.index, s.texture?.key, s.texture?.hash, s.bump?.key, s.bump?.hash])
  };
  return {
    format: 1,
    state: 'unreviewed',
    id: fingerprint(identity),
    scope: sc,
    identity,
    file: meta.key.split('\\').pop(),
    domain: meta.domain,
    headerEligible: meta.headerEligible,
    planet: meta.planet,
    width: t.width,
    height: t.height,
    unassigned: t.unassigned,
    outskirtsIntake: t.outskirtsIntake,
    patchIntake: { neighbors, boundaries, fraction: neighbors ? boundaries / neighbors : null, unit: 'mounted source pair, adjacent painted vertices' },
    surfaceIntake: { bakedShadeRange: t.shadeRange, darkShadeVertices: t.darkShadeVertices, waterMode: t.waterMode },
    water: t.water,
    environments: t.environments,
    placedObjects: t.placedObjects,
    slots
  };
}
export function makeQueue(jobs) {
  const groups = new Map();
  for (const job of jobs)
    for (const s of job.slots) {
      if (!s.vertices || s.hole || !s.pair) continue;
      const row = groups.get(s.pair) || {
        pair: s.pair,
        name: s.texture.name,
        suggestion: s.suggestion,
        vertices: 0,
        maps: new Set(),
        sample: job.id
      };
      row.maps.add(job.id);
      row.vertices += s.vertices;
      groups.set(s.pair, row);
    }
  return [...groups.values()]
    .map(r => ({ ...r, maps: r.maps.size, jobs: [...r.maps] }))
    .sort((a, b) => b.maps - a.maps || b.vertices - a.vertices || a.pair.localeCompare(b.pair));
}
