# Persistent flagship damage: not enabled

Gate: damage one of two identical ships, partially repair it, retreat both, transfer the damaged one to a different fleet slot, save/load, and enter a second battle. Damage and any repair bill must follow that one ship, not its position, faction or type.

`SWR_GAME=<stock install> node tools/check-universal-vessel-identity.mjs` runs a staged stock Equal Footing campaign in memory. It uses the headless space simulator with the local Kuat map, campaign battle setup/result, retreat coordinator, actual fleet transfer and JSON round-trip of `snapshotGalaxy`/`applyGalaxy`. It does not overwrite a save or install a mod. This is an engine test, not a played campaign.

Two identical Mon Calamari cruisers entered. One took 1,000 hull damage (12,750 → 11,750); a damaged hardpoint recovered from 315 to 378 using a native repair satellite. The other hull remained at 12,750. Both retreated; the damaged hull moved from `0:0` to `1:0`. Their saved unit tuples were identical. Both returned at **12,750**. The paid hardpoint-repair path refused a ship: it is a station action, not a receipt system for shipyard repairs.

`GalacticGame.battleSetup` in `public/js/game/galactic.js` assigns `fleetIndex:unitIndex` for a single battle. `placeCampaignBattle`/`battleResult` in `campaignbattle.js` track fielded entities and surviving IDs, not outgoing hull or hardpoint damage. Reserves are associated by type and counts. `transferFleetUnits` moves the live objects, but `snapshotGalaxy` in `galaxy.js` persists type, passenger, marker and flags, not a durable vessel serial. A tactical save can preserve health *within* a battle; that does not preserve a ship between battles.

Before shipping the option: give campaign vessels saved identities that follow transfers and reinforcements, carry the result back by identity, and test that a repair debits exactly once even if its result is loaded twice. No damage registry, repair charges, borrowed mod scripts or save-schema migration were shipped with this check.
