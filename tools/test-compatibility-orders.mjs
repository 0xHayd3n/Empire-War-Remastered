import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sourceOracle } from './compatibility-orders.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-order-'));
try {
  const items = new Map();
  for (const [id, files] of [
    ['1', { 'GameConstants.xml': 'parent', 'patch.xml': 'lower', 'keep.xml': 'a' }],
    ['2', { 'patch.xml': '', 'keep.xml': 'b' }]
  ]) {
    const folder = path.join(root, id),
      dir = path.join(folder, 'Data', 'XML');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    items.set(id, { folder });
  }
  const inspect = sourceOracle({ game: null, items });
  const hi = inspect(['2', '1']),
    lo = inspect(['1', '2']);
  assert.equal(hi.sharedModPaths, 2);
  assert.equal(hi.effectivePaths['2'], 2); // a winning zero-byte mask still changes resolution
  assert.equal(hi.shadowed.length, 0);
  assert(hi.probes.some(p => p.winner === '2' && p.over === '1'));
  assert.equal(lo.effectivePaths['2'], 0);
  assert.deepEqual(
    lo.shadowed.map(x => [x.id, x.winner, x.paths, x.sameBytes]),
    [['2', '1', 2, false]]
  );
  for (const [order, winning] of [
    [hi, '2'],
    [lo, '1']
  ]) {
    for (const p of order.probes) {
      const name = path.basename(p.path).toLowerCase();
      const expected =
        name === 'gameconstants.xml' ? 'parent' : name === 'keep.xml' ? (winning === '2' ? 'b' : 'a') : winning === '2' ? '' : 'lower';
      assert.equal(p.sha256, expected ? createHash('sha256').update(expected).digest('hex') : null);
    }
  }
  console.log('PASS: first item wins, masks count, reverse order changes bytes, fully overridden layer is reported.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
