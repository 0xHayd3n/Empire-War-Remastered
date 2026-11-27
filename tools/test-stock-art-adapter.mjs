import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bindingID, preflight, readAdapter } from './stock-art-adapter.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-adapter-')),
  adapter = path.join(dir, 'references'),
  parent = path.join(dir, 'required');
const model = 'Data/Art/Models/Test.ALO',
  texture = 'Data/Art/Textures/Test.DDS',
  bytes = Buffer.from('Original preflight fixture; not game art'),
  sha256 = createHash('sha256').update(bytes).digest('hex');
const row = {
  edition: 'foc',
  target: 'RV_XWING.ALO',
  workshop: '42',
  model,
  files: [
    { path: model, sha256 },
    { path: texture, sha256 }
  ]
};
const library = { items: new Map([['42', { folder: parent }]]), ambiguous: new Set() },
  review = new Map([
    [bindingID(row), { credit: 'Test author', terms: 'Self-authored fixture only', compatibility: 'Preflight test only' }]
  ]);
try {
  fs.mkdirSync(adapter);
  const write = bindings =>
    fs.writeFileSync(path.join(adapter, 'adapter.json'), JSON.stringify({ format: 'stock-art-references/1', bindings }));
  write([row]);
  assert.deepEqual(readAdapter(adapter), [row]);
  for (const key of [model, texture]) {
    const file = path.join(parent, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  assert.equal(
    preflight(row, {
      get items() {
        throw Error('Should not inspect installation before review');
      }
    }).status,
    'stock'
  );
  assert.equal(preflight(row, library, review).status, 'eligible');
  assert.deepEqual(fs.readFileSync(path.join(parent, model)), bytes);
  assert.equal(preflight({ ...row, edition: 'eaw' }, library, review).status, 'stock');
  assert.equal(preflight({ ...row, workshop: '43' }, library, review).status, 'stock');
  assert.equal(preflight(row, { ...library, ambiguous: new Set(['42']) }, review).status, 'stock');
  assert.equal(preflight(row, { items: new Map() }, review).status, 'stock');
  fs.writeFileSync(path.join(parent, texture), 'changed');
  assert.match(preflight(row, library, review).reason, /changed/);
  fs.unlinkSync(path.join(parent, texture));
  assert.match(preflight(row, library, review).reason, /missing/);
  for (const bindings of [
    [{ ...row, allowed: true }],
    [row, row],
    [{ ...row, files: [...row.files, { path: 'Data/XML/Units.xml', sha256 }] }],
    [{ ...row, files: [...row.files, { path: 'Data/Art/Textures/../x.dds', sha256 }] }]
  ]) {
    write(bindings);
    assert.throws(() => readAdapter(adapter));
  }
  write([]);
  fs.writeFileSync(path.join(adapter, 'copied.dds'), bytes);
  assert.throws(() => readAdapter(adapter), /only adapter.json/);
  console.log(
    'PASS: metadata-only distributable, independent review, edition/parent pins, changed or missing dependency, no asset export.'
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
