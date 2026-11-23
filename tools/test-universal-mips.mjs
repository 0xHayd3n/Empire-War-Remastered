// No game data needed. Add --installed for a read-only sample of local Steam primaries.
import assert from 'node:assert/strict';
import { decodeDXT } from '../public/js/ddsdecode.js';
import { buildMips, encodeDXT } from '../public/js/ddsmips.js';

// Reference path: expand the entire source, average 2 x 2 RGBA, then use the unchanged encoder.
function reference(src, w, h, kind) {
  let pixels = decodeDXT(src, w, h, kind);
  const chain = [];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1),
      nh = Math.max(1, h >> 1),
      next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let j = 0; j < 2; j++)
            for (let i = 0; i < 2; i++) {
              sum += pixels[(Math.min(y * 2 + j, h - 1) * w + Math.min(x * 2 + i, w - 1)) * 4 + c];
            }
          next[(y * nw + x) * 4 + c] = (sum + 2) >> 2;
        }
    chain.push({ data: encodeDXT(next, nw, nh, kind), width: nw, height: nh });
    [pixels, w, h] = [next, nw, nh];
  }
  return chain;
}

function compare(src, w, h, kind) {
  const actual = buildMips(src, w, h, kind),
    expected = reference(src, w, h, kind);
  assert.equal(actual.length, expected.length);
  for (const [i, m] of actual.entries()) {
    const e = expected[i];
    assert.ok(m.width === e.width && m.height === e.height && Buffer.from(m.data).equals(e.data), `DXT${kind} ${w}x${h} mip ${i + 1}`);
  }
}

const sizes = [
  [1, 1],
  [1, 33],
  [32, 1],
  [3, 2],
  [7, 7],
  [8, 15],
  [16, 16],
  [8, 17],
  [19, 18],
  [20, 31],
  [64, 32],
  [47, 65],
  [256, 512]
];
for (const kind of [1, 3, 5])
  for (const [w, h] of sizes) {
    // Nonzero view offset, nonuniform colours/alpha and partial blocks across strip boundaries.
    const bytes = new Uint8Array(11 + Math.ceil(w / 4) * Math.ceil(h / 4) * (kind === 1 ? 8 : 16)).subarray(11);
    let seed = kind + w * h;
    for (let i = 0; i < bytes.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes[i] = seed >>> 24;
    }
    compare(bytes, w, h, kind);
  }
console.log(`PASS: ${sizes.length * 3} synthetic DXT chains, exact dimensions and encoded bytes at every level.`);

if (process.argv.includes('--installed')) {
  const { openGame } = await import('./megfs.mjs');
  const { readLibrary } = await import('./workshop-library.mjs');
  const path = await import('node:path');
  const lib = readLibrary();
  if (!lib.game) throw Error('Install Gold Pack or set SWR_GAME to its root. Omit --installed for synthetic tests.');
  const primaries = [...new Set(lib.cards.filter(c => c.saved).map(c => c.primary))];
  const mounts = [
    { name: 'Stock EaW', expansion: false },
    { name: 'Stock FoC', expansion: true },
    ...primaries.map(id => ({ name: `Workshop ${id}`, dir: lib.items.get(id)?.folder, expansion: true, mod: true }))
  ];
  for (const { name, dir, expansion, mod } of mounts) {
    if (mod && !dir) {
      console.log(`${name}: NOT TESTED (not installed)`);
      continue;
    }
    const game = openGame(lib.game, dir ? [dir] : [], { expansion });
    try {
      const keys = [...game.index]
        .filter(([k, entry]) => {
          if (!k.startsWith('DATA\\ART\\TEXTURES\\') || !k.endsWith('.DDS')) return false;
          if (!dir) return true;
          const rel = path.relative(dir, entry.meg || entry.file);
          return !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
        })
        .map(([k]) => k)
        .sort();
      const n = Math.min(96, keys.length),
        samples = [];
      let eligible = 0;
      for (let i = 0; i < n; i++) {
        const key = keys[Math.floor((i * keys.length) / n)],
          header = game.readPart(key, 0, 128);
        if (header.length < 128 || header.toString('ascii', 0, 4) !== 'DDS ' || !(header.readUInt32LE(80) & 4)) continue;
        const fourCC = header.toString('ascii', 84, 88),
          w = header.readUInt32LE(16),
          h = header.readUInt32LE(12);
        if (
          !/^DXT[135]$/.test(fourCC) ||
          header.readUInt32LE(112) & 512 ||
          (header.readUInt32LE(8) & 0x20000 && header.readUInt32LE(28) > 1)
        )
          continue;
        // Count a conservative subset of the renderer's fullChain route (PoT only).
        if (w < 4 || h < 4 || w & (w - 1) || h & (h - 1)) continue;
        eligible++;
        if (w <= 2048 && h <= 2048) samples.push({ key, w, h, kind: Number(fourCC.at(-1)) });
      }
      // Choose one deterministic example near 1 megapixel; do not copy assets or print their names.
      samples.sort((a, b) => Math.abs(a.w * a.h - 1024 ** 2) - Math.abs(b.w * b.h - 1024 ** 2));
      if (!samples.length) {
        console.log(`${name}: ${eligible}/${n} eligible; no bounded sample to decode`);
        continue;
      }
      const { key, w, h, kind } = samples[0];
      const size = Math.ceil(w / 4) * Math.ceil(h / 4) * (kind === 1 ? 8 : 16),
        data = game.readPart(key, 128, size);
      assert.equal(data.length, size);
      compare(data, w, h, kind);
      console.log(`${name}: ${eligible}/${n} eligible headers; PASS DXT${kind} ${w}x${h} real texture, every generated mip identical.`);
    } finally {
      game.close();
    }
  }
}
