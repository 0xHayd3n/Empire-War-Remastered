#!/usr/bin/env node
// Cooks the seven CC0 Poly Haven ground families used by the Endor terrain experiment into
// packed BC3/DXT5 DDS pairs at 2048x2048 with full mip chains:
//
//   <id>-color.dds    RGB = albedo (stored sRGB), A = normalised height (linear, 0 = deepest)
//   <id>-surface.dds  RGB = tangent normal (from nor_gl, G flipped for top-down DDS rows),
//                     A = roughness (linear)
//
// Every source is a first-party Poly Haven 2k PNG (diffuse / nor_gl / rough / disp). They are
// fetched one family at a time into the system temp dir and deleted the moment they are
// decoded, so the repo only ever holds the cooked DDS files, materials.json and SOURCES.md.
// No tinting, no upscaling, no stock art: albedo is the scan's own colour.
//
//   node tools/cook-endor-terrain.mjs            # download if missing, cook, verify, write manifest
//   node tools/cook-endor-terrain.mjs --verify   # same, plus a full mip-by-mip decode report
//   node tools/cook-endor-terrain.mjs --keep     # keep the downloaded PNGs in the temp cache
//
// The cook is offline-repeatable: every source is pinned by md5 (Poly Haven's own hash) and
// sha256, so a re-run either reproduces the same inputs or fails loudly.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { decodeDXT } from '../public/js/ddsdecode.js';
import { encodeDXT } from '../public/js/ddsmips.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public/art/endor-terrain');
const CACHE = process.env.ENDOR_TERRAIN_CACHE || path.join(os.tmpdir(), 'endor-terrain-source');
const SIZE = 2048;
const MIPS = 12; // 2048 ... 1
const BASE = 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/';

// Order is the contract: grass, moss, litter, soil, mud, rock, sand.
// tileMeters is the physical size Poly Haven states for the scan (metres), so a tile at 1.0 UV
// repeat covers exactly the ground the photographer captured.
const FAMILIES = [
  {
    id: 'grass',
    asset: 'leafy_grass',
    name: 'Leafy Grass',
    author: 'Charlotte Baglioni',
    tileMeters: 2,
    sources: {
      diffuse: { file: 'leafy_grass_diff_2k.png', md5: '91c82271318a5bbe69182404c6dff730', sha256: '9ae7994a36a7aedf5fe65dac49d5e096e9a8ff1d8a8e8ccb28df0c9c3a7a2d34' },
      nor_gl: { file: 'leafy_grass_nor_gl_2k.png', md5: '99b68312712462595976eb2baef58c6b', sha256: '476a34f2f60186f51644c3b9560d7659531a033f993b01f274f939e447f3de25' },
      rough: { file: 'leafy_grass_rough_2k.png', md5: 'fbdf75ebded5133626f67a30277a3efd', sha256: '71d2c187fd8cb7182c8877710431af23257904fb167c38218ed0abf21c2e73b6' },
      disp: { file: 'leafy_grass_disp_2k.png', md5: '540555d31b8bf2d674b818a7e2e61125', sha256: '506ed7d425d9a73f6881e17f03e2a0d2fa57893bb0555a4b86ad905d2cabe510' },
    },
  },
  {
    id: 'moss',
    asset: 'forest_leaves_02',
    name: 'Forest Leaves 02 (mossy forest floor)',
    author: 'Rob Tuytel',
    tileMeters: 3,
    sources: {
      diffuse: { file: 'forest_leaves_02_diffuse_2k.png', md5: '142798abe47028a0c7c8ed35ae53140d', sha256: '5f572a23d6e4a7c7ea132272945f7dabb301101641083f9f490e89b1f65be4e7' },
      nor_gl: { file: 'forest_leaves_02_nor_gl_2k.png', md5: 'cce2a8fd9454483a17f65b3cfc832725', sha256: 'b352e89611239796aa307afd3d34a83aca77b8e2a98244e3458ec3fa5b635af2' },
      rough: { file: 'forest_leaves_02_rough_2k.png', md5: 'b54fead1218286015ac1f770c09efd22', sha256: '88d0ae62b0ee124a183fcefece544f021125da709ead233717326bcb0d4baebd' },
      disp: { file: 'forest_leaves_02_disp_2k.png', md5: 'f208c441c521b69c87d661c19dcfb578', sha256: '97a110abde191c2cf1dd30cf93c169c9e4395792568a4a7dd3757571f5a704bd' },
    },
  },
  {
    id: 'litter',
    asset: 'forest_leaves_04',
    name: 'Forest Leaves 04',
    author: 'Rob Tuytel',
    tileMeters: 1.5,
    sources: {
      diffuse: { file: 'forest_leaves_04_diff_2k.png', md5: '8e8bb44c218cf80224c90fd19eb21e12', sha256: '9ecd60bb97fa26139de6729b4baa817672acdee34f1853618c8930dde7833da7' },
      nor_gl: { file: 'forest_leaves_04_nor_gl_2k.png', md5: 'b218e95118db6c855144da3702653032', sha256: '4bdcfe8df17aba2bca329cb2d785a7ee36f0aa7bebbbd29f29ebfdc36a47c093' },
      rough: { file: 'forest_leaves_04_rough_2k.png', md5: '86ce81fd592f04291f61ee29d8de73c6', sha256: '9c38cdaa2f8cb926773ac4c2e306e14351373a8e4b551caf116c996ca5d4397e' },
      disp: { file: 'forest_leaves_04_disp_2k.png', md5: '4d36f558b5fcdc64e488b558ffc38309', sha256: 'c12974df23b6437bad50640e094f0b490e7528de9b77a8fefc0f50f24e46ecf6' },
    },
  },
  {
    id: 'soil',
    asset: 'dirt_floor',
    name: 'Dirt Floor',
    author: 'eye-candy.xyz',
    tileMeters: 2.1,
    sources: {
      diffuse: { file: 'dirt_floor_diff_2k.png', md5: '5e18a380887dbd15bd5ab2d7217fa44b', sha256: '850e0d11ba5d5a75382b63dc9dbbacc098be51a89f704c260df8cdf7539e4697' },
      nor_gl: { file: 'dirt_floor_nor_gl_2k.png', md5: 'dee71ffbf1075a9194043ef57b463e3d', sha256: '6bfd01a27abbab03c65afe55ca5ceaac78e94d052d8806549a35a17cb4541d72' },
      rough: { file: 'dirt_floor_rough_2k.png', md5: 'a0c4ff6765fbf38ad53e640ffa63683c', sha256: '164e8d7ad5219f613e2d93445c374dd2505836960b27d4b6ae1de873bb18b4c6' },
      disp: { file: 'dirt_floor_disp_2k.png', md5: '33bafd3095b4f8c7b1234d492d9a32d0', sha256: '5896ea2600f95469a83dc4d9efd6a46c41b14ff06a1ab06fdcfb8fc570445ed5' },
    },
  },
  {
    id: 'mud',
    asset: 'brown_mud_02',
    name: 'Brown Mud 02',
    author: 'Rob Tuytel',
    tileMeters: 1.3,
    sources: {
      diffuse: { file: 'brown_mud_02_diff_2k.png', md5: 'ef770d3bdde5f6356d2bb71f7f52fef7', sha256: 'a00bad20b2c339bd3d2837b8ae80903c4646876bb4ec0cc960846a97b2d3d737' },
      nor_gl: { file: 'brown_mud_02_nor_gl_2k.png', md5: '04c379fb559dc3920f0ecfa6ce1f3a2c', sha256: '78e01270b222a96cc1433c8d4ba2b6fbbe24b296934b45d1ff6aa30cad647888' },
      rough: { file: 'brown_mud_02_rough_2k.png', md5: 'e53629b9f9c912af86524fe20fc0c35a', sha256: 'c2c7835ff92171d9141dd7a1884dbf3a00b5d989fe8ae05737ac6d5397c12572' },
      disp: { file: 'brown_mud_02_disp_2k.png', md5: '424a01299369299091f1b8193191e58a', sha256: 'c4eae3aba4cb23e967eb3b2c3cbf4cd6dd82830906233dc76c4048884c5fd2d7' },
    },
  },
  {
    id: 'rock',
    asset: 'mossy_rock',
    name: 'Mossy Rock',
    author: 'Rob Tuytel',
    tileMeters: 3,
    sources: {
      diffuse: { file: 'mossy_rock_diff_2k.png', md5: '8df6ca9f9ca64ab7279c52618a5ebc04', sha256: '7a5cf7886fb46f71ff76d822939b0eb4169f7d29ef504918fe7526f948511302' },
      nor_gl: { file: 'mossy_rock_nor_gl_2k.png', md5: 'b5385cc9f6239f4720a43e0acbed6015', sha256: 'b72a20fb7101bd962150c1061cd1d798c2b2d77815092543593eb23d3f0f1735' },
      rough: { file: 'mossy_rock_rough_2k.png', md5: '97add42f4d4314103082668313420a1f', sha256: '4a47fba6710e48e7ef2cfac2dd32e2e900e5d4bdf0c2b372b3d5d599831681c6' },
      disp: { file: 'mossy_rock_disp_2k.png', md5: '2ec6243afcf5345fd329ee7b3535fd1d', sha256: '3ee19ec26fa8ecf27b1fc961902e0656321d37f3d66a5c4fd809303db858ff7c' },
    },
  },
  {
    id: 'sand',
    asset: 'sand_01',
    name: 'Sand 01',
    author: 'Rob Tuytel',
    tileMeters: 1.5,
    sources: {
      diffuse: { file: 'sand_01_diff_2k.png', md5: '80513d13769f0e50120c3deb07dd5ee4', sha256: '03c77ce8780bb2265b27d266d8c613a8b91767bf27cbabc43412a7a9f516d5a3' },
      nor_gl: { file: 'sand_01_nor_gl_2k.png', md5: 'b58a19090377dacf161a1c6b6dfc07d5', sha256: 'fc1d2f1af4c6166cbc0dc696999f7a92a207b8fbd22208fa384a6c03299b942f' },
      rough: { file: 'sand_01_rough_2k.png', md5: 'f1fbebee2f060ff63ad170a227c10442', sha256: '63f33004d2f0f411297d1b79af04dec537624726c53a4264ae2cd0db13f10225' },
      disp: { file: 'sand_01_disp_2k.png', md5: 'b3405a4242951301a76de11359ea4f79', sha256: '3a2cfb70b8e688f4b9d09b08684e94e4dfb5ad934d042c8d71879b8b612f3b7a' },
    },
  },
];

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const byte = v => Math.max(0, Math.min(255, Math.round(v)));
const hashOf = (algo, buf) => createHash(algo).update(buf).digest('hex');

// PNG: non-interlaced 8/16-bit RGB / RGBA / grey, which is what Poly Haven ships at 2k.
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8,
    width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0,
    interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos),
      type = buf.toString('latin1', pos + 4, pos + 8),
      body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error('interlaced PNG unsupported');
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels || (bitDepth !== 8 && bitDepth !== 16)) throw new Error(`unsupported PNG ${colorType}/${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)),
    bpp = (bitDepth / 8) * channels,
    stride = width * bpp,
    out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride),
      cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0,
        b = prev[x],
        c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return { width, height, bitDepth, channels, data: out };
}

const at = (png, i, c) =>
  png.bitDepth === 16 ? png.data.readUInt16BE((i * png.channels + c) * 2) / 65535 : png.data[i * png.channels + c] / 255;

const planes = n => ({
  r: new Float32Array(n),
  g: new Float32Array(n),
  b: new Float32Array(n),
  a: new Float32Array(n),
});

function makeMip(p, nw, nh) {
  const w = nw * 2,
    q = planes(nw * nh);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const x0 = x * 2,
        x1 = x0 + 1,
        y0 = y * 2,
        y1 = y0 + 1;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (const yy of [y0, y1])
        for (const xx of [x0, x1]) {
          const i = yy * w + xx;
          r += p.r[i];
          g += p.g[i];
          b += p.b[i];
          a += p.a[i];
        }
      const o = y * nw + x;
      q.r[o] = r / 4;
      q.g[o] = g / 4;
      q.b[o] = b / 4;
      q.a[o] = a / 4;
    }
  return q;
}

function toBytes(p, n, kind) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (kind === 'color') {
      // albedo is stored sRGB; filtering above happened in linear light
      out[i * 4] = byte(linearToSrgb(Math.min(1, p.r[i])) * 255);
      out[i * 4 + 1] = byte(linearToSrgb(Math.min(1, p.g[i])) * 255);
      out[i * 4 + 2] = byte(linearToSrgb(Math.min(1, p.b[i])) * 255);
      out[i * 4 + 3] = byte(Math.min(1, Math.max(0, p.a[i])) * 255);
    } else {
      const len = Math.hypot(p.r[i], p.g[i], p.b[i]) || 1;
      out[i * 4] = byte((p.r[i] / len) * 0.5 * 255 + 127.5);
      out[i * 4 + 1] = byte((p.g[i] / len) * 0.5 * 255 + 127.5);
      out[i * 4 + 2] = byte((p.b[i] / len) * 0.5 * 255 + 127.5);
      out[i * 4 + 3] = byte(Math.max(0, Math.min(1, p.a[i])) * 255);
    }
  }
  return out;
}

function ddsHeader(width, height, mips) {
  const h = Buffer.alloc(128);
  h.write('DDS ', 0, 'latin1');
  h.writeUInt32LE(124, 4); // dwSize
  h.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, 8); // caps|height|width|pixelformat|mipcount|linearsize
  h.writeUInt32LE(height, 12);
  h.writeUInt32LE(width, 16);
  h.writeUInt32LE((Math.ceil(width / 4) * Math.ceil(height / 4) * 16) | 0, 20);
  h.writeUInt32LE(mips, 28);
  h.writeUInt32LE(32, 76); // DDS_PIXELFORMAT.dwSize
  h.writeUInt32LE(0x4, 80); // DDPF_FOURCC
  h.write('DXT5', 84, 'latin1');
  h.writeUInt32LE(0x1000 | 0x8 | 0x400000, 108); // texture|complex|mipmap
  return h;
}

function encodeChain(p, kind) {
  const levels = [];
  let w = SIZE,
    h = SIZE,
    cur = p;
  for (let m = 0; m < MIPS; m++) {
    levels.push({ width: w, height: h, data: encodeDXT(toBytes(cur, w * h, kind), w, h, 5) });
    if (w === 1 && h === 1) break;
    const nw = Math.max(1, w >> 1),
      nh = Math.max(1, h >> 1);
    cur = makeMip(cur, nw, nh);
    w = nw;
    h = nh;
  }
  if (levels.length !== MIPS) throw new Error(`expected ${MIPS} mips, got ${levels.length}`);
  return levels;
}

function writeDds(pathname, levels) {
  const body = Buffer.concat(levels.map(l => Buffer.from(l.data)));
  const head = ddsHeader(levels[0].width, levels[0].height, levels.length);
  const buf = Buffer.concat([head, body]);
  writeFileSync(pathname, buf);
  return buf;
}

function channelStats(bytes, n) {
  const per = [];
  for (let c = 0; c < 4; c++) {
    let lo = 255,
      hi = 0,
      sum = 0;
    for (let i = c; i < n * 4; i += 4) {
      const v = bytes[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
    }
    per.push({ min: lo, max: hi, mean: +(sum / n).toFixed(2) });
  }
  return per;
}

async function fetchSource(family, key) {
  const src = family.sources[key],
    url = `${BASE}${family.asset}/${src.file}`,
    dest = path.join(CACHE, src.file);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (existsSync(dest)) {
      const buf = readFileSync(dest),
        md5 = hashOf('md5', buf),
        sha = hashOf('sha256', buf);
      if (md5 === src.md5 && (!src.sha256 || sha === src.sha256)) return { dest, bytes: buf.length, md5, sha256: sha };
      console.warn(`  stale ${src.file} (md5 ${md5}), refetching`);
      rmSync(dest);
    }
    mkdirSync(CACHE, { recursive: true });
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer()),
        md5 = hashOf('md5', buf),
        sha = hashOf('sha256', buf);
      if (md5 !== src.md5) throw new Error(`md5 ${md5} != pinned ${src.md5}`);
      if (src.sha256 && sha !== src.sha256) throw new Error(`sha256 ${sha} != pinned ${src.sha256}`);
      writeFileSync(dest, buf);
      return { dest, bytes: buf.length, md5, sha256: sha, downloaded: true };
    } catch (e) {
      lastErr = e;
      console.warn(`  ${src.file}: ${e.message}${attempt < 2 ? ', retrying' : ''}`);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`${family.id}/${key}: ${lastErr.message} (${url})`);
}

function decodeSource(info, label) {
  const png = decodePNG(readFileSync(info.dest));
  if (png.width !== SIZE || png.height !== SIZE) throw new Error(`${label}: ${png.width}x${png.height}, expected ${SIZE}x${SIZE}`);
  return png;
}

async function cookFamily(family) {
  const n = SIZE * SIZE,
    color = planes(n),
    surface = planes(n),
    manifest = { source: {} };

  // 1. albedo -> sRGB-decoded linear RGB
  let src = await fetchSource(family, 'diffuse');
  manifest.source.diffuse = { file: src.dest.split(/[\\/]/).pop(), bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  let png = decodeSource(src, `${family.id}/diffuse`);
  for (let i = 0; i < n; i++) {
    color.r[i] = srgbToLinear(at(png, i, 0));
    color.g[i] = srgbToLinear(at(png, i, png.channels >= 3 ? 1 : 0));
    color.b[i] = srgbToLinear(at(png, i, png.channels >= 3 ? 2 : 0));
  }
  png = null;

  // 2. displacement -> alpha height, normalised over the tile's own range
  src = await fetchSource(family, 'disp');
  manifest.source.disp = { file: src.dest.split(/[\\/]/).pop(), bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  const disp = decodeSource(src, `${family.id}/disp`);
  let hMin = 1,
    hMax = 0;
  for (let i = 0; i < n; i++) {
    const v = at(disp, i, 0);
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  const hSpan = hMax - hMin || 1;
  for (let i = 0; i < n; i++) color.a[i] = (at(disp, i, 0) - hMin) / hSpan;
  manifest.height = { min: +hMin.toFixed(5), max: +hMax.toFixed(5), span: +hSpan.toFixed(5) };

  // 3. nor_gl -> tangent normal, G flipped so the stored rows match a top-down DDS
  src = await fetchSource(family, 'nor_gl');
  manifest.source.nor_gl = { file: src.dest.split(/[\\/]/).pop(), bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  png = decodeSource(src, `${family.id}/nor_gl`);
  let mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const nx = at(png, i, 0) * 2 - 1,
      ny = -(at(png, i, 1) * 2 - 1),
      nz = at(png, i, 2) * 2 - 1,
      len = Math.hypot(nx, ny, nz) || 1;
    surface.r[i] = nx / len;
    surface.g[i] = ny / len;
    surface.b[i] = nz / len;
    mean[0] += nx / len;
    mean[1] += ny / len;
    mean[2] += nz / len;
  }
  manifest.normalMean = mean.map(v => +(v / n).toFixed(5));
  png = null;

  // 4. roughness -> alpha
  src = await fetchSource(family, 'rough');
  manifest.source.rough = { file: src.dest.split(/[\\/]/).pop(), bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  png = decodeSource(src, `${family.id}/rough`);
  for (let i = 0; i < n; i++) surface.a[i] = at(png, i, 0);
  png = null;

  const colorTop = toBytes(color, n, 'color'),
    surfaceTop = toBytes(surface, n, 'normal');

  mkdirSync(OUT_DIR, { recursive: true });
  const colorPath = path.join(OUT_DIR, `${family.id}-color.dds`),
    surfacePath = path.join(OUT_DIR, `${family.id}-surface.dds`);
  const colorBuf = writeDds(colorPath, encodeChain(color, 'color')),
    surfaceBuf = writeDds(surfacePath, encodeChain(surface, 'normal'));

  manifest.color = {
    file: `${family.id}-color.dds`,
    bytes: colorBuf.length,
    sha256: hashOf('sha256', colorBuf),
    top: channelStats(colorTop, n),
    encode: topLevelError(colorBuf, colorTop, n),
  };
  manifest.surface = {
    file: `${family.id}-surface.dds`,
    bytes: surfaceBuf.length,
    sha256: hashOf('sha256', surfaceBuf),
    top: channelStats(surfaceTop, n),
    encode: topLevelError(surfaceBuf, surfaceTop, n),
  };
  return manifest;
}

function verifyFile(pathname, mips) {
  const buf = readFileSync(pathname);
  if (buf.readUInt32LE(0) !== 0x20534444) throw new Error(`${pathname}: missing DDS magic`);
  if (buf.toString('latin1', 84, 88) !== 'DXT5') throw new Error(`${pathname}: not DXT5`);
  if (buf.readUInt32LE(16) !== SIZE || buf.readUInt32LE(12) !== SIZE) throw new Error(`${pathname}: not ${SIZE}²`);
  if (buf.readUInt32LE(28) !== mips.length) throw new Error(`${pathname}: mip count mismatch`);
  let off = 128,
    mipSizes = [];
  for (let m = 0; m < mips.length; m++) {
    const l = mips[m],
      size = Math.ceil(l.width / 4) * Math.ceil(l.height / 4) * 16;
    if (off + size > buf.length) throw new Error(`${pathname}: truncated at mip ${m}`);
    const px = decodeDXT(buf.subarray(off, off + size), l.width, l.height, 5);
    if (px.length !== l.width * l.height * 4) throw new Error(`${pathname}: mip ${m} decodes to ${px.length} bytes`);
    mipSizes.push(size);
    off += size;
  }
  if (off !== buf.length) throw new Error(`${pathname}: ${buf.length - off} trailing bytes`);
  return mipSizes;
}

// Re-encode check: decode the top level of a cooked file and compare with the intended bytes.
function topLevelError(buf, want, n) {
  const dec = decodeDXT(buf.subarray(128, 128 + Math.ceil(SIZE / 4) ** 2 * 16), SIZE, SIZE, 5);
  let sum = 0,
    worst = 0;
  for (let i = 0; i < n * 4; i++) {
    const e = Math.abs(dec[i] - want[i]);
    sum += e;
    if (e > worst) worst = e;
  }
  return { meanAbsError: +(sum / (n * 4)).toFixed(2), maxAbsError: worst };
}

const info = m => m.top.map(c => `[${c.min},${c.max}] mean ${c.mean}`).join('  ');

function sourcesDoc(report) {
  const rows = report.map(({ family: f, m }) => {
    const row = (label, s) => `| ${label} | \`${s.file}\` | ${s.bytes} | \`${s.md5}\` | \`${s.sha256}\` |`;
    return `### ${f.id} — ${f.name}\n\n` +
      `- Asset: \`${f.asset}\` (https://polyhaven.com/a/${f.asset}), author ${f.author}, CC0\n` +
      `- Scanned size, used as \`tileMeters\`: ${f.tileMeters} m (Poly Haven asset info)\n` +
      `- Source displacement range: ${m.height.min}–${m.height.max}, normalised to 0–1 in the colour alpha\n` +
      `- Mean tangent normal after G flip: ${m.normalMean.join(', ')}\n\n` +
      `| map | 2k PNG | bytes | md5 | sha256 |\n| --- | --- | --- | --- | --- |\n` +
      `${row('diffuse', m.source.diffuse)}\n${row('nor_gl', m.source.nor_gl)}\n` +
      `${row('rough', m.source.rough)}\n${row('disp', m.source.disp)}\n\n` +
      `Outputs: \`${m.color.file}\` ${m.color.bytes} B sha256 \`${m.color.sha256}\`; ` +
      `\`${m.surface.file}\` ${m.surface.bytes} B sha256 \`${m.surface.sha256}\`.`;
  });
  return `# Endor terrain: sources and cook\n\n` +
    `The greener grass is ambientCG Ground 037 ([donor, verification and license](GRASS.md)); the trail is [Forest Ground 04](TRAIL.md) copied from the verified 4K pair. The other five are CC0 Poly Haven ground scans, cooked by \`tools/cook-endor-terrain.mjs\` into 2048² ` +
    `BC3/DXT5 DDS pairs with full mip chains (2048 → 1, ${MIPS} levels). No tint, no upscale, no ` +
    `third-party art: every pixel comes from the first-party 2k Poly Haven PNGs pinned below.\n\n` +
    `## Packing\n\n` +
    `- \`<id>-color.dds\`: RGB = albedo stored sRGB (mip filtering done in linear light); A = height ` +
    `from \`disp\`, normalised over that tile's own min/max (0 = deepest, 1 = highest).\n` +
    `- \`<id>-surface.dds\`: RGB = tangent normal from \`nor_gl\` with G flipped for top-down DDS rows ` +
    `(stored n*0.5+0.5, renormalised after each mip); A = roughness from \`rough\`, linear.\n` +
    `- Every file is 2048x2048 DXT5 with ${MIPS} mips; same sources + same script = same sha256.\n\n` +
    `## Reproduce\n\n\`\`\`\nnode tools/cook-endor-terrain.mjs\nnode tools/cook-endor-terrain.mjs --verify\n\`\`\`\n\n` +
    `Sources are streamed into the OS temp dir one family at a time and deleted as soon as they ` +
    `are decoded; the repo keeps only the DDS files, \`materials.json\` and this page.\n\n` +
    `## License\n\nAll Poly Haven assets are CC0 (public domain): https://polyhaven.com/license.\n\n` +
    `## Source files\n\n${rows.join('\n\n')}\n`;
}

async function main() {
  const verify = process.argv.includes('--verify'),
    keep = process.argv.includes('--keep');

  // Never let a recook overwrite the reviewed greener grass with the earlier brown donor.
  execFileSync(process.execPath,[path.join(ROOT,'tools/cook-endor-grass.mjs'),...process.argv.slice(2).filter(x=>['--verify','--keep'].includes(x))],{stdio:'inherit'});
  const manifest = [JSON.parse(readFileSync(path.join(OUT_DIR,'grass.json'),'utf8'))],
    report = [];

  for (const family of FAMILIES.filter(f=>f.id!=='grass')) {
    if(family.id==='soil'){
      execFileSync(process.execPath,[path.join(ROOT,'tools/cook-endor-trail.mjs')],{stdio:'inherit'});
      manifest.push(JSON.parse(readFileSync(path.join(OUT_DIR,'materials.json'),'utf8'))[3]);continue;
    }
    const t0 = Date.now();
    const m = await cookFamily(family);
    manifest.push({
      id: family.id,
      asset: family.asset,
      tileMeters: family.tileMeters,
      colorHash: m.color.sha256,
      surfaceHash: m.surface.sha256,
    });
    report.push({ family, m });
    console.log(
      `${family.id.padEnd(6)} ${family.asset.padEnd(17)} ${((m.color.bytes + m.surface.bytes) / 1048576).toFixed(1)}MiB  ` +
        `${((Date.now() - t0) / 1000).toFixed(1)}s  color ${m.color.sha256.slice(0, 12)}  surface ${m.surface.sha256.slice(0, 12)}`,
    );
    if (!keep) for (const s of Object.values(m.source)) rmSync(path.join(CACHE, s.file), { force: true });
  }

  // Always re-read every output: header, dimensions, mip chain, decode sizes, trailing bytes.
  const mips = [];
  for (let w = SIZE, h = SIZE; ; ) {
    mips.push({ width: w, height: h });
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  for (const { family, m } of report) {
    for (const kind of ['color', 'surface']) {
      const name = `${family.id}-${kind}.dds`,
        pathname = path.join(OUT_DIR, name),
        buf = readFileSync(pathname),
        sizes = verifyFile(pathname, mips),
        expectation = 128 + sizes.reduce((s, v) => s + v, 0);
      if (buf.length !== expectation) throw new Error(`${name}: ${buf.length} B != ${expectation} B`);
      if (verify)
        console.log(
          `${name}: ${mips.length} mips, ${buf.length} B, encode err ${(kind === 'color' ? m.color : m.surface).encode.meanAbsError}/255 mean`,
        );
    }
  }

  writeFileSync(path.join(OUT_DIR, 'materials.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(path.join(OUT_DIR, 'SOURCES.md'), sourcesDoc(report));

  console.log('\nPacked channels, top mip (RGBA 0-255):');
  for (const { family, m } of report) {
    console.log(`  ${family.id.padEnd(6)} color ${info(m.color)}`);
    console.log(`  ${''.padEnd(6)} surf  ${info(m.surface)}`);
  }
  const total = report.reduce((s, r) => s + r.m.color.bytes + r.m.surface.bytes, 0);
  console.log(`\n${report.length * 2} DDS, ${(total / 1048576).toFixed(1)} MiB total -> ${OUT_DIR}`);
}

main().catch(e => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
