// An away seat is a small, battle-local detachment. The host owns the TED,
// economy, production buildings and AI; a source supplies combatants and art,
// never campaign/Lua logic. Guest IDs cannot shadow a host type or TED CRC.
import { db, ObjType, guestObjects, skirmishFactions, skirmishStation } from '../gamedata.js';
import { activeLanguage } from '../language.js';
import { factionKey, guestRefs, readDetachment, productName, productCost, openingProducts } from './tacticalroster.js';
export { factionKey };
const keys = ['types', 'factions', 'hardpoints'];
let installed = '',
  labels = [];
export async function prepareDetachments(setup, { restoring = !!setup.restore } = {}) {
  const refs = setup.skirmishRosters || [],
    domain = setup.mode;
  if (!Array.isArray(refs) || refs.length > 100 || (refs.length && (!['space', 'land'].includes(domain) || setup.net || setup.campaign)))
    throw Error('Invalid standalone tactical detachments.');
  const sources = guestRefs(refs),
    key = JSON.stringify([sources, domain, !!setup.instant, activeLanguage]);
  const kits = await Promise.all(sources.map(ref => readDetachment(ref, domain, activeLanguage)));
  if (setup.instant && kits.length) {
    const armies = domain === 'land' ? setup.instant.groundArmies : setup.instant.armies;
    for (const [i, p] of setup.players.entries()) {
      const side = p.skirmishFaction || setup.teamFactions[p.team];
      const kit = kits.find(k => factionKey(k.id, k.faction) === side);
      if (!kit && !side?.startsWith('UXF_')) continue;
      const allowed = new Set(kit?.roster.map(r => productName(kit, r)));
      if (restoring && kit) for (const body of kit.restoreBodies || []) allowed.add(side + '__' + body);
      if (!armies?.[i]?.length || !armies[i].every(n => allowed.has(n))) throw Error('A selected army is not provided by its faction.');
    }
  }
  if (key === installed) return;
  const next = { types: new Map(), factions: new Map(), hardpoints: new Map(), text: new Map() };
  for (const k of kits) install(k, next, !!setup.instant);
  for (const k of keys) guestObjects[k] = next[k];
  for (const k of labels) db.text.delete(k);
  for (const [id, text] of next.text) db.text.set(id, text);
  labels = [...next.text.keys()];
  installed = key;
}
function install(k, next, instant) {
  const side = factionKey(k.id, k.faction),
    root = side + '__',
    art = `UXA${k.id}_${k.revision}__`,
    domain = k.domain;
  const add = (bucket, tag, name, label) => {
    const t = new ObjType(tag, name);
    next[bucket].set(name.toUpperCase(), t);
    const id = ('TEXT_' + name).toUpperCase();
    if (label) {
      next.text.set(id, label);
      set(t, 'Text_ID', id);
    }
    return t;
  };
  const set = (t, key, value) => t.props.set(key.toLowerCase(), [String(value)]);
  const host = instant ? skirmishFactions()[0] : skirmishFactions().find(f => skirmishStation(f));
  if (!host) throw Error('No host tactical faction.');
  const faction = add('factions', 'Faction', side, k.label);
  faction.parent = db.faction(host);
  faction.detachment = { profile: k.id, faction: k.faction, revision: k.revision, host, domain, roster: [] };
  // This synthetic faction inherits facilities, never the host's map/UI tint.
  for (const key of ['Color', 'Display_Font_Color', 'Big_Fleet_Color', 'Selection_Blob_RGBA']) set(faction, key, k.color || '160,160,160');
  for (const field of [
    'Standalone_Space_Maps_Special_Weapon_A',
    'Standalone_Space_Maps_Special_Weapon_B',
    'Space_Skirmish_AI_Default_Forces',
    'Land_Skirmish_AI_Default_Forces'
  ])
    set(faction, field, '');
  function convert(name, def, bucket) {
    const t = add(bucket, def.tag, root + name, def.label);
    set(t, 'Affiliation', side);
    for (const [key, val] of Object.entries(def.props)) {
      if (key.endsWith('_model_name') || key === 'land_model_anim_override_name') set(t, key, art + val);
      else if (['projectile_types', 'hardpoints', 'fire_projectile_type'].includes(key))
        set(
          t,
          key,
          val
            .split(',')
            .map(n => root + n)
            .join(',')
        );
      else set(t, key, val);
    }
    t.sourceUnit = name;
    return t;
  }
  for (const [name, d] of Object.entries(k.defs)) convert(name, d, 'types');
  for (const [name, d] of Object.entries(k.hp)) convert(name, d, 'hardpoints');
  const products = faction.detachment.roster;
  for (const r of k.roster) {
    const wrapper = domain === 'land' || r.members.length;
    let t;
    if (wrapper) {
      t = add('types', domain === 'land' ? 'GroundCompany' : 'Squadron', productName(k, r), r.label);
      set(
        t,
        domain === 'land' ? 'Company_Units' : 'Squadron_Units',
        (r.members.length ? r.members : [r.body]).map(n => root + n).join(',')
      );
    } else t = next.types.get(productName(k, r).toUpperCase());
    t.sourceUnit = r.name;
    set(t, 'Affiliation', side);
    set(t, 'Tactical_Build_Cost_Multiplayer', productCost(r));
    set(t, 'Tactical_Build_Time_Seconds', Math.max(2, Math.min(60, r.time || 8)));
    products.push(t.name);
  }
  const start = openingProducts(k);
  set(faction, domain + '_Skirmish_AI_Default_Forces', start.join(','));
  if (domain === 'space' && !instant) {
    const base = skirmishStation(host),
      station = add('types', base.tag, root + 'STATION', k.label + ' · Skirmish station');
    station.parent = base;
    set(station, 'Affiliation', side);
    set(station, 'Next_Level_Base', '');
    set(station, 'Tactical_Buildable_Objects_Multiplayer', [side, ...products].join(','));
    for (let i = 0; i < 6; i++) for (const prefix of ['Starting', 'Reserve']) set(station, prefix + '_Spawned_Units_Tech_' + i, '');
    faction.detachment.station = station;
  }
}
