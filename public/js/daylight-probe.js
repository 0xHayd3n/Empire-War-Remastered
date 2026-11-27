// Diffuse incident light from the mounted land dome, never from the viewport, units or HUD.
// Integrate the UPPER hemisphere in linear RGB with cube solid-angle and Lambert cosine weights.
// The lower dome is frequently painted sky too; light arriving from below comes from the terrain.
import { toLinear } from './orbitcolor.js';
export function daylightFaces(pixels, size, env) {
  if (pixels?.length !== size * size * 24 || !env?.lights?.[0]) return null;
  const out = new Float32Array(24),
    sum = [0, 0, 0];
  let weight = 0;
  for (let f = 0; f < 6; f++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) * 2) / size - 1,
          v = ((y + 0.5) * 2) / size - 1,
          d = [
            [1, -u, v],
            [-1, u, v],
            [u, 1, v],
            [-u, -1, v],
            [-u, v, 1],
            [u, v, -1]
          ][f];
        if (d[2] <= 0) continue;
        const inv = 1 / Math.hypot(...d),
          solid = (4 / (size * size)) * inv ** 3,
          at = 4 * ((6 * y + f) * size + x);
        for (let c = 0; c < 3; c++) {
          const L = toLinear(pixels[at + c] / 255);
          sum[c] += L * solid;
          for (let a = 0; a < 6; a++) {
            const cos = d[a >> 1] * inv * (a % 2 ? -1 : 1);
            if (cos > 0) out[a * 3 + c] += (L * solid * cos) / Math.PI;
          }
        }
        weight += solid;
      }
  const Y = (sum[0] * 0.2126 + sum[1] * 0.7152 + sum[2] * 0.0722) / weight;
  if (!(Y > 0.0005)) return null; // Missing/unrendered dome: leave authored lights alone.
  const lights = env.lights,
    sun = lights[0],
    ambient = env.ambient || [0, 0, 0];
  // A display-referred sky does not encode physical exposure. Anchor its strength to THIS
  // map's illuminants, not to Endor's noon. A dark sky is never normalised to daylight.
  const lum = a => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  const fill = lights.slice(1).reduce((s, l) => s + lum(l.color), 0);
  const exposure = (0.32 * lum(sun.color) + 0.18 * fill + 0.25 * lum(ambient)) / Math.max(0.65, Y);
  for (let a = 0; a < 6; a++)
    for (let c = 0; c < 3; c++) {
      let author = ambient[c] * 0.6;
      for (const l of lights.slice(1)) author += l.color[c] * 0.3 * Math.max(0, l.dir[a >> 1] * (a % 2 ? -1 : 1));
      out[a * 3 + c] = out[a * 3 + c] * exposure + author;
    }
  return out;
}
