// Offline oracle for *display* order: highest priority first. Never build packs or write installations.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openGame } from './megfs.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const preferred = k => /\.(XML|LUA|DDS|ALO|TED|WAV|MP3|TGA|ALA|DAT)$/i.test(k);
const limit = 4 * 1024 * 1024;
export function arrange(layers) {
  const winners = new Map();
  for (const { id, entries } of layers)
    for (const [key, entry] of entries) {
      const higher = winners.get(key);
      if (!higher) winners.set(key, { id, entry, lower: [] });
      else higher.lower.push({ id, entry });
    }
  return winners;
}
function digest(e) {
  if (!e) return null; // zero-byte override is a tombstone, not an empty payload
  const fd = fs.openSync(e.file || e.meg, 'r');
  try {
    const b = Buffer.alloc(e.size);
    for (let i = 0; i < b.length; ) {
      const n = fs.readSync(fd, b, i, b.length - i, (e.off || 0) + i);
      if (!n) throw Error('Source changed while reading');
      i += n;
    }
    return sha(b);
  } finally {
    fs.closeSync(fd);
  }
}
export function sourceOracle(lib) {
  const cache = new Map();
  function layer(id) {
    if (!cache.has(id)) {
      let entries, view;
      if (id === 'stock') {
        view = openGame(lib.game);
        entries = view.index;
      } else {
        entries = new Map();
        view = openGame(null, [lib.items.get(id).folder], { collectMod: entries });
      }
      view.close();
      cache.set(id, { id, entries });
    }
    return cache.get(id);
  }
  return ids => {
    const layers = [...ids, 'stock'].map(layer),
      all = arrange(layers),
      probes = new Map();
    let shared = 0;
    const counts = new Map(layers.map(l => [l.id, 0])),
      selected = new Set(),
      distinct = new Set();
    for (const [k, v] of all) {
      counts.set(v.id, counts.get(v.id) + 1);
      if (v.lower.some(l => l.id !== 'stock')) shared++;
      if (!preferred(k) || v.entry?.size > limit || (v.id === 'stock' && ids.length)) continue;
      const lc = v.lower[0];
      // A colliding name alone doesn't prove precedence. Compare the winning bytes to the next layer.
      const conflict = lc && !distinct.has(v.id) && !(lc.entry?.size > limit) && digest(v.entry) !== digest(lc.entry);
      if (!selected.has(v.id) || conflict) {
        probes.set(k, { path: k.replaceAll('\\', '/'), winner: v.id, sha256: digest(v.entry), ...(conflict ? { over: lc.id } : {}) });
        selected.add(v.id);
        if (conflict) distinct.add(v.id);
      }
    }
    for (const k of ['DATA\\XML\\GAMECONSTANTS.XML']) {
      const v = all.get(k);
      if (!v?.entry) throw Error('GameConstants.xml is missing or masked');
      probes.set(k, { ...probes.get(k), path: k.replaceAll('\\', '/'), winner: v.id, sha256: digest(v.entry) });
    }
    const shadowed = [];
    for (const { id, entries } of layers) {
      if (id === 'stock' || counts.get(id)) continue;
      const first = entries.entries().next().value;
      if (!first) {
        shadowed.push({ id, paths: 0 });
        continue;
      }
      const [path, entry] = first,
        higher = all.get(path);
      shadowed.push({
        id,
        paths: entries.size,
        example: path.replaceAll('\\', '/'),
        winner: higher.id,
        sameBytes: (higher.entry?.size || 0) <= limit && (entry?.size || 0) <= limit ? digest(higher.entry) === digest(entry) : null
      });
      if (preferred(path) && (higher.entry?.size || 0) <= limit)
        probes.set(path, { ...probes.get(path), path: path.replaceAll('\\', '/'), winner: higher.id, sha256: digest(higher.entry) });
    }
    return { sharedModPaths: shared, effectivePaths: Object.fromEntries(counts), shadowed, probes: [...probes.values()] };
  };
}
