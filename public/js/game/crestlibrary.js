import { commandMark } from './skirmishcommandpicker.js';
import { crestOutline } from './crestoutline.js';
import { crestSolid } from './crestsolid.js';
import { masterSvg } from './crestmasters.js';

async function fromImage(url, w, mode = 'device') {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w || img.naturalWidth;
  c.height = w || img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return crestOutline(ctx.getImageData(0, 0, c.width, c.height), undefined, mode);
}
const dataSvg = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
async function contours(r, mark) {
  if (mark?.reference) {
    const { referenceSvg } = await import('./crestrefs.js');
    return fromImage(dataSvg(referenceSvg(mark.reference, true)), 768, mark.reference === 'techno' ? 'relief' : 'device');
  }
  if (mark?.master) {
    try {
      const c = await fromImage(dataSvg(masterSvg(mark.master, true)), 768);
      if (c) return c;
    } catch {
      /* the installed crest still works offline */
    }
  }
  if (mark?.outline) return mark.outline;
  if (mark) return fromImage(mark.art); // older catalog during a live upgrade
  const svg = commandMark(r.p, r.id, true);
  svg.setAttribute('width', '256');
  svg.setAttribute('height', '256');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'white');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linejoin', 'round');
  return fromImage(dataSvg(new XMLSerializer().serializeToString(svg)));
}
// Only the in-world projection needs geometry. In-flight
// geometry is retained while referenced, never uploaded after the stage dies.
export function crestLibrary() {
  const entries = new Map();
  let dead = false;
  function trim() {
    for (const [key, e] of entries) {
      if (entries.size <= 10) break;
      if (!e.refs && e.geo) {
        e.geo.dispose();
        entries.delete(key);
      }
    }
  }
  return {
    acquire(r) {
      const mark = r.p.skirmishEmblems?.[r.id],
        key = mark?.reference ? `reference:${mark.reference}` : mark?.projectionKey || r.key;
      let e = entries.get(key);
      if (!e) {
        e = { refs: 0 };
        e.promise = contours(r, mark)
          .then(c => {
            if (!c || dead) throw Error('No crest');
            e.geo = crestSolid(c);
            trim();
            return e.geo;
          })
          .catch(err => {
            entries.delete(key);
            throw err;
          });
      }
      entries.delete(key);
      entries.set(key, e);
      e.refs++;
      return {
        ready: e.promise,
        release() {
          e.refs--;
          trim();
        }
      };
    },
    dispose() {
      dead = true;
      for (const e of entries.values()) e.geo?.dispose();
      entries.clear();
    }
  };
}
