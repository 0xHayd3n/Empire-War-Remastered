import assert from 'node:assert/strict';
import { rasterPortrait } from './universal-planet-portraits.mjs';
import { tileSize, planetArt } from '../public/js/game/universalplanetart.js';
import { laneKit } from './universal-lane-kit.mjs';
import { previewReturn } from '../public/js/game/universalpreviewreturn.js';
import { planetPool } from '../public/js/game/universalplanetpool.js';
import { inactiveWorlds } from '../public/js/game/universalcontextworlds.js';
import { galaxyChart, sectorView } from '../public/js/game/universalgalaxychart.js';
import { overviewView } from '../public/js/game/universalviewcamera.js';
import { mapFamilies, mapStart, planetCount } from '../public/js/game/universalmaplist.js';
import { mapSections } from '../public/js/game/universalmapgroups.js';
import { yearStops, nearestStop } from '../public/js/game/universalyeartrack.js';
import { eraTimeline, startWithin } from '../public/js/game/universaltimeline.js';
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
  { progressive: true },
  { expedition: true }
])
  assert.throws(() => launchPlan(atlas, { ...q, ...bad }));
// Payment is explicitly boolean, scoped to attested sources; false is not a missing choice.
const terms = structuredClone(atlas),
  home = terms.profiles[0];
home.payment = { native: true, declared: true };
for (const value of [false, 0, 'false', null]) assert.throws(() => launchPlan(terms, { ...q, payAsYouGo: value }));
terms.profiles.push({ id: 'stock', payment: { native: false, declared: true } });
assert.deepEqual(launchPlan(terms, { ...q, payAsYouGo: false }).setup.universalOptions, { payAsYouGo: false });
assert.deepEqual(launchPlan(terms, { ...q, payAsYouGo: true }).setup.universalOptions, {});
home.rows[0].scripted = true;
assert.throws(() => launchPlan(terms, { ...q, payAsYouGo: false }));
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
const openings = {
  ...trans,
  CustomMaps: ['FTGU', 'Custom_FTGU'],
  ProgressiveEras: ['4ABY', '6ABY'],
  Era_XML_Nums: { '4ABY': 'Era_1', '6ABY': 'Era_2' }
};
assert.deepEqual(thrawnSelections(openings, { FTGU: { '4ABY': { EMPIRE: true, REBEL: false }, '6ABY': { EMPIRE: true } } }), [
  { map: 'FTGU', targets: [['FTGU_Era_1_EMPIRE', '4 ABY']] }
]);
const staticAtlas = structuredClone(atlas);
staticAtlas.profiles[0].rows[0].eraProgression = true;
assert.equal(launchPlan(staticAtlas, q).setup.startingTechLevel, undefined);
assert.equal(launchPlan(staticAtlas, { ...q, progressive: true }).setup.startingTechLevel, 4);
assert.throws(() => launchPlan(staticAtlas, { ...q, progressive: 4 }));
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
// Exact starts survive era/period filtering, including maps with identical labels across packs.
const uneven = yearStops(['3964 BBY', 'Scenario starts', '3959 BBY', '3957 BBY', '3962 BBY'].map(label => ({ label })));
assert.deepEqual(
  uneven.map(s => s.at),
  [0, 2 / 7, 5 / 7, 1]
);
assert.equal(nearestStop(uneven, -3960).period.label, '3959 BBY');
assert.deepEqual(
  yearStops(['4 ABY', '12 ABY', '11.5 ABY', '20 - 19 BBY', 'Pre-Clone Wars'].map(label => ({ label }))).map(s => s.at),
  [0, 7.5 / 8, 1]
);
const prewar = { label: 'FTGU · pre-22 BBY', ftgu: true };
const withOpening = yearStops([...uneven.map(s => s.period), prewar]);
assert.equal(withOpening[0].year, null);
assert.equal(nearestStop(withOpening, 0).period, prewar);
assert.equal(nearestStop(withOpening, 0.2).year, -3964);
assert(Math.abs((withOpening[2].at - withOpening[1].at) / (1 - withOpening[1].at) - 2 / 7) < 1e-12);
assert.deepEqual(
  yearStops([prewar, { label: '22 BBY' }]).map(s => s.at),
  [0, 1]
);
assert.equal(yearStops([{ label: 'Scenario starts' }]).length, 0);
assert.equal(yearStops([{ label: '4 ABY', ftgu: true }])[0].year, 4);
const fall = { ...profile, id: '1976399102' },
  awakening = { ...profile, id: '3387971722', rows: [row('script', '', 'Red', [['loader', 'Original in-game selector']])] },
  old = {
    ...profile,
    id: '3417277973',
    rows: [
      row('base-b', 'A', 'Blue', [['b22', '22 BBY']]),
      row('single-planet', 'F', 'Red', [['single-planet', '']], { defaultFtguYear: '3996 BBY' })
    ]
  };
const profiles = [old, fall, awakening];
const timeline = eraTimeline({
  profiles,
  eras: [...profiles.map(({ id }) => ({ id, name: id, ready: true })), { id: '1125571106', name: 'Thrawn', ready: false }]
});
const clone = timeline[1],
  inYear = y => clone.periods.find(p => p.label === y).maps;
const [opener, , custom] = timeline[0].periods;
assert.equal(opener.label, '3996 BBY');
assert(opener.ftgu && !opener.scenario && custom.scenario);
const [[revanFtgu, [dated]]] = opener.maps;
assert.equal(mapStart(revanFtgu).date, dated);
assert.equal(dated.choices[0].variant, custom.maps.get(revanFtgu)[0].choices[0].variant);
assert.equal(timeline.length, 4);
assert.equal(timeline[3].periods.length, 0);
assert.match(timeline[3].missing[0], /not ready/i);
assert(timeline[3].offers.some(o => o.mod.name === 'Thrawn' && o.title === 'Known Galaxy'));
assert(timeline[3].views.every(v => v.discovery && v.maps.size === 0 && !v.label));
assert.deepEqual(
  clone.periods.map(p => p.label),
  ['22 BBY', '21 BBY', '20 BBY', '19 BBY', '6 ABY', 'Scenario starts']
);
assert.deepEqual(
  [...inYear('22 BBY').keys()].map(f => f.id),
  ['base-b', 'ftgu', 'fixed']
);
assert.deepEqual(
  [...inYear('Scenario starts').keys()].map(f => [f.p.id, f.id]),
  [
    ['1976399102', 'range'],
    ['1976399102', 'irregular'],
    ['1976399102', 'irregular2'],
    ['3387971722', 'script']
  ]
);
const [[branched, twins]] = inYear('6 ABY');
assert.equal(twins.length, 2);
assert.equal(startWithin(branched, twins, twins[1], 'Blue').choice.variant.id, 'two');
const [[known, early]] = inYear('22 BBY');
assert.equal(startWithin(known, early, twins[1], 'Red').choice.variant.id, 'b22');
const [techMap, techChoices] = [...inYear('21 BBY')].find(([f]) => f.id === 'ftgu');
assert.equal(startWithin(techMap, techChoices, null, 'Red').choice.tech, 1);
const expected = profiles
  .flatMap(p =>
    mapFamilies(p).flatMap(f => f.dates.flatMap(d => d.choices.map(s => JSON.stringify([p.id, s.row.id, s.variant.id, s.tech]))))
  )
  .sort();
const reachable = timeline
  .flatMap(e =>
    e.periods.flatMap(per =>
      [...per.maps].flatMap(([f, ds]) => ds.flatMap(d => d.choices.map(s => JSON.stringify([f.p.id, s.row.id, s.variant.id, s.tech]))))
    )
  )
  .sort();
assert.deepEqual(reachable, expected);
const mkChart = (id, names, coords) => ({
  id,
  camera: { pitch: -37, plane: 10 },
  planets: [...names.map((name, i) => [name, name, ...coords[i], 10, 'planet.alo', 1, 0]), ['Sky', 'Sky', 0, 0, 0, 'sky.alo', 1, 1]],
  maps: [{ worlds: names.map((_, i) => [i, 'Demo']), scenery: [names.length] }]
});
const ref = mkChart(
    'stock',
    ['Core', 'North', 'West'],
    [
      [0, 0],
      [0, 120],
      [-100, 0]
    ]
  ),
  moved = mkChart(
    '1770851727',
    ['Core_WW', 'North_WW', 'West_WW', 'Local_WW'],
    [
      [100, 50],
      [100, 110],
      [50, 50],
      [90, 60]
    ]
  );
const prior = JSON.stringify([ref, moved]),
  chart = galaxyChart([moved, ref]);
assert.equal(chart.reference, ref);
assert.deepEqual(chart.sky, [ref.planets[3]]);
for (let i = 0; i < 3; i++) assert.deepEqual(chart.world(ref, i).placed.slice(2, 5), chart.world(moved, i).placed.slice(2, 5));
assert.deepEqual(chart.world(moved, 3).placed.slice(2, 4), [-20, 20]);
assert.equal(chart.catalog.length, 4, 'Shared worlds have one inactive identity, not one per profile');
assert.deepEqual(
  inactiveWorlds(
    [
      { id: 'A', name: 'A' },
      { id: 'A_WEB', name: 'A' },
      { id: 'B', name: 'B' },
      { id: 'B_BIG', name: 'B' }
    ],
    new Set(['A']),
    ['A']
  ),
  [{ id: 'B', name: 'B' }]
);
// Two maps with the same planet type but different authored placements and topology.
const shifted = structuredClone(ref);
shifted.planets.push([...shifted.planets[0]]);
shifted.planets.at(-1)[2] = 65;
shifted.maps.push({
  worlds: [
    [4, 'Blue'],
    [1, 'Gray']
  ],
  routes: [[1, 0, 3]],
  scenery: [3]
});
const alternate = galaxyChart([shifted]);
assert.equal(alternate.catalog.length, 3);
assert.equal(alternate.world(shifted, 4).id, alternate.world(shifted, 0).id);
assert.deepEqual(alternate.world(shifted, 4).placed.slice(2, 5), [65, 0, 10]);
assert.equal(alternate.world(shifted, 0).placed[2], 0);
assert.deepEqual(shifted.maps[1].routes, [[1, 0, 3]]);
const aliases = mkChart(
  '1770851727',
  ['X', 'X_WW', 'X-II', 'X_II'],
  [
    [10, 20],
    [40, 30],
    [0, 30],
    [100, 10]
  ]
);
assert.equal(galaxyChart([aliases]).catalog.length, 4, 'Do not collapse distinct IDs inside one pack');
const disjoint = mkChart(
  'other',
  ['Island', 'Edge'],
  [
    [0, 0],
    [1234, -4321]
  ]
);
assert.deepEqual(
  galaxyChart([ref, disjoint]).world(disjoint, 1).placed.slice(2, 4),
  [1234, -4321],
  'A remote authored world is not a setup marker'
);
assert.equal(JSON.stringify([ref, moved]), prior);
const all = overviewView(chart.frame, ref.camera, 960, 700, chart.frame),
  sector = overviewView([chart.world(moved, 3).placed], ref.camera, 960, 700, chart.frame);
assert.deepEqual(all.eye, sector.eye);
assert(sectorView(sector.labels).zoom > sectorView(all.labels).zoom);
const ff = { members: [{}], p: { maps: [{ worlds: [1, 2] }, { worlds: [1, 2, 3] }] } },
  variations = [{ choices: [{ variant: { map: 0 } }, { variant: { map: 1 } }] }];
assert.equal(planetCount(ff, variations), '2–3 planets');
assert.equal(planetCount(ff, variations, { map: 0 }), '2 planets');
// Group only unambiguous sizes from the same profile, section and historical span.
// Engine IDs are not a scenario genre; a story campaign can have a Sandbox_* ID.
{
  const fam = (title, id = 'p', span = '') => ({ id: 'Sandbox_Test', title, p: { id }, span, members: [{}] });
  const families = [
    fam('Unknown'),
    fam('SANDBOX -- Atlas - Small'),
    fam('RANDOM -- Atlas - Large'),
    fam('Story -- Atlas - Large'),
    fam('STORY -- Atlas - Small'),
    fam('Story -- Atlas - Small', 'q'),
    fam('Story -- Atlas - Medium', 'p', '11 ABY'),
    fam('story -- Island - Large'),
    fam('STORY -- Island - Large'),
    fam('STORY -- Island - Small')
  ];
  const sections = mapSections({ scenario: true, maps: new Map(families.map(f => [f, variations])) });
  assert.deepEqual(
    sections.map(s => s.name),
    ['Story', 'Random', 'Sandbox', 'Miscellaneous']
  );
  const lists = sections.flatMap(s => s.rows),
    groups = lists.filter(r => r.children);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Atlas');
  assert.deepEqual(
    groups[0].children.map(r => r.title),
    ['Large', 'Small']
  );
  const restored = lists.flatMap(r => r.children || [r]).map(r => r.f);
  assert.equal(restored.length, families.length);
  assert.deepEqual(new Set(restored), new Set(families));
  assert.deepEqual(mapSections({ scenario: false, maps: new Map([[families[0], variations]]) }), [
    { name: '', rows: [{ f: families[0], title: 'Unknown' }] }
  ]);
}
assert.throws(() => assertPrivateLibrary(process.cwd(), { items: new Map() }), /private library/);
// Synthetic rigid mesh and texture, not installed game art. Same normalized result at
// either authored model scale, genuine material colors, transparent background and missing-art fallback.
{
  const triangle = scale => ({
    bones: [],
    meshes: [
      {
        name: 'body_ALT0',
        subs: [
          {
            material: { shader: 'planet.fx', params: { BaseTexture: 'land' } },
            geometry: {
              nVerts: 3,
              indices: [0, 1, 2],
              vertices: {
                pos: [-1, 0, -1, 1, 0, -1, 0, 0, 1].map(n => n * scale),
                nrm: [0, -1, 0, 0, -1, 0, 0, -1, 0],
                uv: [0, 0, 1, 0, 0.5, 1]
              }
            }
          }
        ]
      }
    ]
  });
  const tex = name => (name === 'land' ? { width: 1, height: 1, data: [180, 65, 10, 255] } : null);
  const a = rasterPortrait(triangle(1), tex),
    b = rasterPortrait(triangle(4), tex);
  assert.equal(a.length, tileSize ** 2 * 4);
  assert.deepEqual(a, b);
  assert.equal(a[3], 0);
  const center = ((tileSize / 2) * tileSize + tileSize / 2) * 4;
  assert.equal(a[center + 3], 255);
  assert(a[center] > a[center + 1]);
  assert.equal(
    rasterPortrait(triangle(1), () => null),
    null
  );
  const row = Array(9)
    .fill(null)
    .concat([[0, 3]]);
  assert.deepEqual(planetArt({ sheets: ['local'] }, row), ['local', 3]);
  assert.equal(planetArt({}, row), null);
}
// Same names are NOT a texture namespace. Preserve exact winning bytes, explicit missing
// textures and a bounded fallback for unusually large packs.
{
  const p = { overlay: { ring: 'missing.tga' }, looks: [{ texture: 'line.tga', spark: 'line.tga' }] },
    archive = (byte, size = 1) => ({
      resolve: n => (n.endsWith('/line.tga') ? 'WINNER.DDS' : null),
      index: new Map([['WINNER.DDS', { size }]]),
      read: () => Buffer.from([byte])
    });
  assert.equal(laneKit(archive(123), p)['line.tga'], Buffer.from([123]).toString('base64'));
  assert.notDeepEqual(laneKit(archive(123), p), laneKit(archive(124), p));
  assert.equal(laneKit(archive(123), p)['missing.tga'], null);
  assert.equal(laneKit(archive(123, 129 * 1024), p), null);
  const recent = previewReturn(5);
  let closed = 0;
  const profiles = [],
    entry = {
      profiles,
      plate: [
        'a',
        {
          bitmap: {
            close() {
              closed++;
            }
          }
        }
      ]
    };
  recent.put(entry);
  assert.equal(recent.take(profiles), entry);
  assert.equal(closed, 0);
  recent.put(entry);
  assert.equal(recent.take([]), null);
  assert.equal(closed, 1);
  recent.put(entry);
  await new Promise(ok => setTimeout(ok, 15));
  assert.equal(closed, 2);
  assert.equal(recent.take(profiles), null);
}
// Only the duplicate region meshes on the preview sky disappear. Same-named
// meshes on planets, native owner rings, unrelated components and hidden parts stay untouched.
{
  const { omitRegionBorders } = await import('../public/js/game/universalchartdetail.js');
  const groups = ['core', 'region_lines', 'region_lines', 'region_lines', 'Stars', 'rings', 'Object01', 'hidden'].map(name => ({
    name,
    visible: name !== 'hidden'
  }));
  const inst = { meshByName: new Map(groups.entries()) };
  omitRegionBorders(inst, 'planet.alo', 'stock');
  assert.deepEqual(
    groups.filter(g => !g.visible).map(g => g.name),
    ['hidden']
  );
  omitRegionBorders(inst, 'W_GALAXY00.ALO', '1125571106');
  assert.deepEqual(
    groups.filter(g => g.visible).map(g => g.name),
    ['core', 'Stars', 'Object01']
  );
  omitRegionBorders(inst, 'W_GALAXY00.ALO', '1397421866');
  assert.deepEqual(
    groups.filter(g => g.visible).map(g => g.name),
    ['core', 'Stars']
  );
}
// A static briefing draws the same route quads without the gameplay-only spark geometry.
{
  const { RouteBatches } = await import('../public/js/game/routebatch.js');
  const { Scene, AdditiveBlending } = await import('../public/vendor/three/build/three.module.js');
  const scene = new Scene(),
    batch = new RouteBatches(
      scene,
      () => null,
      () => AdditiveBlending
    );
  const route = () => ({
    A: [0, 0, 0],
    B: [0, 10, 0],
    axes: { across: [1, 0, 0], along: [0, 1, 0] },
    look: { texture: 'line', spark: 'dot' }
  });
  const a = route(),
    b = route();
  batch.build([a]);
  assert.equal(scene.children.length, 2);
  assert(a.spark);
  batch.setQuad(a, 2, 1, 0.5, 0, 1);
  const expected = a.quad.group.geo;
  batch.build([b], { sparks: false });
  batch.setQuad(b, 2, 1, 0.5, 0, 1);
  assert.equal(scene.children.length, 1);
  assert.equal(b.spark, undefined);
  for (const [name, att] of Object.entries(expected.attributes)) assert.deepEqual(b.quad.group.geo.attributes[name].array, att.array);
  assert.deepEqual(b.quad.group.geo.index.array, expected.index.array);
  batch.clear();
}
// A -> B -> C during upload must never paint A, waste an upload on B, or lose C.
{
  const jobs = [],
    workers = [],
    original = globalThis.Worker;
  globalThis.Worker = class {
    constructor() {
      workers.push(this);
    }
    postMessage(q) {
      jobs.push(q);
    }
    terminate() {
      this.closed = true;
    }
  };
  const pool = planetPool(),
    request = (id, signal, ns = 'P@rev') => pool.request(ns, { worlds: [[id]], backplate: 'sky' }, signal);
  try {
    const a = new AbortController(),
      b = new AbortController(),
      c = new AbortController();
    const discarded = assert.rejects(request('a', a.signal), { name: 'AbortError' });
    a.abort();
    const skipped = assert.rejects(request('b', b.signal), { name: 'AbortError' });
    b.abort();
    const latest = request('c', c.signal);
    let closed = false;
    workers[0].onmessage({
      data: {
        bitmap: {
          close() {
            closed = true;
          }
        }
      }
    });
    assert(closed);
    assert.deepEqual(
      jobs.map(q => [q.worlds[0][0], q.backplate]),
      [
        ['a', 'sky'],
        ['c', null]
      ]
    );
    workers[0].onmessage({ data: { placed: 1 } });
    assert.deepEqual(await latest, { placed: 1 });
    await Promise.all([discarded, skipped]);
    const interrupted = assert.rejects(request('d', c.signal), { name: 'AbortError' });
    pool.retain('P@new');
    await interrupted;
    assert(workers[0].closed);
    const fresh = request('a', c.signal, 'P@new');
    assert.equal(workers.length, 2);
    assert.equal(jobs.at(-1).backplate, 'sky');
    workers[1].onmessage({ data: { placed: 1 } });
    await fresh;
  } finally {
    pool.close();
    if (original) globalThis.Worker = original;
    else delete globalThis.Worker;
  }
}
console.log(
  'PASS: exact atlas targets, fixed starts, donor allowlist, literal-only selector tables, faction restriction, regime variants and private cache guard.'
);
