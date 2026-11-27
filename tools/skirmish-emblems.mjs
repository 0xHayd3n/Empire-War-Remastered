// Resolve heraldry in this profile's winning command sheet or loose textures.
// Never fall back to an infantry marker, leader portrait, arbitrary unit icon,
// or another overhaul's meaning for Rebel / Empire / Underworld / Pirates.
import { revanProjector } from './revan-projectors.mjs';
import { deviceProjector } from './device-projectors.mjs';
import { remaster, ruuviEnamel } from './crest-remaster.mjs';
import { crestOutline } from '../public/js/game/crestoutline.js';
import { crestSources, crestTreatment, heraldicCrop } from './skirmish-crest-sources.mjs';
const awakening = {
  Pirates: 'I_ENCYCLOPEDIA_PIRATES_SYMBOL',
  Hutts: 'I_ENCYCLOPEDIA_JABBA_SYMBOL',
  CSA: 'I_ENCYCLOPEDIA_CSA_SYMBOL',
  Hapans: 'I_ENCYCLOPEDIA_HAPAN_SYMBOL'
};
const reviewed = {
  stock: { Pirates: 'I_ENCYCLOPEDIA_PIRATES_SYMBOL', Hutts: 'I_ENCYCLOPEDIA_JABBA_SYMBOL' },
  1125571106: { Mandalorians: 'W_R2_TERMINAL_SYMBOL_MANDO.dds' },
  1976399102: {
    Banking_Clan: 'I_BUTTON_BANKING_CLAN',
    Commerce_Guild: 'I_BUTTON_COMMERCE_GUILD',
    Techno_Union: 'I_BUTTON_TECHNO_UNION',
    Trade_Federation: 'I_BUTTON_TRADE_FEDERATION',
    Sector_Forces: 'I_BUTTON_SECTOR_FORCES',
    Mandalorians: 'W_R2_TERMINAL_SYMBOL_MANDO.dds'
  },
  3417277973: { Rakata_Empire: 'I_BUTTON_RAKATA', Sith_Warlords: 'I_BUTTON_SITH_WARLORD', Hapes_Consortium: 'I_BUTTON_HAPES_ROYAL' },
  1397421866: awakening,
  3387971722: { ...awakening, Empire: 'I_EVENT_REPUBLIC_LOGO_DEFAULT', Rebel: 'I_EVENT_CIS_LOGO_DEFAULT' },
  1770851727: {
    CIS: 'I_BUTTON_FACTION_CIS',
    Republic: 'I_BUTTON_FACTION_REPUBLIC',
    CSA: 'PLANET_ABILITY_CSA',
    Hapan: 'I_BUTTON_FACTION_HAPAN',
    Mandalorians: 'I_BUTTON_FACTION_MANDALORIAN',
    Sith: 'I_BUTTON_FACTION_SITH',
    Cartels: 'I_BUTTON_FACTION_HUTT'
  }
};
export function skirmishEmblems(image, db, profile, factions) {
  const result = {};
  for (const id of factions) {
    const f = db.faction(id),
      explicit = reviewed[profile]?.[id];
    // Overrides intentionally supersede inherited MP icons (notably AotCW).
    const source = explicit ? (/\./.test(explicit) ? explicit : explicit + '.tga') : f?.str('Multiplayer_Map_Preview_Icon').trim();
    if (!source) continue;
    const art = image(source);
    if (!art) continue;
    const mark = (result[id] = { art, source });
    const richer = crestSources[profile]?.[id];
    const crops = [...new Set([richer, source].filter(Boolean))]
      .map(name => ({ name, crop: heraldicCrop(name, image.native?.(name)) }))
      .filter(q => q.crop)
      .sort((a, b) => b.crop.rect.w * b.crop.rect.h - a.crop.rect.w * a.crop.rect.h);
    for (const { name, crop } of crops) {
      const outline = crestOutline(crop.src, crop.rect, crestTreatment(name));
      if (outline) {
        mark.outline = outline;
        mark.outlineSource = name;
        mark.svg = remaster(profile, id, mark, crop, name);
        // Alter the projection only. The full-color native crest keeps its field.
        const device = deviceProjector(profile,id,name,crop);
        if (device) {
          mark.outline = device;
          delete mark.master; // Never substitute a full-face master for an isolated device.
          if (profile === '1125571106' && id === 'SsiRuuvi_Imperium') {
            mark.svg = ruuviEnamel(device, crop);
            // Never flash the yellow carrier even if the HD endpoint is unavailable.
            mark.art = 'data:image/svg+xml,' + encodeURIComponent(mark.svg);
          }
        } else mark.outline = revanProjector(profile,id,name,crop) || outline;
        break;
      }
    }
  }
  return result;
}
