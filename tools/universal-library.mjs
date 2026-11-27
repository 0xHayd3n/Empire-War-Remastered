// Local build products, never Workshop downloads. Share bytes, not load order or symbols.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { openGame } from './megfs.mjs';
import { readVerified } from './verified-pack-read.mjs';

export const primaries = new Map([
  ['1125571106', 'Thrawn’s Revenge'],
  ['1976399102', 'Fall of the Republic'],
  ['3417277973', 'Revan’s Revenge'],
  ['1397421866', 'Awakening of the Rebellion'],
  ['3387971722', 'Awakening of the Clone Wars'],
  ['1770851727', 'Empire at War: Remake']
]);
export const libraryHome = () =>
  path.resolve(
    process.env.SWR_UNIVERSAL_LIBRARY || path.join(process.env.LOCALAPPDATA || os.homedir(), 'EaWBrowserUniversal', 'library-v1')
  );
export function assertPrivateLibrary(home, library) {
  const canonical = p => (fs.existsSync(p) ? fs.realpathSync(p) : path.join(canonical(path.dirname(p)), path.basename(p)));
  for (const root of [
    fileURLToPath(new URL('..', import.meta.url)),
    library.game,
    ...[...library.items.values()].map(m => m.folder)
  ].filter(Boolean)) {
    const rel = path.relative(canonical(root), canonical(path.resolve(home)));
    if (!rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)))
      throw Error('Choose a private library directory outside the checkout, game and Workshop installs.');
  }
}
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const objectFile = (home, sha) => path.join(home, 'objects', sha.slice(0, 2), sha);
function sourceLayer(folder) {
  const entries = new Map();
  openGame(null, [folder], { collectMod: entries }).close();
  return entries;
}
const chunk = Buffer.allocUnsafe(1024 * 1024);
function digestEntry(entry, output) {
  const fd = fs.openSync(entry.file || entry.meg, 'r'),
    h = createHash('sha256');
  try {
    for (let n = 0; n < entry.size; ) {
      const length = fs.readSync(fd, chunk, 0, Math.min(chunk.length, entry.size - n), (entry.off || 0) + n);
      if (!length) throw new Error('Source changed during import; rebuild after Steam finishes.');
      h.update(chunk.subarray(0, length));
      if (output !== undefined) for (let i = 0; i < length; ) i += fs.writeSync(output, chunk, i, length - i);
      n += length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
function checkId(id) {
  if (!primaries.has(id)) throw new Error('Unknown universal profile');
}
const manifestDir = home => path.join(home, 'profiles');
export function listPacks(home) {
  return [...primaries].map(([id, name]) => ({ id, name, ready: fs.existsSync(path.join(manifestDir(home), id + '.json')) }));
}
function readInfo(folder) {
  const file = fs.readdirSync(folder).find(n => /^modinfo\.json$/i.test(n));
  try {
    return file ? JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8').replace(/^\uFEFF/, '')) : null;
  } catch {
    return null;
  }
}
// Each publication is atomic; existing manifests keep referring to immutable blob names across rebuilds.
export function buildPack(home, id, folder, { materialize = false } = {}) {
  return withLibraryWrite(home, () => buildLocked(home, id, folder, materialize));
}
// Serialize private-library publishers and explicit trimming. A stale lock is
// left for manual inspection after a crash; never steal a running build's lock.
export function withLibraryWrite(home, work) {
  fs.mkdirSync(home, { recursive: true });
  const lock = path.join(home, '.pack-maintenance.lock');
  const fd = fs.openSync(lock, 'wx');
  const unlock = () => { fs.closeSync(fd); fs.unlinkSync(lock); };
  let result;
  try { fs.writeFileSync(fd, `${process.pid}\n`); result = work(); }
  catch (err) { unlock(); throw err; }
  if (result && typeof result.then === 'function') return Promise.resolve(result).finally(unlock);
  unlock();
  return result;
}
function buildLocked(home, id, folder, materialize) {
  checkId(id);
  const file = path.join(manifestDir(home), id + '.json');
  materialize ||= fs.existsSync(file) && json(file).materialized === true;
  const entries = sourceLayer(folder),
    rows = [];
  for (const [key, e] of entries) {
    if (!e) {
      rows.push([key, null]);
      continue;
    }
    const sha = digestEntry(e);
    if (materialize) ensureObject(home, sha, e.size, () => e);
    rows.push([key, sha, e.size, !!e.file]); // loose-vs-MEG provenance is observable through /api/modinfo
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const revision = hash(JSON.stringify(rows)),
    info = readInfo(folder);
  atomic(file, JSON.stringify({ format: 1, id, revision, info, rows, ...(materialize && { materialized: true }) }));
  return { revision, rows };
}
function ensureObject(home, sha, size, source) {
  const file = objectFile(home, sha);
  if (fs.existsSync(file)) {
    if (fs.statSync(file).size !== size || digestEntry({ file, size }) !== sha)
      throw new Error('Damaged library object; remove it and reimport.');
    return;
  }
  const e = source();
  if (!e || e.size !== size) throw new Error('Missing or updated parent file; restore the install or rebuild the profile.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    const out = fs.openSync(tmp, 'wx');
    let actual;
    try {
      actual = digestEntry(e, out);
    } finally {
      fs.closeSync(out);
    }
    if (actual !== sha) throw new Error('Parent content changed; rebuild the universal profile.');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
export function loadPack(home, id, folder) {
  checkId(id);
  const m = json(path.join(manifestDir(home), id + '.json'));
  if (m.format !== 1 || m.id !== id || !Array.isArray(m.rows) || hash(JSON.stringify(m.rows)) !== m.revision)
    throw new Error('Invalid universal pack manifest.');
  const entries = new Map(), offline = m.materialized === true;
  let original;
  for (const [key, sha, size, loose] of m.rows) {
    if (typeof key !== 'string' || entries.has(key)) throw new Error('Invalid virtual key');
    if (sha === null) {
      entries.set(key, null);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(sha) || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid object reference');
    const object = { file: objectFile(home, sha), size };
    entries.set(key, {
      ...object, // canonical object address for offline checks and metadata, not necessarily a file on disk
      packLoose: loose,
      readBytes(start, length) {
        if (folder && !offline) {
          try {
            const e = (original ||= sourceLayer(folder)).get(key);
            if (e) return readVerified(e, sha, size, start, length);
          } catch (err) {
            if (!fs.existsSync(object.file)) throw Error('Parent content changed or unavailable; restore the install or rebuild the profile.', { cause: err });
          }
        }
        if (!fs.existsSync(object.file)) throw Error('Missing parent or offline object; restore the install or rebuild the profile.');
        try { return readVerified(object, sha, size, start, length); }
        catch (err) { throw Error('Damaged library object; restore a verified copy or reimport.', { cause: err }); }
      }
    });
  }
  const mounted = {
    name: m.info?.name || m.info?.steamdata?.title || id,
    folder: id,
    workshop: id,
    ...(m.info?.version ? { version: String(m.info.version) } : {}),
    files: entries.size,
    packRevision: m.revision
  };
  return { entries, mounted, info: m.info, revision: m.revision };
}
