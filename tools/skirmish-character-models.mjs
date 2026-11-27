// Exact person, spawned ground object and expected art in that installed profile.
// UI-only: a commander never causes the object to be spawned. Shared bodies are
// accepted only where the pack actually assigns them to this person. A flagship,
// cinematic prop, stand-in with a similar icon or another Hutt doesn't qualify.
export const characterModels = {
  stock: {
    Empire: ['Emperor Palpatine', 'Emperor_Palpatine', 'EI_PALPATINE.ALO'],
    Underworld: ['Tyber Zann', 'Tyber_Zann', 'UI_TYBER.ALO'],
    Hutts: ['Jabba the Hutt', 'Hutt_Field_Commander', 'NI_HUTT.ALO'],
    Pirates: ['Prince Xizor', null, 'NI_PRINCEXIZOR.ALO'] // Named loose figure; no stock tactical XML object.
  },
  '1125571106': {
    Hutt_Cartels: ['Parella Jiramma Baco', 'Parella', 'HUTT_ARMORED_HUTT.ALO'],
    Hapes_Consortium: ['Teneniel Djo', 'Teneniel_Djo', 'TENENIEL_DJO.ALO'],
    SsiRuuvi_Imperium: ['Th’twirirl', 'Thtwirirl', 'SSI-RUU.ALO'],
    Mandalorians: ['Fenn Shysa', 'Fenn_Shysa', 'MANDALORIAN_PROTECTOR_SHYSA.ALO']
  },
  '1397421866': { Underworld: ['Prince Xizor', 'Prince_Xizor', 'NI_PRINCEXIZOR.ALO'] },
  '1770851727': {
    Rebel: ['Luke Skywalker', 'Luke_Skywalker_Jedi', 'RI_SKYWALKER.ALO'],
    Empire: ['Darth Vader', 'Darth_Vader', 'EI_VADER.ALO'],
    Underworld: ['Tyber Zann', 'Tyber_Zann', 'UI_TYBER.ALO'],
    Cartels: ['Jabba the Hutt', 'Jabba_The_Hutt', 'NI_HUTT.ALO']
  },
  '1976399102': {
    Rebel: ['Count Dooku', 'Dooku', 'CIS_DOOKU.ALO'],
    Empire: ['Yoda', 'Yoda', 'RI_YODA.ALO'],
    Hutt_Cartels: ['Jabba the Hutt', 'Jabba_The_Hutt', 'HUTT_JABBA.ALO'],
    Techno_Union: ['Wat Tambor', 'Wat_Tambor', 'TAMBOR.ALO'],
    Trade_Federation: ['Nute Gunray', 'Nute_Gunray', 'NUTE_GUNRAY.ALO'],
    Mandalorians: ['Fenn Shysa', 'Fenn_Shysa', 'MANDALORIAN_PROTECTOR_SHYSA.ALO']
  },
  '3387971722': {
    Rebel: ['General Grievous', 'General_Grievous', 'CIS_GENERAL_GRIEVOUS.ALO'],
    Empire: ['Obi-Wan Kenobi', 'Obi_Wan_Kenobi_Master', 'REP_OBI_WAN_MASTER.ALO']
  },
  '3417277973': {
    Rebel: ['Darth Revan', 'Revan_Sith_Master', 'SI_DARTH_REVAN.ALO'],
    Empire: ['Bastila Shan', 'Bastila_Shan', 'BASTILA_SHAN.ALO'],
    Underworld: ['Mandalore the Ultimate', 'Mandalore_Ultimate_BattleAxe', 'MANDALORE_THE_ULTIMATE_BATTLEAXE.ALO']
  }
};
