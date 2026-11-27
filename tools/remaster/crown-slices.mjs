// Offline orthographic slices of the actual CC0 crown, with alpha-tested source UVs.
// Not a camera-facing billboard: each slice stays in the donor's local frame, including from above.
import fs from 'node:fs';
import path from 'node:path';
const [dir, out] = process.argv.slice(2),
  g = JSON.parse(fs.readFileSync(path.join(dir, 'model.gltf'))),
  bin = fs.readFileSync(path.join(dir, g.buffers[0].uri));
function read(i) {
  const a = g.accessors[i],
    b = g.bufferViews[a.bufferView],
    C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  return new C(bin.buffer, bin.byteOffset + (b.byteOffset || 0) + (a.byteOffset || 0), a.count * { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type]);
}
const N = 512,
  S = 4,
  atlas = Buffer.alloc(N * N * S * 3 * 4),
  zbuf = new Float32Array(N * N * S * 3).fill(-Infinity),
  bounds = [
    [-14, 13],
    [-11, 11],
    [-0.4, 21]
  ],
  planes = [
    [0, 2, 1],
    [1, 2, 0],
    [0, 1, 2]
  ];
for (const pr of g.meshes[0].primitives) {
  const pos = read(pr.attributes.POSITION),
    uv = read(pr.attributes.TEXCOORD_0),
    idx = read(pr.indices),
    rgb = fs.readFileSync(path.join(dir, pr.material + '.rgba')),
    leaf = pr.material === 2;
  for (let side = 0; side < 3; side++) {
    const [u, v, w] = planes[side],
      n = pos.length / 3,
      X = new Float32Array(n),
      Y = new Float32Array(n),
      Z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = [pos[3 * i], -pos[3 * i + 2], pos[3 * i + 1]],
        unit = k => (p[k] - bounds[k][0]) / (bounds[k][1] - bounds[k][0]);
      X[i] = 1 + unit(u) * (N - 2);
      Y[i] = 1 + (1 - unit(v)) * (N - 2);
      Z[i] = unit(w);
    }
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i],
        b = idx[i + 1],
        c = idx[i + 2],
        x = X[a],
        y = Y[a],
        bx = X[b] - x,
        by = Y[b] - y,
        cx = X[c] - x,
        cy = Y[c] - y,
        det = bx * cy - by * cx;
      if (Math.abs(det) < 1e-7) continue;
      const x0 = Math.max(0, Math.ceil(Math.min(x, X[b], X[c]) - 0.5)),
        x1 = Math.min(N - 1, Math.floor(Math.max(x, X[b], X[c]) - 0.5)),
        y0 = Math.max(0, Math.ceil(Math.min(y, Y[b], Y[c]) - 0.5)),
        y1 = Math.min(N - 1, Math.floor(Math.max(y, Y[b], Y[c]) - 0.5));
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const dx = px + 0.5 - x,
            dy = py + 0.5 - y,
            h = (dx * cy - dy * cx) / det,
            k = (bx * dy - by * dx) / det,
            l = 1 - h - k;
          if (Math.min(h, k, l) < 0) continue;
          const z = Z[a] * l + Z[b] * h + Z[c] * k,
            sl = Math.max(0, Math.min(S - 1, Math.floor(z * S))),
            p = (side * N + py) * N * S + sl * N + px;
          if (z <= zbuf[p]) continue;
          const tu = Math.floor((uv[a * 2] * l + uv[b * 2] * h + uv[c * 2] * k) * 1024) & 1023,
            tv = Math.floor((uv[a * 2 + 1] * l + uv[b * 2 + 1] * h + uv[c * 2 + 1] * k) * 1024) & 1023,
            t = (tv * 1024 + tu) * 4;
          if (leaf && rgb[t + 3] < 104) continue;
          for (let j = 0; j < 3; j++) atlas[p * 4 + j] = rgb[t + j];
          atlas[p * 4 + 3] = 255;
          zbuf[p] = z;
        }
    }
  }
}
fs.writeFileSync(path.join(out, 'crown.rgba'), atlas);
fs.writeFileSync(path.join(out, 'crown-depth.bin'), new Uint8Array(zbuf.buffer));
