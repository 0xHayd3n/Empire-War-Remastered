// Cook the endor-plants surface set from Poly Haven CC0 sources.
//
//   node tools/endor-plants-assets.mjs            # download (cached) + write PNGs
//   node tools/endor-plants-assets.mjs --verify   # re-read and check shipped PNGs
//
// Sources are cached outside the checkout at $ENDOR_PLANTS_CACHE or
// <tmpdir>/endor-plants-source. No dependencies are installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodePNG } from '../public/js/png.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'art', 'endor-plants');
const CACHE = process.env.ENDOR_PLANTS_CACHE || path.join(os.tmpdir(), 'endor-plants-source');
const atlasSize = 2048;
const cellSize = atlasSize / 2;
const pad = 8;

// Poly Haven publishes each asset under CC0 1.0. These are the 1K PNG maps; the
// md5/size guards make a silent upstream replacement fail loudly.
const SOURCES = [
  {
    id: 'bark',
    name: 'Bark Brown 01',
    author: 'Rob Tuytel',
    page: 'https://polyhaven.com/a/bark_brown_01',
    diffuse: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/bark_brown_01/bark_brown_01_diff_1k.png',
      md5: 'c9dc937d2cb82bc26a3973ddd6148db9',
      size: 2235035
    },
    rough: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/bark_brown_01/bark_brown_01_rough_1k.png',
      md5: '01853f420746ad757a3add59bcd1a9e4', size: 1783164
    },
    normal: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/bark_brown_01/bark_brown_01_nor_gl_1k.png',
      md5: '531b131bcb9f178357fa948bc06fae71',
      size: 2313976
    }
  },
  {
    id: 'fern',
    name: 'Fern 02',
    author: 'Rob Tuytel (scanning), Rico Cilliers (modelling)',
    page: 'https://polyhaven.com/a/fern_02',
    diffuse: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/fern_02/fern_02_diff_1k.png',
      md5: '49925bd8393b4a7c93380ab7474764ab',
      size: 1986120
    },
    alpha: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/fern_02/fern_02_alpha_1k.png',
      md5: '1421e5e36946c23a7ddcc907de89025c',
      size: 114589
    }
  },
  {
    id: 'nettle',
    name: 'Nettle Plant',
    author: 'Rob Tuytel (photography), Rico Cilliers (modelling)',
    page: 'https://polyhaven.com/a/nettle_plant',
    diffuse: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/nettle_plant/nettle_plant_diff_1k.png',
      md5: '89c11e5b4e05cde391bd003941ccdbb8',
      size: 2453311
    },
    alpha: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/nettle_plant/nettle_plant_alpha_1k.png',
      md5: '57a0ce5b6285f558786511ccff178aa1',
      size: 189288
    }
  },
  {
    id: 'grass',
    name: 'Grass Medium 02',
    author: 'Rico Cilliers',
    page: 'https://polyhaven.com/a/grass_medium_02',
    diffuse: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/grass_medium_02/grass_medium_02_diff_1k.png',
      md5: '55bd011f37a44dc227f690360c492100',
      size: 851217
    },
    alpha: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/grass_medium_02/grass_medium_02_alpha_1k.png',
      md5: 'b231cd6a1b5eb7ae21e7c2e626f8318c',
      size: 110617
    }
  },
  {
    id: 'pine',
    name: 'Pine Tree 01 (twig)',
    author: 'Rob Tuytel (photography), Rico Cilliers (modelling)',
    page: 'https://polyhaven.com/a/pine_tree_01',
    diffuse: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/pine_tree_01/pine_tree_01_twig_diff_1k.png',
      md5: 'a4fa4a55aab9231915a4023ea9841577',
      size: 3208228
    },
    alpha: {
      url: 'https://dl.polyhaven.org/file/ph-assets/Models/png/1k/pine_tree_01/pine_tree_01_twig_alpha_1k.png',
      md5: '641911a5a3f543911dad04ebb26e7bca',
      size: 351928
    }
  }
];

const md5 = bytes => crypto.createHash('md5').update(bytes).digest('hex');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function cached(name, src) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    console.log('download', src.url);
    return fetch(src.url, { redirect: 'follow' })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${src.url}`);
        return r.arrayBuffer();
      })
      .then(buf => {
        const bytes = Buffer.from(buf);
        fs.writeFileSync(file + '.part', bytes);
        fs.renameSync(file + '.part', file);
        return bytes;
      });
  }
  return Promise.resolve(fs.readFileSync(file));
}

async function source(name, src) {
  const bytes = await cached(name, src);
  const got = md5(bytes);
  if (got !== src.md5) throw new Error(`${name}: md5 ${got}, expected ${src.md5}`);
  if (bytes.length !== src.size) throw new Error(`${name}: ${bytes.length} bytes, expected ${src.size}`);
  const png = await decodePNG(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  if (!png) throw new Error(`${name}: the project PNG decoder rejected this file`);
  if (png.width !== 1024 || png.height !== 1024) throw new Error(`${name}: expected 1024x1024, got ${png.width}x${png.height}`);
  return png;
}

function blank(w, h, rgba = [0, 0, 0, 0]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data };
}

const at = (img, x, y) => (y * img.width + x) * 4;

function copyCell(out, image, cellX, cellY) {
  // Keep the centre 1008x1008 pixels; the 8px border is an edge-dilated gutter
  // so bilinear filtering and mip reduction cannot sample the next plant.
  const x0 = cellX * cellSize + pad,
    y0 = cellY * cellSize + pad,
    inner = cellSize - pad * 2;
  for (let y = 0; y < inner; y++)
    for (let x = 0; x < inner; x++) {
      const s = at(image, x + pad, y + pad),
        d = ((y0 + y) * out.width + x0 + x) * 4;
      out.data[d] = image.data[s];
      out.data[d + 1] = image.data[s + 1];
      out.data[d + 2] = image.data[s + 2];
      out.data[d + 3] = image.data[s + 3];
    }
  // Replicate the inner edge outward.
  for (let y = 0; y < inner; y++) {
    const sr = at(image, pad, y + pad),
      sl = at(image, pad + inner - 1, y + pad);
    for (let k = 0; k < pad; k++) {
      let d = ((y0 + y) * out.width + x0 - 1 - k) * 4;
      out.data[d] = image.data[sr];
      out.data[d + 1] = image.data[sr + 1];
      out.data[d + 2] = image.data[sr + 2];
      out.data[d + 3] = image.data[sr + 3];
      d = ((y0 + y) * out.width + x0 + inner + k) * 4;
      out.data[d] = image.data[sl];
      out.data[d + 1] = image.data[sl + 1];
      out.data[d + 2] = image.data[sl + 2];
      out.data[d + 3] = image.data[sl + 3];
    }
  }
  for (let x = 0; x < cellSize; x++) {
    const st = at(image, x < pad ? pad : x >= pad + inner ? pad + inner - 1 : x, pad),
      sb = at(image, x < pad ? pad : x >= pad + inner ? pad + inner - 1 : x, pad + inner - 1);
    for (let k = 0; k < pad; k++) {
      let d = ((y0 - 1 - k) * out.width + cellX * cellSize + x) * 4;
      out.data[d] = image.data[st];
      out.data[d + 1] = image.data[st + 1];
      out.data[d + 2] = image.data[st + 2];
      out.data[d + 3] = image.data[st + 3];
      d = ((y0 + inner + k) * out.width + cellX * cellSize + x) * 4;
      out.data[d] = image.data[sb];
      out.data[d + 1] = image.data[sb + 1];
      out.data[d + 2] = image.data[sb + 2];
      out.data[d + 3] = image.data[sb + 3];
    }
  }
}

// RGBA where RGB is the source diffuse and A is the rescued alpha map. The alpha
// maps are 16-bit or 8-bit grayscale; PNG decoding has already normalised them.
function withAlpha(diffuse, alpha) {
  const out = new Uint8Array(diffuse.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = diffuse.data[i];
    out[i + 1] = diffuse.data[i + 1];
    out[i + 2] = diffuse.data[i + 2];
    out[i + 3] = alpha.data[i];
  }
  return { width: diffuse.width, height: diffuse.height, data: out };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])), 8 + body.length);
  return out;
}
function encodePNG(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0, s = 0, d = 0; y < img.height; y++) {
    raw[d++] = 0;
    raw.set(img.data.subarray(s, s + img.width * 4), d);
    s += img.width * 4;
    d += img.width * 4;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function opaque(img) {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = img.data[i];
    out[i + 1] = img.data[i + 1];
    out[i + 2] = img.data[i + 2];
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

function stats(img) {
  let transparent = 0,
    semi = 0,
    alphaSum = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i];
    alphaSum += a;
    if (a < 16) transparent++;
    else if (a < 240) semi++;
  }
  const n = img.data.length / 4;
  return {
    transparent: +(transparent / n).toFixed(4),
    semi: +(semi / n).toFixed(4),
    alphaMean: +(alphaSum / n).toFixed(2)
  };
}

async function cook() {
  const [bark, fern, nettle, grass, pine] = await Promise.all(SOURCES.map(s => source(s.id, s.diffuse)));
  const [fernA, nettleA, grassA, pineA] = await Promise.all([
    source('fern alpha', SOURCES[1].alpha),
    source('nettle alpha', SOURCES[2].alpha),
    source('grass alpha', SOURCES[3].alpha),
    source('pine alpha', SOURCES[4].alpha)
  ]);

  fs.mkdirSync(OUT, { recursive: true });
  const atlas = blank(atlasSize, atlasSize);
  // Cell order is top-left to bottom-right; the mesh builder mirrors it.
  copyCell(atlas, withAlpha(fern, fernA), 0, 0);
  copyCell(atlas, withAlpha(nettle, nettleA), 1, 0);
  copyCell(atlas, withAlpha(grass, grassA), 0, 1);
  copyCell(atlas, withAlpha(pine, pineA), 1, 1);

  const files = [
    ['leaf-atlas.png', atlas],
    ['bark.png', opaque(bark)],
    ['bark-normal.png', withAlpha(await source('bark normal', SOURCES[0].normal), await source('bark rough', SOURCES[0].rough))]
  ];
  for (const [name, img] of files) {
    const png = encodePNG(img);
    fs.writeFileSync(path.join(OUT, name), png);
    console.log(`${name}: ${img.width}x${img.height} ${png.length} B sha256 ${sha256(png)}`);
  }
  console.log('leaf cells: fern(0,0) nettle(1,0) grass(0,1) pine(1,1)');
  console.log('atlas alpha', stats(atlas));
  for (const [n, img] of [
    ['fern', withAlpha(fern, fernA)],
    ['nettle', withAlpha(nettle, nettleA)],
    ['grass', withAlpha(grass, grassA)],
    ['pine', withAlpha(pine, pineA)]
  ])
    console.log(n, stats(img));
}

async function verify() {
  const expected = {
    'leaf-atlas.png': [2048, 2048],
    'bark.png': [1024, 1024],
    'bark-normal.png': [1024, 1024]
  };
  for (const [name, [w, h]] of Object.entries(expected)) {
    const file = path.join(OUT, name);
    const bytes = fs.readFileSync(file);
    const png = await decodePNG(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    if (!png) throw new Error(`${name}: not a PNG the game can decode`);
    if (png.width !== w || png.height !== h) throw new Error(`${name}: ${png.width}x${png.height}`);
    if (name === 'bark-normal.png' && (stats(png).alphaMean < 215 || stats(png).alphaMean > 249))
      throw Error('Missing scanned bark roughness in normal alpha');
    if (name === 'leaf-atlas.png' && stats(png).transparent < 0.4)
      throw new Error('leaf atlas lost its alpha cutout');
    console.log(`${name}: ${w}x${h} ${bytes.length} B sha256 ${sha256(bytes)} alpha ${JSON.stringify(stats(png))}`);
  }
  const rawAtlas = fs.readFileSync(path.join(OUT, 'leaf-atlas.png'));
  const atlas = await decodePNG(rawAtlas.buffer.slice(rawAtlas.byteOffset, rawAtlas.byteOffset + rawAtlas.length));
  // Every cell must retain a substantial cutout and a non-zero leaf area.
  for (const [cx, cy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ]) {
    let opaque = 0,
      clear = 0;
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 1024; x++) {
        const a = atlas.data[((cy * 1024 + y) * 2048 + cx * 1024 + x) * 4 + 3];
        if (a > 32) opaque++;
        else if (a < 16) clear++;
      }
    if (opaque < 20_000) throw new Error(`cell ${cx},${cy}: too little visible plant`);
    if (clear < 20_000) throw new Error(`cell ${cx},${cy}: no clear cutout`);
  }
  console.log('PASS: 2x2 leaf atlas with four rescued cutouts, bark albedo + OpenGL normal');
}

if (process.argv.includes('--verify')) {
  await verify();
} else {
  await cook();
}
