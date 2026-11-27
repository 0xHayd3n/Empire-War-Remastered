// A flat face is an ink stencil. Projectors can have a different donor, a
// positive instead of a knockout, and multiple relief heights. Never use
// participant paint and never flatten a complete opaque badge into a disc.
import { referenceSvg } from './crestrefs.js';
import { masterFaceSvg } from './crestmasters.js';

// Native contours are measured on the winning private source crop. Keep the
// disconnected islands and counters together as a compound even-odd path.
function path(rings) {
  return rings.map(r => 'M' + r.join(' ') + 'Z').join('');
}
function contourFace(o, treatment, ink, cutLine) {
  const rings = treatment === 'relief' && o?.relief?.length ? o.relief : o?.body;
  if (!rings?.length) return '';
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const r of rings)
    for (let i = 0; i < r.length; i += 2) {
      left = Math.min(left, r[i]);
      right = Math.max(right, r[i]);
      top = Math.min(top, r[i + 1]);
      bottom = Math.max(bottom, r[i + 1]);
    }
  const size = Math.ceil(Math.max(right - left, bottom - top) * 1.06),
    x = Math.round((left + right - size) / 2),
    y = Math.round((top + bottom - size) / 2);
  // A very narrow transparent seam preserves the Hand's fingers and the
  // Pentastar's points where raised details used to meet a different ink.
  const seam = cutLine || (treatment === 'seam' && o.relief?.length && path(o.relief));
  const mask = seam
    ? `<defs><mask id="cut" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${size}" height="${size}"><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="white"/><path d="${seam}" fill="none" stroke="black" stroke-width="84" stroke-linejoin="round"/></mask></defs>`
    : '';
  // The Trade Federation banner has hairlines. Strengthen that same trace
  // slightly for the narrow rail; don't extrude new walls on its projector.
  const edge = treatment === 'hairline' ? `stroke="${ink}" stroke-width="35" stroke-linejoin="round" ` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${x} ${y} ${size} ${size}">${mask}<path fill="${ink}" fill-rule="evenodd" ${seam ? 'mask="url(#cut)" ' : ''}${edge}d="${path(rings)}"/></svg>`;
}
export function commandFaceSvg(mark) {
  const ink = mark?.faceColor;
  if (!/^#[0-9a-f]{6}$/i.test(ink)) return '';
  if (mark.reference) return referenceSvg(mark.reference, false, ink);
  const master = mark.faceMaster ?? mark.master;
  if (master) return masterFaceSvg(master, ink);
  return contourFace(mark.faceOutline || mark.outline, mark.faceTreatment, ink, mark.faceCut);
}
