// The unchanged stock control and the explicitly enrolled engine pilot run against
// the same local map. No OPFS, user saves or live host.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
import * as THREE from '../public/vendor/three/build/three.module.js';
import { db, loadGameData } from '../public/js/gamedata.js';
import { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } from '../public/js/game/galaxy.js';
import { GalacticGame } from '../public/js/game/galactic.js';
import { GalacticBattles } from '../public/js/game/galacticbattles.js';
import { placeCampaignBattle, battleResult } from '../public/js/game/campaignbattle.js';
import { transferFleetUnits } from '../public/js/game/fleetmanagement.js';
import { stepFleets } from '../public/js/game/fleets.js';
import { World, Player, Team, resetEntityIds, modelsForType } from '../public/js/game/sim.js';
import { loadMap } from '../public/js/ted.js';
import { preloadModels } from '../public/js/model.js';
import { RetreatCoordinator } from '../public/js/game/retreat.js';
import { enrollVessels, repairVessel } from '../public/js/game/campaignvessels.js';
import { loseReserve } from '../public/js/game/campaignreserve.js';
import { spaceRosters } from '../public/js/game/tacticalautoresolve.js';
import { snapshot, restore, restoreSpaceCampaign } from '../public/js/game/savegame.js';
const json = x => JSON.parse(JSON.stringify(x));
const ar = openGame(process.env.SWR_GAME || fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
try {
  globalThis.fetch = async input => {
    const s = String(input);
    if (s.startsWith('api/find?q='))
      return Response.json([...ar.index.keys()].filter(n => new RegExp(decodeURIComponent(s.slice(11)), 'i').test(n)));
    const b = ar.read(ar.resolve(decodeURIComponent(s.replace(/^asset\//, ''))));
    return new Response(b || null, { status: b ? 200 : 404 });
  };
  await loadGameData();
  for (const tracking of [false, true]) {
    const data = await loadCampaignData(),
      camp = data.campaigns.get('SANDBOX_EQUAL_FOOTING_REBEL'),
      fresh = () => startingGalaxy(data, camp),
      g = fresh(),
      p = g.planets.find(q => q.name === 'Bespin'),
      ship = db.type('Calamari_Cruiser'),
      satellite = db.type('Rebel_Defense_Satellite_Repair'),
      fleet = { owner: 'Rebel', planet: p.index, units: [{ type: ship }, { type: ship }], dest: -1, leg: null, path: [], slot: 0 };
    g.universalPath = 1;
    if (tracking) assert(enrollVessels(g));
    p.station = null;
    p.spaceLevel = 0;
    g.fleets = [fleet];
    const game = Object.assign(Object.create(GalacticGame.prototype), {
      galaxy: g,
      me: 'Rebel',
      setup: {},
      view: { x: 0, y: 0 },
      cam: { pull: 0 },
      battle: { p: p.index, mode: 'space', attacker: 'Empire', defender: 'Rebel' },
      autoResolveFor: () => ({ allowed: true }),
      victory: { tacticalDeaths() {}, superweaponBattle() {} }
    });
    game.battles = new GalacticBattles(game);
    const map = await loadMap(
      [...ar.index.keys()]
        .find(n => /\\MAPS\\[^\\]*_SPACE_PLANET_[^\\]*KUAT[^\\]*\.TED$/i.test(n))
        .split('\\')
        .pop()
    );
    const names = new Set();
    for (const t of [ship, satellite]) modelsForType(t, null, names, new Set());
    await preloadModels([...names].filter(Boolean));
    const fx = new Proxy(() => {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => 0 : fx), apply: () => undefined });
    function enter(save = null) {
      resetEntityIds();
      const setup = save ? json(save.campaign.setup) : game.battleSetup(),
        cb = setup.campaign;
      const w = new World({ scene: new THREE.Scene(), fx, audio: fx, map });
      w.modelOpts = { headless: true };
      w.artReady = () => true;
      w.onEvent = () => {};
      w.fog = false;
      w.campaign = true;
      for (const [i, f] of ['Empire', 'Rebel'].entries())
        w.addPlayer(new Player(i, w.addTeam(new Team(i, f)), { credits: 5000, human: i === 1 }));
      for (const side of [cb.attacker, cb.defender]) for (const u of side.units) u.type = db.type(u.type);
      cb.defender.station = null;
      cb.defender.orbital = [];
      const book = placeCampaignBattle(w, map, w.teams, cb);
      const tactical = {
        world: w,
        campaignBook: book,
        setup,
        map,
        human: w.players[1],
        ui: { groups: new Map(), selection: [] },
        renderer: { rig: { x: 0, y: 0, dist: 1000, pitch: 0, yaw: 0 } },
        speed: 1
      };
      book.called = new Map();
      w.onEvent = (k, d) => {
        if (k === 'built') {
          const list = book.called.get(d.player.team.id) || [];
          list.push(d.entity);
          book.called.set(d.player.team.id, list);
        }
      };
      if (save) {
        const restored = restore(tactical, save);
        assert.deepEqual(restored.missing, []);
        restoreSpaceCampaign(tactical, save, restored.refs);
      }
      return { w, book, cb, tactical };
    }
    const { w, book, cb, tactical } = enter(),
      a = book.entity.get('0:0'),
      b = book.entity.get('0:1');
    assert.notEqual(a.id, b.id);
    a.shield = 0;
    a.maxShield = 0;
    w.damage(a, 1000, { damageType: 'Damage_Default' });
    const hp = a.hardpoints.find(h => h.destroyable);
    w.damage(a, hp.maxHealth / 2, { damageType: 'Damage_Default', hp });
    const hurt = hp.health,
      sat = w.spawn(satellite, a.player, a.x + 50, a.y);
    sat.heal.timer = 0;
    w.updateHeal(sat, 1 / 30);
    assert(
      hp.health > hurt && hp.health < hp.maxHealth,
      JSON.stringify({ hurt, after: hp.health, max: hp.maxHealth, hyper: !!a.hyper, sat: sat.heal?.range })
    );
    assert.equal(b.health, b.maxHealth);
    const healed = hp.health,
      paidRepair = w.repairHardpoint(a.player, a, 0);
    assert.equal(paidRepair, false);
    let clock = 0;
    const retreat = new RetreatCoordinator({
      prefix: 'Space',
      campaign: true,
      time: () => clock,
      players: () => w.players,
      factionOf: p => p.factionName,
      teamOf: p => p.team.id,
      isSide: () => true,
      units: () => [a, b],
      everything: () => [a, b],
      blocker: () => 0,
      remove: (e, lost) => {
        assert(!lost);
        e.retreated = true;
        w.removeUnit(e);
      },
      end() {},
      play() {},
      show() {}
    });
    clock = 100;
    assert.equal(retreat.request(a.player), 0);
    retreat.step(300);
    assert(a.retreated && b.retreated);
    const returnResult = q => ({ ...battleResult(q.w, q.book, q.cb, q.cb.attacker.team), sides: ['Empire', 'Rebel'], victoryType: 12 });
    let result = returnResult({ w, book, cb });
    if (tracking) {
      const mid = enter(json(snapshot(tactical, 'after extraction')));
      assert.deepEqual(returnResult(mid), result, 'Retreated vessels retain their health even in the gone-entity save record');
      result = returnResult(mid);
    }
    assert.deepEqual(result.alive.slice().sort(), ['0:0', '0:1']);
    game.applyResult({ ...result, sides: ['Empire', 'Rebel'], victoryType: 12 });
    assert(fleet.leg);
    stepFleets(g, 1e7);
    assert(fleet.planet >= 0 && fleet.planet !== p.index);
    const first = fleet.units[0];
    assert(transferFleetUnits(g, fleet, 'Rebel', 1, [first]));
    const snap = JSON.parse(JSON.stringify(snapshotGalaxy(g)));
    if (!tracking) assert.deepEqual(snap.fleets[0].units[0], snap.fleets[1].units[0]);
    else {
      assert.notEqual(a.vesselId, b.vesselId);
      assert.equal(snap.fleets[1].units[0][3].vessel.id, a.vesselId);
      assert.equal(snap.fleets[0].units[0][3].vessel.id, b.vesselId);
    }
    const restored = fresh();
    applyGalaxy(restored, snap);
    game.galaxy = restored;
    game.battle.p = fleet.planet;
    const second = enter();
    assert.deepEqual(
      [...second.book.entity.values()].map(e => e.health),
      [a.maxHealth, tracking ? a.health : a.maxHealth]
    );
    if (tracking) {
      const reentered = second.book.entity.get('1:0');
      assert.equal(reentered.vesselId, a.vesselId);
      assert.equal(reentered.hardpoints.find(h => h.def === hp.def).health, healed);
      assert.equal(second.book.entity.get('0:0').vesselId, b.vesselId);
    }
    console.log({
      path: tracking ? 'enrolled' : 'unmodified control',
      type: ship.name,
      damagedHull: a.health,
      hardpointDamaged: hurt,
      hardpointAfterRepair: healed,
      otherHull: b.health,
      retreated: result.alive,
      damagedSlotAfterTransfer: '1:0',
      onReentry: [...second.book.entity.values()].map(e => e.health),
      nativeStationRepairOnShip: paidRepair
    });
    if (!tracking) continue;
    // New battle with a pathfinder: same hull in field, two in reserve and another
    // *tactically built* copy. Only the actual removed ticket may bind a vessel.
    const copy = fresh();
    applyGalaxy(copy, json(snap));
    game.galaxy = copy;
    const here = copy.fleets[0].planet,
      src = copy.fleets[0];
    src.units[0].pathfinder = true;
    src.units.push({ type: ship }, { type: ship }, { type: ship });
    let q = enter();
    let human = q.w.players[1];
    const records = q.cb.defender.units,
      key = i => records[i].gid,
      id = i => records[i].vessel.id;
    assert.equal(q.book.entity.size, 1);
    assert.equal(q.book.waiting.length, 4);
    q.w.completeBuild(null, ship, human); // attached after the four campaign tickets
    const deploy = x => {
      const p = q.w.players[1];
      for (let y = -900; y <= q.w.max.y; y += 300) if (q.w.deployReinforcement(p, ship, x, y, 0) === null) return q.w.units.at(-1);
      assert.fail('No legal arrival point');
    };
    const fallen = deploy(-900);
    assert.equal(fallen.vesselId, id(1));
    q.w.removeUnit(fallen);
    const called = deploy(-400);
    assert.equal(called.vesselId, id(2));
    q.w.updateHyper(called, 10);
    called.shield = 0;
    q.w.damage(called, 500, { damageType: 'Damage_Default' });
    assert.equal(called.health, called.maxHealth - 500);
    const before = returnResult(q);
    q = enter(json(snapshot(q.tactical, 'dead and living called cruisers')));
    assert.deepEqual(returnResult(q), before);
    assert.equal(q.book.entity.get(key(2)).health, called.health);
    human = q.w.players[1];
    const rows = spaceRosters(q.w, q.cb, q.book)[1].filter(r => r.entity.reserve);
    assert.deepEqual(
      rows.map(r => r.entity.reserveGid),
      [key(3), key(4), undefined]
    );
    // Kill the *second* same-type reserve, not the first. A new same-type build must
    // neither resurrect it nor acquire its serial or the damage it carried.
    loseReserve(rows[1].entity, q.book);
    assert.deepEqual(human.reserveTickets, [key(3)]);
    const survivingReserve = deploy(100);
    assert.equal(survivingReserve.vesselId, id(3));
    q.w.updateHyper(survivingReserve, 10);
    survivingReserve.shield = 0;
    q.w.damage(survivingReserve, 750, { damageType: 'Damage_Default' });
    assert.equal(survivingReserve.health, survivingReserve.maxHealth - 750);
    const tacticalNew = deploy(700);
    assert.equal(tacticalNew.vesselId, undefined);
    const resolved = returnResult(q);
    assert.deepEqual(new Set(resolved.alive), new Set([key(0), key(2), key(3)]));
    game.applyResult({ ...resolved, victoryType: 11, winner: 'defender' });
    const after = json(snapshotGalaxy(copy));
    game.applyResult({ ...resolved, victoryType: 11, winner: 'defender' });
    assert.deepEqual(json(snapshotGalaxy(copy)), after, 'A repeated result must not compact fleets twice');
    // Bill the damaged survivor, not its same-type neighbour. A stale repair may
    // not spend again after restore or after later damage.
    const yard = copy.planets[here],
      owner = copy.players.find(p => p.faction === 'Rebel');
    const shipRec = src.units.find(u => u.vessel.id === id(2)),
      request = { id: shipRec.vessel.id, rev: shipRec.vessel.rev };
    assert(shipRec.vessel.condition);
    const receipt = (g, req = request) => repairVessel(g, req, 125);
    yard.station = db.type('Rebel_Star_Base_1');
    assert(yard.station);
    yard.stationOwner = 'Rebel';
    yard.owner = 'Rebel';
    owner.credits = 100;
    assert(!receipt(copy));
    assert.equal(owner.credits, 100);
    owner.credits = 1000;
    assert(!receipt(copy, { id: id(0), rev: request.rev }));
    assert.equal(owner.credits, 1000);
    const sister = src.units.find(u => u.vessel.id === id(3)).vessel,
      sisterBefore = json(sister);
    assert(sister.condition);
    assert(receipt(copy));
    assert.equal(owner.credits, 875);
    assert(!receipt(copy));
    assert.deepEqual(sister, sisterBefore, 'Repair did not touch a second damaged cruiser');
    const final = fresh();
    applyGalaxy(final, json(snapshotGalaxy(copy)));
    assert(!receipt(final));
    assert.equal(final.players.find(p => p.faction === 'Rebel').credits, 875);
    game.galaxy = final;
    for (const f of final.fleets) for (const u of f.units) delete u.pathfinder;
    const repaired = enter();
    const repairedHull = [...repaired.book.entity.values()].find(e => e.vesselId === request.id);
    assert.equal(repairedHull.health, repairedHull.maxHealth);
    const stillDamaged = [...repaired.book.entity.values()].find(e => e.vesselId === id(3));
    assert.equal(stillDamaged.health, stillDamaged.maxHealth - 750);
    repairedHull.shield = 0;
    repaired.w.damage(repairedHull, 250, { damageType: 'Damage_Default' });
    const later = returnResult(repaired);
    game.applyResult({ ...later, victoryType: 11, winner: 'defender' });
    assert(!receipt(final));
    assert.equal(final.players.find(p => p.faction === 'Rebel').credits, 875);
    const invalid = json(after);
    const vs = invalid.fleets
      .flatMap(f => f.units)
      .map(u => u[3].vessel)
      .filter(Boolean);
    vs[1].id = vs[0].id;
    const invalidGalaxy = fresh();
    applyGalaxy(invalidGalaxy, invalid);
    assert(!invalidGalaxy.vessels && invalidGalaxy.fleets.every(f => f.units.every(u => !u.vessel)));
    console.log(
      'PASS: same-ship damage and partial repair, exact reserve/death and untracked build, tactical and galactic reload, repeated battle result and single 125-credit yard debit.'
    );
  }
} finally {
  ar.close();
}
