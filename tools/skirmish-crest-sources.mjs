// Reviewed standalone heraldry from the SAME mounted era. These are not generic
// faction-name fallbacks: e.g. Fall's P_ALLIED_REP and Revan's are different.
import { createHash } from 'node:crypto';
// These four textures contain a clean faction device next to unrelated surface
// material. Only use the reviewed UV window on these exact decoded pixels.
const details = {
  'BS_STARBASE_INSIGNIA.DDS': [
    '53eac24d81ccb11b0ff084f8edac28c6662cca982ba68d008c2ee12ab044779e',
    48,
    40,
    168,
    173,
    (_r, _g, _b, a) => (a - 10) * 4
  ],
  'W_LAMP_BANNER_TRADE_FED.DDS': [
    'd3fe02c628808fec4105aea5dc7dbe0ab145d944c983cc1ae066a9d7b010a7dd',
    324,
    94,
    166,
    171,
    (r, g, b, a) => Math.min((65 - Math.max(r, g, b)) * 4, (a - 198) * 5)
  ],
  'W_LAMP_BANNER_TECHNO_UNION.DDS': [
    'f0685c6cc57600985ede96a9ed828dbfe619d7cd4c131ecd87a17ffe4837e8c3',
    324,
    94,
    166,
    171,
    (_r, g, _b, a) => Math.min((g - 84) * 3, (a - 198) * 5)
  ],
  'W_LAMP_BANNER_COMMERCE_GUILD.DDS': [
    '150dfe755f16dcac5a55babc908a207a689784b9455317f46778f88fd4986821',
    324,
    94,
    168,
    171,
    (r, g, b) => 2 * Math.max(g - r, b - r)
  ]
};
export function heraldicCrop(name, crop) {
  const d = details[name];
  if (!crop || !d) return crop;
  const { src } = crop,
    [hash, x, y, w, h, value] = d;
  if (x + w > src.width || y + h > src.height || createHash('sha256').update(src.data).digest('hex') !== hash) return null;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = ((j + y) * src.width + i + x) * 4,
        p = (j * w + i) * 4;
      data[p] = data[p + 1] = data[p + 2] = 255;
      data[p + 3] = value(src.data[k], src.data[k + 1], src.data[k + 2], src.data[k + 3]);
    }
  return { src: { data, width: w, height: h }, rect: { x: 0, y: 0, w, h } };
}
const allies = entries => Object.fromEntries(Object.entries(entries).map(([f, n]) => [f, `P_ALLIED_${n}.TGA`]));
// Some devices are drawn in multiple hues on a metal seal. Their identifying
// lines become a second physical relief rather than disappearing in a luma cut.
export function crestTreatment(name) {
  if (details[name]) return 'device';
  if (/I_EVENT_CIS_LOGO_DEFAULT/i.test(name)) return 'event-blue';
  if (/I_EVENT_REPUBLIC_LOGO_DEFAULT/i.test(name)) return 'event-red';
  if (/P_ALLIED_NR\.|W_R2_TERMINAL|MULTIPLAY_REBEL|FACTION_MANDALORIAN/i.test(name)) return 'ink';
  if (/P_ALLIED_HUTTS\./i.test(name)) return 'chroma';
  if (/P_ALLIED_(?:EA|EMPIRE|GM|ZE|WARLORD|CIS|MANDO)\.|COMMAND_BAR|PIRATES_SYMBOL|I_MULTIPLAY_UNDERWORLD/i.test(name)) return 'device';
  return 'relief';
}
export const crestSources = {
  1125571106: allies({
    Rebel: 'NR',
    Empire: 'EMPIRE',
    Underworld: 'VONG',
    Hutt_Cartels: 'HUTTS',
    Eriadu_Authority: 'EA',
    Greater_Maldrood: 'GM',
    Pentastar: 'PA',
    Zsinj_Empire: 'ZE',
    Corellia: 'CF',
    Corporate_Sector: 'CSA',
    Hapes_Consortium: 'HC',
    EmpireoftheHand: 'EOTH',
    Chiss: 'CA',
    SsiRuuvi_Imperium: 'RUUVI',
    Imperial_Proteus: 'WARLORD',
    Yevetha: 'DL'
  }),
  1397421866: { Underworld: 'BS_STARBASE_INSIGNIA.DDS' },
  3387971722: { Underworld: 'BS_STARBASE_INSIGNIA.DDS' },
  1976399102: {
    ...allies({ Rebel: 'CIS', Empire: 'REP', Hutt_Cartels: 'HUTTS' }),
    Techno_Union: 'W_LAMP_BANNER_TECHNO_UNION.DDS',
    Commerce_Guild: 'W_LAMP_BANNER_COMMERCE_GUILD.DDS',
    Trade_Federation: 'W_LAMP_BANNER_TRADE_FED.DDS'
  },
  3417277973: allies({
    Rebel: 'SITH',
    Empire: 'REP',
    Underworld: 'MANDO',
    Hutt_Cartels: 'HUTTS',
    Hapes_Consortium: 'HC_ROYAL',
    Sith_Warlords: 'SITH_WARLORD'
  })
};
