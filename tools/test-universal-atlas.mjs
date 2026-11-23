import assert from 'node:assert/strict';
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
  [
    ['KnownSmall_Era_2_EMPIRE', '6 ABY · Isard'],
    ['KnownSmall_Era_2_EMPIRE_CCoGM', '6 ABY · Central Committee']
  ]
]);
assert.throws(() => assertPrivateLibrary(process.cwd(), { items: new Map() }), /private library/);
console.log(
  'PASS: exact atlas targets, fixed starts, donor allowlist, literal-only selector tables, faction restriction, regime variants and private cache guard.'
);
