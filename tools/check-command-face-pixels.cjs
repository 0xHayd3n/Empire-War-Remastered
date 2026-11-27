// Evaluated inside the mounted frame. Sample the rendered rail asset (including
// inline standards), not SVG paint declarations: a colored disc can still be wrong.
module.exports = async function checkFacePixels(el, key, color) {
  const crest = el.querySelector('.op-family-current .uc-crest');
  let im = crest;
  if (crest.tagName !== 'IMG') {
    const copy = crest.cloneNode(true);
    copy.setAttribute('width', '256');
    copy.setAttribute('height', '256');
    copy.setAttribute('fill', 'none');
    copy.setAttribute('stroke', getComputedStyle(crest).stroke);
    copy.setAttribute('stroke-width', getComputedStyle(crest).strokeWidth);
    im = new Image();
    im.src = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  }
  await im.decode();
  const W = 384,
    c = document.createElement('canvas');
  c.width = c.height = W;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0, W, W);
  const p = ctx.getImageData(0, 0, W, W).data,
    rgb = [1, 3, 5].map(k => parseInt(color.slice(k, k + 2), 16));
  let paint = 0,
    other = 0,
    clear = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) clear++;
    // Compositing antialiased edges of touching paths rounds premultiplied
    // RGB. Only fully opaque pixels are a reliable sample of the paint.
    if (p[i + 3] !== 255) continue;
    paint++;
    if (rgb.some((n, k) => Math.abs(p[i + k] - n) > 2)) other++;
  }
  if (paint < 180 || clear < W * W * 0.1 || other !== 0)
    throw Error(`${key}: ${paint} painted pixels, ${other} not ${color}, ${clear} transparent`);
  // Points in the actual display frame, independent of contour or material implementation.
  const probes = {
    '1976399102/Techno_Union': [
      [0.1, 0.28, 0],
      [0.501, 0.43, 0],
      [0.17, 0.45, 1],
      [0.46, 0.42, 1],
      [0.5, 0.84, 1]
    ],
    '1125571106/Rebel': [
      [0.5, 0.5, 1],
      [0.42, 0.12, 1], // star just left of top center
      [0.5, 0.035, 1], // outer ring
      [0.5, 0.17, 0] // black field above the bird
    ],
    '1125571106/Eriadu_Authority': [
      [0.5, 0.5, 0],
      [0.67, 0.5, 1]
    ],
    '1125571106/Greater_Maldrood': [
      [0.5, 0.5, 0],
      [0.67, 0.5, 1]
    ],
    '1125571106/Corellia': [
      [0.5, 0.5, 1], // central device
      [0.5, 0.047, 1], // outer band
      [0.5, 0.117, 0], // former purple ground
      [0.5, 0.193, 0]
    ],
    '1125571106/Pentastar': [
      [0.5, 0.5, 1],
      [0.32, 0.36, 0]
    ],
    '1125571106/Underworld': [
      [0.05, 0.1, 0],
      [0.22, 0.25, 0]
    ],
    '1125571106/Chiss': [[0.5, 0.5, 0]],
    '1125571106/Yevetha': [[0.5, 0.5, 0]],
    '1125571106/SsiRuuvi_Imperium': [
      [0.5, 0.5, 0],
      [0.5, 0.3, 1]
    ],
    '1770851727/Sith': [
      [0.5, 0.5, 1],
      [0.2, 0.5, 0]
    ],
    '3417277973/Sith_Warlords': [
      [0.5, 0.5, 1],
      [0.5, 0.22, 0]
    ]
  };
  for (const [x, y, on] of probes[key] || []) {
    const a = p[(Math.floor(x * W) + W * Math.floor(y * W)) * 4 + 3];
    if ((on && a < 192) || (!on && a > 64)) throw Error(`${key}: expected ${on ? 'ink' : 'cutout'} at ${x},${y}; alpha ${a}`);
  }
  return { paint, other, clear };
};
