import { commandImages } from './universal-card-images.mjs';
// Representative characters, not a promise that the hero spawns in the chosen scenario.
// Validate the local type, affiliation and picture. These internal faction names mean different things per pack.
const reps = {
  1976399102: { Empire: 'Yoda', Rebel: 'Dooku', Hutt_Cartels: 'Jabba_The_Hutt' },
  3417277973: { Empire: 'Bastila_Shan', Rebel: 'Revan_Sith_Master', Underworld: 'Mandalore_The_Ultimate_Team' },
  3387971722: { Rebel: 'Count_Dooku', Empire: 'Yoda' },
  1125571106: {
    Rebel: 'Mon_Mothma',
    Empire: 'Ysanne_Isard',
    Eriadu_Authority: 'Delvardus_Thalassa',
    Greater_Maldrood: 'Treuten_13X',
    Zsinj_Empire: 'Zsinj_Iron_Fist_Executor',
    Pentastar: 'Ardus_Kaine',
    Corporate_Sector: 'Odumin',
    Hapes_Consortium: 'Teneniel_Djo',
    EmpireoftheHand: 'Formbi',
    Hutt_Cartels: 'Parella'
  },
  1770851727: { Empire: 'Darth_Vader', Rebel: 'Luke_Skywalker_Jedi', Underworld: 'Tyber_Zann' }
};
const badges = {
  1976399102: { Mandalorians: 'W_r2_terminal_symbol_mando.dds' },
  3387971722: { Empire: 'I_EVENT_REPUBLIC_LOGO_DEFAULT', Rebel: 'I_EVENT_CIS_LOGO_DEFAULT' },
  1125571106: { Warlords: 'I_BUTTON_FACTION_WARLORD' },
  1397421866: { Hapans: 'I_ENCYCLOPEDIA_HAPAN_SYMBOL' },
  1770851727: {
    Mandalorians: 'I_BUTTON_FACTION_MANDALORIAN',
    Cartels: 'I_BUTTON_FACTION_HUTT',
    Consortium: 'I_BUTTON_FACTION_ZANN',
    BlackSun: 'I_BUTTON_FACTION_BLACK_SUN'
  }
};
export function catalogFactionArt(archive, db, profile, facts, rows, maps) {
  const image = commandImages(archive),
    playable = new Set(rows.map(r => r.faction)),
    owners = new Set([...playable, ...maps.flatMap(m => m.worlds.map(w => w[1]))]),
    selector = new Map();
  for (const t of db.types.values())
    if (/^Custom_GC_/i.test(t.name) && t.str('Text_ID')) selector.set(t.str('Text_ID').trim().toUpperCase(), t.str('Icon_Name'));
  for (const owner of owners) {
    const f = db.faction(owner),
      fact = facts[owner];
    if (!f || !fact) continue;
    const explicit = badges[profile]?.[owner];
    const names = [
      explicit && (explicit.includes('.') ? explicit : explicit + '.tga'),
      f.str('Multiplayer_Map_Preview_Icon'),
      selector.get(f.str('Text_ID').trim().toUpperCase()),
      `I_BUTTON_FACTION_${owner}.tga`,
      `I_ENCYCLOPEDIA_${owner}_SYMBOL.tga`,
      f.str('Icon_Name'),
      `I_BUTTON_COMMAND_BAR_${owner}_SYMBOL.tga`
    ];
    fact.emblem = names
      .filter(Boolean)
      .map(n => n.trim())
      .reduce((found, n) => found || image(n), '');
    // Minor sides may have only a faction-configured infantry marker, not a crest. Use it in
    // the ownership key (not as a heraldic symbol behind a playable leader).
    if (!fact.emblem && !f.bool('Is_Neutral') && owner !== 'Neutral') fact.keyIcon = image(f.str('Infantry_Icon_Name'));
    if (!playable.has(owner)) continue;
    const belongs = t => t?.list('Affiliation').some(n => n.toUpperCase() === owner.toUpperCase());
    const candidates = [
      db.type(reps[profile]?.[owner]),
      db.type(f.str('Faction_Leader')),
      db.type(f.str('Faction_Leader_Company')),
      ...[...db.types.values()].filter(
        t =>
          t.bool('Is_Named_Hero') &&
          t.list('Affiliation').length === 1 &&
          /^(HeroUnit|HeroInfantry|UniqueUnit|HeroCompany)$/i.test(t.tag) &&
          !/dummy|template|spawner/i.test(t.name)
      )
    ];
    for (const t of candidates) {
      if (!t) continue;
      // Two reviewed commanders use Independent_Forces on their ship type to keep it out of AI enumeration.
      const commandShip =
        profile === '1125571106' && t.name === reps[profile]?.[owner] && ['Treuten_13X', 'Zsinj_Iron_Fist_Executor'].includes(t.name);
      if (!belongs(t) && !commandShip) continue;
      const pic = image(t.str('Icon_Name'));
      if (pic) {
        fact.portrait = pic;
        fact.representative = db.t(t.str('Text_ID')) || t.name;
        break;
      }
    }
  }
}
