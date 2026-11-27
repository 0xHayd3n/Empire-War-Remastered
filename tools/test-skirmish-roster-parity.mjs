// Focused regression test for the bounded roster-extractor parity fix.
//
// The fixture is independent of any installed pack. It builds the smallest
// synthetic game database that tacticalRosters() reads, then checks:
//   1. the eight checked Revan/Fall donor bodies keep their authored
//      Collidable_By_Projectile_Living value;
//   2. a missing value stays missing (the host default is not replaced with Yes);
//   3. authored No/False and a target/projectile immunity are preserved;
//   4. nearest-definition precedence and inherited values survive;
//   5. two different Rebel sources do not share extracted combat data;
//   6. an unresolved hardpoint does not become a usable weapon.
//
// Run from the checkout: node tools/test-skirmish-roster-parity.mjs

import assert from 'node:assert/strict';
import { db, ObjType } from '../public/js/gamedata.js';
import { rosterProps, tacticalRosters } from './skirmish-rosters.mjs';

const KNOWN = [
  { source: '3417277973', faction: 'Rebel', domain: 'space', name: 'Sith_Interceptor', collision: 'yes' },
  { source: '3417277973', faction: 'Rebel', domain: 'space', name: 'Chaos_Fighter', collision: 'yes' },
  { source: '3417277973', faction: 'Rebel', domain: 'land', name: 'Krath_Skiff', collision: 'Yes' },
  { source: '3417277973', faction: 'Rebel', domain: 'land', name: 'Sith_Stingray', collision: 'Yes' },
  {
    source: '1976399102',
    faction: 'Trade_Federation',
    domain: 'space',
    name: 'C9979_Carrier_Subfaction',
    collision: 'Yes'
  },
  {
    source: '1976399102',
    faction: 'Trade_Federation',
    domain: 'space',
    name: 'Geonosian_Cruiser_Influence',
    collision: 'Yes'
  },
  { source: '1976399102', faction: 'Trade_Federation', domain: 'land', name: 'GAT', collision: 'Yes' },
  { source: '1976399102', faction: 'Trade_Federation', domain: 'land', name: 'HAML', collision: 'Yes' }
];
const MODELS = { resolve: p => (/^Data\/Art\/Models\/[^/]+\.alo$/i.test(p) ? p : null) };
let checks = 0;
const check = (fn, label) => {
  fn();
  checks++;
  console.log('ok', label);
};
const values = v => (Array.isArray(v) ? v : [v]).map(String);
function type(tag, name, props = {}, parent = null) {
  const t = new ObjType(tag, name);
  t.parent = parent;
  for (const [k, v] of Object.entries(props)) t.props.set(k.toLowerCase(), values(v));
  return t;
}
const prop = (t, k) => t.props.get(k.toLowerCase());
function reset(types, factions) {
  db.types.clear();
  db.typesByCrc.clear();
  db.hardpoints.clear();
  db.factions.clear();
  db.text.clear();
  db.armorMod.clear();
  for (const t of types) db.types.set(t.name.toUpperCase(), t);
  for (const f of factions) db.factions.set(f.name.toUpperCase(), f);
}
function faction(name, textId) {
  db.text.set(textId.toUpperCase(), name);
  return type('Faction', name, {
    Text_ID: textId,
    Is_Playable: 'Yes',
    Color: '160,160,160',
    Space_Skirmish_AI_Default_Forces: '',
    Land_Skirmish_AI_Default_Forces: ''
  });
}
function projectile(name, extra = {}) {
  return type('Projectile', name, {
    Projectile_Damage: '30',
    Damage_Type: 'Damage_Laser',
    Projectile_Does_Shield_Damage: 'Yes',
    Projectile_Does_Hitpoint_Damage: 'Yes',
    Max_Speed: '25',
    ...extra
  });
}
function unit(domain, name, extra = {}, parent = null) {
  const land = domain === 'land';
  return type(
    land ? 'GroundVehicle' : 'SpaceUnit',
    name,
    {
      [land ? 'Land_Model_Name' : 'Space_Model_Name']: name,
      Affiliation: 'Rebel',
      Build_Cost_Credits: '100',
      Tactical_Build_Cost_Multiplayer: '100',
      Tactical_Build_Time_Seconds: '8',
      Health: '100',
      ...(land
        ? {}
        : {
            Max_Speed: '60',
            SpaceBehavior: 'STARSHIP_LOCOMOTOR'
          }),
      ...extra
    },
    parent
  );
}
function donorPass(factionName, rows) {
  const projectiles = rows.map(r => projectile('Proj_' + r.name, r.projectile || {}));
  const units = rows.map(r =>
    unit(r.domain, r.name, { Projectile_Types: 'Proj_' + r.name, Collidable_By_Projectile_Living: r.collision, Affiliation: factionName })
  );
  const f = faction(factionName, 'TEXT_FACTION_' + factionName);
  reset([...projectiles, ...units, f], [f]);
  return tacticalRosters(MODELS).kits[factionName];
}

// 1. The eight checked donor bodies: the guest value now equals the source.
for (const source of ['3417277973', '1976399102']) {
  const rows = KNOWN.filter(r => r.source === source),
    name = rows[0].faction,
    kit = donorPass(name, rows);
  check(() => {
    for (const row of rows) {
      const def = kit[row.domain].defs[row.name];
      assert(def, `${row.name} is missing from the ${row.domain} kit`);
      assert.equal(def.props.collidable_by_projectile_living, row.collision, `${row.name} lost its authored collision value`);
    }
  }, `${name}: all ${rows.length} source-authored collision values survive extraction`);
}

// 2-3. Missing, authored No, a target immunity and a projectile immunity.
{
  const proj = projectile('Proj_Immunity', {
      Projectile_Damage: '42',
      Damage_Type: 'Damage_Ion',
      Projectile_Does_Shield_Damage: 'Yes',
      Projectile_Does_Hitpoint_Damage: 'No'
    }),
    props = [`Proj_Immunity`],
    noCollision = unit('space', 'Scout_NoCollision', {
      Projectile_Types: props[0],
      Collidable_By_Projectile_Living: 'No',
      Is_Valid_Target: 'No'
    }),
    missing = unit('space', 'Scout_MissingCollision', { Projectile_Types: props[0] }),
    imm = unit('space', 'Gunboat_Immunity', {
      Projectile_Types: props[0],
      Collidable_By_Projectile_Living: 'Yes'
    }),
    f = faction('Rebel', 'TEXT_FACTION_REBEL');
  reset([proj, noCollision, missing, imm, f], [f]);
  const kit = tacticalRosters(MODELS).kits.Rebel;
  check(() => {
    const a = kit.space.defs.Scout_NoCollision.props,
      missingProps = kit.space.defs.Scout_MissingCollision.props,
      shot = kit.space.defs.Proj_Immunity.props;
    assert.equal(a.collidable_by_projectile_living, 'No', 'authored No must not become Yes');
    assert.equal(a.is_valid_target, 'No', 'an authored untargetable object must stay untargetable');
    assert(!Object.hasOwn(missingProps, 'collidable_by_projectile_living'), 'missing collision must stay missing');
    assert(!Object.hasOwn(missingProps, 'is_valid_target'), 'missing target flag must stay missing');
    assert.equal(shot.projectile_does_hitpoint_damage, 'No', 'projectile hull immunity was dropped');
    assert.equal(shot.projectile_does_shield_damage, 'Yes', 'projectile shield flag was dropped');
    assert.equal(shot.projectile_damage, '42', 'direct projectile damage was dropped');
    assert.equal(shot.damage_type, 'Damage_Ion', 'direct projectile damage type was dropped');
  }, 'authored No, missing values, and projectile/target immunities survive');
}

// 4. Nearest definition wins; a child that omits a key inherits it.
{
  const parent = type('SpaceUnit', 'Parent_Scout', {
      Collidable_By_Projectile_Living: 'Yes',
      Is_Valid_Target: 'No',
      Armor_Type: 'Armor_Parent'
    }),
    child = unit('space', 'Child_Scout', { Projectile_Types: 'Proj_Parent', Collidable_By_Projectile_Living: 'No' }, parent),
    inherit = unit('space', 'Inherit_Scout', { Projectile_Types: 'Proj_Parent' }, parent),
    proj = projectile('Proj_Parent'),
    f = faction('Rebel', 'TEXT_FACTION_REBEL');
  reset([parent, child, inherit, proj, f], [f]);
  const defs = tacticalRosters(MODELS).kits.Rebel.space.defs;
  check(() => {
    assert.equal(defs.Child_Scout.props.collidable_by_projectile_living, 'No', 'child override must win over parent Yes');
    assert.equal(defs.Child_Scout.props.is_valid_target, 'No', 'parent target flag must be inherited');
    assert.equal(defs.Inherit_Scout.props.collidable_by_projectile_living, 'Yes', 'missing child key must inherit parent value');
    assert.equal(defs.Child_Scout.props.armor_type, 'Armor_Parent', 'unrelated parent armor must still inherit');
  }, 'nearest-definition precedence and inherited values are preserved');
}

// 4b. Pure seam: arbitrary scripts/object lists are never copied, and a bare
// missing value is not defaulted true.
check(() => {
  const t = type('SpaceUnit', 'Seam', {
    Collidable_By_Projectile_Living: 'No',
    Script: 'Story_Do_Not_Copy',
    Tactical_Buildable_Objects_Multiplayer: 'Some_Build_List',
    Projectile_Does_Hitpoint_Damage: 'No',
    Ship_Class: 'Fighter',
    Space_Override_Population_Value: '3'
  });
  const p = rosterProps(t);
  assert.equal(p.collidable_by_projectile_living, 'No');
  assert.equal(p.projectile_does_hitpoint_damage, 'No');
  assert.equal(p.ship_class, 'Fighter', 'the shared ship-class field must stay in the whitelist');
  assert.equal(p.space_override_population_value, '3', 'the shared space population override must stay in the whitelist');
  assert(!Object.hasOwn(p, 'script'), 'scripts must not be copied');
  assert(!Object.hasOwn(p, 'tactical_buildable_objects_multiplayer'), 'build lists must not be copied');
  const bare = rosterProps(type('SpaceUnit', 'Bare'));
  assert(!Object.hasOwn(bare, 'collidable_by_projectile_living'), 'missing collision must not default true');
}, 'property whitelist stays bounded and does not default a missing flag to true');

// 5. Two sources can both name a faction Rebel without sharing extracted data.
for (const [label, collision] of [
  ['first Rebel source', 'Yes'],
  ['second Rebel source', 'No']
]) {
  const f = faction('Rebel', 'TEXT_FACTION_REBEL'),
    shared = unit('space', 'Shared_Interceptor', {
      Projectile_Types: 'Proj_Shared',
      Collidable_By_Projectile_Living: collision
    }),
    proj = projectile('Proj_Shared');
  reset([shared, proj, f], [f]);
  const kit = tacticalRosters(MODELS).kits.Rebel;
  check(() => {
    assert.equal(
      kit.space.defs.Shared_Interceptor.props.collidable_by_projectile_living,
      collision,
      `${label} leaked another source's collision value`
    );
  }, `${label} keeps its own Rebel definition (${collision})`);
}

// 6. An unresolved hardpoint is not silently turned into a weapon.
{
  const dud = unit('space', 'Dud_Scout', { HardPoints: 'Ghost_Hardpoint' }),
    f = faction('Rebel', 'TEXT_FACTION_REBEL');
  reset([dud, f], [f]);
  const result = tacticalRosters(MODELS),
    kit = result.kits.Rebel;
  check(() => {
    assert(!kit?.space, 'a unit with no resolved weapon must not form a space kit by default');
    assert(!kit?.land, 'a space-only body must not form a land kit');
    assert.equal(result.availability.Rebel.space, false, 'an unresolved weapon must not advertise a space roster');
  }, 'an unresolved hardpoint does not become a usable weapon');
}

// Real service to a faction is distinct from production affiliation. Do not
// accept an off-map campaign assignment, a zero complement, or an unresolved ship.
{
  const owner = faction('Rebel', 'R'),
    other = faction('Empire', 'E'),
    shot = projectile('Bolt'),
    tank = unit('land', 'Tank', { Affiliation: 'Rebel', Projectile_Types: 'Bolt' }),
    ships = ['Deployed', 'Garrison', 'Never', 'Contract'].map(n => unit('space', n, { Affiliation: 'Empire', Projectile_Types: 'Bolt' })),
    base = type('StarBase', 'Port', { Affiliation: 'Rebel', Starting_Spawned_Units_Tech_0: ['Garrison, 2', 'Never, 0'] }),
    story = type('Campaign', 'Campaign_A', { Locations: 'A', Starting_Forces: ['Rebel,A,Deployed', 'Rebel,B,Never'] });
  const reserve = [{ owner: 'Rebel', domain: 'space', source: 'reviewed declaration', label: 'Auxiliary', units: ['Contract'] }];
  reset([shot, tank, ...ships, base], [owner, other]);
  const authored = tacticalRosters(MODELS, [story], reserve).kits.Rebel.space.roster;
  check(
    () =>
      assert.deepEqual(
        authored.map(r => [r.name, r.campaign || r.garrison]),
        [
          ['Deployed', 'Campaign_A'],
          ['Garrison', 'Port']
        ]
      ),
    'campaign and garrison fill a missing domain; zero count, off-map and reserve excluded'
  );
  reset([shot, tank, ...ships], [owner, other]);
  const { kits, availability } = tacticalRosters(MODELS, [], reserve);
  check(() => {
    assert.deepEqual(
      kits.Rebel.space.roster.map(r => r.name),
      ['Contract']
    );
    assert.equal(availability.Rebel.spaceNote, 'Auxiliary');
    assert(!availability.Empire.spaceNote);
  }, 'only the explicitly named reserve fills the empty domain and is labelled');
}
// A raw cheat ship once occupied the whole away roster. It may resolve a saved
// entity by its old scoped name, but cannot outrank genuine garrison fighters.
{
  const owner = faction('Rebel', 'R'),
    other = faction('Empire', 'E'),
    shot = projectile('Bolt'),
    cheat = unit('space', 'Cheat_Space_Unit', { Affiliation: 'Rebel', Projectile_Types: 'Bolt' }),
    real = unit('space', 'Escort', {
      Affiliation: 'Empire',
      Projectile_Types: 'Bolt',
      Max_Rate_Of_Turn: '2.5',
      Max_Rate_Of_Roll: '0',
      Min_Speed: '2'
    }),
    port = type('StarBase', 'Shared_Port', { Affiliation: 'Rebel', Starting_Spawned_Units_Tech_0: 'Escort,1' });
  reset([shot, cheat, real, port], [owner, other]);
  const { kits, availability } = tacticalRosters(MODELS),
    kit = kits.Rebel.space;
  check(() => {
    assert.deepEqual(
      kit.roster.map(r => r.name),
      ['Escort']
    );
    assert.deepEqual(kit.restoreBodies, ['Cheat_Space_Unit']);
    assert(kit.defs.Cheat_Space_Unit);
    assert.equal(availability.Rebel.spaceNote, 'Shared starbase garrison');
    assert.equal(kit.defs.Escort.props.max_rate_of_turn, '2.5');
    assert.equal(kit.defs.Escort.props.max_rate_of_roll, '0');
    assert.equal(kit.defs.Escort.props.min_speed, '2');
  }, 'authored maneuvering survives; cheat body is restore-only, not an opening product');
}
// Ground gun facing uses model bones and the authored swivel. A missing
// Is_Turret is not equivalent to an explicit fixed gun or a rotating one.
{
  const base = type('HardPoint', 'Mobile_Gun_Base', { Is_Turret: 'Yes', Turret_Rotate_Speed: '3.5', Turret_Bone_Name: 'Head' });
  const gun = type('HardPoint', 'Mobile_Gun', { Fire_Projectile_Type: 'Bolt', Turret_Rotate_Extent_Degrees: 0 }, base);
  const hull = unit('land', 'Carrier', { HardPoints: 'Mobile_Gun', Muzzle_Bone_Name: 'Emitter', Apply_Z_Turret_Rotate_To_Axis: 0 });
  reset([hull, projectile('Bolt')], [faction('Rebel', 'R')]);
  db.hardpoints.set('MOBILE_GUN', gun);
  const k = tacticalRosters(MODELS).kits.Rebel.land;
  check(() => {
    assert.equal(k.hp.Mobile_Gun.props.is_turret, 'Yes');
    assert.equal(k.hp.Mobile_Gun.props.turret_bone_name, 'Head');
    assert.equal(k.hp.Mobile_Gun.props.turret_rotate_extent_degrees, '0');
    assert.equal(k.hp.Mobile_Gun.props.turret_rotate_speed, '3.5');
    assert.equal(k.defs.Carrier.props.muzzle_bone_name, 'Emitter');
    assert.equal(k.defs.Carrier.props.apply_z_turret_rotate_to_axis, '0');
    assert(!('is_turret' in k.defs.Carrier.props));
    assert(!('is_turret' in rosterProps(gun, 'space')));
  }, 'land-only rotating hardpoints keep their authored axes, limits, bones and inheritance');
}
{
  const parent = unit('land', 'DonorFlyerBase', {
    MovementClass: 'Flying',
    Hover_Offset: '50',
    Prepare_Strafe_Height: '200',
    Max_Lift: '2.5',
    OverrideAcceleration: '.3'
  });
  const flyer = unit('land', 'Flyer', { Projectile_Types: 'Laser', Hover_Offset: '0' }, parent);
  reset([flyer, projectile('Laser')], [faction('Rebel', 'R')]);
  const p = tacticalRosters(MODELS).kits.Rebel.land.defs.Flyer.props;
  check(() => {
    assert.equal(p.movementclass, 'Flying');
    assert.equal(p.hover_offset, '0');
    assert.equal(p.prepare_strafe_height, '200');
    assert.equal(p.max_lift, '2.5');
    assert.equal(p.overrideacceleration, '.3');
    assert(!('movementclass' in rosterProps(flyer, 'space')));
  }, 'land movement class and inherited flight envelope survive without manufacturing missing values');
}
console.log(`\n${checks} checks passed.`);
