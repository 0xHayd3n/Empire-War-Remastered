// Small, local-only derivatives of the *winning* command bar sheet / loose UI texture.
// Nothing from an installed game is copied into the checkout or requested by path from the client.
import { crc32, deflateSync } from 'node:zlib';
import { parseTexture } from '../public/js/dds.js';
import { decodeDXT } from '../public/js/ddsdecode.js';
const dir = 'Data/Art/Textures/';
function chunk(name, bytes) {
  const c = Buffer.alloc(12 + bytes.length);
  c.writeUInt32BE(bytes.length);
  c.write(name, 4);
  bytes.copy(c, 8);
  c.writeUInt32BE(crc32(c.subarray(4, -4)), c.length - 4);
  return c;
}
export function thumb(src, { x = 0, y = 0, w = src.width, h = src.height } = {}) {
  if (!w || !h || x + w > src.width || y + h > src.height) return '';
  const scale = Math.min(1, 160 / Math.max(w, h)),
    width = Math.max(1, Math.round(w * scale)),
    height = Math.max(1, Math.round(h * scale)),
    stride = width * 4 + 1,
    raw = Buffer.alloc(stride * height);
  let seen = false;
  for (let i = 0; i < height; i++) {
    const row = (y + Math.floor((i * h) / height)) * src.width;
    for (let j = 0; j < width; j++) {
      const s = (row + x + Math.floor((j * w) / width)) * 4;
      raw.set(src.data.subarray(s, s + 4), i * stride + 1 + j * 4);
      seen ||= src.data[s + 3] > 0;
    }
  }
  if (!seen) return '';
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(width);
  hdr.writeUInt32BE(height, 4);
  hdr[8] = 8;
  hdr[9] = 6;
  return (
    'data:image/png;base64,' +
    Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      chunk('IHDR', hdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ]).toString('base64')
  );
}
function texture(archive, key, maxPixels) {
  const e = archive.index.get(key);
  if (!e || e.size > 100 * 1024 ** 2) return null;
  const b = archive.read(key);
  if (!b || b.length < 18) return null;
  const dds = b.toString('ascii', 0, 4) === 'DDS ',
    bmp = b[0] === 66 && b[1] === 77;
  const width = dds ? b.readUInt32LE(16) : bmp ? b.readInt32LE(18) : b.readUInt16LE(12),
    height = dds ? b.readUInt32LE(12) : bmp ? Math.abs(b.readInt32LE(22)) : b.readUInt16LE(14);
  if (width <= 0 || height <= 0 || width * height > maxPixels) return null;
  const raw = b.byteOffset === 0 && b.length === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  const tex = parseTexture(raw),
    top = tex.mipmaps[0];
  if (!top) return null;
  if (!tex.compressed) return top;
  const kind = { 33777: 1, 33778: 3, 33779: 5 }[tex.format];
  return kind ? { width, height, data: decodeDXT(top.data, width, height, kind) } : null;
}
export function commandImages(archive) {
  const rects = new Map(),
    cache = new Map(),
    mtd = archive.read(archive.resolve(dir + 'MT_CommandBar.mtd'));
  if (mtd?.length >= 4 && mtd.readUInt32LE(0) <= (mtd.length - 4) / 81)
    for (let i = 0; i < mtd.readUInt32LE(0); i++) {
      const o = 4 + i * 81;
      rects.set(
        mtd
          .toString('latin1', o, o + 64)
          .split('\0')[0]
          .toUpperCase(),
        { x: mtd.readUInt32LE(o + 64), y: mtd.readUInt32LE(o + 68), w: mtd.readUInt32LE(o + 72), h: mtd.readUInt32LE(o + 76) }
      );
    }
  let sheet;
  return name => {
    if (!name || !/^[-\w .]+$/.test(name)) return '';
    const k = name.trim().toUpperCase();
    if (cache.has(k)) return cache.get(k);
    let uri = '';
    const r = rects.get(k);
    if (r) {
      try {
        if (sheet === undefined) {
          sheet = null;
          sheet = texture(archive, archive.resolve(dir + 'MT_CommandBar.tga'), 24 * 1024 ** 2);
        }
        if (sheet) uri = thumb(sheet, r);
      } catch {
        /* Missing/malformed art must not remove a campaign. */
      }
    }
    if (!uri)
      try {
        const t = texture(archive, archive.resolve(dir + k), 2 * 1024 ** 2);
        if (t) uri = thumb(t);
      } catch {}
    cache.set(k, uri);
    return uri;
  };
}
