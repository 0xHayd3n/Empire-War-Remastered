// Presentation only. Keys are the installed profile AND the native faction ID; neither a
// historical family nor its representative is an affiliation, hero spawn or launch target.
// For people, column three is the exact pack portrait (without .TGA). Optional
// columns four and five distinguish a displayed faction and its campaign role.
const republic = 'Galactic Republic',
  alliance = 'Rebel Alliance / New Republic',
  empire = 'Galactic Empire',
  cis = 'Confederacy',
  hutt = 'Hutt Cartel',
  mando = 'Mandalorian Clans',
  black = 'Black Sun',
  hapes = 'Hapes Consortium',
  csa = 'Corporate Sector Authority',
  independent = 'Independent Forces',
  sectors = republic,
  minor = 'Warlords';
const directories = {
  stock: {
    Rebel: [alliance, 'Mon Mothma', 'I_BUTTON_MON_MOTHMA'],
    Empire: [empire, 'Emperor Palpatine', 'I_BUTTON_EMPEROR_PALPATINE'],
    Pirates: [black, 'Prince Xizor'],
    Underworld: ['Zann Consortium', 'Tyber Zann', 'I_BUTTON_TYBER'],
    Hutts: [hutt, 'Jabba the Hutt', 'I_BUTTON_HUTT']
  },
  1125571106: {
    Rebel: [alliance, 'Mon Mothma', 'I_BUTTON_MON_MOTHMA_ADMIN'],
    Empire: [empire, 'Ysanne Isard', 'I_BUTTON_ISARD_SPYMASTER_LEADER'],
    Underworld: ['Yuuzhan Vong', 'Supreme Overlord Shimrra'],
    Independent_Forces: [independent, null, 'Local defense command'],
    Hutt_Cartels: [hutt, 'Parella Jiramma Baco', 'I_BUTTON_PARELLA'],
    Eriadu_Authority: ['Eriadu Authority', 'Sander Delvardus', 'I_BUTTON_DELVARDUS_LEADER'],
    Greater_Maldrood: ['Greater Maldrood', 'Treuten Teradoc', 'I_BUTTON_TERADOC_LEADER'],
    Pentastar: ['Pentastar Alignment', 'Ardus Kaine', 'I_BUTTON_KAINE_ADMIN_LEADER'],
    Zsinj_Empire: ['Zsinj’s Empire', 'Warlord Zsinj', 'I_BUTTON_ZSINJ_LEADER'],
    Corellia: ['Corellia', 'Windle Meeker', 'I_BUTTON_WINDLE'],
    Corporate_Sector: [csa, 'Odumin', 'I_BUTTON_ODUMIN_SPYMASTER'],
    Hapes_Consortium: [hapes, 'Teneniel Djo', 'I_BUTTON_TENENIEL'],
    EmpireoftheHand: ['Empire of the Hand', 'Chaf’orm’bintrano (Formbi)', 'I_BUTTON_FORMBI_ADMIN'],
    Chiss: ['Chiss Ascendancy', 'Admiral Ar’alani', 'I_BUTTON_ARALANI'],
    SsiRuuvi_Imperium: ['Ssi-ruuvi Imperium', 'Th’twirirl', 'I_BUTTON_THTWIRIRL'],
    Mandalorians: [mando, 'Fenn Shysa', 'I_BUTTON_FENN_SHYSA'],
    Warlords: [minor, null, 'Phase II Dark Trooper', 'Minor Warlords', 'Campaign garrisons'],
    Imperial_Proteus: [minor, 'Bliss Shargael', 'I_BUTTON_SHARGAEL', 'Minor Imperial Warlords', 'Playable campaign regimes'],
    Yevetha: ['Duskhan League', 'Nil Spaar', 'I_BUTTON_NIL_SPAAR']
  },
  1976399102: {
    Rebel: [cis, 'Count Dooku', 'I_BUTTON_DOOKU'],
    Empire: [republic, 'Yoda', 'I_BUTTON_YODA'],
    Underworld: ['Criminal Underworld', null, 'Syndicate council'],
    Independent_Forces: [independent, null, 'Local defense command'],
    Hutt_Cartels: [hutt, 'Jabba the Hutt', 'I_BUTTON_JABBA'],
    Banking_Clan: ['InterGalactic Banking Clan', 'Pors Tonith', 'I_BUTTON_TONITH'],
    Commerce_Guild: ['Commerce Guild', 'Shu Mai', 'I_BUTTON_SHU_MAI'],
    Techno_Union: ['Techno Union', 'Wat Tambor', 'I_BUTTON_WAT'],
    Trade_Federation: ['Trade Federation', 'Nute Gunray', 'I_BUTTON_NUTE_GUNRAY'],
    Sector_Forces: [sectors, 'Jace Dallin', 'I_BUTTON_DALLIN'],
    Mandalorians: [mando, 'Fenn Shysa', 'I_BUTTON_FENN_SHYSA_CW']
  },
  3417277973: {
    Rebel: ['Sith Empire', 'Darth Revan', 'I_BUTTON_REVAN_DARK_SIDE'],
    Empire: [republic, 'Bastila Shan', 'I_BUTTON_BASTILA_SHAN'],
    Underworld: [mando, 'Mandalore the Ultimate', 'I_BUTTON_MANDALORE_THE_ULTIMATE'],
    Independent_Forces: [independent, 'Noana Sowrs', 'I_BUTTON_NOANA_SOWRS'],
    Hutt_Cartels: [hutt, 'Tassaa Bareesh', 'I_BUTTON_TASSAA_BAREESH'],
    Hapes_Consortium: [hapes, null, 'Royal command'],
    Rakata_Empire: ['Rakatan Remnants', null, 'Rakatan command'],
    Sector_Forces: [sectors, null, 'Sector defense command'],
    Sith_Warlords: ['Sith Warlords', null, 'Warlord council']
  },
  1397421866: {
    Rebel: [alliance, 'Mon Mothma', 'I_BUTTON_MON_MOTHMA'],
    Empire: [empire, 'Grand Moff Tarkin', 'I_BUTTON_GRAND_MOFF_TARKIN'],
    Pirates: ['Pirate Bands', 'Talonbane Cobra', 'I_BUTTON_TALONBANE_COBRA'],
    Underworld: [black, 'Prince Xizor', 'I_BUTTON_XIZOR'],
    Hutts: [hutt, 'Jabba the Hutt', 'I_BUTTON_JABBA'],
    CSA: [csa, 'Odumin'],
    Independent: [independent, null, 'Local defense command'],
    Hapans: [hapes, 'Ta’a Chume'],
    Warlords: [minor, 'Blitzer Harrsk', 'HARRSK']
  },
  3387971722: {
    Rebel: [cis, 'General Grievous', 'I_BUTTON_GRIEVOUS'],
    Empire: [republic, 'Obi-Wan Kenobi', 'I_BUTTON_KENOBI_III'],
    Pirates: ['Pirate Bands', 'Hondo Ohnaka', 'I_BUTTON_HERO_PIRATE_HONDO_OHNAKA'],
    Underworld: [black, 'Ziton Moj'],
    Hutts: [hutt, 'Jabba the Hutt', 'I_BUTTON_JABBA'],
    CSA: [csa, null, 'Authority directorate'],
    Independent: [independent, null, 'Local defense command'],
    Hapans: [hapes, null, 'Royal command'],
    Warlords: [minor, null, 'Santhe Security Sergeant']
  },
  1770851727: {
    Rebel: [alliance, 'Luke Skywalker', 'I_BUTTON_RI_SKYWALKER'],
    Empire: [empire, 'Darth Vader', 'I_BUTTON_DARTH_VADER'],
    Pirates: [independent, null, 'Local defense command'],
    Underworld: ['Criminal Underworld', 'Tyber Zann', 'I_BUTTON_TYBER'],
    Hutts: ['Invaders', null, 'Invasion command'],
    CIS: [cis, 'Senator Toonbuck Toora', 'I_BUTTON_TOONBUCK'],
    Republic: [republic, 'Admiral Maarisa Zsinj', 'I_BUTTON_MZSINJ'],
    CSA: [csa, 'Baron Orman Tagge', 'I_BUTTON_ORMAN_TAGGE'],
    Warlords: ['Imperial Defectors', 'Moff Kalast', 'I_BUTTON_KALAST'],
    Hapan: [hapes, 'Ta’a Chume', 'I_BUTTON_CHUME'],
    Mandalorians: [mando, 'Fenn Shysa', 'I_BUTTON_SHYSA'],
    Sith: ['Sith Cultists', 'Masked Entity', 'I_BUTTON_NIHILUS'],
    Cartels: [hutt, 'Jabba the Hutt', 'I_BUTTON_JABBA_THE_HUTT']
  }
};
// Supplemental art is still local to an installed game. It may illustrate ONLY the
// explicitly named person, never a successor, a namesake or the faction's ordinary hero.
const extra = {
  1976399102: { 'Ziton Moj': 'I_BUTTON_ZITON_MOJ' },
  1125571106: { 'Ta’a Chume': 'I_BUTTON_TAA_CHUME' },
  1770851727: { 'Prince Xizor': 'I_BUTTON_XIZOR' }
};
export function skirmishCommanders(image, profile, factions) {
  const commanders = {},
    portraits = {};
  function portrait(name, key) {
    if (!key) return;
    const source = key + '.TGA',
      art = image(source);
    if (art) portraits[name] = { source, art };
  }
  for (const id of factions) {
    const [family, person, key, displayFaction, campaignRole] = directories[profile]?.[id] || [id, null, 'Field command'];
    commanders[id] = { family, name: person || key, person: !!person };
    if(family===hutt || family===republic || family===cis || family===empire) commanders[id].displayFaction=family===republic&&id==='Sector_Forces'?'Republic-Aligned Sector Forces':family;
    if (displayFaction) commanders[id].displayFaction = displayFaction;
    if (campaignRole) commanders[id].campaignRole = campaignRole;
    if (person) portrait(person, key);
  }
  for (const [name, key] of Object.entries(extra[profile] || {})) if (!portraits[name]) portrait(name, key);
  return { commanders, portraits };
}
