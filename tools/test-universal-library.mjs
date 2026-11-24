import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { auditPacks } from './audit-universal-packs.mjs';
import { completeOfflinePack } from './universal-atlas.mjs';
import { openGame } from './megfs.mjs';
import { buildPack, loadPack, listPacks } from './universal-library.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-pack-test-'));
const put = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
// Tiny v1 archive, one virtual file. Also exercise a localized stock MEG behind the mod layer.
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
const a = '1125571106',
  b = '1397421866',
  home = path.join(dir, 'library'),
  game = path.join(dir, 'game'),
  parents = path.join(dir, 'parents');
const folder = id => path.join(parents, id);
try {
  put(path.join(game, 'GameData/Data/megafiles.xml'), '<Files/>');
  put(path.join(game, 'GameData/Data/Old.txt'), 'base');
  meg(path.join(game, 'GameData/Data/Audio/SFX/sfx2d_french.meg'), 'DATA\\FR.TXT', 'fr');
  for (const [id, file] of [
    [a, 'One.dds'],
    [b, 'Two.dds']
  ]) {
    const root = folder(id);
    put(path.join(root, 'modinfo.json'), JSON.stringify({ name: id, version: '1' }));
    put(path.join(root, 'Data/megafiles.xml'), '<Files><File>Data/archive.meg</File></Files>');
    meg(path.join(root, 'Data/archive.meg'), 'DATA\\ARCHIVED.TXT', 'packed');
    put(path.join(root, 'Data', file), 'same payload');
    put(path.join(root, 'Data/Same.lua'), id);
  }
  put(path.join(folder(a), 'Data/Old.txt'), '');
  put(path.join(folder(a), 'Data/OneAlias.dds'), 'same payload');
  const ma = buildPack(home, a, folder(a)),
    mb = buildPack(home, b, folder(b));
  assert.equal(listPacks(home).filter(p => p.ready).length, 2);
  assert(!fs.existsSync(path.join(home, 'objects')), 'thin build stores no assets');
  assert(!completeOfflinePack(home, a), 'A thin pack cannot use its cached atlas after its parent disappears');
  const audit = auditPacks(home, { verify: true });
  assert.equal(audit.cachedObjects, 0);
  assert(!fs.existsSync(path.join(home, 'objects')), 'Audit never warms a thin pack');
  assert.equal(audit.withinProfileBytes, Buffer.byteLength('same payload'));
  assert.equal(audit.sharedAcrossProfiles, 3); // payload, archive entry and megafiles.xml
  assert.equal(
    audit.crossProfileBytes,
    mb.rows.filter(([key]) => key !== 'DATA\\SAME.LUA').reduce((n, row) => n + row[2], 0)
  );
  assert.equal(audit.distinctBytes + audit.crossProfileBytes + audit.withinProfileBytes, audit.logicalBytes);
  assert.equal(audit.masks, 1);
  const shared = ma.rows.find(r => r[0] === 'DATA\\ONE.DDS')[1];
  assert.equal(shared, mb.rows.find(r => r[0] === 'DATA\\TWO.DDS')[1]);
  for (const id of [a, b]) {
    const pack = loadPack(home, id, folder(id)),
      original = openGame(game, [folder(id)]),
      packed = openGame(game, [], { packedLayer: pack.entries });
    try {
      for (const lang of [0, 'French']) {
        const ref = original.forLanguage(lang),
          got = packed.forLanguage(lang);
        assert.deepEqual([...got.index.keys()].sort(), [...ref.index.keys()].sort());
        for (const k of ref.index.keys()) assert.deepEqual(got.read(k), ref.read(k), k);
      }
      const alias = packed.resolve(id === a ? 'data/One.tga' : 'data/Two.tga');
      assert.deepEqual(packed.readPart(alias, 2, 4), Buffer.from('me p'));
      assert.equal(pack.entries.get(alias).file, path.join(home, 'objects', shared.slice(0, 2), shared));
      assert.equal(packed.read(packed.resolve('Data/Same.lua')).toString(), id);
      assert.equal(packed.resolve('Data/Old.txt') !== null, id === b);
      assert.equal(pack.entries.get('DATA\\ARCHIVED.TXT').packLoose, false);
      assert.equal(pack.mounted.workshop, id);
    } finally {
      original.close();
      packed.close();
    }
  }
  // Snapshot independence from both parents, and failure rather than substituting a same-length changed source.
  put(path.join(folder(a), 'Data/New.txt'), 'latest');
  buildPack(home, a, folder(a));
  put(path.join(folder(a), 'Data/New.txt'), 'edited');
  assert.throws(() => loadPack(home, a, folder(a)).entries.get('DATA\\NEW.TXT').ensure(), /content changed/);
  buildPack(home, a, folder(a), { materialize: true });
  fs.rmSync(parents, { recursive: true });
  assert(completeOfflinePack(home, a), 'Materialized packs remain available without their parent');
  const packed = openGame(game, [], { packedLayer: loadPack(home, a).entries });
  assert.equal(packed.read('DATA\\NEW.TXT').toString(), 'edited');
  packed.close();
  const verified = auditPacks(home, { verify: true });
  assert.equal(verified.cachedObjects, verified.verifiedObjects);
  assert.equal(verified.invalidObjects + verified.unexpectedEntries, 0);
  put(path.join(home, 'objects', shared.slice(0, 2), shared), 'bad! payload');
  assert.equal(auditPacks(home, { verify: true }).invalidObjects, 1); // same length, wrong bytes
  put(path.join(home, 'objects', shared.slice(0, 2), 'repeated-copy'), 'same payload');
  assert.equal(auditPacks(home).unexpectedEntries, 1);
  assert.throws(() => loadPack(home, a).entries.get('DATA\\ONE.DDS').ensure(), /Damaged/);
  console.log(
    'PASS: isolated packs, shared bytes, distinct scripts, MEG/loose provenance, masks, languages, ranges, update and offline materialization'
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
