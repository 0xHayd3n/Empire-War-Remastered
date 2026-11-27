// Synthetic-only coverage for tools/universal-prune.mjs. Everything happens in
// one temporary directory: no Steam scan, no real private library, no cleanup
// outside <tmp>. SWR_UNIVERSAL_LIBRARY is redirected so a defaulted home would
// be visible as a failure rather than touching the developer's library.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildPack } from './universal-library.mjs';
import { planPrune, applyPrune, pruneLibrary, PRUNE_FORMAT, formatReport } from './universal-prune.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-prune-test-'));
const previous = process.env.SWR_UNIVERSAL_LIBRARY;
process.env.SWR_UNIVERSAL_LIBRARY = path.join(dir, 'never-default-home');
const sha = data => createHash('sha256').update(data).digest('hex');
const put = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
const read = file => fs.readFileSync(file);
const rows = (pack, key) => pack.rows.find(row => row[0] === key);

// Same tiny v1 archive layout the existing library test uses.
function meg(file, key, text) {
  const name = Buffer.from(key),
    data = Buffer.from(text),
    buf = Buffer.alloc(30 + name.length);
  buf.writeUInt32LE(1, 0);
  buf.writeUInt32LE(1, 4);
  buf.writeUInt16LE(name.length, 8);
  name.copy(buf, 10);
  buf.writeUInt32LE(data.length, 18 + name.length);
  buf.writeUInt32LE(buf.length, 22 + name.length);
  put(file, Buffer.concat([buf, data]));
}

// Recursive lstat snapshot: proves a planning sweep wrote nothing at all.
function snapshot(root) {
  const out = [];
  const walk = rel => {
    const full = path.join(root, rel);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const next = rel ? rel + '/' + entry.name : entry.name,
        stat = fs.lstatSync(path.join(root, next));
      out.push(
        [next, stat.size, stat.mtimeMs, stat.isSymbolicLink() ? 'link:' + fs.readlinkSync(path.join(root, next)) : entry.isDirectory() ? 'dir' : 'file'].join('|')
      );
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(next);
    }
  };
  walk('');
  return out.sort();
}
const objectsPresent = home => {
  const root = path.join(home, 'objects');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(shard => shard.isDirectory() && !shard.isSymbolicLink())
    .flatMap(shard => fs.readdirSync(path.join(root, shard.name)).map(name => path.join(root, shard.name, name)))
    .sort();
};

const A = '1125571106',
  B = '1397421866',
  C = '3417277973',
  D = '1770851727',
  E = '3387971722',
  F = '1976399102';
const home = path.join(dir, 'library'),
  parents = path.join(dir, 'parents'),
  folder = id => path.join(parents, id);

try {
  // A: a packed payload plus shared loose bytes. B: shares those bytes, keeps an
  // unmodified copy of one file and a source-changed copy of another.
  // A caches its payload once (a legacy materialized pack whose flag was later
  // dropped), so the objects below really exist on disk.
  put(path.join(folder(A), 'modinfo.json'), JSON.stringify({ name: 'A', version: '1' }));
  put(path.join(folder(A), 'Data/megafiles.xml'), '<Files><File>Data/archive.meg</File></Files>');
  meg(path.join(folder(A), 'Data/archive.meg'), 'DATA\\ARCHIVED.TXT', 'packed');
  put(path.join(folder(A), 'Data/Shared.dds'), 'same payload');
  put(path.join(folder(A), 'Data/Other.dds'), 'shared payload');
  put(path.join(folder(A), 'Data/OnlyA.lua'), 'a');
  // B is thin: it only has a cached Shared.dds/Shared2.dds object because A
  // already cached the same bytes. Its own parent copy of Shared2 has moved on.
  put(path.join(folder(B), 'Data/Shared.dds'), 'same payload');
  put(path.join(folder(B), 'Data/OnlyB.lua'), 'b');
  put(path.join(folder(B), 'Data/Shared2.dds'), 'shared payload');
  put(path.join(folder(C), 'Data/OnlyC.lua'), 'c');
  put(path.join(folder(D), 'Data/OnlyD.lua'), 'd');
  put(path.join(folder(E), 'Data/OnlyE.lua'), 'e');
  put(path.join(folder(E), 'Data/ExtraE.txt'), 'extra');

  const ma = buildPack(home, A, folder(A), { materialize: true }),
    mb = buildPack(home, B, folder(B)),
    mc = buildPack(home, C, folder(C), { materialize: true }),
    md = buildPack(home, D, folder(D), { materialize: true }),
    me = buildPack(home, E, folder(E), { materialize: true });

  const stripMaterialized = id => {
    const file = path.join(home, 'profiles', id + '.json'),
      doc = JSON.parse(read(file));
    delete doc.materialized;
    fs.writeFileSync(file, JSON.stringify(doc));
  };
  stripMaterialized(A);
  // B's parent still holds the same bytes under another name, then moves on.
  put(path.join(folder(B), 'Data/Shared2.dds'), 'SHARED PAYLOAD');
  // A is only partially cached: one object is gone, so the pack can never run
  // offline again and its remaining verified objects are reclaimable.
  fs.rmSync(path.join(home, 'objects', rows(ma, 'DATA\\MEGAFILES.XML')[1].slice(0, 2), rows(ma, 'DATA\\MEGAFILES.XML')[1]));

  // C is an explicitly materialized manifest: buildPack writes that flag and
  // loadPack stops reading straight from the parent for it.
  const manifestC = path.join(home, 'profiles', C + '.json');
  assert.equal(JSON.parse(read(manifestC)).materialized, true);
  fs.rmSync(folder(C), { recursive: true });

  // Legacy fully-cached pack: every object is on disk but the manifest predates
  // the flag, and the parent no longer reproduces the object.
  stripMaterialized(D);
  put(path.join(folder(D), 'Data/OnlyD.lua'), 'D');

  // E is a partially cached pack whose parent disappeared: the remaining object
  // is not reproducible and must survive.
  stripMaterialized(E);
  fs.rmSync(path.join(home, 'objects', rows(me, 'DATA\\EXTRAE.TXT')[1].slice(0, 2), rows(me, 'DATA\\EXTRAE.TXT')[1]));
  fs.rmSync(folder(E), { recursive: true });

  const orphan = sha('orphan bytes'),
    victim = sha('victim bytes');
  put(path.join(home, 'objects', orphan.slice(0, 2), orphan), 'orphan bytes');
  put(path.join(home, 'objects', 'zz'), 'not a shard');
  let mismatched = 'mismatched shard';
  while (sha(mismatched).startsWith('cd')) mismatched += '!';
  put(path.join(home, 'objects', 'cd', sha(mismatched)), mismatched);
  put(path.join(dir, 'outside.txt'), 'victim bytes');
  let linked = false;
  try {
    fs.mkdirSync(path.join(home, 'objects', victim.slice(0, 2)), { recursive: true });
    fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(home, 'objects', victim.slice(0, 2), victim), 'file');
    linked = true;
  } catch {
    // Symlink creation needs privileges on some Windows setups; the case is skipped.
  }

  const folders = () =>
    new Map([
      [A, folder(A)],
      [B, folder(B)],
      [C, folder(C)],
      [D, folder(D)],
      [E, folder(E)]
    ]);

  // --- 1. dry run is the default and writes nothing -------------------------
  const before = snapshot(home);
  const first = planPrune({ home, folders: folders(), detail: true });
  assert.deepEqual(snapshot(home), before, 'planning must not create, touch or delete anything');
  assert.equal(first.format, PRUNE_FORMAT);
  assert.equal(first.mode, 'dry-run');
  const states = Object.fromEntries(first.packs.map(pack => [pack.id, pack.state]));
  assert.equal(states[A], 'thin');
  assert.equal(states[B], 'thin');
  assert.equal(states[C], 'materialized');
  assert.equal(states[D], 'fully-cached');
  assert.equal(states[E], 'parent-unavailable');
  assert.equal(first.packs.find(p => p.id === C).materialized, true);

  const expectReclaim = [
    rows(ma, 'DATA\\SHARED.DDS')[1],
    rows(ma, 'DATA\\ONLYA.LUA')[1],
    rows(ma, 'DATA\\ARCHIVED.TXT')[1]
  ].sort();
  assert.deepEqual(first.reclaim.map(item => item.sha), expectReclaim, 'only fully reproducible objects are reclaimable');
  // The shared object is proven twice; the packed slice came through the MEG.
  assert.deepEqual(
    first.reclaim.find(item => item.sha === rows(ma, 'DATA\\SHARED.DDS')[1]).references.map(ref => ref.id).sort(),
    [A, B].sort()
  );
  assert(first.reclaim.find(item => item.sha === rows(ma, 'DATA\\ARCHIVED.TXT')[1]).references.some(ref => ref.key === 'DATA\\ARCHIVED.TXT'));

  const keepReasons = Object.fromEntries(first.keep ? first.keep.map(item => [item.sha, item.reason]) : []);
  // Shared bytes: A still holds this slice, B's parent no longer does, so the
  // object is not reproducible and stays.
  assert.equal(keepReasons[rows(mb, 'DATA\\SHARED2.DDS')[1]], 'unverified:source-differs');
  assert.equal(rows(ma, 'DATA\\OTHER.DDS')[1], rows(mb, 'DATA\\SHARED2.DDS')[1]);
  assert.equal(keepReasons[rows(mc, 'DATA\\ONLYC.LUA')[1]], 'protected:materialized');
  assert.equal(keepReasons[rows(md, 'DATA\\ONLYD.LUA')[1]], 'protected:fully-cached');
  assert.equal(keepReasons[rows(me, 'DATA\\ONLYE.LUA')[1]], 'protected:parent-unavailable');
  assert.equal(keepReasons[orphan], 'unreferenced');
  assert.equal(first.totals.reclaimObjects, 3);
  assert.equal(first.totals.reclaimBytes + first.totals.keepBytes, first.totals.cachedBytes);
  assert.equal(first.totals.reclaimBytes, 12 + 1 + 6);
  assert.deepEqual(
    first.unknown.map(entry => entry.path).sort(),
    ['cd/' + sha(mismatched), 'zz', ...(linked ? [victim.slice(0, 2) + '/' + victim] : [])].sort()
  );
  assert(first.unknown.every(entry => entry.reason === 'noncanonical' || entry.reason === 'link'));
  assert.deepEqual(first.blockers, []);
  assert.match(formatReport({ mode: 'dry-run', plan: first, result: null }), /DRY RUN/);

  // Detail is opt-in; the default report stays compact.
  assert(planPrune({ home, folders: folders() }).keep === null, 'kept-object detail is opt-in');
  assert(first.keep.length >= 5);

  // --- 2. a source that moves between plan and apply aborts everything ------
  put(path.join(folder(A), 'Data/OnlyA.lua'), 'z');
  const sourceAbort = applyPrune(first);
  assert.equal(sourceAbort.aborted.code, 'changed-during-sweep');
  assert.equal(sourceAbort.deleted.length, 0);
  assert.deepEqual(snapshot(home), before, 'an aborted apply deletes nothing');
  put(path.join(folder(A), 'Data/OnlyA.lua'), 'a');

  // --- 3. a manifest that changes between plan and apply aborts too ---------
  const second = planPrune({ home, folders: folders() });
  assert.deepEqual(second.reclaim.map(item => item.sha), expectReclaim);
  const manifestB = path.join(home, 'profiles', B + '.json');
  fs.writeFileSync(manifestB, JSON.stringify(JSON.parse(read(manifestB)), null, 2));
  const rewritten = snapshot(home);
  const manifestAbort = applyPrune(second);
  assert.equal(manifestAbort.aborted.code, 'manifests-changed');
  assert.equal(manifestAbort.deleted.length, 0);
  assert.deepEqual(snapshot(home), rewritten, 'a manifest change aborts before any unlink');

  // --- 4. apply reclaims exactly the verified set, once --------------------
  const third = planPrune({ home, folders: folders() });
  assert.deepEqual(third.reclaim.map(item => item.sha), expectReclaim);
  // An object that disappeared between plan and apply is skipped, not failed.
  const vanished = third.reclaim[0];
  fs.rmSync(vanished.file);
  const applied = applyPrune(third);
  assert.equal(applied.aborted, null);
  assert.deepEqual(applied.failed, []);
  assert.deepEqual([...applied.deleted].sort(), expectReclaim.filter(sha => sha !== vanished.sha));
  assert.equal(applied.deletedBytes, third.totals.reclaimBytes - vanished.size);
  assert.deepEqual(applyPrune(third).deleted, [], 'applying the same plan twice is harmless');
  assert.deepEqual(
    objectsPresent(home).map(file => path.basename(file)).sort(),
    [rows(mb, 'DATA\\SHARED2.DDS')[1], rows(mc, 'DATA\\ONLYC.LUA')[1], rows(md, 'DATA\\ONLYD.LUA')[1], rows(me, 'DATA\\ONLYE.LUA')[1], orphan, sha(mismatched), ...(linked ? [victim] : [])].sort()
  );
  assert.equal(read(path.join(dir, 'outside.txt')).toString(), 'victim bytes');
  if (linked) assert(fs.lstatSync(path.join(home, 'objects', victim.slice(0, 2), victim)).isSymbolicLink());
  // A second sweep finds nothing left to reclaim and still names the guard rails.
  const after = planPrune({ home, folders: folders() });
  assert.deepEqual(after.reclaim, []);
  assert.equal(after.keepSummary['protected:materialized'], 1);
  assert.equal(after.keepSummary['protected:fully-cached'], 1);
  assert.equal(after.keepSummary['unverified:source-differs'], 1);
  assert.equal(after.totals.reclaimBytes + after.totals.keepBytes, after.totals.cachedBytes);
  assert.equal(pruneLibrary({ home, folders: folders() }).result, null, 'pruneLibrary only applies when asked');

  // --- 5. an invalid manifest keeps the whole store -------------------------
  const bad = path.join(dir, 'library-bad');
  put(path.join(folder(F), 'Data/OnlyF.lua'), 'f');
  const mf = buildPack(bad, F, folder(F), { materialize: true });
  const manifestF = path.join(bad, 'profiles', F + '.json');
  fs.writeFileSync(manifestF, JSON.stringify({ ...JSON.parse(read(manifestF)), revision: '0'.repeat(64) }));
  const badPlan = planPrune({ home: bad, folders: new Map([[F, folder(F)]]) });
  assert.equal(badPlan.blockers.length, 1);
  assert.equal(badPlan.blockers[0].code, 'invalid-manifest');
  assert.deepEqual(badPlan.reclaim, []);
  assert.equal(badPlan.keepSummary.blocked, badPlan.totals.cachedObjects);
  const badApply = applyPrune(badPlan);
  assert.equal(badApply.aborted.code, 'blocked');
  assert.equal(badApply.deleted.length, 0);
  assert(fs.existsSync(path.join(bad, 'objects', rows(mf, 'DATA\\ONLYF.LUA')[1].slice(0, 2), rows(mf, 'DATA\\ONLYF.LUA')[1])));

  // --- 6. a blank library is a valid, empty plan ---------------------------
  const blank = path.join(dir, 'library-blank');
  fs.mkdirSync(blank);
  const blankPlan = planPrune({ home: blank, folders: new Map() });
  assert.deepEqual(blankPlan.packs, []);
  assert.deepEqual(blankPlan.reclaim, []);
  assert.equal(blankPlan.totals.cachedObjects, 0);
  assert.deepEqual(planPrune({ home: blank, folders: new Map([[A, folder(A)]]) }).reclaim, []);

  // --- 7. unsafe homes are refused before anything is read -----------------
  put(path.join(dir, 'plain-file'), 'not a library');
  assert.throws(() => pruneLibrary({ home: path.join(dir, 'plain-file'), folders: new Map() }), /not a directory|does not exist/);
  assert.throws(() => pruneLibrary({ home: path.join(dir, 'missing'), folders: new Map() }), /does not exist/);
  assert.equal(pruneLibrary({ home, folders: folders() }).mode, 'dry-run', 'the same inputs stay valid');
  {
    const checkout = path.resolve(TOOLS, '..');
    assert.throws(() => planPrune({ home: checkout, folders: new Map() }), /outside the checkout/);
    assert.throws(() => planPrune({ home: path.join(checkout, 'tools'), folders: new Map() }), /outside the checkout/);
  }
  let linkedHome = false;
  try {
    fs.symlinkSync(home, path.join(dir, 'linked-home'), 'junction');
    linkedHome = true;
  } catch {}
  if (linkedHome) assert.throws(() => planPrune({ home: path.join(dir, 'linked-home'), folders: new Map() }), /link or reparse/);

  assert(!fs.existsSync(process.env.SWR_UNIVERSAL_LIBRARY), 'the default library home was never used');
  console.log(
    'PASS: dry-run default, verified-only reclaim, shared-parent proof, MEG slices, materialized/fully-cached/parent-missing protection, unknown entries, manifest and source guards, apply idempotence, unsafe homes'
  );
} finally {
  if (previous === undefined) delete process.env.SWR_UNIVERSAL_LIBRARY;
  else process.env.SWR_UNIVERSAL_LIBRARY = previous;
  fs.rmSync(dir, { recursive: true, force: true });
}
