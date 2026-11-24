// A counterexample test, not a damage implementation. Staged stock campaign,
// headless tactical simulation, real casualty handoff / fleet transfer / save codec.
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
  const data = await loadCampaignData(),
    camp = data.campaigns.get('SANDBOX_EQUAL_FOOTING_REBEL'),
    fresh = () => startingGalaxy(data, camp),
    g = fresh(),
    p = g.planets.find(q => q.name === 'Bespin'),
    ship = db.type('Calamari_Cruiser'),
    satellite = db.type('Rebel_Defense_Satellite_Repair'),
    fleet = { owner: 'Rebel', planet: p.index, units: [{ type: ship }, { type: ship }], dest: -1, leg: null, path: [], slot: 0 };
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
  function enter() {
    resetEntityIds();
    const cb = game.battleSetup().campaign;
    const w = new World({ scene: new THREE.Scene(), fx, audio: fx, map });
    w.modelOpts = { headless: true };
    w.artReady = () => true;
    w.onEvent = () => {};
    w.fog = false;
    for (const [i, f] of ['Empire', 'Rebel'].entries()) w.addPlayer(new Player(i, w.addTeam(new Team(i, f)), { credits: 5000 }));
    for (const side of [cb.attacker, cb.defender]) for (const u of side.units) u.type = db.type(u.type);
    cb.defender.station = null;
    cb.defender.orbital = [];
    const book = placeCampaignBattle(w, map, w.teams, cb);
    assert.equal(book.entity.size, 2);
    return { w, book, cb };
  }
  const { w, book, cb } = enter(),
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
  const result = battleResult(w, book, cb, cb.attacker.team);
  assert.deepEqual(result.alive.slice().sort(), ['0:0', '0:1']);
  game.applyResult({ ...result, sides: ['Empire', 'Rebel'], victoryType: 12 });
  assert(fleet.leg);
  stepFleets(g, 1e7);
  assert(fleet.planet >= 0 && fleet.planet !== p.index);
  const first = fleet.units[0];
  assert(transferFleetUnits(g, fleet, 'Rebel', 1, [first]));
  const snap = JSON.parse(JSON.stringify(snapshotGalaxy(g)));
  assert.deepEqual(snap.fleets[0].units[0], snap.fleets[1].units[0]);
  const restored = fresh();
  applyGalaxy(restored, snap);
  game.galaxy = restored;
  game.battle.p = fleet.planet;
  const second = enter();
  assert.deepEqual(
    [...second.book.entity.values()].map(e => e.health),
    [a.maxHealth, a.maxHealth]
  );
  console.log({
    gate: 'FAILED — do not enable persistent flagship damage',
    type: ship.name,
    damagedHull: a.health,
    hardpointDamaged: hurt,
    hardpointAfterRepair: healed,
    otherHull: b.health,
    retreated: result.alive,
    damagedSlotAfterTransfer: '1:0',
    onReentry: [...second.book.entity.values()].map(e => e.health),
    paidShipRepair: paidRepair
  });
} finally {
  ar.close();
}
