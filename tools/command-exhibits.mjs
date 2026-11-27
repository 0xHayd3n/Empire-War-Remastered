// Reviewed FOOT actors (not a lookup of playable armies). Object + expected ALO
// must agree in the installed source; the idle is validated against that skeleton.
// If a seat has only vehicles, a pinned illustration may come from the same
// organization's infantry in another installed pack. This never grants land units.
const roles = rows =>
  Object.fromEntries(rows.map(([f, label, object, model, source, person]) => [f, { label, object, model, source, person }]));
export const exhibits = {
  1125571106: roles([
    // The Mandalorian soldier company lists this seat among its affiliations.
    // Present it as an auxiliary, not as the person or species of Shimrra.
    ['Underworld', 'Mandalorian auxiliary', 'Mandalorian_Soldier', 'MANDALORIAN_SOLDIER_LEGIONS.ALO'],
    ['Independent_Forces', 'Local Military Rifleman', 'Military_Soldier', 'MILITIA_SOLDIER.ALO'],
    ['Corellia', 'CorSec Rifleman', 'CorSec_Trooper', 'COR_CORTROOPER.ALO'],
    ['Corporate_Sector', 'Security Police Officer', 'Espo', 'CSA_ESPO_TROOPER.ALO'],
    ['Chiss', 'Household Phalanx Trooper', 'Chiss_Phalanx_Trooper_Rifle', 'PHALANX_TROOPER.ALO'],
    ['Warlords', 'Phase II Dark Trooper', 'Dark_Trooper_Phase_II', 'PHASE_II_DARK_TROOPER.ALO']
  ]),
  1976399102: roles([
    ['Underworld', 'Ailon Nova Guard', 'Ailon_Nova_Guard', 'AILON_NOVA_GUARD.ALO'],
    // Death Watch's Kryze, not a second copy of the New Republic-era Shysa.
    ['Mandalorians', 'Bo-Katan Kryze', 'Bo_Katan', 'DEATH_WATCH_COMMANDO_BO.ALO', null, true],
    ['Banking_Clan', 'B2 Super Battle Droid', 'B2_Droid', 'CIS_B2_SBD.ALO'],
    ['Commerce_Guild', 'Geonosian B1 Battle Droid', 'B1_Geo', 'B1_BATTLEDROID_GEO.ALO'],
    ['Sector_Forces', 'Republic Navy Trooper', 'Republic_Navy_Trooper', 'REP_NAVY_TROOPER.ALO']
  ]),
  1397421866: roles([
    ['Pirates', 'Nikto Thug', 'Nikto_Soldier_01_Indig', 'UI_NIKTO_THUG_01.ALO'],
    ['Hutts', 'Disruptor Mercenary Pistoleer', 'Squad_UW_Field_Commander_Guard', 'UI_DISRUPTOR.ALO'],
    ['CSA', 'Espo Officer', 'Espo_Trooper', 'CSI_ESPO.ALO'],
    ['Independent', 'Dressellian Rifleman', 'Dressellian_Indigenous_Rifleman', 'NI_DRESSELLIAN_01.ALO'],
    ['Hapans', 'Hapan Royal Guard', 'Hapan_Royal_Guard', 'RI_FHUMAN_MAGMA_01_HELMET.ALO'],
    ['Warlords', 'Stormtrooper', 'Stormtrooper', 'EI_STORMTROOPER.ALO']
  ]),
  3387971722: roles([
    // AotCW depicts Hondo in a vehicle. FoTR has his actual on-foot hero.
    ['Pirates', 'Hondo Ohnaka', 'Hondo_Ohnaka', 'WEEQUAY_HERO.ALO', '1976399102', true],
    ['Underworld', 'Pirate Sergeant', 'Pirate_Soldier_Sergeant', 'BI_SOLDIER.ALO'],
    ['Hutts', 'Devaronian Marauder', 'Devaronian_Indig_Carbine_GC', 'NI_DEVARONIAN_01.ALO'],
    ['CSA', 'Espo Stunner', 'Espo_Trooper_Shield', 'CSI_ESPO_SHIELD.ALO'],
    ['Independent', 'Zabrak Militia', 'Zabrak_Indig_Carbine', 'NI_ZABRAK_01.ALO'],
    ['Hapans', 'Hapan Home Guard', 'Hapan_Security_Trooper', 'HI_HOME_GUARD.ALO', '1397421866'],
    // Neutral_Santhetrooper_Squad belongs to Warlords. Its deployed squad
    // includes this sergeant; the stand-alone actor's broad owner is Pirates.
    ['Warlords', 'Santhe Security Sergeant', 'Santhetrooper_Sergeant', 'NI_SANTHETROOPER.ALO']
  ]),
  3417277973: roles([
    ['Independent_Forces', 'Defense Force Trooper', 'PDF_Soldier', 'REP_PDF_SOLDIER.ALO'],
    ['Hutt_Cartels', 'Gamorrean Guard', 'Gamorrean_Guard', 'HUTT_GAMORREAN.ALO'],
    ['Hapes_Consortium', 'Hapan Partisan', 'Partisan_Hapan', 'NI_SOLDIER_HUMAN_MIXED.ALO'],
    ['Rakata_Empire', 'Rakatan Partisan', 'Partisan_Rakatan', 'NI_RAKATAN_RANGED.ALO', '1125571106'],
    ['Sector_Forces', 'PDF Fleet Trooper', 'PDF_Fleet_Trooper', 'TSF_NAVY_TROOPER.ALO'],
    ['Sith_Warlords', 'Dark Jedi', 'Dark_Jedi', 'KOTOR_DARK_JEDI.ALO']
  ]),
  1770851727: roles([
    ['Pirates', 'Kaleesh Outlaw Sergeant', 'Outlaw_Sergeant_Team', 'NI_KALEESH.ALO'],
    // Explicitly affiliated human emissary. Neither the repurposed faction ID nor
    // a recycled Hutt insignia is evidence that Invaders are Jabba's cartel.
    ['Hutts', 'Civilian emissary', 'Govenor_Koong_Hutt', 'NI_GMALE_DESERT_A.ALO'],
    ['CIS', 'B1 Battle Droid', 'B1_Droid', 'NI_B1_BATTLEDROID.ALO'],
    ['Republic', 'Clone Trooper · Phase II', 'Clone_Trooper', 'REP_CLONETROOPER_P2_BASIC.ALO'],
    ['CSA', 'Heavy Security Police', 'Heavy_Espo', 'CSA_ESPO_SUPPRESSOR.ALO', '1125571106'],
    ['Warlords', 'Imperial Militia Commander', 'Imperial_Militia_Commander', 'EI_ARMYTROOPER.ALO'],
    ['Hapan', 'Royal House Guard Commander', 'Hapan_Squad_Commander', 'HAP_GUARD_ROYAL.ALO', '1125571106'],
    ['Cartels', 'Guardian Corps Commander', 'Commander_Tier_II_GuardianCorps', 'HUTT_GUARDIANCORPS_COMMANDER.ALO', '1976399102'],
    ['Mandalorians', 'Mandalorian Militiaman', 'Mandalorian_01_Team', 'NI_MANDALORIAN_01.ALO'],
    ['Sith', 'Sentinel Battle Droid', 'Sentinel_Droid', 'KOTOR_SITH_SENTINEL_DROID.ALO']
  ])
};
export function linkCommandExhibits(solo, profiles) {
  const packs = new Map(profiles.map(p => [p.id, p]));
  for (const [id, s] of Object.entries(solo))
    for (const [f, c] of Object.entries(s.commanders)) {
      const ref = exhibits[id]?.[f];
      if (!ref) continue;
      const src = ref.source || id,
        art = solo[src]?.ringActors?.[id + '/' + f],
        p = packs.get(src);
      if (art && p) {
        c.stage = { ...art, ...(src === id ? {} : { profile: src, revision: p.revision, mod: p.name }) };
        if (art.label !== c.name) c.leader ||= c.name; // searchable strategic identity, not the figure's likeness
        c.name = art.label;
        c.person = art.kind === 'person';
      }
    }
  for (const s of Object.values(solo)) delete s.ringActors;
}
