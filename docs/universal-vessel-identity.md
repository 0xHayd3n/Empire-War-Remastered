# Persistent flagship damage: proceed with a limited stock pilot

**Decision:** the per-vessel identity prerequisite passes for the human Rebel `Calamari_Cruiser` in stock Universal **Equal Footing**. Proceed with one opt-in flagship on this opening. Do **not** enable campaign-wide damage, migrate old saves, or overlay Thrawn’s own Executor/Lusankya rules. The resulting [Rebel flagship setting](universal-library.md#start-a-campaign-and-choose-its-path) is off by default. It commissions only the cruiser the player confirms in a new eligible campaign. The engine prerequisite was tested with multiple tracked twins; the player-facing version persists damage for just the one designated ship. No mod flagship was validated.

## What changed the decision

Previously (`ae666f8`), two identical cruisers retreated but the damaged one returned at full health after a fleet split and reload. The positional ID `0:0` identified a slot in the *old battle*, not a ship. Type-matching called reinforcements at battle end could also substitute a newly built ship for a dead one.

| Same stock map, same staged encounter | Damaged cruiser on re-entry | Its untouched sister |
| --- | ---: | ---: |
| Ordinary campaign (control) | 12,750 | 12,750 |
| Enrolled campaign, after split and save/load | **11,750** | **12,750** |

- **Rendered game (Chrome, disposable loopback origin):** launched the native title and Equal Footing, staged two Rebel cruisers against an Imperial ship, damaged one, wrote and loaded a tactical save, and advanced the normal retreat coordinator and victory countdown. Both ships returned through the actual tactical-to-galactic transition. Split the damaged ship into a different fleet, wrote and loaded a galactic save, and entered a second rendered battle. The same ship had 11,750 hull and a 315-health hardpoint; the sister still had 12,750 hull. No manual result or restored condition was injected.
- **Headless stock engine:** a native repair satellite moved a damaged hardpoint from 315 to 378. That partial repair and the 1,000-point hull deficit survived extraction, a tactical save *after extraction*, fleet transfer, a galactic save and re-entry. A second engagement included a pathfinder, four campaign reserves and a tactically built identical cruiser. Tested dead and living called ships across tactical restore, loss of the **second** waiting duplicate, and deployment of the untracked build. It received no campaign ID and did not replace a casualty.
- **Repair accounting (engine only):** against two damaged survivors, a test yard debited 125 credits for the selected ship, not its sister. Insufficient funds, stale revision, replay of a battle result, repeated repair, repair after reload, and reuse of an old request after new damage did not debit again. The price was a test tariff, not a proposed balance change. This is not the station-only tactical hardpoint purchase.

The browser test caught something the isolated simulator did not: normal `applyGalaxy` compacts empty fleets. A correct UUID on the flagship alone was not enough: even an *untracked enemy* could receive the wrong positional casualty. The return now resolves a ticket for **every participant** in the enrolled battle before invoking the normal casualty and retreat code. The fast regression deliberately removes an empty fleet and reverses the twins before applying the result.

## Implementation and limits

- `campaignvessels.js` assigns an opaque ID to each eligible campaign record when it first participates, not to a ship type. A condition follows that record through transfers. One pending battle token authorizes one return; one vessel revision authorizes one yard debit. An unrecognized roster or duplicate ID is not repaired by guessing. Hull and named hardpoints are carried; shields are not.
- `campaignreserve.js` binds a campaign ticket at actual dequeue and placement. Ordinary cards call the first ordinary ship of the class; Valiant’s card carries its vessel ID to the actual dequeue. A stale selection does not fall back to its sister. A tactical save preserves exact bindings, remaining tickets and the condition of a successfully extracted ship, even when it no longer has a live entity. AI, multiplayer, linked missions and ordinary saves do not enroll.
- **Player-facing check:** commissioned the second of two staged stock cruisers through the native log. Called Valiant from its own reserve card after retreat, fleet split and restore (11,750 hull, one damaged hardpoint); the ordinary card brought the healthy sister. On a second branch of the same disposable save, a friendly starbase quoted 157 credits. Cancel kept the treasury at 12,000; confirmed full repair left 11,843 and the same undamaged ship after reload. Scripted replacements, upgrades into a different ship type, AI, multiplayer, and mod-native damage/repair systems are outside the proof.

## Reproduce

From the Universal checkout:

- `node tools/test-campaign-vessels.mjs` — fast, no game install. Also included in `npm run test:universal`.
- Set `SWR_GAME` to the stock installation and run `node tools/check-universal-vessel-identity.mjs` — control, engine pilot, reserves and repair receipts.
- With local Universal packs, Chrome and `playwright-core` available, run `node tools/check-universal-vessel-window.cjs` — native opt-in, designation, separate reserve cards, two rendered battles and temporary tactical, galactic and repair saves. Default disposable port block starts at 8940; override with `SWR_TEST_WINDOW_PORT`. Look for both `PASS: rendered second battle, selected exact reserves` and `PASS: cancelled quote unchanged; confirmed once and reloaded`.
