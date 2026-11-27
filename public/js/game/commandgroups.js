// Universal identity colors, not a coalition's diplomacy. The native faction
// name is only meaningful WITH its source profile. Pin shades to seats rather
// than assigning the Nth shade in today's filtered/installed directory.
const TR = '1125571106',
  FALL = '1976399102',
  RR = '3417277973',
  AOR = '1397421866',
  CW = '3387971722',
  REM = '1770851727',
  STOCK = 'stock';
const groups = [],
  seats = new Map();
function group(name, hue, aliases, palettes) {
  const g = { name, hue, aliases };
  groups.push(g);
  for (const [pack, entries] of palettes)
    for (const [id, color] of Object.entries(entries)) {
      const key = pack + '/' + id.toUpperCase();
      if (seats.has(key)) throw Error('Duplicate Universal color: ' + key);
      seats.set(key, { group: g, color: '#' + color });
    }
}
group('Republic & Rebellion', 'Crimson', 'Republic restoration • republican movements', [
  [STOCK, { Rebel: 'ee5056' }],
  [TR, { Rebel: 'b94752' }],
  [RR, { Empire: 'ce4968', Sector_Forces: 'ef8493' }],
  [FALL, { Empire: 'd94545', Sector_Forces: 'e97570' }],
  [CW, { Empire: 'f75c4c' }],
  [AOR, { Rebel: 'fc807e' }],
  [REM, { Rebel: 'dc5864', Republic: 'ba3c42' }]
]);
group('Separatist coalition', 'Blue', 'Corporate Alliance • Separatist Council • Confederacy of Independent Systems • CIS', [
  [FALL, { Rebel: '577ee2', Commerce_Guild: '78acef', Trade_Federation: '4977af', Banking_Clan: '476bc7', Techno_Union: '5295dc' }],
  [CW, { Rebel: '4089f2' }],
  [REM, { CIS: '88a2eb' }]
]);
group('Empire & Imperial offshoots', 'Green', 'Imperial remnants • Imperial successor states • Imperial warlords • Imperial splinters', [
  [STOCK, { Empire: '4bb765' }],
  [
    TR,
    {
      Empire: '629c48',
      Eriadu_Authority: '92b45c',
      Greater_Maldrood: '4b9d65',
      Pentastar: '8ece74',
      Zsinj_Empire: '9dc267',
      EmpireoftheHand: '4dae7d',
      Imperial_Proteus: '74bf88',
      Warlords: '9ecb9a'
    }
  ],
  [AOR, { Empire: '7abb4e', Warlords: '64945c' }],
  [REM, { Empire: '57b455', Warlords: '80a86f' }]
]);
group('Underworld & syndicates', 'Gold', 'criminal syndicates • cartels • pirates • organized crime • underworld', [
  [STOCK, { Pirates: 'e8b13f', Underworld: 'f7c90d', Hutts: 'e6ab58' }],
  [TR, { Hutt_Cartels: 'c5a550' }],
  [RR, { Hutt_Cartels: 'd9b969' }],
  [FALL, { Underworld: 'bd9140', Hutt_Cartels: 'dfb952' }],
  [CW, { Underworld: 'f1c658', Pirates: 'cc9a34', Hutts: 'f3d081' }],
  [AOR, { Underworld: 'e7ca63', Pirates: 'edac39', Hutts: 'bd9e57' }],
  [REM, { Underworld: 'd8b338', Cartels: 'f1bb44' }]
]);
group('Regional powers', 'Teal', 'regional governments • regional states', [
  [TR, { Hapes_Consortium: '6eb7a7', Mandalorians: '3eaba4', Corellia: '47bb9e', Corporate_Sector: '68ab9f', Yevetha: '46a393' }],
  [RR, { Hapes_Consortium: '94cfbc', Underworld: '5bc2c2' }],
  [FALL, { Mandalorians: '46bab8' }],
  [CW, { Hapans: '80ccbd', CSA: '42b6a1' }],
  [AOR, { Hapans: '5fbfba', CSA: '379e91' }],
  [REM, { Hapan: '95c8b4', Mandalorians: '408f96', CSA: '74c3a5' }]
]);
group('Unknown Regions powers', 'Copper', 'Unknown Regions • western reaches', [
  [TR, { Chiss: 'd58553', SsiRuuvi_Imperium: 'f19660' }],
  [RR, { Rakata_Empire: 'c87746' }]
]);
group('Invasion forces', 'Magenta', 'invading forces • invasion factions', [
  [TR, { Underworld: 'd44c9a' }],
  [REM, { Hutts: 'e17cb9' }]
]);
group('Sith traditions', 'Violet', 'Sith factions • Sith orders', [
  [RR, { Rebel: '9d69d8', Sith_Warlords: 'ba85ec' }],
  [REM, { Sith: '8c77cc' }]
]);
group('Local forces & warlords', 'Silver', 'local defense • local defence • unaffiliated forces', [
  [TR, { Independent_Forces: 'c4ced2' }],
  [RR, { Independent_Forces: 'd1cbd4' }],
  [FALL, { Independent_Forces: 'e2e6e4' }],
  [CW, { Independent: 'c4cbd8', Warlords: 'a4b0ba' }],
  [AOR, { Independent: 'd8d5ce' }],
  [REM, { Pirates: 'f3f3f3' }]
]);
export const commandGroups = groups;
const seat = (p, id) => typeof id === 'string' && seats.get(p + '/' + id.toUpperCase());
export const commandGroup = (p, id) => seat(p, id)?.group || null;
export const rosterColor = (p, id) => seat(p, id)?.color;
export const rgbBytes = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const authoredInks = new Set([...seats.values()].map(s => s.color));
// Two seats can both choose e.g. Yoda. Prefer a lighter/darker version over
// silently making the second Republic player Separatist blue. Skip every
// authored base color so a mirror never steals a later seat's own shade.
export function alternateShade(own, free) {
  if (!authoredInks.has(own)) return;
  const rgb = rgbBytes(own);
  for (const amount of [-0.34, 0.48, -0.5, 0.65, 0.28, -0.18, 0.77, -0.62, 0.38, -0.42, 0.56]) {
    const end = amount < 0 ? 0 : 255;
    const color =
      '#' +
      rgb
        .map(c =>
          Math.round(c + (end - c) * Math.abs(amount))
            .toString(16)
            .padStart(2, '0')
        )
        .join('');
    if (!authoredInks.has(color) && free(color)) return color;
  }
}
