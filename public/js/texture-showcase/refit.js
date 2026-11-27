// Venator dry-dock atlas. Authored in a 512-unit drawing space on the reviewed hull UVs.
// Colour, relief and gloss share a single material layout, rather than deriving bumps from paint brightness.
import { decodeDXT } from '../ddsdecode.js';
import { encodeDXT } from '../ddsmips.js';
import { outputBytes, sizeOfMip } from './recipes.js';
// DDS samples are NoColorSpace in Universal: average numeric linear albedo, not sRGB display values.
function downColour(src, n) {
  const w = n >> 1,
    out = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * n * 2 + x * 2) * 4,
        j = i + n * 4,
        o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = (src[i + c] + src[i + 4 + c] + src[j + c] + src[j + 4 + c] + 2) >> 2;
    }
  return out;
}
const sat = x => Math.max(0, Math.min(1, x)),
  mix = (a, b, t) => a + (b - a) * t;
const hash = (x, y) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
// Charcoal machinery, blue-grey armor, pale ceramic facing, exposed titanium, ochre service paint.
const colors = [
  [18, 26, 33],
  [57, 75, 92],
  [148, 155, 151],
  [93, 107, 118],
  [176, 105, 39],
  [43, 52, 63],
  [207, 212, 197]
];
// Paint a source-independent set of recessed hatches, vents and service legends. These pieces
// are localized on mapped surfaces; no text in mirrored islands, where it would read backwards.
function blueprint(n, turret) {
  const ink = new Uint8Array(n * n),
    relief = new Int8Array(n * n),
    scale = n / 512;
  function poly(points, id, z) {
    let xmin = 512,
      xmax = 0,
      ymin = 512,
      ymax = 0;
    for (const [x, y] of points) {
      xmin = Math.min(x, xmin);
      xmax = Math.max(x, xmax);
      ymin = Math.min(y, ymin);
      ymax = Math.max(y, ymax);
    }
    for (let y = Math.max(0, Math.floor(ymin * scale)); y < Math.min(n, Math.ceil(ymax * scale)); y++) {
      const yy = (y + 0.5) / scale;
      for (let x = Math.max(0, Math.floor(xmin * scale)); x < Math.min(n, Math.ceil(xmax * scale)); x++) {
        const xx = (x + 0.5) / scale;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i],
            b = points[j];
          if (a[1] > yy !== b[1] > yy && xx < ((b[0] - a[0]) * (yy - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        if (inside) {
          const p = y * n + x;
          ink[p] = id + 1;
          relief[p] = z;
        }
      }
    }
  }
  const rect = (x, y, w, h, id, z = 0) =>
    poly(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h]
      ],
      id,
      z
    );
  const plate = (x, y, w, h, id, z, c = 1.5) =>
    poly(
      [
        [x + c, y],
        [x + w, y],
        [x + w, y + h - c],
        [x + w - c, y + h],
        [x, y + h],
        [x, y + c]
      ],
      id,
      z
    );
  function hatch(x, y, w, h) {
    plate(x, y, w, h, 0, -20);
    plate(x + 0.8, y + 0.8, w - 1.6, h - 1.6, 3, 9);
    plate(x + 1.5, y + 1.6, w - 3, h - 3.5, 1, 5);
    rect(x + w * 0.65, y + h * 0.38, 0.8, h * 0.24, 6);
  }
  function radiator(x, y, w, h) {
    plate(x, y, w, h, 3, 5);
    plate(x + 1, y + 1, w - 2, h - 2, 0, -26);
    for (let v = 2; v < h - 1; v += 2.8)
      poly(
        [
          [x + 2, y + v],
          [x + w - 2, y + v - 0.65],
          [x + w - 2, y + v + 0.3],
          [x + 2, y + v + 1.15]
        ],
        5,
        4
      );
  }
  function guide(x, y, len) {
    rect(x, y, 1.1, len, 6);
    for (let k = 0; k < 4; k++) rect(x + 1.1, y + k * 2.9, 2.4, 0.7, 6);
  }
  function chevrons(x, y, count) {
    for (let i = 0; i < count; i++)
      poly(
        [
          [x, y + i * 5],
          [x + 5, y + 2 + i * 5],
          [x + 5, y + 3.7 + i * 5],
          [x, y + 1.7 + i * 5]
        ],
        4,
        0
      );
  }
  if (!turret) {
    // Swept dorsal shoulder: long graphite insert, pale escort stripe and open maintenance wells.
    poly(
      [
        [121, 99],
        [128, 88],
        [113, 246],
        [98, 302],
        [91, 318],
        [91, 306],
        [105, 244]
      ],
      1,
      3
    );
    poly(
      [
        [119, 113],
        [120.8, 110],
        [105.4, 243],
        [98, 264],
        [102.8, 242]
      ],
      2,
      2
    );
    poly(
      [
        [86, 321],
        [92, 331],
        [90, 388],
        [74, 418],
        [49, 438],
        [48, 434],
        [68, 413],
        [82, 389]
      ],
      1,
      4
    );
    // Dorsal boarding-bay keep-clear marking: twin broken chevrons follow the swept shoulder.
    for (const [x, y] of [
      [97, 210],
      [92, 236],
      [79, 378]
    ]) {
      poly(
        [
          [x, y],
          [x + 8, y - 4],
          [x + 11, y - 1.8],
          [x + 8.1, y - 2.1],
          [x - 0.35, y + 2.3]
        ],
        2,
        0
      );
      poly(
        [
          [x + 0.5, y + 4],
          [x + 8.1, y + 0.3],
          [x + 10.2, y + 1.6],
          [x + 8.2, y + 1.8],
          [x + 0.25, y + 5.3]
        ],
        4,
        0
      );
    }
    for (const [x, y, w, h] of [
      [110, 173, 5, 22],
      [99, 228, 6, 16],
      [85, 273, 7, 20],
      [73, 303, 8, 11],
      [81, 367, 6, 14],
      [71, 398, 7, 9],
      [251, 369, 10, 15],
      [263, 315, 8, 18],
      [361, 379, 11, 19]
    ])
      radiator(x, y, w, h);
    for (const [x, y, w, h] of [
      [96, 248, 8, 12],
      [92, 277, 9, 13],
      [80, 327, 10, 14],
      [106, 375, 9, 12],
      [169, 307, 12, 21],
      [179, 391, 16, 18],
      [166, 226, 8, 15],
      [354, 229, 8, 14],
      [375, 416, 10, 17]
    ])
      hatch(x, y, w, h);
    for (const [x, y] of [
      [92, 249],
      [79, 288],
      [85, 359],
      [167, 278],
      [178, 365],
      [263, 304],
      [357, 404]
    ]) {
      guide(x, y, 12);
      chevrons(x + 2.5, y + 1, 2);
    }
    // Ventral keel: offset reinforcement bays, interrupted by a pale inspection rail.
    poly(
      [
        [156, 122],
        [161, 130],
        [183, 402],
        [205, 454],
        [200, 457],
        [176, 403]
      ],
      1,
      4
    );
    poly(
      [
        [159, 149],
        [160.4, 151],
        [178.7, 397],
        [177, 393]
      ],
      2,
      2
    );
    for (let i = 0; i < 4; i++) {
      const x = 162 + i * 2.5,
        y = 213 + i * 38;
      rect(x, y, 6.5, 1, 6);
      rect(x + 1, y + 2.5, 3.6, 0.7, 4);
    }
  } else {
    radiator(82, 174, 38, 83);
    radiator(259, 141, 37, 51);
    hatch(148, 280, 42, 52);
    hatch(310, 305, 32, 50);
    guide(181, 129, 45);
    chevrons(193, 138, 4);
  }
  return { ink, relief };
}
function normalMip(src, n) {
  const w = n >> 1,
    out = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * n * 2 + x * 2) * 4,
        j = i + n * 4,
        o = (y * w + x) * 4;
      const comp = c => src[i + c] + src[i + 4 + c] + src[j + c] + src[j + 4 + c] - 510;
      const a = comp(0),
        b = comp(1),
        c = comp(2),
        s = 127.5 / (Math.hypot(a, b, c) || 1);
      out[o] = Math.round(127.5 + a * s);
      out[o + 1] = Math.round(127.5 + b * s);
      out[o + 2] = Math.round(127.5 + c * s);
      out[o + 3] = (src[i + 3] + src[i + 7] + src[j + 3] + src[j + 7] + 2) >> 2;
    }
  return out;
}
function dds(src, rgba, r, normal) {
  let w = r.side * r.scale;
  const out = new Uint8Array(outputBytes(r));
  out.set(src.subarray(0, 128));
  const d = new DataView(out.buffer);
  for (const [i, v] of [
    [2, 0xa1007],
    [3, w],
    [4, w],
    [5, sizeOfMip(w)],
    [7, 1 + Math.log2(w)],
    [20, 4],
    [27, 0x401008]
  ])
    d.setUint32(i * 4, v, true);
  let at = 128;
  for (; w >= 1; w >>= 1) {
    const blocks = encodeDXT(rgba, w, w, 5);
    if (!normal && w === r.side) {
      for (let i = 0; i < blocks.length; i += 16) blocks.set(src.subarray(128 + i, 136 + i), i);
    }
    out.set(blocks, at);
    at += blocks.length;
    if (w > 1) rgba = normal ? normalMip(rgba, w) : downColour(rgba, w);
  }
  return out;
}
export function refitPair(src, bump, cr, nr) {
  const n = cr.side * cr.scale,
    side = cr.side,
    turret = side === 256,
    ratio = side / n;
  for (const b of [src, bump]) {
    const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (
      d.getUint32(0, true) !== 0x20534444 ||
      d.getUint32(12, true) !== side ||
      d.getUint32(16, true) !== side ||
      d.getUint32(84, true) !== 0x35545844 ||
      d.getUint32(112, true) !== 0 ||
      b.length < 128 + sizeOfMip(side)
    )
      throw Error('Unexpected shipyard texture');
  }
  const original = decodeDXT(src.subarray(128), side, side, 5),
    norm = decodeDXT(bump.subarray(128), side, side, 5),
    albedo = new Uint8Array(n * n * 4),
    surface = new Uint8Array(n * n * 4),
    height = new Float32Array(n * n),
    { ink, relief } = blueprint(n, turret);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        o = i * 4,
        s = (Math.floor(y * ratio) * side + Math.floor(x * ratio)) * 4,
        yy = ((y + 0.5) * 512) / n,
        xx = ((x + 0.5) * 512) / n,
        lum = original[s + 1],
        mask = original[s + 3] / 255;
      // Staggered long faceplates with jogged seams, occasional replacement faces, and recessed expansion joints.
      // Big masses are quiet. Reserve louvers, bolt wells and paint damage for panel edges and service bays.
      const row = Math.floor(yy / 22),
        v = yy - row * 22,
        shift = hash(row, 11) * 21,
        u0 = xx + shift + Math.max(0, Math.min(4, v - 12)),
        col = Math.floor(u0 / 13.5),
        u = u0 - col * 13.5,
        seed = hash(row, col),
        edge = Math.min(v, 22 - v, u, 13.5 - u),
        mach = sat((95 - lum) / 39),
        armor = 1 - mach;
      // Dark structural bands follow the shoulder rather than a repeating wave through every UV island.
      const shoulder = xx + 0.108 * yy,
        dark = turret
          ? lum < 113
          : (shoulder > 125 && shoulder < 131 && yy > 94 && yy < 325) || (xx > 355 && xx < 365 && yy > 347 && yy < 420) || lum < 98;
      let id = dark ? 1 : 2;
      const material = ink[i] ? ink[i] - 1 : id,
        paint = ink[i] ? 1 : 0;
      let color = colors[material];
      const groove = 1 - sat((edge - 0.12) / 0.48),
        rim = sat(1 - Math.abs(edge - 0.83) / 0.39),
        weather = hash(x >> 1, y >> 1),
        bolt = (u - 1.8) ** 2 + (v - 2) ** 2 < 0.42 || (13.5 - u - 1.8) ** 2 + (22 - v - 2) ** 2 < 0.42;
      const baseline = lum < 50 ? 0.6 + lum / 125 : 0.86 + (lum - 96) * 0.004,
        plateTone = 0.83 + seed * 0.26,
        chip = rim * sat((weather - 0.48) * 3.4) * armor,
        smudge = sat(1 - edge / 2.2) * (0.5 + weather * 0.5),
        detail = (hash(x, y) - 0.5) * 2;
      const conduit = Math.abs((yy % 5) - 2.1) < 0.65 ? 1 : 0;
      for (let c = 0; c < 3; c++) {
        let f = mix(color[c] * plateTone, colors[0][c] * (0.68 + lum * 0.01) + conduit * 13, mach * (1 - paint));
        // The team tint multiplies RGB in this shader: feed it a neutral enamel rather than coloring the stripe twice.
        f = mix(f, [174, 168, 153][c] * plateTone, mask * 0.96);
        f =
          f * baseline * (1 - (1 - paint) * armor * (groove * 0.34 + smudge * 0.07 + (bolt ? 0.34 : 0))) + chip * (1 - paint) * 19 + detail;
        albedo[o + c] = Math.round(Math.max(0, Math.min(255, f)));
      }
      albedo[o + 3] = original[s + 3];
      height[i] = relief[i] * 0.043 + (1 - paint) * (armor * (-groove * 0.86 + rim * 0.16 + (bolt ? -0.42 : 0)) + mach * conduit * 0.24);
      const sheen = mix(dark ? 106 : 58, 42 + mach * 44, mach);
      surface[o + 3] = Math.round(
        Math.max(
          4,
          Math.min(
            228,
            mix(mix(sheen, 48, mask), [29, 92, 58, 165, 64, 86, 54][material], paint) + (norm[s + 3] - 110) * 0.24 + chip * 57 - groove * 20
          )
        )
      );
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        o = i * 4,
        s = (Math.floor(y * ratio) * side + Math.floor(x * ratio)) * 4;
      const dx = (height[i + (x > 0 ? -1 : 0)] - height[i + (x + 1 < n ? 1 : 0)]) * 0.59,
        dy = (height[i + (y > 0 ? -n : 0)] - height[i + (y + 1 < n ? n : 0)]) * 0.59;
      const a = (norm[s] / 127.5 - 1) * 0.82 + dx,
        b = (norm[s + 1] / 127.5 - 1) * 0.82 + dy,
        c = Math.max(0.035, norm[s + 2] / 127.5 - 1),
        k = 127.5 / Math.hypot(a, b, c);
      surface[o] = Math.round(127.5 + a * k);
      surface[o + 1] = Math.round(127.5 + b * k);
      surface[o + 2] = Math.round(127.5 + c * k);
    }
  return [dds(src, albedo, cr, false), dds(bump, surface, nr, true)];
}
