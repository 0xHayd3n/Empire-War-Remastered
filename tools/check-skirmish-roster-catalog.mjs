// Read every offered detachment through the same revision-pinned API as launch.
// This verifies data coverage; check-cross-era-skirmish exercises the simulation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const base = process.env.FRAME_URL || 'http://127.0.0.1:8591',
  api = base + '/api/universal/atlas';
const { profiles } = await (await fetch(api)).json(),
  { solo, unavailable } = await (await fetch(api + '/operations')).json();
assert.deepEqual(unavailable, []);
const names = new Map(),
  bodies = new Map(),
  collisions = [];
function unique(seen, key, owner) {
  if (seen.has(key)) collisions.push(`${owner} repeats ${seen.get(key)}`);
  else seen.set(key, owner);
}
let entries = 0,
  land = 0,
  space = 0;
for (const p of profiles) {
  const s = solo[p.id];
  assert(s);
  assert(!s.kits, 'Do not send every detachment with map discovery');
  assert.deepEqual(Object.keys(s.commanders).sort(), s.skirmishFactions.slice().sort());
  const artFiles = new Set();
  for (const c of Object.values(s.commanders)) {
    assert(c.family?.length && c.name?.length && c.name !== 'Field command', p.name + ' missing reviewed command');
    assert(c.stage && /\.alo$/i.test(c.stage.model), `${p.name}/${c.name}: missing stage art`);
    assert(c.stage.infantry && /\.ala$/i.test(c.stage.idle), `${p.name}/${c.name}: must have an animated infantry body`);
    if (c.stage.kind === 'person') assert(c.person);
    else assert(c.stage.kind === 'unit' && c.stage.label);
    const donor = c.stage.profile ? profiles.find(q => q.id === c.stage.profile && q.revision === c.stage.revision) : p;
    assert(donor, `${p.name}/${c.name}: unpinned figure donor`);
    const owner = `${p.name}: ${c.stage.label || c.name}`;
    unique(names, (c.stage.label || c.name).toLowerCase(), owner);
    const model = await fetch(
      `${base}/api/universal/art/${donor.id}/${donor.revision}/asset/Data/Art/Models/${encodeURIComponent(c.stage.model)}`
    );
    assert.equal(model.status, 200, owner);
    unique(
      bodies,
      createHash('sha256')
        .update(Buffer.from(await model.arrayBuffer()))
        .digest('hex'),
      owner
    );
    for (const file of [c.stage.idle, c.stage.action].filter(Boolean))
      artFiles.add(`${donor.id}/${donor.revision}/asset/Data/Art/Models/${encodeURIComponent(file)}`);
  }
  for (const file of artFiles) {
    const response = await fetch(`${base}/api/universal/art/${file}`);
    assert.equal(response.status, 200, `${p.name} missing ${file}`);
    assert((await response.arrayBuffer()).byteLength > 8);
  }
  for (const art of Object.values(s.portraits)) assert.match(art.art, /^data:image\/png;base64,/);
  const marks=new Map();for(const [id,m]of Object.entries(s.emblems)){
    const family=s.commanders[id].family;assert(m.hd || m.art);if(marks.has(m.hd))assert.equal(marks.get(m.hd),family,`${p.name}: unrelated families share a crest`);marks.set(m.hd,family);
  }
  for (const [f, a] of Object.entries(s.availability)) {
    assert(!/^(?:Neutral|Hostile|Sarlacc|Blank\d*|Dummy_\d+|Rebel_Story)$/i.test(f));
    entries++;
    for (const domain of ['land', 'space']) {
      if (!a[domain]) continue;
      const q = new URLSearchParams({ profile: p.id, revision: p.revision, faction: f, domain });
      const response = await fetch(api + '/roster?' + q);
      assert.equal(response.status, 200);
      const kit = await response.json();
      assert.equal(kit.faction, f);
      assert.equal(kit.revision, p.revision);
      assert.equal(kit.id, p.id);
      assert(kit.roster.length > 0 && kit.roster.length <= 8);
      for (const r of kit.roster) {
        const units = (r.members.length ? r.members : [r.body]).map(n => kit.defs[n]);
        assert(
          units.every(u => u?.props[domain + '_model_name']),
          `${p.name}/${f}: missing ${domain} model`
        );
        const armed = u =>
          u.props.projectile_types?.split(',').some(n => kit.defs[n]) ||
          u.props.hardpoints?.split(',').some(n => kit.defs[kit.hp[n]?.props.fire_projectile_type]);
        assert(units.some(armed), `${p.name}/${f}: no usable weapon`);
      }
      if (domain === 'land') land++;
      else space++;
    }
  }
}
assert.deepEqual(collisions, [], 'A second pack, file name, caption or costume must not disguise a duplicate representative');
if (solo['3417277973'] && solo['1976399102']) {
  const old = solo['3417277973'].commanders,
    clone = solo['1976399102'].commanders;
  assert.equal(old.Empire.family, clone.Empire.family);
  assert.notEqual(old.Rebel.family, clone.Rebel.family);
  assert.equal(old.Empire.name, 'Bastila Shan');
  assert.equal(clone.Trade_Federation.name, 'Nute Gunray');
}
assert.equal((await fetch(api + '/roster?profile=stock&revision=wrong&faction=Empire&domain=land')).status, 404);
console.log(
  `${entries} faction/profile entries across ${profiles.length} sources; all ${land} ground and ${space} space detachments resolved models and combat definitions. Wrong revision rejected.`
);
