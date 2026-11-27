// No mounted or licensed files required. Exercises the intake cache the `plan`/`catalog` path uses:
// identical job bodies with and without it, one read per installed source, one parse per distinct
// content, content (not date) invalidation after a source edit, mount-order identity, complete
// receipts, and the documented loose-index snapshot contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openScope, scope, catalog, resolver, survey, pairId, fingerprint, sha, intakeCache } from './survey.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remaster-intake-'));
// Minimal but valid TED v1: a map header chunk, then a container holding a 0x101 terrain chunk
// (size minis, a 4-byte-per-cell grid, and a layer block). Same reader as the game.
const chunk = (type, body, container = false) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(type, 0);
  head.writeUInt32LE((body.length | (container ? 0x80000000 : 0)) >>> 0, 4);
  return Buffer.concat([head, body]);
};
const mini = (type, data) => Buffer.concat([Buffer.from([type, data.length]), data]);
const u32 = v => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const f32 = v => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v);
  return b;
};
const wide = s => {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), i * 2);
  return b;
};
function ted({ planet = 'Testworld', width = 4, height = 4, layers, cells }) {
  const header = chunk(
    0,
    Buffer.concat([mini(1, u32(1)), mini(2, u32(2)), mini(3, u32(0)), mini(9, wide(planet)), mini(11, Buffer.from([0]))])
  );
  const grid = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = cells[i % cells.length];
    grid.writeInt16LE(c.height ?? 0, i * 4);
    grid.writeUInt8(c.layer, i * 4 + 2);
    grid.writeUInt8(c.shade ?? 200, i * 4 + 3);
  }
  const terrain = chunk(
    0x101,
    Buffer.concat([
      chunk(0, Buffer.concat([mini(0, u32(width)), mini(1, u32(height))])),
      chunk(5, grid),
      chunk(
        2,
        Buffer.concat(
          layers.map(l =>
            chunk(3, Buffer.concat([mini(7, f32(l.tile ?? 215)), mini(12, Buffer.from(l.texture)), mini(19, Buffer.from(l.bump))]))
          )
        ),
        true
      )
    ]),
    true
  );
  return Buffer.concat([header, chunk(0x100, terrain, true)]);
}
const LAYERS = [
  { texture: 'test_ground.TGA', bump: 'test_ground_b.TGA', tile: 215 },
  { texture: 'test_dirt.TGA', bump: 'test_dirt_b.TGA', tile: 300 }
];
const CELLS = [
  { layer: 0, shade: 200 },
  { layer: 1, shade: 180 }
];
const TEXTURES = ['test_ground.dds', 'test_ground_b.dds', 'test_dirt.dds', 'test_dirt_b.dds'];
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
const folder = id => path.join(root, id);
const mapPath = (id, name = 'same.ted') => path.join(folder(id), 'Data/Art/Maps', name);
const textures = id => {
  for (const name of TEXTURES) write(path.join(folder(id), 'Data/Art/Textures', name), Buffer.from('bytes-' + id + '-' + name));
};
const items = new Map();
function install(id, maps) {
  items.set(id, { id, folder: folder(id), name: 'Item ' + id });
  textures(id);
  for (const [name, planet] of maps) write(mapPath(id, name), ted({ layers: LAYERS, cells: CELLS, planet }));
}
// One pass over several installed scopes, the way `plan` mounts them.
const lib = () => ({ game: root, items, ambiguous: new Set() });
function plan(cache, looseIndex = null, scopes = ['11', '11,22', '22,11', '22', '44']) {
  const l = lib(),
    out = { reads: 0, surveys: 0, jobs: [], catalogs: [] };
  for (const key of scopes) {
    const s = scope(l, key),
      v = openScope(l, s, looseIndex ? { looseIndex } : null),
      read = v.read.bind(v),
      resolve = resolver(v, cache);
    v.read = k => {
      out.reads++;
      return read(k);
    };
    try {
      const maps = catalog(v, cache);
      out.catalogs.push({ key, maps });
      for (const m of maps.filter(r => r.domain === 'land')) {
        out.surveys++;
        out.jobs.push(survey(v, m, s, resolve, new Map(), cache));
      }
    } finally {
      v.close();
    }
  }
  return out;
}

try {
  install('11', [['same.ted', 'Testworld']]);
  install('22', [['same.ted', 'Testworld'], ['other.ted', 'Otherworld']]);
  // Item 22 ships the same map bytes as item 11 from its own folder.
  write(mapPath('22'), fs.readFileSync(mapPath('11')));

  // A non-square map pads the square backing store; its patch intake must still count only the
  // authored neighbour pairs, which is what the per-slot adjacency tally has to reproduce.
  const WIDE = { width: 4, height: 6 }; // taller than wide: the backing store stride is 6, not 4
  const wideCells = Array.from({ length: WIDE.width * WIDE.height }, (_, i) => ({ layer: i % 3 === 2 ? 1 : 0, shade: 200 }));
  install('44', []);
  write(mapPath('44', 'wide.ted'), ted({ layers: LAYERS, cells: wideCells, ...WIDE }));

  // 1. Same jobs and catalog rows with and without the cache, including a call that omits it.
  const cached = plan(intakeCache()),
    uncached = plan(null);
  assert.equal(cached.jobs.length, 8, 'every land map of every mount is surveyed');
  assert.deepEqual(
    cached.jobs.map(j => j.id),
    uncached.jobs.map(j => j.id),
    'the cache changes no job identity'
  );
  assert.equal(JSON.stringify(cached.catalogs), JSON.stringify(uncached.catalogs), 'the cache changes no catalog row');
  const fresh = lib();
  for (const key of ['11', '22']) {
    const v = openScope(fresh, scope(fresh, key));
    try {
      const m = catalog(v).find(r => r.domain === 'land'),
        legacy = survey(v, m, scope(fresh, key), resolver(v), new Map());
      assert.ok(
        cached.jobs.some(j => j.id === legacy.id),
        'omitting the cache stays supported'
      );
    } finally {
      v.close();
    }
  }

  // 2. One read per installed source, one parse per distinct content, one walk per root.
  const cache = intakeCache(),
    shared = plan(cache);
  assert.equal(cache.files.size, 4, 'four physical map sources');
  assert.equal(cache.textures.size, 12, 'twelve physical texture sources');
  assert.equal(shared.reads, 4 + 12, 'each installed source is read once for the whole pass');
  assert.ok(uncached.reads > shared.reads, `reads drop with the cache (${shared.reads} < ${uncached.reads})`);
  assert.equal(cache.maps.size, 3, 'three distinct map contents parsed');
  assert.equal(cache.headers.size, 4, 'header fields follow the physical source');
  assert.ok(shared.jobs.length > cache.maps.size, 'several mounts reuse one parsed content');

  // 2b. Non-square map: patch intake equals a direct count over the authored grid.
  const wide = shared.jobs.find(j => j.file === 'WIDE.TED');
  assert.ok(wide, 'non-square map planned');
  let wideNeighbors = 0,
    wideBoundaries = 0;
  for (let y = 0; y < WIDE.height; y++)
    for (let x = 0; x < WIDE.width; x++) {
      const a = wideCells[y * WIDE.width + x].layer;
      if (x) {
        wideNeighbors++;
        if (a !== wideCells[y * WIDE.width + x - 1].layer) wideBoundaries++;
      }
      if (y) {
        wideNeighbors++;
        if (a !== wideCells[(y - 1) * WIDE.width + x].layer) wideBoundaries++;
      }
    }
  assert.equal(wide.patchIntake.neighbors, wideNeighbors, 'padding is not counted as a neighbour');
  assert.equal(wide.patchIntake.boundaries, wideBoundaries, 'boundaries only inside the authored grid');
  assert.equal(wide.patchIntake.fraction, wideBoundaries / wideNeighbors);

  // 3. Mount order still changes identity while the cache is warm.
  const pick = (key, file) => shared.jobs.find(j => j.scope.key === key && j.file === file);
  const forward = pick('11,22', 'SAME.TED'),
    backward = pick('22,11', 'SAME.TED');
  assert.equal(forward.identity.ted, backward.identity.ted, 'same map bytes in both orders');
  assert.notEqual(forward.id, backward.id, 'load order is part of identity');
  assert.deepEqual(forward.identity.order, ['11', '22'], 'order recorded highest priority first');
  assert.deepEqual(backward.identity.order, ['22', '11'], 'reversed order recorded as given');

  // 4. Receipts stay complete, and the hash is the bytes actually installed.
  const shipped = new Set([
    sha(fs.readFileSync(mapPath('11'))),
    sha(fs.readFileSync(mapPath('22', 'other.ted'))),
    sha(fs.readFileSync(mapPath('44', 'wide.ted')))
  ]);
  for (const j of shared.jobs) {
    assert.ok(shipped.has(j.identity.ted), 'ted receipt is the installed bytes');
    assert.equal(j.id, fingerprint(j.identity));
    for (const s of j.slots)
      if (s.vertices && !s.hole) {
        assert.match(s.texture.key, /^DATA\\ART\\TEXTURES\\/, 'texture key kept');
        assert.match(s.texture.hash, /^[0-9a-f]{64}$/, 'texture hash kept');
        assert.match(s.bump.hash, /^[0-9a-f]{64}$/, 'bump hash kept');
        assert.equal(s.pair, pairId(s.texture, s.bump));
      }
    assert.ok(j.width > 1 && j.height > 1 && j.surfaceIntake && j.outskirtsIntake && j.patchIntake, 'intake fields kept');
    assert.ok(j.patchIntake.neighbors > 0 && j.patchIntake.boundaries > 0, 'patch intake measured');
  }

  // 5. An edited source is re-read, not reused, while the same cache stays in memory.
  const warm = intakeCache(),
    before = plan(warm),
    edited = ted({ layers: LAYERS, cells: CELLS, planet: 'Westworld' });
  assert.equal(edited.length, fs.statSync(mapPath('11')).size, 'edit keeps the file size');
  write(mapPath('11'), edited);
  const after = plan(warm),
    idsBefore = new Set(before.jobs.map(j => j.id));
  assert.ok(
    after.jobs.some(j => !idsBefore.has(j.id)),
    'an edited map gets a new job id even with a warm cache'
  );
  assert.deepEqual(
    plan(intakeCache()).jobs.map(j => j.id),
    after.jobs.map(j => j.id),
    'replanning the edited tree is stable'
  );
  assert.equal(after.jobs.find(j => j.file === 'SAME.TED').planet, 'Westworld', 'edited header re-read');

  // 6. Rewriting identical bytes (a new date, the same content) keeps identity.
  write(mapPath('11'), edited);
  const touched = plan(intakeCache());
  assert.deepEqual(touched.jobs.map(j => j.id), after.jobs.map(j => j.id), 'content, not the date, decides identity');

  // 7. The shared loose index is a snapshot, and it never replaces a fresh mount.
  install('33', [['one.ted', 'Testworld']]);
  const snapshot = new Map(),
    withIndex = () => {
      const v = openScope(lib(), scope(lib(), '33'), { looseIndex: snapshot });
      try {
        return catalog(v).map(r => r.key);
      } finally {
        v.close();
      }
    },
    withoutIndex = () => {
      const v = openScope(lib(), scope(lib(), '33'));
      try {
        return catalog(v).map(r => r.key);
      } finally {
        v.close();
      }
    };
  const first = withIndex();
  write(mapPath('33', 'two.ted'), ted({ layers: LAYERS, cells: CELLS, planet: 'Second' }));
  assert.deepEqual(withIndex(), first, 'a shared loose index is the snapshot it is documented to be');
  assert.equal(withoutIndex().length, first.length + 1, 'a fresh mount sees the new map');
  console.log('PASS intake cache: identity, read/parse dedupe, content invalidation, order, receipts and snapshot contract');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
