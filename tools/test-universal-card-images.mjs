import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { swtorLogo } from './universal-era-logo.mjs';
import { commandImages } from './universal-card-images.mjs';
import { decodePNG } from '../public/js/png.js';
const dir = 'Data/Art/Textures/',
  files = new Map(),
  mtd = Buffer.alloc(4 + 2 * 81);
mtd.writeUInt32LE(2);
for (const [i, name] of ['Hero.TGA', 'Overhang.tga'].entries()) {
  const off = 4 + i * 81;
  mtd.write(name, off);
  mtd.writeUInt32LE(1 + i, off + 64);
  mtd.writeUInt32LE(1, off + 72);
  mtd.writeUInt32LE(1, off + 76);
}
const tga = Buffer.alloc(18 + 8);
tga[2] = 2;
tga.writeUInt16LE(2, 12);
tga.writeUInt16LE(1, 14);
tga[16] = 32;
tga[17] = 32;
tga.set([0, 2, 4, 255, 3, 5, 7, 170], 18);
files.set('mt_commandbar.mtd', mtd);
files.set('mt_commandbar.tga', tga);
files.set('crest.tga', tga);
const archive = {
  index: new Map([...files].map(([k, v]) => [k, { size: v.length }])),
  read: k => files.get(k),
  resolve: p => p.slice(dir.length).toLowerCase()
};
const image = commandImages(archive);
async function verify(name, w, pixels) {
  const uri = image(name);
  assert(uri.startsWith('data:image/png;base64,'));
  const b = Uint8Array.from(Buffer.from(uri.split(',')[1], 'base64')),
    png = await decodePNG(b.buffer);
  assert.equal(png.width, w);
  assert.equal(png.height, 1);
  assert.deepEqual([...png.data], pixels);
}
await verify('hero.tga', 1, [7, 5, 3, 170]);
await verify('crest.tga', 2, [4, 2, 0, 255, 7, 5, 3, 170]);
assert.equal(image('Overhang.tga'), '');
assert.equal(image('missing.tga'), '');
assert.equal(image('../unrelated.tga'), '');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-test-logo-'));
try {
  assert.equal(await swtorLogo([root]), '');
  const folder = path.join(root, 'appcache', 'librarycache', '1286830');
  fs.mkdirSync(folder, { recursive: true });
  const logo = path.join(folder, 'logo.png');
  fs.writeFileSync(logo, Buffer.from(image('crest.tga').split(',')[1], 'base64'));
  assert.equal(await swtorLogo([root]), image('crest.tga'));
  fs.writeFileSync(logo, 'bad');
  assert.equal(await swtorLogo([root]), '');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('PASS: exact local command-bar crop, optional local Steam logo, out-of-bounds and missing-art fallback.');
