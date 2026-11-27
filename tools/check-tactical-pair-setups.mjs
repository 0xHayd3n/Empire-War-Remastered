// Offline preparation is not a battle. Verify both real solo draft paths and the
// installed products (including native seats) for every unordered pair on this host.
// Run once per --host in a fresh process. Fail closed; never synthesize a missing kit.
import { readLibrary } from './workshop-library.mjs';
import { libraryHome, loadPack } from './universal-library.mjs';
import { openGame } from './megfs.mjs';
import { db, loadGameData, skirmishFactions, skirmishStation } from '../public/js/gamedata.js';
import { instantForces } from '../public/js/game/instantforces.js';
import { skirmishSetup } from '../public/js/game/skirmishsetup.js';
import { prepareDetachments } from '../public/js/game/skirmishdetachments.js';
import { instantRoster } from '../public/js/game/instantbattle.js';
import { groundForces } from '../public/js/game/planetbattle.js';
import { guestRefs } from '../public/js/game/tacticalroster.js';
import fs from 'node:fs';
const arg = k => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const host = arg('--host') || 'stock',
  api = process.env.FRAME_URL || 'http://127.0.0.1:8591';
const lib = readLibrary(),
  pack = host === 'stock' ? null : loadPack(libraryHome(), host, lib.items.get(host)?.folder),
  v = openGame(lib.game, [], { packedLayer: pack?.entries, language: 0 });
const http = fetch,
  rows = [],
  failures = [],
  counts = {};
try {
  const { profiles } = await (await http(api + '/api/universal/atlas')).json(),
    { solo, unavailable } = await (await http(api + '/api/universal/atlas/operations')).json();
  if (unavailable.length) throw Error('Incomplete source catalog: ' + unavailable.join(','));
  const catalog = profiles.map(p => ({ ...p, ...solo[p.id] }));
  globalThis.fetch = async input => {
    const u = new URL(String(input), api);
    if (u.pathname.startsWith('/api/universal/atlas/')) return http(u);
    if (u.pathname === '/api/find')
      return Response.json([...v.index.keys()].filter(k => new RegExp(u.searchParams.get('q'), 'i').test(k)).sort());
    const bytes = v.read(v.resolve(decodeURIComponent(u.pathname.replace(/^\/asset\//, ''))));
    return new Response(bytes, { status: bytes ? 200 : 404 });
  };
  await loadGameData(undefined, { language: 0, universalProfile: host });
  const native = skirmishFactions(),
    forces = instantForces(catalog, host, native);
  const model = skirmishSetup({
    maps: ['space.ted'],
    landMaps: ['land.ted'],
    factions: native,
    init: {
      players: [
        { human: true, team: 0 },
        { difficulty: 'medium', team: 1 }
      ],
      mapFile: 'space.ted',
      teamFactions: native,
      credits: 10000,
      popCap: 50
    }
  });
  model.configureRosters(catalog, host);
  for (const domain of ['land', 'space']) {
    model.st.mode = domain;
    model.st.mapFile = domain + '.ted';
    const picks = forces.options(domain).map(([value]) => ({ value, ...forces.get(domain, value) }));
    await Promise.all(picks.map(p => forces.load(domain, p.value)));
    const army = p =>
      domain === 'land'
        ? p.home
          ? groundForces(p.value)
          : forces.ground(p.value)
        : (p.home ? instantRoster(p.value) : forces.roster(p.value))
            .filter(r => r.cost <= 15000)
            .slice(0, 1)
            .map(r => r.name);
    const armies = new Map(picks.map(p => [p.value, army(p)]));
    for (let i = 0; i < picks.length; i++)
      for (let j = i; j < picks.length; j++) {
        const pair = [picks[i], picks[j]],
          expected = pair.map(p => p.value);
        for (const [n, p] of pair.entries()) model.slots[n].rosterPick = p.ref;
        const sk = model.setup();
        for (const mode of ['skirmish', 'instant'])
          try {
            if (!sk || sk.teamFactions.join('/') !== expected.join('/')) throw Error('skirmish seat resolution: ' + model.rosterError());
            const units = expected.map(k => armies.get(k)),
              setup =
                mode === 'skirmish'
                  ? sk
                  : {
                      mode: domain,
                      players: [{ team: 0 }, { team: 1 }],
                      teamFactions: expected,
                      skirmishRosters: guestRefs(pair.map(p => (!p.home ? p.ref : null))),
                      instant: { [domain === 'land' ? 'groundArmies' : 'armies']: units }
                    };
            await prepareDetachments(setup);
            for (const [n, p] of pair.entries()) {
              const f = db.faction(p.value);
              if (!f) throw Error('unresolved faction ' + p.value);
              if (!p.home && (f.detachment?.profile !== p.ref.profile || f.detachment?.revision !== p.ref.revision))
                throw Error('wrong revision');
              const start = mode === 'instant' ? units[n] : f.list(domain + '_Skirmish_AI_Default_Forces');
              if (!start.length || !start.every(u => db.type(u))) throw Error(mode + ' empty or unresolved opening: ' + p.value);
              if (domain === 'space' && mode === 'skirmish' && !skirmishStation(p.value)) throw Error('missing station ' + p.value);
            }
            const key = mode + '-' + domain;
            counts[key] = (counts[key] || 0) + 1;
          } catch (e) {
            failures.push({ mode, domain, expected, why: e.message });
          }
      }
    rows.push({ domain, seats: picks.map(p => p.ref), pairs: (picks.length * (picks.length + 1)) / 2 });
  }
  const result = { host, kind: 'setup and opening-product resolution, not live damage', counts, rows, failures };
  if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(result, null, 2));
  console.log(host, counts, 'failed:', failures.length, failures.slice(0, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  v.close();
}
