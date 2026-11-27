// Resolve visual donors after the isolated pack scans. Paint the FACE only
// after choosing both donors; neither the seat nor the projection is retinted.
import { createHash } from 'node:crypto';
import { referenceSvg } from '../public/js/game/crestrefs.js';
import { commandFaceSvg } from '../public/js/game/crestface.js';
import { rosterColor } from '../public/js/game/commandgroups.js';
const refs = {
  'Galactic Empire': 'imperial',
  Confederacy: 'confederacy',
  'Hapes Consortium': 'hapes',
  'Rakatan Remnants': 'rakata',
  'Corporate Sector Authority': 'csa',
  'InterGalactic Banking Clan': 'banking',
  'Techno Union': 'techno'
};
const CW = '3387971722',
  RR = '3417277973',
  TR = '1125571106',
  FALL = '1976399102',
  REMAKE = '1770851727';
// On these particular relief seals the base includes the carrier; the detail
// layer records the orbits/radial glyphs. On the Hand and Pentastar the body
// already excludes the grey field; a cut line separates touching devices.
const treatment = new Map([
  ['P_ALLIED_CA.TGA', 'relief'],
  ['P_ALLIED_DL.TGA', 'relief'],
  ['P_ALLIED_EOTH.TGA', 'seam'],
  ['P_ALLIED_PA.TGA', 'seam']
]);
export function linkCommandHeraldry(solo, profiles) {
  const packs = new Map(profiles.map(p => [p.id, p]));
  const get = (p, id) => {
    const m = solo[p]?.emblems[id];
    return m?.svg && m.outline ? { ...m, faceProfile: p, origin: packs.get(p)?.name, projectionKey: `${p}/${id}` } : null;
  };
  const republic = get(CW, 'Empire'),
    blackSun = get(CW, 'Underworld'),
    mando = get(FALL, 'Mandalorians') || get(TR, 'Mandalorians'),
    huttFace = get(REMAKE, 'Cartels'),
    huttDevice = get(RR, 'Hutt_Cartels');
  for (const [p, s] of Object.entries(solo))
    for (const [id, c] of Object.entries(s.commanders)) {
      const family = c.family,
        key = `${p}/${id}`;
      let mark = s.emblems[id];
      const ref = p === TR && ['Imperial_Proteus', 'Zsinj_Empire'].includes(id) ? 'imperial' : refs[family];
      if (ref && !(ref === 'hapes' && p === RR)) {
        mark = {
          reference: ref,
          svg: referenceSvg(ref),
          faceProfile: 'reference',
          source: ref === 'imperial' ? 'Universal Imperial cog · faction color' : `Universal ${family} reference`,
          origin: 'Universal reference'
        };
      } else if (family === 'Hutt Cartel') {
        const local = get(p, id),
          face = huttFace || local,
          device = huttDevice || local;
        if (face && device)
          mark = {
            ...face,
            faceMaster: face.master || '',
            faceOutline: face.outline,
            master: device.master,
            projectionKey: device.projectionKey,
            outline: device.outline,
            outlineSource: device.outlineSource,
            projectionOrigin: device.origin
          };
      } else {
        const donor =
          family === 'Galactic Republic'
            ? republic
            : family === 'Black Sun'
              ? blackSun
              : p === REMAKE && family === 'Mandalorian Clans'
                ? mando
                : null;
        if (donor) mark = { ...donor, projectionOrigin: donor.origin };
      }
      if (!mark) continue; // labeled Universal marker, painted by commandMark
      const ink = rosterColor(p, id);
      if (ink) {
        const faceTreatment =
          p === TR
            ? treatment.get(mark.outlineSource?.toUpperCase())
            : key === `${FALL}/Trade_Federation` && mark.outlineSource === 'W_LAMP_BANNER_TRADE_FED.DDS'
              ? 'hairline'
              : undefined;
        // Reuse the native inner orbit's boundary. Without a cut, adjacent
        // blue bands on this Chiss seal would become one thick copper band.
        const faceCut =
          key === `${TR}/Chiss` &&
          mark.svg &&
          createHash('sha256').update(mark.svg).digest('hex').startsWith('932b284dc77e6f0e') &&
          mark.svg.match(/<path fill="#4b6fc4" fill-rule="evenodd" d="([MLQZ0-9, .-]+)"/)?.[1];
        const flat = { ...mark, faceColor: ink, ...(faceTreatment ? { faceTreatment } : {}), ...(faceCut ? { faceCut } : {}) };
        const svg = commandFaceSvg(flat);
        if (svg) mark = { ...flat, svg };
      }
      s.emblems[id] = mark;
    }
}
