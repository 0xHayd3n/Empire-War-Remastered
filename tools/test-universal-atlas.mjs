import assert from 'node:assert/strict';
import { mapFamilies, mapStart } from '../public/js/game/universalmaplist.js';
import { launchPlan } from './universal-atlas.mjs';
import { menuTable, thrawnSelections } from './universal-loader-table.mjs';
import { assertPrivateLibrary } from './universal-library.mjs';
const atlas = {
    profiles: [
      {
        id: 'demo',
        revision: 'A',
        defaults: { treasury: 10000, politics: 160 },
        facts: { Blue: { adj: 0 } },
        rows: [
          {
            id: 'loader',
            faction: 'Blue',
            initial: 0,
            slots: [],
            limits: { custom: false },
            variants: [
              { id: 'later', sites: [] },
              { id: 'earlier', sites: [] }
            ]
          }
        ]
      }
    ]
  },
  q = { profile: 'demo', row: 'loader', target: 'later', difficulty: 'hard' };
const plan = launchPlan(atlas, q);
assert.equal(plan.setup.campaign, 'later');
assert.equal(plan.setup.universalPath, 1);
assert.equal(plan.setup.faction, 'Blue');
assert.deepEqual(plan.setup.universalOptions, {});
assert(!('campaignSettings' in plan.setup));
for (const bad of [
  { profile: 'missing' },
  { row: 'later' },
  { target: 'loader' },
  { difficulty: '4' },
  { settings: { tech: 4 } },
  { treasury: 8899 },
  { expedition: true }
])
  assert.throws(() => launchPlan(atlas, { ...q, ...bad }));
const t = menuTable('return { ["map"] = { ["6ABY"] = { ["EMPIRE"] = true, ["REBEL"] = false } }, -- note\n ["regions"] = {"map"} }');
assert.equal(t.map['6ABY'].EMPIRE, true);
assert.deepEqual(t.regions, ['map']);
assert.throws(() => menuTable('return { ["foo"] = require("code") }'));
const trans = {
  ProgressiveMaps: ['KnownSmall'],
  RegionalMaps: [],
  HistoricalMaps: [],
  AllFactions: ['EMPIRE', 'REBEL'],
  ProgressiveEras: ['6ABY'],
  Era_XML_Nums: { '6ABY': 'Era_2' }
};
assert.deepEqual(thrawnSelections(trans, { KnownSmall: t.map }), [
  {
    map: 'KnownSmall',
    targets: [
      ['KnownSmall_Era_2_EMPIRE', '6 ABY · Isard'],
      ['KnownSmall_Era_2_EMPIRE_CCoGM', '6 ABY · Central Committee']
    ]
  }
]);
// Display families group faction-specific starts, but never supply the launch ID themselves.
const row = (id, family, faction, dates, extra = {}) => ({
  id,
  family,
  faction,
  label: 'Same name',
  limits: { custom: false },
  slots: [],
  initial: 0,
  variants: dates.map(([id, date]) => ({ id, date, sites: [] })),
  ...extra
});
const profile = {
  id: 'pack',
  facts: { Blue: { adj: 0 }, Red: { adj: 1 } },
  yearLegend: '1. - 22 BBY: Early\n2. - 21 BBY: Later',
  rows: [
    row('base-b', 'A', 'Blue', [
      ['b22', '22 BBY'],
      ['b21', '21 BBY']
    ]),
    row('base-r', 'A', 'Red', [['r21', '21 BBY']]),
    row(
      'other',
      'B',
      'Blue',
      [
        ['end', '19 BBY'],
        ['middle', '20 BBY']
      ],
      { initial: 1 }
    ),
    row('ftgu', 'C', 'Red', [['ftgu', '']], { base: { tech: 0 }, slots: ['tech'], limits: { custom: true, minTech: 1, maxTech: 2 } }),
    row('branches', 'D', 'Blue', [
      ['one', '6 ABY · Isard'],
      ['two', '6 ABY · Central Committee']
    ]),
    row('fixed', '', 'Blue', [['fixed', '']], { label: '22 BBY: Siege' }),
    row('range', '', 'Blue', [['range', '']], { label: '25 - 20 BBY: Siege' }),
    row('irregular', 'bad', 'Blue', [['i', '']]),
    row('irregular2', 'bad', 'Blue', [['j', '']])
  ]
};
const [a, b, ftgu, branches, fixed, range, ...irregular] = mapFamilies(profile);
assert.equal(a.members.length, 2);
assert.notEqual(a.title, b.title);
assert.equal(irregular.length, 2);
assert.equal(range.dates[0].year, '');
assert.equal(fixed.dates[0].year, '22 BBY');
const twentyOne = a.dates.find(d => d.year === '21 BBY');
assert.equal(mapStart(a, twentyOne, 'Red').choice.variant.id, 'r21');
assert.equal(mapStart(b, twentyOne, 'Red').choice.variant.id, 'middle');
assert.equal(mapStart(ftgu, twentyOne).choice.tech, 1);
assert.equal(mapStart(ftgu).choice.tech, undefined);
assert.equal(mapStart(a, mapStart(ftgu).date, 'Blue').choice.variant.id, 'b22');
assert.equal(mapStart(branches, branches.dates[1]).choice.variant.id, 'two');
for (const family of mapFamilies(profile))
  for (const date of family.dates)
    for (const s of date.choices) {
      const { setup } = launchPlan({ profiles: [profile] }, { profile: 'pack', row: s.row.id, target: s.variant.id, difficulty: 'medium' });
      assert.equal(setup.campaign, s.variant.id);
      assert.equal(setup.faction, s.row.faction);
    }
assert.throws(() => assertPrivateLibrary(process.cwd(), { items: new Map() }), /private library/);
console.log(
  'PASS: exact atlas targets, fixed starts, donor allowlist, literal-only selector tables, faction restriction, regime variants and private cache guard.'
);
