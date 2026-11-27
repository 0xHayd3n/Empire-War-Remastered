// Endor conifer foliage: one hemlock sapling or one redwood crown, written into a geometry()
// builder owned by the caller. Only foliage strips are emitted; trunk, bark, material and
// instancing stay in endor-thicket's mesh(). No imports, so the counts are deterministic and the
// near and far levels describe the same branches.
const TAU = Math.PI * 2;
// Approved atlas tile 3: the bottom-right bough panel of boughs.png, a cut branch with its stick
// down the middle of the panel. The cut-out's base sits at the v-high edge, its tip at v-low.
const UV_X = 0.507,
  UV_W = 0.486,
  UV_Y = 0.507;
// Rows per strip. Near keeps the droop arc smooth; far is a straight blade, a third of the cost.
const ROWS_NEAR = [0, 0.3, 0.62, 1],
  ROWS_FAR = [0, 0.5, 1],
  ROWS_HEMLOCK = [0, 0.4, 1],
  // Strip width at each row, following the cut-out's own outline: a stick, the broad sprays just
  // past the first third, then the tapered tip. Squashed and jittered per bough, so no two
  // branches share the same chevron.
  WIDE_NEAR = [0.24, 0.98, 0.86, 0.44],
  WIDE_FAR = [0.24, 0.96, 0.5],
  WIDE_HEMLOCK = [0.22, 0.96, 0.5];
function rnd(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 13), 0x165667b1);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// A bough is a narrow strip that leaves the trunk slightly upward, sweeps outward, then hangs
// below its own attachment at the tip. Rows are sampled along that arc; the strip's width axis is
// rolled about the bough axis so neighbouring sprays do not share one plane, and the atlas
// midrib (which sits at 42% of the panel, not the centre) is shifted back onto the axis.
function bough(g, seed, cx, cy, cz, az, len, wide, rise, droop, twist, roll, flip, rows, wideRow) {
  const n = rows.length,
    uA = flip ? UV_X + UV_W : UV_X,
    uB = flip ? UV_X : UV_X + UV_W,
    cs = Math.cos(roll),
    sn = Math.sin(roll);
  let prev = null;
  for (let i = 0; i < n; i++) {
    const t = rows[i],
      a = az + twist * t,
      dx = Math.cos(a),
      dy = Math.sin(a),
      d = len * t,
      px = cx + dx * d,
      py = cy + dy * d,
      pz = cz + rise * t - droop * Math.pow(t, 1.55),
      w = wide * wideRow[i] * (0.86 + 0.28 * rnd(seed, i, 5)),
      // 0.16 of the half width puts the photographed stick on the bough axis
      o = w * 0.16 * (flip ? -1 : 1),
      vx = -dy * cs,
      vy = dx * cs,
      vz = sn,
      // bough tangent, for the strip normal
      tx = dx * len,
      ty = dy * len,
      tz = rise - droop * 1.55 * Math.pow(t, 0.55),
      tl = Math.hypot(tx, ty, tz) || 1,
      nx = (ty * vz - tz * vy) / tl,
      ny = (tz * vx - tx * vz) / tl,
      nz = (tx * vy - ty * vx) / tl,
      nl = Math.hypot(nx, ny, nz) || 1,
      v = UV_Y + UV_W * (1 - t),
      ax = px + vx * (o - w),
      ay = py + vy * (o - w),
      az0 = pz + vz * (o - w),
      bx = px + vx * (o + w),
      by = py + vy * (o + w),
      bz0 = pz + vz * (o + w),
      A = g.vertex(ax, ay, az0, uA, v, nx / nl, ny / nl, nz / nl),
      B = g.vertex(bx, by, bz0, uB, v, nx / nl, ny / nl, nz / nl);
    if (prev) g.quad(prev[0], prev[1], B, A);
    prev = [A, B];
  }
}
// Redwood crown: a staggered column of broken whorls whose reach falls away toward the spire.
// Branch counts, attachment radii, tilts and lengths all wander, so neither the tiers nor the
// upward chevrons read as repeats, and the ragged cut-out edges overlap into a solid cone that
// holds up from the tactical camera and from command height.
function crown(g, near) {
  const rows = near ? ROWS_NEAR : ROWS_FAR,
    wideRow = near ? WIDE_NEAR : WIDE_FAR,
    counts = near ? [11, 10, 10, 10, 9, 9, 8, 7, 6, 5] : [8, 8, 7, 7, 6, 5],
    K = counts.length;
  for (let j = 0; j < K; j++) {
    const t = K > 1 ? j / (K - 1) : 0,
      z = 88 + 106 * t + (rnd(j, 0, 41) - 0.5) * 5,
      reach = 31 * Math.pow(1 - 0.9 * t, 0.8) + 1.4,
      // lower whorls spread flat and low, the crown top turns its sprays upright
      roll0 = 0.22 + 0.58 * t + (rnd(j, 1, 43) - 0.5) * 0.24,
      spin = j * 2.39996 + rnd(j, 2, 47) * 0.7,
      n = counts[j];
    for (let i = 0; i < n; i++) {
      const q1 = rnd(j, i, 11),
        q2 = rnd(i, j, 23),
        q3 = rnd(j * 7 + i, i, 31),
        q4 = rnd(j + i, 3, 53),
        az = spin + (i + (q1 - 0.5) * 0.62) * (TAU / n),
        len = reach * (0.6 + 0.52 * q2),
        r0 = reach * (0.03 + 0.15 * q3);
      bough(
        g,
        j * 131 + i,
        Math.cos(az) * r0,
        Math.sin(az) * r0,
        z + (q2 - 0.5) * 4,
        az,
        len,
        len * (0.6 + 0.15 * q4 + 0.2 * t),
        len * (0.1 + 0.16 * q1),
        Math.min(len * (0.3 + 0.32 * q3), (z - 78) * (0.55 + 0.45 * q4)),
        (q2 - 0.5) * 0.5,
        roll0 + (q4 - 0.5) * 0.55,
        q1 > 0.5,
        rows,
        wideRow
      );
    }
  }
}
// Hemlock: a small drooping sapling. Wide lower whorls hang below their attachment and let the
// sprays sweep down and outward, then the whorls shorten quickly into a soft spire so the
// silhouette still reads as one small tree from above.
function hemlock(g, near) {
  const rows = ROWS_HEMLOCK,
    wideRow = WIDE_HEMLOCK,
    counts = near ? [6, 6, 6, 5, 5, 5, 4, 4, 3] : [4, 4, 4, 4, 3, 3, 3],
    K = counts.length;
  for (let j = 0; j < K; j++) {
    // internodes shorten toward the tip, as they do on a real sapling, so the upper whorls touch
    const t = K > 1 ? j / (K - 1) : 0,
      z = 8 + 42 * Math.pow(t, 0.72) + (rnd(j, 4, 67) - 0.5) * 2.2,
      u = Math.min(1, Math.max(0, (z - 8) / 42)),
      reach = 13.6 * Math.pow(1 - 0.9 * u, 0.8) + 1.4,
      roll0 = 0.3 + 0.5 * u + (rnd(j, 5, 71) - 0.5) * 0.24,
      spin = j * 2.39996 + rnd(j, 6, 73) * 0.8,
      n = counts[j];
    for (let i = 0; i < n; i++) {
      const q1 = rnd(j, i, 17),
        q2 = rnd(i, j, 19),
        q3 = rnd(j * 5 + i, i, 29),
        q4 = rnd(i * 3 + j, 7, 37),
        az = spin + (i + (q1 - 0.5) * 0.66) * (TAU / n),
        len = reach * (0.62 + 0.5 * q2),
        r0 = reach * (0.03 + 0.16 * q3);
      bough(
        g,
        j * 97 + i,
        Math.cos(az) * r0,
        Math.sin(az) * r0,
        z + (q2 - 0.5) * 1.8,
        az,
        len,
        len * (0.6 + 0.15 * q4 + 0.2 * t),
        len * (0.06 + 0.16 * q1 + 0.34 * u),
        Math.min(len * (0.45 + 0.3 * q3), (z - 3.2) * (0.5 + 0.5 * q4)),
        (q2 - 0.5) * 0.72,
        roll0 + (q4 - 0.5) * 0.85,
        q1 > 0.5,
        rows,
        wideRow
      );
    }
  }
}
export function conifer(g, kind, near) {
  if (kind === 'crown') crown(g, near);
  else hemlock(g, near);
}
