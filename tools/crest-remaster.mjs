// Offline only: derive clean, flat enamel artwork from the winning source in
// this pack. Unlike the projected device it retains multiple inks and its field.
import { createHash } from 'node:crypto';
import { masterSvg } from '../public/js/game/crestmasters.js';
import { traceCrestField } from '../public/js/game/crestoutline.js';
const reviewed = {
  stock: {
    Rebel: ['alliance', '1b1e2b9131e62b5ec3d4e18f'],
    Empire: ['empire', '4ddca480b6bca1164190031a'],
    Underworld: ['zann', '6d775a76ce4dd070282ae125']
  },
  1397421866: {
    Rebel: ['alliance', '9a172639fea5b34aab473aba'],
    Empire: ['empire', 'dd33f1aab7eb5019c90f48c2'],
    Pirates: ['zann', '56fe188324c8801ad11c08d9']
  },
  3387971722: { Pirates: ['zann', 'd83071eaf4ba58804dd24b6e'] },
  1770851727: {
    Rebel: ['alliance', '2953758e3cf05775c794e1aa'],
    Empire: ['empire', 'ddd44edd64a76a7d6e67b8bb'],
    Underworld: ['zann', 'df8ec5ed8020d77eeec12385']
  }
};
const single = {
  'BS_STARBASE_INSIGNIA.DDS': '#e5ad34',
  'W_LAMP_BANNER_TRADE_FED.DDS': '#993e33',
  'W_LAMP_BANNER_TECHNO_UNION.DDS': '#ecc136',
  'W_LAMP_BANNER_COMMERCE_GUILD.DDS': 'url(#guild)',
  'I_EVENT_CIS_LOGO_DEFAULT.TGA': '#3379da',
  'I_EVENT_REPUBLIC_LOGO_DEFAULT.TGA': '#b83352',
  'W_R2_TERMINAL_SYMBOL_MANDO.DDS': '#559ce5'
};
// Fit short round joins through smooth turns. Keep angular cuts and pointed
// tips, and use evenodd compound paths so a hole never becomes a solid disk.
function path(rings) {
  const pt = (x, y) => `${Math.round(x)},${Math.round(y)}`;
  return rings
    .map(a => {
      let d = '';
      const n = a.length;
      for (let i = 0; i < n; i += 2) {
        const x = a[i],
          y = a[i + 1],
          ax = a[(i + n - 2) % n] - x,
          ay = a[(i + n - 1) % n] - y,
          bx = a[(i + 2) % n] - x,
          by = a[(i + 3) % n] - y,
          al = Math.hypot(ax, ay),
          bl = Math.hypot(bx, by),
          r = ax * bx + ay * by < -0.18 * al * bl ? Math.min(100, 0.42 * al, 0.42 * bl) : 0;
        d += (i ? 'L' : 'M') + pt(x + ax * (r / (al || 1)), y + ay * (r / (al || 1)));
        if (r) d += 'Q' + pt(x, y) + ' ' + pt(x + (bx * r) / bl, y + (by * r) / bl);
      }
      return d + 'Z';
    })
    .join('');
}
function palette(pixels) {
  const bins = new Map();
  for (const [r, g, b, a] of pixels) {
    if (a < 0.28) continue;
    const k = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    let v = bins.get(k);
    if (!v) bins.set(k, (v = [0, 0, 0, 0]));
    v[0] += r * a;
    v[1] += g * a;
    v[2] += b * a;
    v[3] += a;
  }
  const samples = [...bins.values()].sort((a, b) => b[3] - a[3]).map(([r, g, b, n]) => [r / n, g / n, b / n, n]);
  if (!samples.length) return [];
  const dist = (a, b) => (a[0] - b[0]) ** 2 + 1.6 * (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers = [samples[0].slice(0, 3)];
  while (centers.length < 8) {
    let best,
      score = 0;
    for (const s of samples) {
      const d = Math.min(...centers.map(c => dist(c, s)));
      if (d < 1100) continue;
      const priority = d * Math.sqrt(s[3]);
      if (priority > score) {
        best = s;
        score = priority;
      }
    }
    if (!best) break;
    centers.push(best.slice(0, 3));
  }
  let sums;
  for (let i = 0; i < 5; i++) {
    sums = centers.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let k = 0;
      for (let j = 1; j < centers.length; j++) if (dist(s, centers[j]) < dist(s, centers[k])) k = j;
      const q = sums[k];
      for (let c = 0; c < 3; c++) q[c] += s[c] * s[3];
      q[3] += s[3];
    }
    sums.forEach((s, j) => {
      if (s[3]) centers[j] = s.slice(0, 3).map(v => v / s[3]);
    });
  }
  return centers
    .map((c, i) => [c, sums[i][3]])
    .filter(a => a[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(a => a[0]);
}
function wrap(layers) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [, rings] of layers)
    for (const a of rings)
      for (let i = 0; i < a.length; i += 2) {
        minX = Math.min(minX, a[i]);
        maxX = Math.max(maxX, a[i]);
        minY = Math.min(minY, a[i + 1]);
        maxY = Math.max(maxY, a[i + 1]);
      }
  const side = (Math.max(maxX - minX, maxY - minY) || 1) * 1.06;
  if (!Number.isFinite(side)) return '';
  const defs = layers.some(([fill]) => fill === 'url(#guild)')
    ? '<defs><linearGradient id="guild"><stop offset="50%" stop-color="#70ab28"/><stop offset="50%" stop-color="#2684cd"/></linearGradient></defs>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${Math.round((maxX + minX - side) / 2)} ${Math.round((maxY + minY - side) / 2)} ${Math.ceil(side)} ${Math.ceil(side)}">${defs}${layers.map(([fill, rings]) => `<path fill="${fill}" fill-rule="evenodd" d="${path(rings)}"/>`).join('')}</svg>`;
}
// Paint the cropped Ssi-ruuvi device in its two native inks. The base contour
// already excludes the outer rim and the central star; clip the second enamel
// to it as well so smoothing at the tiny tips cannot refill the aperture.
export function ruuviEnamel(outline, {src,rect:{x,y,w,h}}) {
  const W=w+2,H=h+2, warm=new Float32Array(W*H);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const k=((y+j)*src.width+x+i)*4,s=src.data;
    warm[(j+1)*W+i+1]=Math.max(0,Math.min(1,(s[k]-s[k+2]+12)/32))*s[k+3]/255;
  }
  const gold=traceCrestField(warm,W,H,.5,Math.max(w,h));
  const svg=wrap([['#2781c6',outline.body]]),d=path(outline.body);
  return svg.replace('</svg>',`<defs><clipPath id="ink"><path clip-rule="evenodd" d="${d}"/></clipPath></defs><path fill="#aa7713" fill-rule="evenodd" clip-path="url(#ink)" d="${path(gold)}"/></svg>`);
}
export function remaster(profile, id, mark, { src, rect }, name) {
  // Same geometry, five different enamel fields in the mounted New Republic era.
  // Verify the actual loose source (not the much smaller map thumbnail).
  const regimes = {
    Empire: 'd6be8a5bb3632c3ed6eefd5b',
    Eriadu_Authority: '99b789771de5f596ae02aeb0',
    Greater_Maldrood: 'fca9a4de027617a9c18321a0',
    Zsinj_Empire: '8a925571c80185e9de95a415',
    Imperial_Proteus: '2645b054c30f3c3d09e083b7'
  };
  if (
    profile === '1125571106' &&
    regimes[id] &&
    src.width === 128 &&
    src.height === 128 &&
    createHash('sha256').update(src.data).digest('hex').startsWith(regimes[id])
  ) {
    const k = (36 * 128 + 81) * 4,
      field = '#' + Array.from(src.data.subarray(k, k + 3), v => v.toString(16).padStart(2, '0')).join('');
    mark.master = 'regime';
    return masterSvg('regime', false, field);
  }
  const choice = reviewed[profile]?.[id];
  if (choice && createHash('sha256').update(mark.art).digest('hex').startsWith(choice[1])) {
    mark.master = choice[0];
    return masterSvg(choice[0]);
  }
  if (single[name.toUpperCase()]) return wrap([[single[name.toUpperCase()], mark.outline.body]]);
  const { x, y, w, h } = rect;
  if (w * h > 1024 * 1024) return '';
  const W = w + 2,
    H = h + 2,
    pixels = [];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = ((j + y) * src.width + i + x) * 4,
        s = src.data;
      pixels.push([s[k], s[k + 1], s[k + 2], s[k + 3] / 255]);
    }
  const cols = palette(pixels);
  if (!cols.length) return '';
  const fields = cols.map(() => new Float32Array(W * H));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const p = pixels[j * w + i],
        k = (j + 1) * W + i + 1;
      fields[0][k] = p[3];
      if (!p[3] || cols.length < 2) continue;
      const ds = cols.map(c => (c[0] - p[0]) ** 2 + 1.6 * (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2);
      let near = 0;
      for (let n = 1; n < ds.length; n++) if (ds[n] < ds[near]) near = n;
      for (let n = 1; n < cols.length; n++) {
        const alt = n === near ? Math.min(...ds.filter((_, idx) => idx !== n)) : ds[near];
        fields[n][k] = p[3] * Math.max(0, Math.min(1, 0.5 + (alt - ds[n]) / (1 + alt + ds[n])));
      }
    }
  const layers = [];
  for (const [n, field] of fields.entries()) {
    const rings = traceCrestField(field, W, H, n ? 0.465 : 0.5, Math.max(w, h));
    if (rings.length) layers.push(['#' + cols[n].map(c => Math.round(c).toString(16).padStart(2, '0')).join(''), rings]);
  }
  return wrap(layers);
}
