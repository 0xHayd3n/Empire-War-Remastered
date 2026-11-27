// Some strategic leaders only have a flagship or a portrait. Prefer a named,
// affiliated foot commander actually deployed by that source. Require BOTH the
// object and its reviewed body so a later pack changing it to a vehicle fails closed.
export const fieldLeaders = {
  stock: { Rebel: ['Han_Solo', 'RI_HANSOLO.ALO'] },
  1125571106: {
    Rebel: ['Princess_Leia', 'RI_LEIA_HOTH.ALO'],
    Empire: ['Rukh', 'RUKH.ALO'],
    Eriadu_Authority: ['Snopel', 'EI_SNOPEL.ALO'],
    Greater_Maldrood: ['Kayn_Somos', 'FIELDCOMMANDER_STORMTROOPER_4.ALO'],
    Pentastar: ['Jerec', 'JEREC.ALO'],
    Zsinj_Empire: ['Gethzerion', 'PI_GETHZERION.ALO'],
    EmpireoftheHand: ['Ashik', 'CHISS_BODYGUARD.ALO'],
    Imperial_Proteus: ['Vedder', 'IMPOFFICER_VEDDER.ALO'],
    Yevetha: ['Kan_Nakkar', 'YEVETHAN_TROOPER.ALO']
  },
  1397421866: {
    Rebel: ['Kyle_Katarn', 'RI_MERC_KYLE_KATARN.ALO'],
    Empire: ['Commander_Fulik', 'EI_STORMTROOPER_FULIK.ALO'],
    Underworld: ['Guri', 'BS_GURI.ALO']
  },
  1976399102: { Independent_Forces: ['Holchas', 'FORCECULTIST_MINOR.ALO'], Hutt_Cartels: ['Ziro_The_Hutt', 'HUTT_ZIRO.ALO'] },
  1770851727: { Underworld: ['Urai_Fen', 'UI_URAI_FEN.ALO'] }
};
