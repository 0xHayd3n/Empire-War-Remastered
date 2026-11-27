#!/usr/bin/env node
// Cooks the Endor meadow replacement ("grass" slot) from one first-party CC0 photogrammetry
// scan, ambientCG "Ground 037", into the same packed BC3/DXT5 pair the seven-family Endor
// terrain cook produces, at 2048x2048 with a full 12-level mip chain:
//
//   grass-color.dds    RGB = albedo (stored sRGB), A = normalised height (linear, 0 = deepest)
//   grass-surface.dds  RGB = tangent normal (from NormalGL, G flipped for top-down DDS rows),
//                      A = roughness (linear)
//
// The donor's own colour is used as scanned: no tint, no grade, no upscale, no hand paint.
// Only the grass family is cooked here; the other six Endor families keep their own cook.
//
//   node tools/cook-endor-grass.mjs                          # cook, verify, write grass.json
//   node tools/cook-endor-grass.mjs --verify                 # + per-mip decode and encode error
//   node tools/cook-endor-grass.mjs --evidence docs/endor-grass
//                                                            # + before/after crops and means
//                                                            #   (default: <tmpdir>/endor-grass-evidence)
//   node tools/cook-endor-grass.mjs --keep                   # keep the downloaded archives
//
// Every input is pinned by md5 and sha256, including the container zip, the four extracted
// 2K PNGs and the leafy_grass baseline used for the before/after comparison, so a re-run
// either reproduces byte-identical DDS files or fails loudly.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { decodeDXT } from '../public/js/ddsdecode.js';
import { encodeDXT } from '../public/js/ddsmips.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public/art/endor-terrain');
const CACHE = process.env.ENDOR_GRASS_CACHE || path.join(os.tmpdir(), 'endor-grass-source');
const SIZE = 2048;
const MIPS = 12; // 2048 ... 1

// Donor: ambientCG "Ground 037".
//   https://ambientcg.com/a/Ground037  ·  technique "Surface Photogrammetry"
//   dimensions ca. 2.1 m x 2.1 m  ·  CC0 1.0 Universal (https://docs.ambientcg.com/license/)
const DONOR = {
  id: 'grass',
  asset: 'Ground037',
  name: 'Ground 037',
  page: 'https://ambientcg.com/a/Ground037',
  technique: 'Surface Photogrammetry',
  tileMeters: 2.1,
  container: {
    url: 'https://ambientcg.com/get?file=Ground037_2K-PNG.zip',
    file: 'Ground037_2K-PNG.zip',
    bytes: 72439572,
    md5: '6b3e9a5f96293ea05985b1b97d9b53c2',
    sha256: 'd36d714948dcb1eb075785f207132b333d8b4a508f539e20d981d53946c4dfed'
  },
  maps: {
    color: {
      member: 'Ground037_2K-PNG_Color.png',
      bytes: 10683243,
      md5: '2dcc08a19456646542de938b2b23b177',
      sha256: 'd8422045bc369dc1f113bfe3ee9a91faebeb65f074259770bc9bfd96357bfa85'
    },
    normal_gl: {
      member: 'Ground037_2K-PNG_NormalGL.png',
      bytes: 24384109,
      md5: '91310b498ec961ab9678be548b9335b0',
      sha256: '50d0027364638eecf4c5b4f4c42bfe2a191b4a3affc6309403df0aa4f6a21e8b'
    },
    roughness: {
      member: 'Ground037_2K-PNG_Roughness.png',
      bytes: 2916727,
      md5: 'a007bad4a4dd4e13ad10fb6d4228c987',
      sha256: '2b627a44ef1321d464f0eb6a0728617f97ab996be68bd9f7dd3bbb9e84c8b037'
    },
    displacement: {
      member: 'Ground037_2K-PNG_Displacement.png',
      bytes: 6670586,
      md5: '3be301f8b2577c78562c2da01b1a49a3',
      sha256: '4b2bb93973390c7be7a32b774a3c03726860bf753006ff0b177854bb64c9b395'
    }
  }
};

// "Before" reference: the leafy_grass diffuse the seven-family cook currently ships in this
// slot (same pin as tools/cook-endor-terrain.mjs, Poly Haven, CC0). Only ever used to measure
// and illustrate the difference; it is not part of the cooked output.
const BASELINE = {
  asset: 'leafy_grass',
  page: 'https://polyhaven.com/a/leafy_grass',
  url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/leafy_grass/leafy_grass_diff_2k.png',
  file: 'leafy_grass_diff_2k.png',
  bytes: 23606854,
  md5: '91c82271318a5bbe69182404c6dff730',
  sha256: '9ae7994a36a7aedf5fe65dac49d5e096e9a8ff1d8a8e8ccb28df0c9c3a7a2d34'
};

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const byte = v => Math.max(0, Math.min(255, Math.round(v)));
const hashOf = (algo, buf) => createHash(algo).update(buf).digest('hex');

// ---------------------------------------------------------------- zip container (stored/deflate)

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = buf => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// Reads every entry through the central directory; no zip dependency and nothing written to disk.
function readZip(buf) {
  let eocd = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 66000); p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`zip: bad central directory at ${p}`);
    const method = buf.readUInt16LE(p + 10),
      crc = buf.readUInt32LE(p + 16),
      csize = buf.readUInt32LE(p + 20),
      usize = buf.readUInt32LE(p + 24),
      nameLen = buf.readUInt16LE(p + 28),
      extraLen = buf.readUInt16LE(p + 30),
      commentLen = buf.readUInt16LE(p + 32),
      local = buf.readUInt32LE(p + 42),
      name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, crc, csize, usize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`zip: ${name} not in archive`);
      if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const raw = buf.subarray(start, start + e.csize);
      const data = e.method === 0 ? Buffer.from(raw) : e.method === 8 ? zlib.inflateRawSync(raw) : null;
      if (!data) throw new Error(`zip: ${name} uses compression method ${e.method}`);
      if (data.length !== e.usize) throw new Error(`zip: ${name} inflates to ${data.length}, expected ${e.usize}`);
      if (crc32(data) !== e.crc) throw new Error(`zip: ${name} fails its CRC`);
      return data;
    }
  };
}

// ---------------------------------------------------------------- PNG decode / encode

// PNG: non-interlaced 8/16-bit RGB / RGBA / grey, which is what ambientCG and Poly Haven ship.
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

// Evidence crops are written as plain 8-bit RGB PNGs with filter 0 on every row.
function encodePNG(rgb, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------- cook primitives

const planes = n => ({
  r: new Float32Array(n),
  g: new Float32Array(n),
  b: new Float32Array(n),
  a: new Float32Array(n)
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

// Colour summary of an RGBA albedo buffer: sRGB means (what the DDS stores), linear-light means
// (what the shader multiplies), and how much of the tile is green-dominant (G > R + 8).
function albedoMeans(bytes, n) {
  const s = [0, 0, 0],
    lin = [0, 0, 0];
  let green = 0;
  for (let i = 0; i < n; i++) {
    const r = bytes[i * 4],
      g = bytes[i * 4 + 1],
      b = bytes[i * 4 + 2];
    s[0] += r;
    s[1] += g;
    s[2] += b;
    lin[0] += srgbToLinear(r / 255);
    lin[1] += srgbToLinear(g / 255);
    lin[2] += srgbToLinear(b / 255);
    if (g > r + 8) green++;
  }
  const srgb = s.map(v => +(v / n).toFixed(2)),
    linear = lin.map(v => +(v / n).toFixed(5));
  return {
    srgb,
    linear,
    greenDominantPct: +((green / n) * 100).toFixed(2),
    greenMinusRed: +(srgb[1] - srgb[0]).toFixed(2),
    greenOverRed: +(srgb[1] / srgb[0]).toFixed(4)
  };
}

function verifyFile(pathname, mips) {
  const buf = readFileSync(pathname);
  if (buf.readUInt32LE(0) !== 0x20534444) throw new Error(`${pathname}: missing DDS magic`);
  if (buf.toString('latin1', 84, 88) !== 'DXT5') throw new Error(`${pathname}: not DXT5`);
  if (buf.readUInt32LE(16) !== SIZE || buf.readUInt32LE(12) !== SIZE) throw new Error(`${pathname}: not ${SIZE}²`);
  if (buf.readUInt32LE(28) !== mips.length) throw new Error(`${pathname}: mip count mismatch`);
  let off = 128;
  const sizes = [];
  for (let m = 0; m < mips.length; m++) {
    const l = mips[m],
      size = Math.ceil(l.width / 4) * Math.ceil(l.height / 4) * 16;
    if (off + size > buf.length) throw new Error(`${pathname}: truncated at mip ${m}`);
    const px = decodeDXT(buf.subarray(off, off + size), l.width, l.height, 5);
    if (px.length !== l.width * l.height * 4) throw new Error(`${pathname}: mip ${m} decodes to ${px.length} bytes`);
    sizes.push(size);
    off += size;
  }
  if (off !== buf.length) throw new Error(`${pathname}: ${buf.length - off} trailing bytes`);
  return sizes;
}

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

// ---------------------------------------------------------------- downloads

async function download({ url, file, bytes, md5, sha256 }) {
  const dest = path.join(CACHE, file);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (existsSync(dest)) {
      const buf = readFileSync(dest);
      if (hashOf('md5', buf) === md5 && (!sha256 || hashOf('sha256', buf) === sha256)) return buf;
      console.warn(`  stale ${file}, refetching`);
      rmSync(dest);
    }
    mkdirSync(CACHE, { recursive: true });
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (bytes && buf.length !== bytes) throw new Error(`${buf.length} bytes, expected ${bytes}`);
      const gotMd5 = hashOf('md5', buf),
        gotSha = hashOf('sha256', buf);
      if (gotMd5 !== md5) throw new Error(`md5 ${gotMd5} != pinned ${md5}`);
      if (sha256 && gotSha !== sha256) throw new Error(`sha256 ${gotSha} != pinned ${sha256}`);
      writeFileSync(dest, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      console.warn(`  ${file}: ${e.message}${attempt < 2 ? ', retrying' : ''}`);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`${file}: ${lastErr.message} (${url})`);
}

// The archive container is pinned too, but the four member PNGs are the real gate: if ambientCG
// ever repacks the zip (same pixels, new container) the cook still runs and says so.
async function donorArchive() {
  const c = DONOR.container,
    dest = path.join(CACHE, c.file);
  let buf;
  if (existsSync(dest)) buf = readFileSync(dest);
  else {
    let lastErr;
    for (let attempt = 0; attempt < 3 && !buf; attempt++) {
      try {
        const res = await fetch(c.url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(dest, buf);
      } catch (e) {
        lastErr = e;
        console.warn(`  ${c.file}: ${e.message}${attempt < 2 ? ', retrying' : ''}`);
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (!buf) throw new Error(`${c.file}: ${lastErr.message} (${c.url})`);
  }
  const sha = hashOf('sha256', buf);
  if (sha !== c.sha256) console.warn(`  container sha256 ${sha} differs from pin ${c.sha256}; verifying member PNGs instead`);
  return { buf, sha };
}

function donorMap(zip, key) {
  const want = DONOR.maps[key];
  const buf = zip.read(want.member);
  const gotBytes = buf.length,
    gotMd5 = hashOf('md5', buf),
    gotSha = hashOf('sha256', buf);
  if (gotBytes !== want.bytes || gotMd5 !== want.md5 || gotSha !== want.sha256)
    throw new Error(`${want.member}: ${gotBytes} B md5 ${gotMd5} sha256 ${gotSha} != pinned`);
  return { buf, bytes: gotBytes, md5: gotMd5, sha256: gotSha, file: want.member };
}

// ---------------------------------------------------------------- cook

async function cook() {
  const n = SIZE * SIZE,
    color = planes(n),
    surface = planes(n),
    m = { id: DONOR.id, asset: DONOR.asset, tileMeters: DONOR.tileMeters, source: {} };

  const { buf: zipBuf } = await donorArchive();
  const zip = readZip(zipBuf);
  const missing = Object.values(DONOR.maps)
    .map(s => s.member)
    .filter(name => !zip.names.includes(name));
  if (missing.length) throw new Error(`archive is missing ${missing.join(', ')}`);

  // 1. albedo -> sRGB-decoded linear RGB. Colour is exactly the scan's own; nothing is adjusted.
  let src = donorMap(zip, 'color');
  m.source.color = { file: src.file, bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  let png = decodePNG(src.buf);
  if (png.width !== SIZE || png.height !== SIZE) throw new Error(`color: ${png.width}x${png.height}, expected ${SIZE}²`);
  for (let i = 0; i < n; i++) {
    color.r[i] = srgbToLinear(at(png, i, 0));
    color.g[i] = srgbToLinear(at(png, i, 1));
    color.b[i] = srgbToLinear(at(png, i, 2));
  }
  png = null;

  // 2. displacement -> alpha height, normalised over this tile's own range
  src = donorMap(zip, 'displacement');
  m.source.displacement = { file: src.file, bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  const disp = decodePNG(src.buf);
  if (disp.width !== SIZE || disp.height !== SIZE) throw new Error(`displacement: ${disp.width}x${disp.height}`);
  let hMin = 1,
    hMax = 0;
  for (let i = 0; i < n; i++) {
    const v = at(disp, i, 0);
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  const hSpan = hMax - hMin || 1;
  for (let i = 0; i < n; i++) color.a[i] = (at(disp, i, 0) - hMin) / hSpan;
  m.height = { min: +hMin.toFixed(5), max: +hMax.toFixed(5), span: +hSpan.toFixed(5), bits: disp.bitDepth };

  // 3. NormalGL -> tangent normal, G flipped so the stored rows match a top-down DDS
  src = donorMap(zip, 'normal_gl');
  m.source.normal_gl = { file: src.file, bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  png = decodePNG(src.buf);
  if (png.width !== SIZE || png.height !== SIZE) throw new Error(`normal_gl: ${png.width}x${png.height}`);
  const nMean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const nx = at(png, i, 0) * 2 - 1,
      ny = -(at(png, i, 1) * 2 - 1),
      nz = at(png, i, 2) * 2 - 1,
      len = Math.hypot(nx, ny, nz) || 1;
    surface.r[i] = nx / len;
    surface.g[i] = ny / len;
    surface.b[i] = nz / len;
    nMean[0] += nx / len;
    nMean[1] += ny / len;
    nMean[2] += nz / len;
  }
  m.normalMean = nMean.map(v => +(v / n).toFixed(5));
  png = null;

  // 4. roughness -> alpha
  src = donorMap(zip, 'roughness');
  m.source.roughness = { file: src.file, bytes: src.bytes, md5: src.md5, sha256: src.sha256 };
  png = decodePNG(src.buf);
  if (png.width !== SIZE || png.height !== SIZE) throw new Error(`roughness: ${png.width}x${png.height}`);
  for (let i = 0; i < n; i++) surface.a[i] = at(png, i, 0);
  png = null;

  const colorTop = toBytes(color, n, 'color'),
    surfaceTop = toBytes(surface, n, 'normal');

  mkdirSync(OUT_DIR, { recursive: true });
  const colorPath = path.join(OUT_DIR, `${DONOR.id}-color.dds`),
    surfacePath = path.join(OUT_DIR, `${DONOR.id}-surface.dds`);
  const colorBuf = writeDds(colorPath, encodeChain(color, 'color')),
    surfaceBuf = writeDds(surfacePath, encodeChain(surface, 'normal'));

  m.color = {
    file: path.basename(colorPath),
    bytes: colorBuf.length,
    sha256: hashOf('sha256', colorBuf),
    top: channelStats(colorTop, n),
    encode: topLevelError(colorBuf, colorTop, n)
  };
  m.surface = {
    file: path.basename(surfacePath),
    bytes: surfaceBuf.length,
    sha256: hashOf('sha256', surfaceBuf),
    top: channelStats(surfaceTop, n),
    encode: topLevelError(surfaceBuf, surfaceTop, n)
  };
  return { m, colorTop, surfaceTop };
}

// ---------------------------------------------------------------- evidence

function crop(bytes, w, x0, y0, cw, ch) {
  const out = Buffer.alloc(cw * ch * 3);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = ((y0 + y) * w + (x0 + x)) * 4,
        o = (y * cw + x) * 3;
      out[o] = bytes[i];
      out[o + 1] = bytes[i + 1];
      out[o + 2] = bytes[i + 2];
    }
  return out;
}

function swatch(mean, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    out[i * 3] = byte(mean[0]);
    out[i * 3 + 1] = byte(mean[1]);
    out[i * 3 + 2] = byte(mean[2]);
  }
  return out;
}

async function evidence(dir, m, colorTop) {
  const n = SIZE * SIZE;
  const baseBuf = await download(BASELINE);
  const base = decodePNG(baseBuf);
  if (base.width !== SIZE || base.height !== SIZE) throw new Error(`baseline: ${base.width}x${base.height}`);
  const before = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    before[i * 4] = byte(at(base, i, 0) * 255);
    before[i * 4 + 1] = byte(at(base, i, base.channels >= 3 ? 1 : 0) * 255);
    before[i * 4 + 2] = byte(at(base, i, base.channels >= 3 ? 2 : 0) * 255);
    before[i * 4 + 3] = 255;
  }
  const beforeMeans = albedoMeans(before, n),
    afterMeans = albedoMeans(colorTop, n);

  // Less green than the shipped donor would make the whole change pointless; stop and say so.
  if (!(afterMeans.greenOverRed > beforeMeans.greenOverRed && afterMeans.greenMinusRed > beforeMeans.greenMinusRed))
    throw new Error(
      `donor is not greener than ${BASELINE.asset}: G/R ${afterMeans.greenOverRed} vs ${beforeMeans.greenOverRed}, ` +
        `G-R ${afterMeans.greenMinusRed} vs ${beforeMeans.greenMinusRed} — do not ship the pair just written`
    );

  mkdirSync(dir, { recursive: true });
  const cw = 512,
    x0 = 512,
    y0 = 512;
  const beforePng = encodePNG(crop(before, SIZE, x0, y0, cw, cw), cw, cw),
    afterPng = encodePNG(crop(colorTop, SIZE, x0, y0, cw, cw), cw, cw);
  const beforeSwatch = encodePNG(swatch(beforeMeans.srgb, cw, 96), cw, 96),
    afterSwatch = encodePNG(swatch(afterMeans.srgb, cw, 96), cw, 96);
  for (const [name, buf] of [
    ['before-crop.png', beforePng],
    ['after-crop.png', afterPng],
    ['before-mean.png', beforeSwatch],
    ['after-mean.png', afterSwatch]
  ])
    writeFileSync(path.join(dir, name), buf);

  const report = {
    before: { asset: BASELINE.asset, page: BASELINE.page, ...beforeMeans },
    after: { asset: DONOR.asset, page: DONOR.page, ...afterMeans },
    delta: {
      greenOverRed: +(afterMeans.greenOverRed - beforeMeans.greenOverRed).toFixed(4),
      greenMinusRed: +(afterMeans.greenMinusRed - beforeMeans.greenMinusRed).toFixed(2),
      greenDominantPct: +(afterMeans.greenDominantPct - beforeMeans.greenDominantPct).toFixed(2)
    },
    crop: { x: x0, y: y0, size: cw, note: 'same pixel rect in both 2048 tiles; 0.50 m before vs 0.525 m after' },
    cooked: {
      color: { file: m.color.file, sha256: m.color.sha256, top: m.color.top },
      surface: { file: m.surface.file, sha256: m.surface.sha256, top: m.surface.top }
    }
  };
  writeFileSync(path.join(dir, 'means.json'), JSON.stringify(report, null, 2) + '\n');

  // Same-camera-free comparison page: one slider wipes the donor crop over the baseline crop.
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Endor grass: leafy_grass vs Ground 037</title>
<style>*{box-sizing:border-box}body{max-width:1040px;margin:auto;padding:20px;background:#121619;color:#eef2ec;font:15px/1.55 system-ui}
h1{font-size:1.35rem;font-weight:550}figure{--cut:50%;margin:0}.frame{position:relative}.frame img{width:100%;display:block}
.after{position:absolute;inset:0;clip-path:inset(0 0 0 var(--cut))}.seam{position:absolute;top:0;bottom:0;left:var(--cut);width:2px;background:#fff}
input{width:100%;margin:14px 0 6px;accent-color:#a5ccae}.row{display:flex;gap:12px;margin-top:14px}
.sw{flex:1}.sw img{width:100%;display:block}.sw p{margin:.4rem 0 0;font-variant-numeric:tabular-nums}
figcaption{margin-top:14px;color:#a9b8b0}</style>
<h1>Endor meadow: 2K albedo, same 512² crop rect</h1>
<figure><div class="frame"><img src="before-crop.png" alt="leafy_grass, the shipped grass">
<img class="after" src="after-crop.png" alt="Ground 037, the replacement grass"><i class="seam"></i></div>
<input aria-label="Reveal the shipped grass" type="range" min="0" max="100" value="50"
 oninput="this.closest('figure').style.setProperty('--cut',this.value+'%')">
<div class="row"><div class="sw"><img src="before-mean.png" alt="Mean colour of leafy_grass"><p>Before · ${BASELINE.asset} · mean sRGB ${beforeMeans.srgb.join(', ')}</p></div>
<div class="sw"><img src="after-mean.png" alt="Mean colour of Ground 037"><p>After · ${DONOR.asset} · mean sRGB ${afterMeans.srgb.join(', ')}</p></div></div>
<figcaption>Left of the seam: the shipped grass (Poly Haven leafy_grass). Right of it: ambientCG Ground 037, both straight from the pinned source PNGs with no tint. The strip below shows each tile's mean colour.</figcaption>
</figure>`;
  writeFileSync(path.join(dir, 'compare.html'), page);

  console.log('\nGreenness, top level albedo (sRGB 0-255):');
  for (const [label, v] of [
    ['before ' + BASELINE.asset, beforeMeans],
    ['after  ' + DONOR.asset, afterMeans]
  ])
    console.log(
      `  ${label.padEnd(24)} ${v.srgb.join(', ').padEnd(16)} G/R ${v.greenOverRed.toFixed(4)}  G-R ${v.greenMinusRed
        .toString()
        .padStart(6)}  green-dominant ${v.greenDominantPct}%`
    );
  console.log(`  crops, means and compare.html -> ${dir}`);
  return report;
}

// ---------------------------------------------------------------- main

async function main() {
  const verify = process.argv.includes('--verify');
  const keep = process.argv.includes('--keep');
  const evIndex = process.argv.indexOf('--evidence');
  const evNext = evIndex >= 0 ? process.argv[evIndex + 1] : undefined;
  const evDir =
    evIndex < 0 ? null : path.resolve(evNext && !evNext.startsWith('--') ? evNext : path.join(os.tmpdir(), 'endor-grass-evidence'));

  const t0 = Date.now();
  const { m, surfaceTop, colorTop } = await cook();
  const n = SIZE * SIZE;

  // Always re-read both outputs: header, dimensions, mip chain, decode sizes, no trailing bytes.
  const mips = [];
  for (let w = SIZE, h = SIZE; ;) {
    mips.push({ width: w, height: h });
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  for (const kind of ['color', 'surface']) {
    const name = `${DONOR.id}-${kind}.dds`,
      pathname = path.join(OUT_DIR, name),
      buf = readFileSync(pathname),
      sizes = verifyFile(pathname, mips),
      expected = 128 + sizes.reduce((s, v) => s + v, 0);
    if (buf.length !== expected) throw new Error(`${name}: ${buf.length} B != ${expected} B`);
    if (verify)
      console.log(
        `${name}: ${mips.length} mips, ${buf.length} B, encode err ${m[kind].encode.meanAbsError}/255 mean, ${m[kind].encode.maxAbsError} max`
      );
  }

  const json = {
    id: DONOR.id,
    asset: DONOR.asset,
    tileMeters: DONOR.tileMeters,
    colorHash: m.color.sha256,
    surfaceHash: m.surface.sha256
  };
  writeFileSync(path.join(OUT_DIR, `${DONOR.id}.json`), JSON.stringify(json, null, 2) + '\n');

  console.log(
    `${DONOR.id.padEnd(6)} ${DONOR.asset.padEnd(10)} ${((m.color.bytes + m.surface.bytes) / 1048576).toFixed(1)}MiB  ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s  color ${m.color.sha256.slice(0, 12)}  surface ${m.surface.sha256.slice(0, 12)}`
  );
  const donorMeans = albedoMeans(colorTop, SIZE * SIZE);
  console.log(
    `  albedo  mean sRGB ${donorMeans.srgb.join(', ')}  G/R ${donorMeans.greenOverRed}  green-dominant ${donorMeans.greenDominantPct}%`
  );
  console.log(
    `  height  ${m.height.bits}-bit source, ${m.height.min}-${m.height.max} normalised to 0-1 in the colour alpha; normal mean after G flip ${m.normalMean.join(', ')}`
  );
  console.log(`  color   ${m.color.file} ${m.color.bytes} B  top ${m.color.top.map(c => `[${c.min},${c.max}] ${c.mean}`).join('  ')}`);
  console.log(
    `  surface ${m.surface.file} ${m.surface.bytes} B  top ${m.surface.top.map(c => `[${c.min},${c.max}] ${c.mean}`).join('  ')}`
  );
  console.log(`  write   ${path.join(OUT_DIR, DONOR.id + '.json')}`);

  if (evDir) await evidence(evDir, m, colorTop);

  if (!keep) for (const s of Object.values(m.source)) rmSync(path.join(CACHE, s.file), { force: true });
  if (!keep) rmSync(path.join(CACHE, DONOR.container.file), { force: true });
}

main().catch(e => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
