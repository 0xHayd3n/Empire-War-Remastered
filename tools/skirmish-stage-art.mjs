// Ground actors only. The exact idle is resolved against the same mounted
// override chain as the model. Never fall through to a space or vehicle kit.
import { characterModels } from './skirmish-character-models.mjs';
import { exhibits } from './command-exhibits.mjs';
import { fieldLeaders } from './skirmish-field-leaders.mjs';
import { parseALO } from '../public/js/alo.js';
import { parseALA } from '../public/js/ala.js';
export function stageArt(v, profile, directory, db, image) {
  const { commanders, portraits } = directory;
  const asset = f => typeof f === 'string' && /^[-\w ().]+\.(?:alo|ala)$/i.test(f) && v.resolve('Data/Art/Models/' + f);
  const bytes = f => {
    const key = asset(f),
      b = key && v.read(key);
    return b && b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  // Land battles attach authored hardpoint meshes to sockets on the actor.
  // Export only their art references, never the weapon's gameplay definition.
  function equipment(unit) {
    const props = [];
    for (const id of unit?.list?.('HardPoints') || []) {
      const hp = db.hardpoint(id),
        model = hp?.str('Model_To_Attach').trim(),
        bone = hp?.str('Attachment_Bone').trim();
      if (
        bone &&
        asset(model) &&
        !props.some(q => q.model.toUpperCase() === model.toUpperCase() && q.bone.toUpperCase() === bone.toUpperCase())
      )
        props.push({ model, bone });
    }
    return props;
  }
  const tested = new Map();
  function pose(model, base) {
    const key = model + '|' + base;
    if (tested.has(key)) return tested.get(key);
    let art = null;
    try {
      const mb = bytes(model);
      if (!mb) return null;
      const alo = parseALO(mb, { outline: true });
      const bones = new Set(alo.bones.map(b => b.name.toUpperCase()));
      for (const stem of [...new Set([base, model].filter(Boolean).map(f => f.replace(/\.(?:alo|ala)$/i, '')))]) {
        const clip = s => {
          const f = stem + '_' + s + '.ALA',
            raw = bytes(f);
          if (!raw) return null;
          const a = parseALA(raw),
            bound = a.tracks.filter(t => bones.has(t.name.toUpperCase()));
          return a.frames > 2 && bound.length >= 4 && bound.some(t => t.rot || t.trans) ? f : null;
        };
        // Yoda's civilian idles explicitly hide both saber and hilt. The pack
        // supplies a looping combat idle with the blade drawn (no firing loop).
        const drawn = model.toUpperCase() === 'RI_YODA.ALO' && clip('ATTACKIDLE_00');
        const idle = drawn || clip('IDLE_00') || clip('IDLE_01') || clip('IDLE_02');
        if (!idle) continue;
        const actions = drawn ? ['ATTACKIDLE_01', 'READY_00'] : ['SALUTE_00', 'IDLE_01', 'IDLE_02', 'READY_00', 'FIRE_STAND_00'];
        const action = actions
          .map(s => stem + '_' + s + '.ALA')
          .filter(f => f !== idle && asset(f))
          .map(f => f.slice(stem.length + 1, -4))
          .find(s => clip(s));
        art = { infantry: true, model, idle, action: action ? stem + '_' + action + '.ALA' : null };
        break;
      }
    } catch {
      /* corrupt/unsupported rig: not a figure */
    }
    tested.set(key, art);
    return art;
  }
  // These individual soldiers own the hardpoints; their same-body company
  // previews specify the animation set. Never attach the company's ROOT boxes.
  const companyPose = {
    Mandalorian_Soldier: 'Mandalorian_Soldier_Company_Dummy',
    Chiss_Phalanx_Trooper_Rifle: 'Chiss_Phalanx_Trooper_Company_Dummy',
    Ailon_Nova_Guard: 'Ailon_Nova_Guard_Company_Dummy'
  };
  const gallery = (directory.ringActors = {});
  for (const [target, entries] of Object.entries(exhibits))
    for (const [f, ref] of Object.entries(entries)) {
      if ((ref.source || target) !== profile || !ref.model) continue;
      const t = ref.object && db.type(ref.object);
      if (ref.object && t?.str('Land_Model_Name').trim().toUpperCase() !== ref.model.toUpperCase()) continue;
      const company = companyPose[ref.object] && db.type(companyPose[ref.object]);
      const sharedBase =
        company?.str('Land_Model_Name').trim().toUpperCase() === ref.model.toUpperCase() &&
        company.str('Land_Model_Anim_Override_Name').trim();
      const art = pose(ref.model, ref.base || t?.str?.('Land_Model_Anim_Override_Name').trim() || sharedBase);
      if (art) {
        const icon = t?.str('Icon_Name').trim(),
          portrait = icon && image(icon);
        gallery[target + '/' + f] = {
          ...art,
          props: equipment(t),
          kind: ref.person ? 'person' : 'unit',
          label: ref.label,
          object: ref.object || undefined,
          ...(portrait ? { portrait: { source: icon, art: portrait } } : {})
        };
      }
    }
  for (const [id, c] of Object.entries(commanders)) {
    const [name, object, model] = characterModels[profile]?.[id] || [],
      unit = object && db.type(object);
    if (
      !fieldLeaders[profile]?.[id] &&
      c.person &&
      c.name === name &&
      (!object || unit?.str('Land_Model_Name').trim().toUpperCase() === model)
    ) {
      const art = pose(model, unit?.str?.('Land_Model_Anim_Override_Name').trim());
      if (art) {
        c.stage = { ...art, kind: 'person', object, props: equipment(unit) };
        // Use this pack's standing Navy Trooper as the ring's human yardstick.
        // Its posed REP_NAVY_TROOPER.ALO is 9.9601 native units high (without
        // its weapon). Resolve both actors' tactical Scale_Factor from the
        // signed definitions, not the company dummy, hero name or faction ID.
        if (profile === '1976399102' && object === 'Yoda' && model === 'RI_YODA.ALO') {
          const human = db.type('Republic_Navy_Trooper');
          if (human?.str('Land_Model_Name').trim().toUpperCase() === 'REP_NAVY_TROOPER.ALO') {
            const units = unit.num('Scale_Factor', 1) / (9.9601 * human.num('Scale_Factor', 1));
            if (units > 0 && Number.isFinite(units)) c.stage.ringUnits = units;
          }
        }
        continue;
      }
    }
    const [actor, expected] = fieldLeaders[profile]?.[id] || [],
      alt = db.type(actor);
    if (
      alt &&
      alt.str('Land_Model_Name').trim().toUpperCase() === expected &&
      alt.list('Affiliation').some(f => f.toUpperCase() === id.toUpperCase())
    ) {
      const art = pose(expected, alt.str('Land_Model_Anim_Override_Name').trim());
      if (art) {
        c.leader = c.name;
        c.name = db.text.get(alt.str('Text_ID').trim().toUpperCase()) || actor.replaceAll('_', ' ');
        c.person = true;
        c.stage = { ...art, kind: 'person', object: actor, props: equipment(alt) };
        const source = alt.str('Icon_Name').trim();
        const pic = source && image(source);
        if (pic) portraits[c.name] = { source, art: pic };
        continue;
      }
    }
    // Never guess from the GroundInfantry tag: even some walkers and aircraft
    // have that tag. The gallery is joined after all independent workers finish.
  }
}
