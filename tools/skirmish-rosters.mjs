// Project a profile into small, data-only tactical rosters. Never copy a donor
// manifest, script, campaign, UI, global constant or primary VFS into a game.
import { db, skirmishFactions } from '../public/js/gamedata.js';
const military = /^(?:spaceunit|uniqueunit|groundinfantry|groundvehicle|squadron|groundcompany|herocompany)$/i;
const utility =
  /(?:^|_)(?:dummy|template|death_clone|converted_to_enemy|placeholder|cinematic|cutscene|noncombat|test|storyprop|proxy)(?:_|$)/i;
const excluded = /^(?:neutral|hostile|sarlacc|blank\d*|dummy_?\d*|rebel_story)$/i;
const allowed =
  /^(?:behavior|spacebehavior|landbehavior|categorymask|scale_factor|layer_z_adjust|tactical_health|shield_points|shield_refresh_rate|armor_type|shield_armor_type|mass|max_speed|min_speed|max_rate_of_turn|max_rate_of_roll|max_rotation_speed|override_acceleration|override_deceleration|turn_rate|space_fow_reveal_range|land_fow_reveal_range|ai_combat_power|targeting_max_attack_distance|targeting_min_attack_distance|turn_rate|bank_turn_angle|bank_turn_time|population_value|max_squad_size|formation_spacing|unit_abilities_data|fire_(?!projectile_type$)[\w]+|projectile_(?:damage|range|blast_area_damage|blast_area_range|max_flight_distance|max_flight_time|velocity|category|accuracy|does_shield_damage|does_hitpoint_damage)|damage_type|hardpoint_type|collision_mesh_name|model_to_attach_to|attachment_bone|health|collidable_by_projectile_living|is_valid_target|is_targetable|is_destroyable|ship_class|space_override_population_value|targeting_priority|firing_bone_name|projectile_fire_recharge_seconds|projectile_fire_pulse_count|projectile_fire_pulse_delay_seconds|projectile_fire_pulse_interval_seconds|projectile_fire_pulse_duration_seconds)$/i;
// LandWorld aims the hull, rotating mount and barrel independently. These
// names are local bones, not donor object or script references.
const landMotion = /^(?:movementclass|hover_offset|prepare_strafe_height|max_lift|overrideacceleration|overridedeceleration)$/i;
const landAim =
  /^(?:is_turret|(?:turret|barrel|muzzle)_bone_name|turret_rotate_(?:speed|extent_degrees)|turret_elevate_extent_degrees|turret_deployed_rest_angle|apply_[yz]_turret_rotate_to_axis|turret_targets_(?:ground_vehicles|ground_infantry|air_vehicles|anything_else))$/i;
const label = t => db.text.get(t.str('Text_ID').trim().toUpperCase())?.trim() || t.name.replaceAll('_', ' ');
const prop = (t, k) =>
  t
    .list(k)
    .map(n => db.type(n))
    .filter(Boolean);
// Effective authored roster properties: the nearest definition wins, a missing
// property stays missing so the host keeps its own default, and an authored
// No/False is copied verbatim instead of being rewritten to a combat default.
export function rosterProps(t, domain) {
  const props = {};
  for (let p = t; p; p = p.parent)
    for (const [k, values] of p.props)
      if ((allowed.test(k) || (domain === 'land' && (landAim.test(k) || landMotion.test(k)))) && !Object.hasOwn(props, k)) props[k] = values.at(-1);
  return props;
}
// Campaigns sometimes assign a unit to an owner other than its production affiliation.
// Read only explicit starting forces on real campaign worlds, never campaign scripts.
export function campaignDeployments(campaigns) {
  const owners = new Map();
  for (const c of campaigns || []) {
    if (c.bool('Tutorial')) continue;
    const worlds = new Set(c.list('Locations').map(n => n.toUpperCase()));
    for (const [owner, world, unit] of c.tuples('Starting_Forces')) {
      if (!unit || !worlds.has(world?.toUpperCase()) || !db.faction(owner)) continue;
      const name = unit.toUpperCase();
      if (!owners.has(name)) owners.set(name, new Map());
      owners.get(name).set(owner.toUpperCase(), c.name);
    }
  }
  return owners;
}
export function tacticalRosters(v, campaigns, auxiliaries = []) {
  const native = new Set(skirmishFactions()),
    kits = {},
    availability = {};
  const models = new Map();
  function model(t, domain) {
    const s = t
      .str(domain === 'land' ? 'Land_Model_Name' : 'Space_Model_Name')
      .trim()
      .replace(/^.*[\\/]/, '')
      .replace(/\.alo$/i, '');
    if (!s || !/^[-\w. ()]+$/.test(s)) return '';
    if (!models.has(s)) models.set(s, v.resolve('Data/Art/Models/' + s + '.alo') ? s + '.alo' : '');
    return models.get(s);
  }
  const weapons = t =>
    prop(t, 'Projectile_Types').length || t.list('HardPoints').some(n => db.type(db.hardpoint(n)?.str('Fire_Projectile_Type')));
  const groups = new Map(),
    deployed = new Map(),
    reserve = new Map(),
    owners = campaignDeployments(campaigns);
  // Bases can own mobile units without granting their production affiliation to the owner.
  // Record only positive starting complements; a zero count or a reserve alone isn't a deployment.
  const garrisons = new Map();
  for (const t of db.types.values()) {
    if (utility.test(t.name) || !/structure|starbase|spacebuildable/i.test(t.tag)) continue;
    for (let i = 0; i <= 5; i++)
      for (const [unit, count] of t.tuples('Starting_Spawned_Units_Tech_' + i)) {
        if (!(Number(count) > 0) || !db.type(unit)) continue;
        const key = unit.toUpperCase();
        if (!garrisons.has(key)) garrisons.set(key, new Map());
        const affiliations = t.list('Affiliation');
        for (const f of affiliations)
          if (db.faction(f)) {
            const by = garrisons.get(key),
              owner = f.toUpperCase();
            if (!by.has(owner) || by.get(owner).breadth > affiliations.length)
              by.set(owner, { name: t.name, breadth: affiliations.length });
          }
      }
  }
  for (const t of db.types.values()) {
    if (!military.test(t.tag) || utility.test(t.name) || t.bool('Is_Named_Hero') || t.bool('In_Background') || t.bool('Is_Decoration'))
      continue;
    for (const d of ['space', 'land']) {
      const members = prop(t, d === 'space' ? 'Squadron_Units' : 'Company_Units'),
        bodies = members.length ? members : [t];
      if ((d === 'space' && t.has('Company_Units')) || (d === 'land' && t.has('Squadron_Units'))) continue;
      if (!bodies.every(u => !utility.test(u.name) && model(u, d)) || !bodies.some(weapons)) continue;
      if (d === 'space' && !bodies.some(u => u.num('Max_Speed') > 0 && /LOCOMOTOR/i.test(u.str('SpaceBehavior') + ' ' + u.str('Behavior'))))
        continue;
      if (!members.length && (d === 'land' ? !/infantry|vehicle/i.test(t.tag) : !/spaceunit|uniqueunit/i.test(t.tag))) continue;
      for (const a of auxiliaries)
        if (a.domain === d && a.units.some(n => n.toUpperCase() === t.name.toUpperCase())) {
          const key = a.owner.toUpperCase();
          if (!reserve.has(key)) reserve.set(key, { land: [], space: [] });
          reserve.get(key)[d].push({ t, members, auxiliary: a });
        }
      for (const [owner, garrison] of garrisons.get(t.name.toUpperCase()) || []) {
        if (!deployed.has(owner)) deployed.set(owner, { land: [], space: [] });
        deployed.get(owner)[d].push({ t, members, garrison: garrison.name, breadth: garrison.breadth });
      }
      for (const [owner, campaign] of owners.get(t.name.toUpperCase()) || []) {
        if (!deployed.has(owner)) deployed.set(owner, { land: [], space: [] });
        deployed.get(owner)[d].push({ t, members, campaign });
      }
      for (const f of t.list('Affiliation')) {
        const key = f.toUpperCase();
        if (!groups.has(key)) groups.set(key, { land: [], space: [] });
        groups.get(key)[d].push({ t, members });
      }
    }
  }
  for (const f of db.factions.values()) {
    if (excluded.test(f.name) || f.bool('Is_Neutral') || !label(f).trim()) continue;
    const kit = {},
      pool = groups.get(f.name.toUpperCase());
    for (const d of ['space', 'land']) {
      // Never replace or reorder an existing kit. Use an authored deployment to fill an
      // empty domain for an otherwise tactical faction, not to promote hidden story actors.
      const service = deployed.get(f.name.toUpperCase())?.[d];
      const direct = pool?.[d] || [];
      // Keep the old raw body's scoped ID available for saves, not for drafting or production.
      const retired = direct.filter(({ t, members }) => !members.length && /^Cheat_Space_Unit$/i.test(t.name));
      const playable = direct.filter(r => !retired.includes(r));
      const candidates = playable.length
          ? playable
          : !(pool || native.has(f.name))
            ? []
            : service?.length
              ? service
              : reserve.get(f.name.toUpperCase())?.[d] || [],
        defaults = f.list(d + '_Skirmish_AI_Default_Forces').map(s => s.toUpperCase());
      // Prefer authored opening companies/wings, then ordinary faction-specific
      // production units. Raw armed infantry/ships are usable even without a GC factory.
      const score = ({ t, members }) =>
        (defaults.includes(t.name.toUpperCase()) ? 100 : 0) +
        (t.list('Affiliation').length === 1 ? 20 : 0) +
        (t.num('Build_Cost_Credits') > 0 || t.num('Tactical_Build_Cost_Multiplayer') > 0 ? 15 : 0) +
        (members.length ? 10 : 0) -
        (t.bool('Build_Initially_Locked') ? 2 : 0);
      // Direct campaign service outranks a base's complement; owner-specific bases
      // outrank shared facilities. Ties retain the ordinary product ranking.
      const priority = c => (c.campaign ? -1 : c.breadth || 0);
      candidates.sort((a, b) => priority(a) - priority(b) || score(b) - score(a) || a.t.name.localeCompare(b.t.name));
      const roots = [],
        seen = new Set();
      for (const c of candidates) {
        const signature = (c.members[0] || c.t).name;
        if (seen.has(signature)) continue;
        seen.add(signature);
        roots.push(c);
        if (roots.length === 8) break;
      }
      if (!roots.length) continue;
      const defs = {},
        hp = {};
      function save(t, to, kind) {
        if (Object.hasOwn(to, t.name)) return t.name;
        const props = rosterProps(t, d);
        to[t.name] = { tag: t.tag, label: label(t), props };
        if (kind === 'unit') {
          props[d + '_model_name'] = model(t, d);
          if (d === 'land') {
            const clip = t.str('Land_Model_Anim_Override_Name').trim();
            if (/^[-\w. ]+$/.test(clip)) props.land_model_anim_override_name = clip;
          }
          const projectiles = prop(t, 'Projectile_Types');
          if (projectiles.length) props.projectile_types = projectiles.map(q => save(q, defs, 'shot')).join(',');
          const hard = t
            .list('HardPoints')
            .map(n => db.hardpoint(n))
            .filter(Boolean);
          if (hard.length) props.hardpoints = hard.map(h => save(h, hp, 'hard')).join(',');
        }
        if (kind === 'hard') {
          const q = db.type(t.str('Fire_Projectile_Type'));
          if (q) props.fire_projectile_type = save(q, defs, 'shot');
        }
        return t.name;
      }
      const roster = roots.map(({ t, members, campaign, garrison, auxiliary }) => ({
        name: t.name,
        ...(campaign
          ? { deployedBy: f.name, campaign }
          : garrison
            ? { deployedBy: f.name, garrison }
            : auxiliary
              ? { auxiliary: auxiliary.label, source: auxiliary.source }
              : {}),
        label: label(t),
        cost: t.num('Tactical_Build_Cost_Multiplayer') || t.num('Build_Cost_Credits'),
        time: t.num('Tactical_Build_Time_Seconds') || t.num('Build_Time_Seconds'),
        members: members.slice(0, 32).map(u => save(u, defs, 'unit')),
        body: members.length ? null : save(t, defs, 'unit')
      }));
      const restoreBodies = retired.map(({ t }) => save(t, defs, 'unit'));
      kit[d] = { combatSchema: 3, roster, defs, hp, ...(restoreBodies.length ? { restoreBodies } : {}) };
    }
    if (!Object.keys(kit).length && !native.has(f.name)) continue;
    kits[f.name] = { ...kit, label: label(f), color: f.str('Color') };
    const home = d =>
      native.has(f.name) &&
      prop(f, d + '_Skirmish_AI_Default_Forces').some(t => t.has(d === 'land' ? 'Company_Units' : 'Squadron_Units') || !!model(t, d));
    availability[f.name] = {
      native: native.has(f.name),
      nativeland: home('land'),
      nativespace: home('space'),
      land: !!kit.land,
      space: !!kit.space,
      ...(kit.space?.restoreBodies?.length && kit.space.roster.every(r => r.garrison) ? { spaceNote: 'Shared starbase garrison' } : {}),
      ...Object.fromEntries(
        Object.entries(kit)
          .filter(([, k]) => k.roster[0]?.auxiliary)
          .map(([d, k]) => [d + 'Note', k.roster[0].auxiliary])
      )
    };
  }
  return { kits, availability };
}
