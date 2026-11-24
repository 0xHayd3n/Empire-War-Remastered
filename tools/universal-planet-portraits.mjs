// Local-only setup portraits. Rasterize the mounted ALO's visible rigid parts, UVs and
// textures into a normalized orthographic tile once, never during a map or zoom input.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import { Matrix4, Vector3 } from '../public/vendor/three/build/three.module.js';
import { parseALO } from '../public/js/alo.js';
import { parseTexture } from '../public/js/dds.js';
import { decodeDXT } from '../public/js/ddsdecode.js';
import { tileSize as TILE, sheetColumns as COLS } from '../public/js/game/universalplanetart.js';
const exact = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
function png(width, height, data) {
  const chunk = (s, b) => {
    const c = Buffer.alloc(12 + b.length);
    c.writeUInt32BE(b.length);
    c.write(s, 4);
    b.copy(c, 8);
    c.writeUInt32BE(crc32(c.subarray(4, -4)), c.length - 4);
    return c;
  };
  const stride = width * 4,
    rows = Buffer.alloc((stride + 1) * height),
    hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(width);
  hdr.writeUInt32BE(height, 4);
  hdr[8] = 8;
  hdr[9] = 6;
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', hdr),
    chunk('IDAT', deflateSync(rows, { level: 3 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function sampler(archive) {
  const recent = new Map();
  return name => {
    if (!name) return null;
    const k = archive.resolve('Data/Art/Textures/' + (/\.\w+$/.test(name) ? name : name + '.dds'));
    if (!k) return null;
    if (recent.has(k)) return recent.get(k);
    let t = null;
    try {
      const size = archive.index.get(k)?.size;
      if (size > 0 && size < 64 * 1024 ** 2) {
        const b = archive.read(k),
          dds = b.toString('ascii', 0, 4) === 'DDS ';
        const w = dds ? b.readUInt32LE(16) : b.readUInt16LE(12),
          h = dds ? b.readUInt32LE(12) : b.readUInt16LE(14);
        if (w > 0 && h > 0 && w * h <= 16 * 1024 ** 2) {
          const a = parseTexture(exact(b));
          const m = a.mipmaps.find(m => Math.max(m.width, m.height) <= 512) || a.mipmaps.at(-1);
          const kind = { 33777: 1, 33778: 3, 33779: 5 }[a.format];
          if (m && (!a.compressed || kind)) {
            let src = a.compressed ? decodeDXT(m.data, m.width, m.height, kind) : m.data;
            // Bound the texture working set even when a pack ships no mipmaps.
            const scale = Math.min(1, 512 / Math.max(m.width, m.height)),
              width = Math.max(1, Math.round(m.width * scale)),
              height = Math.max(1, Math.round(m.height * scale));
            if (scale < 1) {
              const out = new Uint8Array(width * height * 4);
              for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                  const i = 4 * (Math.floor((y * m.height) / height) * m.width + Math.floor((x * m.width) / width));
                  out.set(src.subarray(i, i + 4), 4 * (y * width + x));
                }
              src = out;
            }
            t = { data: src, width, height };
          }
        }
      }
    } catch {
      /* A missing optional material never removes a world. */
    }
    recent.set(k, t);
    if (recent.size > 20) recent.delete(recent.keys().next().value);
    return t;
  };
}
// Sample the mounted colour and cloud maps with wrapping and bilinear filtering.
function sample(t, u, v, out) {
  const x = (u - Math.floor(u)) * t.width,
    y = (v - Math.floor(v)) * t.height,
    i = Math.floor(x),
    j = Math.floor(y),
    a = x - i,
    b = y - j,
    s = (j * t.width + i) * 4,
    h = (j * t.width + ((i + 1) % t.width)) * 4,
    k = (((j + 1) % t.height) * t.width + i) * 4,
    l = (((j + 1) % t.height) * t.width + ((i + 1) % t.width)) * 4;
  for (let c = 0; c < 4; c++)
    out[c] = (t.data[s + c] * (1 - a) + t.data[h + c] * a) * (1 - b) + (t.data[k + c] * (1 - a) + t.data[l + c] * a) * b;
}
export function rasterPortrait(model, texture) {
  const bones = [],
    parts = [],
    v = new Vector3(),
    normal = new Vector3();
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const b of model.bones) {
    const m = new Matrix4().set(...b.matrix, 0, 0, 0, 1);
    if (bones[b.parent]) m.premultiply(bones[b.parent]);
    bones.push(m);
  }
  const solid = model.meshes.some(
    m =>
      !m.hidden &&
      !m.collision &&
      !/_ALT[1-9]|_LOD[1-9]|glow/i.test(m.name) &&
      m.subs.some(s => s.material?.params.BaseTexture && !/shadow|collision|additive|heat|lightvisual/i.test(s.material.shader))
  );
  for (const mesh of model.meshes) {
    if (mesh.hidden || mesh.collision || /_ALT[1-9]|_LOD[1-9]|glow/i.test(mesh.name) || model.bones[mesh.bone]?.visible === false) continue;
    const mat = bones[mesh.bone] || new Matrix4();
    for (const { geometry: g, material: m } of mesh.subs) {
      if (
        !g?.vertices ||
        !g.indices?.length ||
        !m ||
        /shadow|collision|heat|lightvisual/i.test(m.shader) ||
        (solid && /additive/i.test(m.shader))
      )
        continue;
      const base = texture(m.params.BaseTexture);
      if (!base) continue;
      const { pos, nrm, uv } = g.vertices,
        screen = new Float32Array(g.nVerts * 4);
      for (let i = 0; i < g.nVerts; i++) {
        v.fromArray(pos, i * 3).applyMatrix4(mat);
        normal.fromArray(nrm, i * 3).transformDirection(mat);
        // Three-quarter Z-up view, shared light source, no dependency on campaign camera or Scale_Factor.
        const X = 0.866 * v.x + 0.5 * v.y,
          side = 0.5 * v.x - 0.866 * v.y,
          Y = 0.35 * side - 0.937 * v.z,
          Z = 0.937 * side + 0.35 * v.z;
        left = Math.min(left, X);
        right = Math.max(right, X);
        top = Math.min(top, Y);
        bottom = Math.max(bottom, Y);
        screen[4 * i] = X;
        screen[4 * i + 1] = Y;
        screen[4 * i + 2] = Z;
        screen[4 * i + 3] = Math.max(0, -0.15 * normal.x - 0.82 * normal.y + 0.55 * normal.z);
      }
      parts.push({
        screen,
        uv,
        indices: g.indices,
        base,
        cloud: texture(m.params.CloudTexture),
        planet: /planet/i.test(m.shader),
        alpha: /alpha/i.test(m.shader),
        emissive: /additive/i.test(m.shader),
        tint: m.params.Diffuse || [1, 1, 1]
      });
    }
  }
  const span = Math.max(right - left, bottom - top);
  if (!Number.isFinite(span) || span <= 0) return null;
  const size = TILE,
    scale = (size - 4) / span,
    ox = size / 2 - ((left + right) * scale) / 2,
    oy = size / 2 - ((top + bottom) * scale) / 2,
    color = new Uint8Array(size * size * 4),
    zbuf = new Float32Array(size * size).fill(-Infinity),
    rgb = [0, 0, 0, 0],
    cloud = [0, 0, 0, 0];
  let painted = false;
  for (const { screen: s, uv, indices, base, cloud: clouds, planet, alpha, emissive, tint } of parts) {
    for (let k = 0; k < s.length; k += 4) {
      s[k] = s[k] * scale + ox;
      s[k + 1] = s[k + 1] * scale + oy;
    }
    for (let tri = 0; tri < indices.length; tri += 3) {
      const A = indices[tri],
        B = indices[tri + 1],
        C = indices[tri + 2],
        i = A * 4,
        j = B * 4,
        k = C * 4,
        X = s[i],
        Y = s[i + 1],
        dx = s[j] - X,
        dy = s[j + 1] - Y,
        ex = s[k] - X,
        ey = s[k + 1] - Y,
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-6) continue;
      const x0 = Math.max(0, Math.floor(Math.min(X, s[j], s[k]))),
        x1 = Math.min(size - 1, Math.ceil(Math.max(X, s[j], s[k]))),
        y0 = Math.max(0, Math.floor(Math.min(Y, s[j + 1], s[k + 1]))),
        y1 = Math.min(size - 1, Math.ceil(Math.max(Y, s[j + 1], s[k + 1])));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const b = ((x + 0.5 - X) * ey - (y + 0.5 - Y) * ex) / den,
            c = (dx * (y + 0.5 - Y) - dy * (x + 0.5 - X)) / den,
            a = 1 - b - c;
          if (a < 0 || b < 0 || c < 0) continue;
          const px = y * size + x,
            z = a * s[i + 2] + b * s[j + 2] + c * s[k + 2];
          if (z <= zbuf[px]) continue;
          const u = a * uv[A * 2] + b * uv[B * 2] + c * uv[C * 2],
            v = a * uv[A * 2 + 1] + b * uv[B * 2 + 1] + c * uv[C * 2 + 1];
          sample(base, u, v, rgb);
          if (alpha && rgb[3] < 45) continue;
          if (planet && clouds) {
            sample(clouds, u, v, cloud);
            const f = (0.68 * cloud[3]) / 255;
            for (let n = 0; n < 3; n++) rgb[n] = rgb[n] * (1 - f) + cloud[n] * f;
          }
          zbuf[px] = z;
          painted = true;
          const light = emissive ? 1 : 0.28 + 0.92 * (a * s[i + 3] + b * s[j + 3] + c * s[k + 3]);
          for (let n = 0; n < 3; n++) color[px * 4 + n] = Math.min(255, rgb[n] * light * (0.45 + 0.55 * (tint[n] ?? 1)));
          color[px * 4 + 3] = emissive ? Math.max(rgb[0], rgb[1], rgb[2]) : alpha ? rgb[3] : 255;
        }
    }
  }
  return painted ? color : null;
}
export function planetSheets(archive, planets, maps, home) {
  const dir = path.join(home, 'planet-portraits-v1');
  fs.mkdirSync(dir, { recursive: true });
  const seen = new Map(),
    indices = [...new Set(maps.flatMap(m => m.worlds.map(([i]) => i)))],
    pages = [],
    tiles = [],
    texture = sampler(archive);
  function flush() {
    if (!tiles.length) return;
    const width = TILE * COLS,
      height = TILE * Math.ceil(tiles.length / COLS),
      out = Buffer.alloc(width * height * 4);
    for (let n = 0; n < tiles.length; n++)
      for (let y = 0; y < TILE; y++)
        out.set(tiles[n].subarray(y * TILE * 4, (y + 1) * TILE * 4), ((Math.floor(n / COLS) * TILE + y) * width + (n % COLS) * TILE) * 4);
    const bytes = png(width, height, out),
      id = createHash('sha256').update(bytes).digest('hex'),
      dest = path.join(dir, id + '.png');
    if (!fs.existsSync(dest)) {
      const tmp = dest + '.' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, dest);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    pages.push(id);
    tiles.length = 0;
  }
  for (const i of indices) {
    const p = planets[i],
      key = archive.resolve('Data/Art/Models/' + p[5]) || archive.resolve('Data/Art/Models/' + p[5] + '.alo');
    if (!seen.has(key)) {
      let pic;
      try {
        const len = archive.index.get(key)?.size;
        if (len > 0 && len < 32 * 1024 ** 2) pic = rasterPortrait(parseALO(exact(archive.read(key))), texture);
      } catch {
        /* Missing or unsupported model: the chart still draws a shaded globe. */
      }
      seen.set(key, pic ? [pages.length, tiles.length] : null);
      if (pic) {
        tiles.push(pic);
        if (tiles.length === COLS * COLS) flush();
      }
    }
    p[9] = seen.get(key);
  }
  flush();
  return pages;
}
