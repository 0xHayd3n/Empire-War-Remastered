// Fast, asset-free guard for the live failure: the tactical galaxy compacted
// empty fleets before the old positional casualty list returned.
import assert from 'node:assert/strict';
import { enrollVessels, openVesselBattle, acceptVesselResult, restoreVessels } from '../public/js/game/campaignvessels.js';
const ship = { name: 'Calamari_Cruiser' },
  sides = ['Empire', 'Rebel'];
const galaxy = () => ({
  universalPath: 1,
  campaign: { name: 'Sandbox_Equal_Footing_Rebel' },
  active: 'Rebel',
  fleets: [
    { planet: -1, units: [] },
    { planet: 5, owner: 'Rebel', units: [{ type: ship }, { type: ship }] },
    { planet: 5, owner: 'Empire', units: [{ type: { name: 'Other' } }] }
  ]
});
for (const mismatch of [{ universalPath: 0 }, { active: 'Empire' }, { campaign: { name: 'Other' } }, { humans: ['REBEL'] }])
  assert.equal(enrollVessels(Object.assign(galaxy(), mismatch)), false);
const g = galaxy();
assert.equal(openVesselBattle(g, 5, sides), null);
assert(!g.fleets[1].units[0].vessel);
assert(enrollVessels(g));
assert.equal(openVesselBattle(g, 5, ['Empire', 'Underworld']), null);
const nonce = openVesselBattle(g, 5, sides),
  [first, second] = g.fleets[1].units;
assert.notEqual(first.vessel.id, second.vessel.id);
const outcome = {
  vesselBattle: nonce,
  planet: 5,
  sides,
  battleSlots: ['1:0', '1:1', '2:0'],
  alive: ['1:1', '2:0'],
  vesselOutcomes: [
    { id: first.vessel.id, gid: '1:0', survived: false },
    { id: second.vessel.id, gid: '1:1', survived: true, condition: { hull: 0.75, parts: [] } }
  ]
};
g.fleets.shift();
g.fleets[0].units.reverse();
for (const wrong of [
  { vesselBattle: crypto.randomUUID() },
  { battleSlots: ['1:0', '1:0', '2:0'] },
  { alive: ['2:0'] },
  { vesselOutcomes: outcome.vesselOutcomes.toReversed().map((o, i) => ({ ...o, gid: '1:' + i })) }
]) {
  const before = structuredClone(g);
  assert(!acceptVesselResult(g, { ...outcome, ...wrong }));
  assert.deepEqual(g, before);
}
const result = structuredClone(outcome);
assert(acceptVesselResult(g, result));
assert.deepEqual(result.alive, ['0:0', '1:0']);
assert.equal(second.vessel.condition.hull, 0.75);
assert(!first.vessel.condition);
assert(!first.battleSlot);
assert(!acceptVesselResult(g, structuredClone(outcome)));
restoreVessels(g, { open: null });
assert(g.vessels);
first.vessel.id = second.vessel.id;
restoreVessels(g, { open: null });
assert(!g.vessels && !first.vessel && !second.vessel);
console.log(
  'PASS: vessel enrollment exclusions; exact tracked and untracked returns across roster compaction; mismatched, duplicate and stale receipts rejected.'
);
