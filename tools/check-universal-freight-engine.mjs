// Real stock campaign, native order checks and battle-return roster translation. No live game or saves.
import assert from 'node:assert/strict';
import { openGame } from './megfs.mjs';
import { db, loadGameData } from '../public/js/gamedata.js';
import { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } from '../public/js/game/galaxy.js';
import { stepVisibility } from '../public/js/game/galacticfog.js';
import { enableConvoy, acceptConvoy, settleConvoy, convoyRows } from '../public/js/game/convoycontract.js';
import { acceptVesselResult, openVesselBattle } from '../public/js/game/campaignvessels.js';
import { checkYard, finderShips, finderRows } from '../public/js/game/shipyardfinder.js';
import { availableUnits, productionBlock, queueUnit } from '../public/js/game/galacticproduction.js';
import { launchPlan } from './universal-atlas.mjs';
const a = openGame(process.env.SWR_GAME);
try {
  globalThis.fetch = async i => {
    const s = String(i);
    if (s.startsWith('api/find?q='))
      return Response.json([...a.index.keys()].filter(n => new RegExp(decodeURIComponent(s.slice(11)), 'i').test(n)));
    const b = a.read(a.resolve(decodeURIComponent(s.replace(/^asset\//, ''))));
    return new Response(b || null, { status: b ? 200 : 404 });
  };
  await loadGameData();
  const data = await loadCampaignData(),
    name = 'Sandbox_Equal_Footing_Rebel',
    camp = data.campaigns.get(name.toUpperCase());
  const fresh = () => {
      const g = startingGalaxy(data, camp);
      g.universalPath = 1;
      stepVisibility(g, g.active);
      return g;
    },
    snap = g => JSON.parse(JSON.stringify(snapshotGalaxy(g))),
    load = s => {
      const g = fresh();
      applyGalaxy(g, s);
      return g;
    };
  const row = { id: name, faction: 'Rebel', variants: [{ id: name, sites: [] }] },
    p = { id: 'stock', combat: { rescue: true }, rows: [row] },
    q = { profile: 'stock', row: name, target: name, difficulty: 'medium', convoy: true };
  assert(launchPlan({ profiles: [p] }, q).setup.universalOptions.convoy);
  for (const x of [{ convoy: 'true' }, { envoy: true }, { heroRescue: true }])
    assert.throws(() => launchPlan({ profiles: [p] }, { ...q, ...x }));
  const g = fresh(),
    owner = g.active,
    here = n => g.planets.find(p => p.name === n),
    home = here('Hoth'),
    to = here('Bespin');
  assert(!g.convoy);
  enableConvoy(g);
  home.restricted = true;
  assert(!acceptConvoy(g));
  assert(!JSON.stringify(convoyRows(g)).includes('Hoth'));
  home.restricted = false;
  assert(acceptConvoy(g));
  assert(!acceptConvoy(g));
  const id = g.convoy.id,
    freighter = g.fleets.find(f => f.units.some(u => u.charter === id));
  const u = freighter.units[0],
    untagged = { type: u.type };
  const other = { ...freighter, planet: to.index, units: [untagged] };
  g.fleets.push(other);
  assert(!settleConvoy(g));
  const before = g.players.find(p => p.faction === owner).credits;
  const keep = snap(g);
  freighter.units = [];
  assert(settleConvoy(g));
  assert.equal(g.convoy.state, 'lost');
  assert.equal(g.players.find(p => p.faction === owner).credits, before);
  assert(!settleConvoy(g));
  const retry = load(keep),
    cargo = retry.fleets.find(f => f.units.some(u => u.charter === id));
  assert(!cargo.units[0].vessel);
  retry.fleets.unshift({ ...cargo, units: [] });
  const battle = openVesselBattle(retry, home.index, [owner, 'Empire']);
  assert(battle);
  const slots = retry.fleets
    .filter(f => !f.leg && f.planet === home.index && [owner, 'Empire'].includes(f.owner))
    .flatMap(f => f.units.map(u => u.battleSlot));
  const r = {
    vesselBattle: battle,
    vesselOutcomes: [],
    planet: home.index,
    sides: [owner, 'Empire'],
    battleSlots: slots,
    alive: [cargo.units[0].battleSlot]
  };
  const back = load(snap(retry));
  assert(acceptVesselResult(back, r));
  assert(!acceptVesselResult(back, r));
  const [fi, ui] = r.alive[0].split(':');
  assert.equal(back.fleets[fi].units[ui].charter, id);
  back.fleets[fi].planet = to.index;
  assert(settleConvoy(back));
  assert.equal(back.convoy.state, 'paid');
  assert(!settleConvoy(load(snap(back))));
  assert.equal(back.players.find(p => p.faction === owner).credits - before, 1500);
  assert(back.fleets.some(f => f.units.some(u => u.type.name === 'Merchant_Freighter' && !u.charter)));
  const off = load(keep);
  off.planets[to.index].owner = 'Empire';
  assert(settleConvoy(off));
  assert.equal(off.convoy.state, 'closed');
  assert.equal(off.players.find(p => p.faction === owner).credits, before);
  const types = finderShips(g);
  const ship = types.find(t => availableUnits(g, to.index, owner, 'space').includes(t) && !productionBlock(g, to.index, owner, t));
  assert(ship);
  let compared = 0;
  for (const p of g.planets.filter(p => p.owner === owner && p.selectable && !p.background && !p.restricted)) {
    assert.equal(checkYard(g, p, ship), productionBlock(g, p.index, owner, ship));
    if (!checkYard(g, p, ship)) {
      const restored = load(snap(g));
      assert.equal(queueUnit(restored, p.index, owner, ship), null);
      compared++;
    }
  }
  assert(compared > 0);
  const chosen = finderRows(
    g,
    { type: ship },
    () => {},
    () => {
      throw Error('stale yard selected');
    }
  ).find(row => row.text.startsWith('Go to yard:'));
  for (const p of g.planets) p.restricted = true;
  chosen.activate();
  assert(
    !finderRows(
      g,
      { type: ship },
      () => {},
      () => {}
    ).some(row => row.text.startsWith('Go to yard:'))
  );
  console.log(
    'PASS: convoy exact loss, survivor translation across compaction, stale result, cancellation, one payout; finder vs native queue at',
    compared,
    'yards'
  );
} finally {
  a.close();
}
