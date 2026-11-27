#!/usr/bin/env node
// Cooks Poly Haven "Forest Ground 04" (CC0) into the two BC3/DXT5 DDS files used by the
// forest ground material. Regenerates public/art/forest-ground-04/*.dds from first-party
// 4K PNG sources; nothing is upscaled and no intermediate images are kept in the repo.
//
//   node tools/cook-forest-ground-04.mjs            # download if missing, then cook
//   node tools/cook-forest-ground-04.mjs --verify   # recook and re-read outputs, print stats
//
// Sources (https://api.polyhaven.com/files/forest_ground_04, 4k/png):
//   diffuse      forest_ground_04_diff_4k.png     sRGB albedo
//   nor_gl       forest_ground_04_nor_gl_4k.png   OpenGL tangent normal (linear)
//   roughness    forest_ground_04_rough_4k.png    linear roughness
//   displacement forest_ground_04_disp_4k.png     linear height, 16-bit
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodeDXT } from '../public/js/ddsdecode.js';
import { encodeDXT } from '../public/js/ddsmips.js';

const paving = process.argv.includes('--paving');
const OUT_DIR = path.resolve(paving ? 'public/art/endor-terrain' : 'public/art/forest-ground-04');
const CACHE = process.env.FG04_CACHE || path.join(os.tmpdir(), 'forest-ground-04-source');
const SIZE = paving ? 2048 : 4096;
const MIPS = Math.log2(SIZE)+1;

const BASE = 'https://dl.polyhaven.org/file/ph-assets/Textures/png/'+(paving?'2k/concrete_floor_02/':'4k/forest_ground_04/');
const SOURCES = paving ? {
  diffuse:{file:'concrete_floor_02_diff_2k.png',md5:'e6328911fe7cd3a74f11486f06a5ad60'},
  nor_gl:{file:'concrete_floor_02_nor_gl_2k.png',md5:'e7bbae9a0ec85c590b82ccdf5788c46d'},
  roughness:{file:'concrete_floor_02_rough_2k.png',md5:'130e55c56d8f1db1c1ed0cd7d160fa78'},
  displacement:{file:'concrete_floor_02_disp_2k.png',md5:'73f54017bc0fc5b6c85807f694624c62'}
} : {
  diffuse: { file: 'forest_ground_04_diff_4k.png', md5: '8ef79e766dcaed16fafdf6676ede9a5a' },
  nor_gl: { file: 'forest_ground_04_nor_gl_4k.png', md5: '0dbcfa2a379e0b10dbc01151099764b2' },
  roughness: { file: 'forest_ground_04_rough_4k.png', md5: '44ded6d079237fd8782c50057f5928b7' },
  displacement: { file: 'forest_ground_04_disp_4k.png', md5: '17fe418956c73e204cb162c2686c4466' },
};

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const byte = v => Math.max(0, Math.min(255, Math.round(v)));

// PNG: non-interlaced 8-bit RGB / 8-bit gray / 16-bit gray, which is what Poly Haven ships.
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
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
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

async function fetchSource(key) {
  const { file, md5 } = SOURCES[key],
    dest = path.join(CACHE, file),
    hash = b => createHash('md5').update(b).digest('hex');
  if (existsSync(dest)) {
    const have = hash(readFileSync(dest));
    if (have === md5) return dest;
    console.warn(`stale ${file} (${have}), refetching`);
  }
  mkdirSync(CACHE, { recursive: true });
  const url = BASE + file,
    res = await fetch(url);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer()),
    got = hash(buf);
  if (got !== md5) throw new Error(`${key}: md5 ${got} != expected ${md5} (${url})`);
  writeFileSync(dest, buf);
  console.log(`downloaded ${file} (${buf.length} bytes, md5 ok)`);
  return dest;
}

function load(key) {
  const png = decodePNG(readFileSync(path.join(CACHE, SOURCES[key].file)));
  if (png.width !== SIZE || png.height !== SIZE)
    throw new Error(`${key}: ${png.width}x${png.height}, expected ${SIZE}`);
  return png;
}

const at = (png, i, c) =>
  png.bitDepth === 16 ? png.data.readUInt16BE((i * png.channels + c) * 2) / 65535 : png.data[i * png.channels + c] / 255;

// 3-channel linear float planes (RGB) + one linear float plane (alpha), sized n pixels.
function planes(n) {
  return { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), a: new Float32Array(n) };
}
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
      // albedo is stored sRGB: mip filtering happened in linear space above
      out[i * 4] = byte(linearToSrgb(Math.min(1, p.r[i])) * 255);
      out[i * 4 + 1] = byte(linearToSrgb(Math.min(1, p.g[i])) * 255);
      out[i * 4 + 2] = byte(linearToSrgb(Math.min(1, p.b[i])) * 255);
      out[i * 4 + 3] = byte(Math.min(1, p.a[i]) * 255);
    } else {
      // tangent normal vectors, averaged then renormalised; roughness stays linear
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
  h.writeUInt32LE(124, 4);
  h.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, 8); // caps|height|width|pixelformat|mipcount|linearsize
  h.writeUInt32LE(height, 12);
  h.writeUInt32LE(width, 16);
  h.writeUInt32LE(Math.ceil(width / 4) * Math.ceil(height / 4) * 16, 20);
  h.writeUInt32LE(mips, 28);
  h.writeUInt32LE(32, 76); // DDS_PIXELFORMAT
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

function write(pathname, levels) {
  const body = Buffer.concat(levels.map(l => Buffer.from(l.data)));
  const head = ddsHeader(levels[0].width, levels[0].height, levels.length);
  writeFileSync(pathname, Buffer.concat([head, body]));
  return head.length + body.length;
}

function stats(bytes, n) {
  const per = [[], [], [], []];
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
    per[c] = { min: lo, max: hi, mean: +(sum / n).toFixed(2) };
  }
  return per;
}

async function main() {
  const verify = process.argv.includes('--verify');
  for (const key of Object.keys(SOURCES)) await fetchSource(key);

  const diff = load('diffuse'),
    nor = load('nor_gl'),
    rough = load('roughness'),
    disp = load('displacement'),
    n = SIZE * SIZE;

  // displacement is 16-bit linear; normalise its own range to 0..255 so the BC3 alpha byte
  // keeps the full height signal instead of the ~28% the raw 16-bit range would occupy.
  let hMin = 1,
    hMax = 0;
  for (let i = 0; i < n; i++) {
    const v = at(disp, i, 0);
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  const hSpan = hMax - hMin || 1;

  const color = planes(n),
    normal = planes(n);
  let nMean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    color.r[i] = srgbToLinear(at(diff, i, 0));
    color.g[i] = srgbToLinear(at(diff, i, 1));
    color.b[i] = srgbToLinear(at(diff, i, 2));
    color.a[i] = (at(disp, i, 0) - hMin) / hSpan; // linear height, 0 = deepest, 1 = highest

    // nor_gl -> nor_dx: flip green so the top-down DDS rows match DirectX tangent space
    const nx = at(nor, i, 0) * 2 - 1,
      ny = -(at(nor, i, 1) * 2 - 1),
      nz = at(nor, i, 2) * 2 - 1,
      len = Math.hypot(nx, ny, nz) || 1;
    normal.r[i] = nx / len;
    normal.g[i] = ny / len;
    normal.b[i] = nz / len;
    normal.a[i] = at(rough, i, 0);
    nMean[0] += nx / len;
    nMean[1] += ny / len;
    nMean[2] += nz / len;
  }
  nMean = nMean.map(v => +(v / n).toFixed(5));

  console.log(`cooking ${SIZE}x${SIZE} x${MIPS} mips ...`);
  const colorLevels = encodeChain(color, 'color'),
    normalLevels = encodeChain(normal, 'normal');

  mkdirSync(OUT_DIR, { recursive: true });
  const colorPath = path.join(OUT_DIR, paving?'concrete-color.dds':'color-height.dds'),
    normalPath = path.join(OUT_DIR, paving?'concrete-surface.dds':'normal-roughness.dds');
  const colorSize = write(colorPath, colorLevels),
    normalSize = write(normalPath, normalLevels);

  const colorTop = toBytes(color, n, 'color'),
    normalTop = toBytes(normal, n, 'normal');

  const results = {
    [path.basename(colorPath)]: {
      size: colorSize,
      top: stats(colorTop, n),
      source: { height16: { min: +hMin.toFixed(4), max: +hMax.toFixed(4) } },
    },
    [path.basename(normalPath)]: { size: normalSize, top: stats(normalTop, n), normalMean: nMean },
  };

  if (verify) {
    // read both files back and decode through the project decoder
    for (const [name, levels] of [
      [path.basename(colorPath), colorLevels],
      [path.basename(normalPath), normalLevels],
    ]) {
      const buf = readFileSync(path.join(OUT_DIR, name)),
        expected = 128 + levels.reduce((s, l) => s + l.data.length, 0);
      if (buf.length !== expected) throw new Error(`${name}: ${buf.length} bytes, expected ${expected}`);
      if (buf.readUInt32LE(0) !== 0x20534444 || buf.toString('latin1', 84, 88) !== 'DXT5')
        throw new Error(`${name}: bad DDS header`);
      if (buf.readUInt32LE(28) !== MIPS || buf.readUInt32LE(12) !== SIZE || buf.readUInt32LE(16) !== SIZE)
        throw new Error(`${name}: bad dimensions/mips`);
      let off = 128;
      for (const l of levels) {
        const px = decodeDXT(buf.subarray(off, off + l.data.length), l.width, l.height, 5);
        off += l.data.length;
        if (px.length !== l.width * l.height * 4) throw new Error(`${name}: decode size mismatch`);
        if (l.width === 1 && l.height === 1) console.log(`${name}: 1x1 mip decodes to rgba(${[...px].join(',')})`);
      }
      console.log(`${name}: ${buf.length} bytes, ${MIPS} mips, header + chain consistent`);
    }
    // encoded vs. intended values on the top level
    const dec = decodeDXT(readFileSync(colorPath).subarray(128, 128 + colorLevels[0].data.length), SIZE, SIZE, 5);
    let sum = 0,
      worst = 0;
    for (let i = 0; i < n; i++) {
      const want = [colorTop[i * 4], colorTop[i * 4 + 1], colorTop[i * 4 + 2], colorTop[i * 4 + 3]];
      for (let c = 0; c < 4; c++) {
        const e = Math.abs(dec[i * 4 + c] - want[c]);
        sum += e;
        if (e > worst) worst = e;
      }
    }
    console.log(`color-height.dds top level: mean abs error ${(sum / (n * 4)).toFixed(2)}/255, max ${worst}`);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
