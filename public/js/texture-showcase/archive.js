// ZIP32, stored entries only: private payloads are already BC3-compressed. No extraction to disk.
const enc = new TextEncoder(),
  dec = new TextDecoder();
const table = Uint32Array.from({ length: 256 }, (_, v) => {
  for (let i = 0; i < 8; i++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0);
  return v >>> 0;
});
const crc = a => {
  let c = 0xffffffff;
  for (const b of a) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};
function record(size) {
  const bytes = new Uint8Array(size),
    d = new DataView(bytes.buffer);
  return { bytes, u16: (i, x) => d.setUint16(i, x, true), u32: (i, x) => d.setUint32(i, x, true) };
}
function join(parts) {
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let pos = 0;
  for (const a of parts) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}
export function storeZip(entries) {
  const body = [],
    directory = [];
  let pos = 0;
  for (const [path, data] of entries) {
    const name = enc.encode(path),
      sum = crc(data);
    const h = record(30);
    h.u32(0, 0x04034b50);
    h.u16(4, 20);
    h.u16(12, 0x21);
    h.u32(14, sum);
    h.u32(18, data.length);
    h.u32(22, data.length);
    h.u16(26, name.length);
    const c = record(46);
    c.u32(0, 0x02014b50);
    c.u16(4, 20);
    c.u16(6, 20);
    c.u16(14, 0x21);
    c.u32(16, sum);
    c.u32(20, data.length);
    c.u32(24, data.length);
    c.u16(28, name.length);
    c.u32(42, pos);
    directory.push(c.bytes, name);
    body.push(h.bytes, name, data);
    pos += 30 + name.length + data.length;
  }
  const end = record(22);
  end.u32(0, 0x06054b50);
  end.u16(8, entries.length);
  end.u16(10, entries.length);
  end.u32(
    12,
    directory.reduce((n, a) => n + a.length, 0)
  );
  end.u32(16, pos);
  return join([...body, ...directory, end.bytes]);
}
export function readTextureZip(a, allowed) {
  if (a.byteLength > 64 * 1024 * 1024 || a.length < 22) throw Error('Not a showcase ZIP');
  const d = new DataView(a.buffer, a.byteOffset, a.byteLength),
    u16 = i => d.getUint16(i, true),
    u32 = i => d.getUint32(i, true),
    last = a.length - 22,
    files = new Map();
  if (u32(last) !== 0x06054b50 || u16(last + 10) !== allowed.size || u32(last + 16) + u32(last + 12) !== last)
    throw Error('Expected the complete profile ZIP made by this builder');
  const end = u32(last + 16);
  let p = 0;
  while (p < end) {
    if (p + 30 > end || u32(p) !== 0x04034b50 || u16(p + 6) || u16(p + 8)) throw Error('Unsupported ZIP encoding');
    const size = u32(p + 18),
      len = u16(p + 26),
      start = p + 30 + len + u16(p + 28),
      name = dec.decode(a.subarray(p + 30, p + 30 + len));
    if (!allowed.has(name) || files.has(name) || size !== u32(p + 22) || start + size > end) throw Error('Unexpected texture pack entry');
    const bytes = a.subarray(start, start + size);
    if (crc(bytes) !== u32(p + 14)) throw Error('Damaged texture pack');
    files.set(name, bytes);
    p = start + size;
  }
  if (files.size !== allowed.size || p !== end) throw Error('Incomplete pack');
  return files;
}
