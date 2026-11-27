import { crestOutline } from '../public/js/game/crestoutline.js';
// These mounted medallions are correct for the flat crest. For the solid,
// isolate the device rather than extruding its neutral enamel background.
const devices = {
  Hapes_Consortium: ['P_ALLIED_HC_ROYAL.TGA', 178],
  Rebel: ['P_ALLIED_SITH.TGA', 188],
  Sith_Warlords: ['P_ALLIED_SITH_WARLORD.TGA', 117]
};
export function revanProjector(profile, id, name, { src, rect }) {
  const pair = devices[id];
  if (profile !== '3417277973' || !pair || name.toUpperCase() !== pair[0]) return null;
  const { x, y, w, h } = rect,
    data = new Uint8ClampedArray(w * h * 4),
    s = src.data;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = ((j + y) * src.width + x + i) * 4,
        d = (j * w + i) * 4;
      const ink = Math.min(s[k], s[k + 1], s[k + 2]);
      data[d] = data[d + 1] = data[d + 2] = 255;
      data[d + 3] = s[k + 3] * Math.min(1, Math.max(0, (pair[1] - ink) / 32 + 0.5));
    }
  return crestOutline({ data, width: w, height: h });
}
