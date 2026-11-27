// Measured palettes on exact installed crops. Trace the surviving ink rather
// than extruding a disk and drawing transparent paint on top of it. No game
// pixels in this module; an unrecognized mod revision keeps its native outline.
import { createHash } from 'node:crypto';
import { traceCrestField } from '../public/js/game/crestoutline.js';
const reviewed = {
  '1125571106/Pentastar': [
    'P_ALLIED_PA.TGA',
    'd66dd83f728f7b2afae881d1',
    [
      [13, 44, 179],
      [213, 213, 213]
    ],
    [
      [145, 145, 145],
      [0, 0, 0]
    ],
    [0]
  ],
  '1125571106/Corellia': [
    'P_ALLIED_CF.TGA',
    'e8e025c28f754217fc8c83d0',
    [
      [183, 122, 23],
      [84, 147, 187],
      [211, 211, 211]
    ],
    [[63, 22, 107]],
    [1, 2]
  ],
  '1125571106/EmpireoftheHand': [
    'P_ALLIED_EOTH.TGA',
    '5241942760cd0d207d16d239',
    [
      [105, 105, 105],
      [55, 55, 55],
      [26, 103, 139],
      [165, 64, 104]
    ],
    [[193, 193, 193]],
    [2, 3]
  ],
  '1125571106/SsiRuuvi_Imperium': [
    'P_ALLIED_RUUVI.TGA',
    'c5eeba60be299b7dc6ba0c9f',
    [
      [37, 129, 199],
      [170, 119, 19]
    ],
    [
      [210, 193, 8],
      [0, 0, 0]
    ],
    [1]
  ],
  '1770851727/Sith': ['I_BUTTON_FACTION_SITH.TGA', '65b6cc2c8c64891f0d02263c', [[0, 62, 192]], [[240, 240, 240]], []]
};
export function deviceProjector(profile, id, name, { src, rect: { x, y, w, h } }) {
  const spec = reviewed[profile + '/' + id];
  if (!spec || name.toUpperCase() !== spec[0]) return null;
  const hash = createHash('sha256');
  for (let j = 0; j < h; j++) {
    const k = ((y + j) * src.width + x) * 4;
    hash.update(src.data.subarray(k, k + 4 * w));
  }
  if (!hash.digest('hex').startsWith(spec[1])) return null;
  const W = w + 2,
    H = h + 2,
    coverage = new Float32Array(W * H),
    detail = new Float32Array(W * H),
    [, , keep, discard, raised] = spec,
    dist = (a, b, c, p) => Math.hypot(a - p[0], b - p[1], c - p[2]);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      // Only the two interlocked insignia, not the identically blue outside rim.
      if (id === 'SsiRuuvi_Imperium' && Math.hypot((i + 0.5) / w - 0.5, (j + 0.5) / h - 0.5) > 0.454) continue;
      const k = ((j + y) * src.width + i + x) * 4,
        s = src.data,
        opacity = s[k + 3] / 255;
      if (!opacity) continue;
      const distances = keep.map(p => dist(s[k], s[k + 1], s[k + 2], p));
      const fg = Math.min(...distances),
        bg = Math.min(...discard.map(p => dist(s[k], s[k + 1], s[k + 2], p)));
      const a = opacity * Math.max(0, Math.min(1, 0.5 + (bg - fg) / 36));
      const pos = (j + 1) * W + i + 1;
      coverage[pos] = a;
      if (raised.includes(distances.indexOf(fg))) detail[pos] = a;
    }
  const trace = f => traceCrestField(f, W, H, 0.501, Math.max(w, h)),
    body = trace(coverage),
    relief = raised.length ? trace(detail) : [];
  return body.length ? { w, h, body, ...(relief.length ? { relief } : {}) } : null;
}
