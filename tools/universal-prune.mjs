// Reclaim only cached objects that a fresh sweep can reproduce from every
// installed parent that still refers to them. Dry run unless `apply: true`.
//
// The dry run never writes. The CLI holds the build/trim lock throughout an
// apply; only verified canonical objects are unlinked. It reads manifests through loadPack() for validated rows
// and reads source slices through the openGame() collector that buildPack()
// itself uses, so a verified object means "this exact key, size and SHA-256 is
// what the installed parent would import again".
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertPrivateLibrary, libraryHome, listPacks, loadPack, withLibraryWrite } from './universal-library.mjs';
import { openGame } from './megfs.mjs';
import { readLibrary } from './workshop-library.mjs';

export const PRUNE_FORMAT = 1;

const CHUNK = 1 << 20;
const SHA = /^[a-f0-9]{64}$/;
const SHARD = /^[a-f0-9]{2}$/;
const MANIFEST = /\.json$/i;

// Never apply an imported/serialized list of arbitrary paths.
const issued = new WeakSet();

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const samePath = (a, b) => (caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);
const objectPath = (home, sha) => path.join(home, 'objects', sha.slice(0, 2), sha);
const stampOf = stat => ({ size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev });
const sameStamp = (a, b) => Boolean(a && b && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev);
function statStamp(file) {
  try {
    return stampOf(fs.statSync(file));
  } catch {
    return null;
  }
}

class StaleSource extends Error {
  constructor(file) {
    super('Source changed while the sweep was running: ' + file);
    this.name = 'StaleSource';
    this.code = 'source-changed';
    this.file = file;
  }
}

// `folders` is the parent directory per primary id (library.items folder).
function parentFolders(folders) {
  const map = new Map();
  const add = (id, value) => {
    const folder = typeof value === 'string' ? value : value && typeof value.folder === 'string' ? value.folder : null;
    map.set(String(id), folder ? path.resolve(folder) : null);
  };
  if (folders instanceof Map) for (const [id, value] of folders) add(id, value);
  else if (folders && typeof folders === 'object') for (const [id, value] of Object.entries(folders)) add(id, value);
  return map;
}

// A private library must be a real directory reached without any link or
// reparse point, or every path check below could be redirected.
function assertSafeHome(home) {
  let stat;
  try {
    stat = fs.lstatSync(home);
  } catch {
    throw Error('Private library directory does not exist: ' + home);
  }
  if (stat.isSymbolicLink()) throw Error('Private library directory is a link or reparse point: ' + home);
  if (!stat.isDirectory()) throw Error('Private library path is not a directory: ' + home);
  if (!samePath(fs.realpathSync(home), path.resolve(home)))
    throw Error('Private library directory resolves through a link or reparse point: ' + home);
}

function snapshotManifests(profiles) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(profiles, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile() || !MANIFEST.test(e.name)) continue;
    let stat;
    try {
      stat = fs.statSync(path.join(profiles, e.name));
    } catch {
      continue; // vanished mid-sweep: the snapshot comparison reports the change
    }
    out.push({ name: e.name, ...stampOf(stat) });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function manifestsUnchanged(expected, profiles) {
  const now = snapshotManifests(profiles);
  if (now.length !== expected.length) return false;
  for (let i = 0; i < now.length; i++) if (now[i].name !== expected[i].name || !sameStamp(now[i], expected[i])) return false;
  return true;
}

// Walk the real object tree. Anything that is not a canonical
// objects/<2hex>/<64hex> regular file is reported and left alone.
function scanObjects(objectsRoot) {
  const canonical = new Map(),
    unusual = [];
  if (!fs.existsSync(objectsRoot)) return { canonical, unusual };
  const rootStat = fs.lstatSync(objectsRoot);
  if (rootStat.isSymbolicLink()) throw Error('The object store is a link or reparse point: ' + objectsRoot);
  if (!rootStat.isDirectory()) throw Error('The object store is not a directory: ' + objectsRoot);
  for (const shard of fs.readdirSync(objectsRoot, { withFileTypes: true })) {
    if (shard.isSymbolicLink()) {
      unusual.push({ path: shard.name, reason: 'link' });
      continue;
    }
    if (!shard.isDirectory() || !SHARD.test(shard.name)) {
      unusual.push({ path: shard.name, reason: 'noncanonical' });
      continue;
    }
    const shardPath = path.join(objectsRoot, shard.name);
    for (const entry of fs.readdirSync(shardPath, { withFileTypes: true })) {
      const rel = shard.name + '/' + entry.name,
        file = path.join(shardPath, entry.name);
      if (entry.isSymbolicLink()) {
        unusual.push({ path: rel, reason: 'link' });
        continue;
      }
      if (!entry.isFile() || !SHA.test(entry.name) || entry.name.slice(0, 2) !== shard.name) {
        unusual.push({ path: rel, reason: 'noncanonical' });
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        unusual.push({ path: rel, reason: 'vanished' });
        continue;
      }
      canonical.set(entry.name, { file, size: stat.size, stamp: stampOf(stat) });
    }
  }
  return { canonical, unusual };
}

// Every source read is bracketed by a stat, and a slice is never reused after
// its file's size/mtime moved. A change aborts the whole sweep instead of
// producing a deletion based on half-old information.
function sourceGuard() {
  const stamps = new Map();
  return {
    observe(file) {
      if (!stamps.has(file)) stamps.set(file, statStamp(file));
      return stamps.get(file);
    },
    check(file) {
      const start = this.observe(file);
      if (!sameStamp(start, statStamp(file))) throw new StaleSource(file);
    },
    handle(file) {
      this.check(file);
      return fs.openSync(file, 'r');
    },
    observed: () => stamps
  };
}

function hashSlice(source, memo, guard) {
  const file = source.file || source.meg;
  const off = source.off || 0;
  const size = source.size;
  const key = file + '\0' + off + '\0' + size;
  const cached = memo.get(key);
  if (cached !== undefined) {
    guard.check(file);
    return cached;
  }
  const fd = guard.handle(file),
    buffer = Buffer.allocUnsafe(Math.max(1, Math.min(CHUNK, size))),
    hash = createHash('sha256');
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || (source.off === undefined ? st.size !== size : off + size > st.size)) throw new StaleSource(file);
    for (let n = 0; n < size; ) {
      const got = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - n), off + n);
      if (!got) throw new StaleSource(file);
      hash.update(buffer.subarray(0, got));
      n += got;
    }
  } finally { fs.closeSync(fd); }
  const digest = hash.digest('hex');
  guard.check(file);
  memo.set(key, digest);
  return digest;
}

// buildPack()'s own view of a parent: the mod layer only, never the stock game.
function sourceLayer(folder) {
  const entries = new Map(),
    view = openGame(null, [folder], { collectMod: entries });
  view.close();
  return entries;
}

function classify(pack, objects, refsBySha, memo, guard) {
  // A fully cached pack is the legacy offline copy: keep its objects even when
  // a source is installed and would let us reproduce them.
  pack.fullyCached =
    pack.refs.length > 0 &&
    pack.refs.every(r => {
      const cached = objects.canonical.get(r.sha);
      return Boolean(cached) && cached.size === r.size;
    });
  if (pack.materialized) pack.state = 'materialized';
  else if (pack.fullyCached) pack.state = 'fully-cached';
  else if (!pack.folder || !fs.existsSync(pack.folder)) pack.state = 'parent-unavailable';
  else {
    const stat = fs.lstatSync(pack.folder, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) pack.state = 'parent-unavailable';
    else {
      try {
        pack.source = sourceLayer(pack.folder);
      } catch {
        pack.state = 'parent-unavailable';
      }
    }
  }
  if (pack.state === 'thin')
    for (const r of pack.refs) {
      if (!objects.canonical.has(r.sha)) continue; // no cached object at risk; do not hash the whole installation
      const source = pack.source.get(r.key);
      if (!source) {
        r.state = 'unverified';
        r.reason = 'source-missing';
        continue;
      }
      if (source.size !== r.size) {
        r.state = 'unverified';
        r.reason = 'source-size';
        continue;
      }
      let digest;
      try {
        const file = source.file || source.meg, actual = fs.realpathSync(file);
        const rel = path.relative(pack.folder, actual);
        if (!samePath(actual, path.resolve(file)) || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) throw Error('Outside parent');
        digest = hashSlice(source, memo, guard);
      } catch (err) {
        if (err && err.code === 'source-changed') throw err;
        r.state = 'unverified';
        r.reason = 'source-unreadable';
        continue;
      }
      if (digest !== r.sha) {
        r.state = 'unverified';
        r.reason = 'source-differs';
        continue;
      }
      r.state = 'verified';
      r.location = [source.file || source.meg, source.off ?? null, source.size];
    }
  else
    for (const r of pack.refs) {
      r.state = 'protected';
      r.reason = pack.state;
    }
  delete pack.source;
  for (const r of pack.refs) {
    let shared = refsBySha.get(r.sha);
    if (!shared) refsBySha.set(r.sha, (shared = { size: r.size, refs: [] }));
    shared.refs.push({ id: pack.id, key: r.key, state: r.state, reason: r.reason });
  }
}

function build(options, guard) {
  if (!options || typeof options.home !== 'string' || !options.home.trim())
    throw Error('A private library home is required.');
  const home = path.resolve(options.home),
    parents = parentFolders(options.folders);
  // Same containment rule as the loader: never inside the checkout, the game
  // install or a Workshop item.
  assertPrivateLibrary(home, {
    game: options.game,
    items: new Map([...parents].map(([id, folder]) => [id, { folder }]))
  });
  assertSafeHome(home);

  const objectsRoot = path.join(home, 'objects'),
    profiles = path.join(home, 'profiles'),
    manifestStamps = snapshotManifests(profiles),
    objects = scanObjects(objectsRoot),
    memo = new Map(),
    refsBySha = new Map(),
    packs = [],
    blockers = [];
  if (fs.existsSync(profiles)) {
    assertSafeHome(profiles);
    const known = new Set(listPacks(home).map(p => p.id + '.json'));
    for (const e of fs.readdirSync(profiles, { withFileTypes: true }))
      if (MANIFEST.test(e.name) && (!known.has(e.name) || !e.isFile() || e.isSymbolicLink()))
        blockers.push({ code: 'unknown-manifest', message: e.name });
  }

  for (const { id } of listPacks(home).filter(p => p.ready)) {
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(profiles, id + '.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch (err) {
      blockers.push({ code: 'invalid-manifest', id, message: err.message });
    }
    let loaded;
    try {
      loaded = loadPack(home, id);
    } catch (err) {
      blockers.push({ code: 'invalid-manifest', id, message: err.message });
      continue;
    }
    const pack = {
      id,
      folder: parents.get(id) || null,
      // An explicit materialized flag is the parent's promise that this pack is
      // shipped as a complete payload; honour it before anything else.
      materialized: manifest?.materialized === true,
      fullyCached: false,
      state: 'thin',
      references: 0,
      objects: 0,
      bytes: 0,
      refs: []
    };
    let canonicalPaths = true;
    for (const [key, entry] of loaded.entries) {
      if (!entry) continue;
      const sha = path.basename(entry.file);
      if (!SHA.test(sha) || !samePath(entry.file, objectPath(home, sha))) canonicalPaths = false;
      pack.refs.push({ key, sha, size: entry.size, loose: Boolean(entry.packLoose), state: null, reason: null });
    }
    if (!canonicalPaths) blockers.push({ code: 'invalid-manifest', id, message: 'A manifest object path is not canonical.' });
    // Report the manifest's own shape even if verification aborts later.
    pack.references = pack.refs.length;
    pack.objects = new Set(pack.refs.map(r => r.sha)).size;
    pack.bytes = pack.refs.reduce((n, r) => n + r.size, 0);
    packs.push(pack);
  }

  for (const pack of packs) {
    try {
      classify(pack, objects, refsBySha, memo, guard);
    } catch (err) {
      if (!err || err.code !== 'source-changed') throw err;
      blockers.push({ code: 'changed-during-sweep', id: pack.id, message: err.message });
      break;
    }
  }

  if (!blockers.length) {
    if (!manifestsUnchanged(manifestStamps, profiles))
      blockers.push({ code: 'manifests-changed', message: 'A pack manifest appeared or changed during the sweep.' });
    for (const [file, stamp] of guard.observed())
      if (!sameStamp(stamp, statStamp(file))) {
        blockers.push({ code: 'changed-during-sweep', message: 'A source file changed during the sweep: ' + file });
        break;
      }
  }

  const reclaim = [],
    keep = [],
    keepSummary = {};
  const record = (sha, size, reason) => {
    keep.push({ sha, size, reason });
    keepSummary[reason] = (keepSummary[reason] || 0) + 1;
  };
  if (blockers.length) {
    // Without a trusted view of every manifest, no cached object can be proved
    // unreachable or reproducible: keep the whole store and reclaim nothing.
    for (const [sha, cached] of objects.canonical) record(sha, cached.size, 'blocked');
  } else
    for (const [sha, cached] of objects.canonical) {
      const shared = refsBySha.get(sha);
      let reason = null;
      if (!shared) reason = 'unreferenced';
      else {
        // Every referring primary must reproduce this digest: a shared object
        // is only reclaimable when all of its parents still hold that slice.
        const bad = shared.refs.find(r => r.state !== 'verified');
        if (bad) reason = bad.state === 'protected' ? 'protected:' + bad.reason : 'unverified:' + bad.reason;
      }
      if (!reason) {
        const stat = fs.lstatSync(cached.file);
        if (!stat.isFile() || stat.nlink !== 1 || !samePath(fs.realpathSync(cached.file), cached.file) ||
            cached.size !== shared.size || hashSlice({ file: cached.file, size: cached.size }, memo, guard) !== sha)
          reason = 'unverified:cache-object';
      }
      if (reason) record(sha, cached.size, reason);
      else
        reclaim.push({
          sha,
          size: cached.size,
          file: cached.file,
          references: shared.refs.map(r => ({ id: r.id, key: r.key }))
        });
    }

  const order = (a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0);
  reclaim.sort(order);
  keep.sort(order);
  const reclaimBytes = reclaim.reduce((n, item) => n + item.size, 0);
  const keepBytes = keep.reduce((n, item) => n + item.size, 0);
  const cachedBytes = [...objects.canonical.values()].reduce((n, item) => n + item.size, 0);

  return {
    format: PRUNE_FORMAT,
    mode: 'dry-run',
    home,
    objectsRoot,
    detail: Boolean(options.detail),
    packs: packs.map(pack => ({
      id: pack.id,
      state: pack.state,
      folder: pack.folder,
      materialized: pack.materialized,
      fullyCached: pack.fullyCached,
      references: pack.references,
      objects: pack.objects,
      bytes: pack.bytes,
      reproducible: pack.refs.filter(r => r.state === 'verified').length
    })),
    unknown: objects.unusual,
    reclaim,
    keepSummary,
    keep: options.detail
      ? keep.map(item => ({ ...item, references: (refsBySha.get(item.sha)?.refs || []).map(r => ({ id: r.id, key: r.key })) }))
      : null,
    totals: {
      cachedObjects: objects.canonical.size,
      cachedBytes,
      referencedObjects: refsBySha.size,
      reclaimObjects: reclaim.length,
      reclaimBytes,
      keepObjects: keep.length,
      keepBytes,
      unknownEntries: objects.unusual.length
    },
    blockers,
    guards: {
      winners: packs.filter(p => p.state === 'thin').map(p => ({ folder: p.folder, rows: p.refs.filter(r => r.location).map(r => [r.key, ...r.location]) })),
      profiles: manifestStamps,
      sources: [...guard.observed()].filter(([p]) => !p.startsWith(objectsRoot + path.sep)).map(([file, stamp]) => ({ file, ...stamp })),
      objects: reclaim.map(item => ({ sha: item.sha, file: item.file, ...objects.canonical.get(item.sha).stamp }))
    }
  };
}

export function planPrune(options = {}) {
  const guard = sourceGuard();
  const plan = build(options, guard);
  issued.add(plan);
  return plan;
}

function abort(code, message, extra = {}) {
  return { deleted: [], deletedBytes: 0, failed: [], aborted: { code, message, ...extra } };
}

// Re-check the plan's own evidence before the first unlink. Nothing is removed
// unless the manifest stamps, winning source locations, source stamps and
// candidate identities still match the sweep. Pause Steam updates while trimming.
export function applyPrune(plan) {
  if (!issued.has(plan) || plan.format !== PRUNE_FORMAT) throw Error('Apply a plan produced by planPrune().');
  assertSafeHome(plan.home);
  if (plan.reclaim.length) {
    assertSafeHome(path.join(plan.home, 'objects'));
    assertSafeHome(path.join(plan.home, 'profiles'));
  }
  if (plan.blockers.length)
    return abort('blocked', 'The plan reported blockers; nothing was deleted.', { blockers: plan.blockers });
  if (!manifestsUnchanged(plan.guards.profiles, path.join(plan.home, 'profiles')))
    return abort('manifests-changed', 'A pack manifest changed since the plan; nothing was deleted.');
  for (const { folder, rows } of plan.guards.winners) {
    if (!rows.length) continue;
    try {
      const layer = sourceLayer(folder);
      for (const [key, file, off, size] of rows) {
        const e = layer.get(key);
        if (!e || (e.file || e.meg) !== file || (e.off ?? null) !== off || e.size !== size)
          return abort('changed-during-sweep', 'The winning parent entry changed: ' + key);
      }
    } catch { return abort('changed-during-sweep', 'Parent can no longer be mounted.'); }
  }
  const moved = plan.guards.sources.find(source => !sameStamp(source, statStamp(source.file)));
  if (moved) return abort('changed-during-sweep', 'A source file changed since the plan; nothing was deleted.', { file: moved.file });

  const candidates = new Map(plan.guards.objects.map(item => [item.sha, item])),
    pending = [];
  for (const item of plan.reclaim) {
    const expected = objectPath(plan.home, item.sha);
    if (!SHA.test(item.sha) || item.file !== expected) return abort('not-canonical', 'A planned object path is not canonical; nothing was deleted.');
    const guardStamp = candidates.get(item.sha);
    if (!guardStamp) return abort('not-planned', 'A planned object has no recorded state; nothing was deleted.');
    const stat = fs.lstatSync(expected, { throwIfNoEntry: false });
    if (!stat) continue; // already gone; nothing to reclaim
    if (!samePath(expected, item.file) || stat.isSymbolicLink() || !stat.isFile())
      return abort('not-canonical', 'A planned object is no longer a canonical regular file; nothing was deleted.');
    if (!sameStamp(stampOf(stat), guardStamp))
      return abort('object-changed', 'A planned object changed since the plan; nothing was deleted.');
    const shard = fs.lstatSync(path.dirname(expected), { throwIfNoEntry: false });
    if (!shard || shard.isSymbolicLink() || !shard.isDirectory())
      return abort('not-canonical', 'A planned object shard is not a real directory; nothing was deleted.');
    if (stat.nlink !== 1 || !samePath(fs.realpathSync(expected), expected)) return abort('not-canonical', 'Object moved or linked.');
    pending.push(expected);
  }

  const result = { deleted: [], deletedBytes: 0, failed: [], aborted: null };
  const sizes = new Map(plan.reclaim.map(item => [item.sha, item.size]));
  for (const file of pending) {
    const sha = path.basename(file);
    try {
      if (!samePath(fs.realpathSync(file), file) || !sameStamp(stampOf(fs.lstatSync(file)), candidates.get(sha))) throw Error('Candidate changed; kept.');
      fs.unlinkSync(file);
      result.deleted.push(sha);
      result.deletedBytes += sizes.get(sha) || 0;
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      result.failed.push({ sha, message: err.message });
    }
  }
  return result;
}

export function pruneLibrary(options = {}) {
  const plan = planPrune(options),
    apply = options.apply === true,
    result = apply ? applyPrune(plan) : null;
  return { format: PRUNE_FORMAT, mode: apply ? 'apply' : 'dry-run', plan, result };
}

const BOOLEANS = new Set(['--apply', '--detail', '--json']);
function parseArgs(argv) {
  const args = { apply: false, detail: false, json: false, help: false, home: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (BOOLEANS.has(flag)) args[flag.replace(/^-+/, '')] = true;
    else if (flag === '--home') { args.home = argv[++i]; if (!args.home || args.home.startsWith('--')) throw Error('Expected a directory after --home.'); }
    else if (flag.startsWith('--home=') && flag.length > 7) args.home = flag.slice('--home='.length);
    else throw Error('Unknown option: ' + flag);
  }
  return args;
}

export function formatReport(run) {
  const { plan, result } = run,
    mib = bytes => (bytes / 1048576).toFixed(2) + ' MiB',
    lines = [];
  lines.push(`${run.mode === 'apply' ? 'APPLY' : 'DRY RUN'} ${plan.home}`);
  for (const pack of plan.packs)
    lines.push(
      `  ${pack.id}  ${pack.state.padEnd(18)} ${String(pack.objects).padStart(6)} objects  ` +
        `${String(pack.reproducible).padStart(6)} cached references verified (${pack.references} total paths)`
    );
  lines.push(`cached: ${plan.totals.cachedObjects} objects, ${mib(plan.totals.cachedBytes)}`);
  lines.push(`reclaim: ${plan.totals.reclaimObjects} objects, ${mib(plan.totals.reclaimBytes)}`);
  for (const [reason, count] of Object.entries(plan.keepSummary).sort()) lines.push(`  keep ${reason}: ${count}`);
  if (plan.unknown.length) lines.push(`unusual object entries (never touched): ${plan.unknown.length}`);
  for (const blocker of plan.blockers) lines.push(`BLOCKED ${blocker.code}${blocker.id ? ' ' + blocker.id : ''}: ${blocker.message}`);
  if (result?.aborted) lines.push(`ABORTED ${result.aborted.code}: ${result.aborted.message}`);
  if (result)
    lines.push(
      `deleted: ${result.deleted.length} objects, ${mib(result.deletedBytes)}` +
        (result.failed.length ? `; failed: ${result.failed.length}` : '')
    );
  else if (plan.totals.reclaimObjects)
    lines.push(`no files deleted. Re-run with --apply to reclaim ${plan.totals.reclaimObjects} verified objects.`);
  return lines.join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node tools/universal-prune.mjs [--apply] [--detail] [--json] [--home <library>]');
    return 0;
  }
  const library = readLibrary(),
    home = args.home ? path.resolve(args.home) : libraryHome();
  assertPrivateLibrary(home, library);
  assertSafeHome(home);
  const sweep = () => pruneLibrary({
    home,
    game: library.game,
    folders: new Map([...library.items].filter(([id]) => !library.ambiguous?.has(id)).map(([id, item]) => [id, item.folder])),
    detail: args.detail,
    apply: args.apply
  });
  const run = args.apply ? withLibraryWrite(home, sweep) : sweep();
  if (args.json) console.log(JSON.stringify(run, null, 2));
  else console.log(formatReport(run));
  return run.plan.blockers.length || run.result?.aborted || run.result?.failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    err => {
      console.error(err.message);
      process.exitCode = 1;
    }
  );
