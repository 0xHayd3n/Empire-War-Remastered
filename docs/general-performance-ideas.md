# General performance ideas beyond fleet rendering

Discovery only. Public notes were checked for Awakening of the Clone Wars, Awakening of the Rebellion, Empire at War: Remake, Fall of the Republic, Revan’s Revenge and Thrawn’s Revenge, plus examples from other Workshop projects. No portable FPS switch or measured stock-game speedup was established.

| Try | Why it is plausible | Quick decision test |
|---|---|---|
| **Reuse unchanged game definitions when starting a battle.** | The [browser](../public/js/main.js) and [space battle worker](../public/js/game/spacebattleworker.js) both call [`loadGameData`](../public/js/gamedata.js). That means parsing the resolved definitions in two contexts, even when the underlying bytes are cached. The local Remake install listed 853 entries across its unit, hardpoint and sound-event manifests; stock FoC listed 148. These are manifest entries, not timings. | Time entry into a repeat battle in stock and Remake. Keep only if reuse beats its transfer/setup cost and yields the same definitions, overrides and language; invalidate on content or load-order changes. This targets loading, not FPS. |
| **Skip campaign calculations when their inputs haven’t changed.** | [Awakening of the Clone Wars](https://steamcommunity.com/sharedfiles/filedetails/changelog/3387971722?l=english&p=2#1734921393) explicitly reports less Galactic Conquest lag when AI moves senators with galaxy-wide bonuses. It does not say how the fix works. A transferable idea is to reuse unchanged results, not slow down AI or timers. The browser [already indexes story objects by type and owner](../public/js/game/galacticstory.js), so don't reimplement that. | Only prototype if repeated bonus/ownership calculations actually show up in a stock campaign. Compare identical campaign state after moves, captures and save/load. |
| **Bound memory used by old sound effects.** | [Remake](https://steamcommunity.com/sharedfiles/filedetails/?id=1770851727) describes a much larger audio library. The browser already [limits simultaneous voices](../public/js/audio.js) but keeps requested decoded sound-effect buffers without an eviction budget. This is our engine opportunity, not a reported Remake technique. | If retained audio memory grows over several battles, evict least recently used, inactive clips under a byte budget; check for re-decode hitches, keep active sounds intact. No change to sound quality. |

## Repeat battle loading: tested, not adopted

An in-memory page snapshot reused the resolved unit, hardpoint and sound-event definitions in a fresh battle worker. Each worker rebuilt its own objects, nested XML methods and inheritance links. Faction data, localized text, constants and other rules still used the normal loader. No cache was written to the install or the browser profile.

| Workload | Current → trial, median until playable | Time saved | Worker definition step alone |
|---|---:|---:|---:|
| Stock Forces of Corruption | 1.76 → 1.61 s | 0.16 s (8.9%) | 256 → 98 ms |
| Empire at War: Remake | 8.53 → 8.37 s | 0.16 s (1.9%) | 1,166 → 250 ms |

Two browser sessions per workload; one untimed initial battle in each, followed by four repeat starts in opposite orders (baseline/trial/trial/baseline, then reversed). Same local install per pair, Empire vs Rebel, `benchmark=10`, original primary only, normal workers and WebGL, 1280×720. Timing starts at battle construction and ends after the load screen closes and the page has applied a live simulation record. It includes sending and rebuilding the definitions. The one-time page packing cost (22–24 ms stock, 78–181 ms Remake) is **not** charged to the trial's repeat times. Four measurements per configuration are a screening test, not a general performance claim; trial and baseline times overlapped on Remake. This does not measure cold startup, FPS, a full campaign or every mod stack.

In separate, untimed launches, the normal and reuse workers returned matching SHA-256 digests for the three bulk definition tables and for the checked localized text, rules, faction, music, category and CRC data. The checks also verified real `ObjType`/`XNode` prototypes and parent references (6,881 definition records stock; 22,012 Remake). These are data checks, not full simulation parity.

**Decision:** neither workload cleared the predeclared minimum of 250 ms **and** 10% lower median repeat-entry time. Keep the original loader; the trial code was removed.

## Campaign map: measured, no new cache

**Decision:** don't cache campaign-wide totals across frames. In early live Galactic Conquest play, looking up production bonuses was infrequent and cheap in both workloads. Politics and income ran every simulation update, but neither took enough time on average to justify storing results that can go stale when fleets move or planets change hands.

| During a move between friendly planets | Stock FoC: Equal Footing (56 planets) | Awakening of the Clone Wars: Republic sandbox (101 planets) |
|---|---:|---:|
| Production bonus context: single-planet + all-planet builders | 77 calls, 6.13 ms total | 38 calls, 4.66 ms total |
| Politics update, mean ms/frame | 0.020 | 0.065 |
| Income update, mean ms/frame | 0.033 | 0.079 |
| Population used + cap queries, mean ms/frame | 0.002 | 0.006 |
| Whole simulation, mean ms/frame | 0.61 | 1.00 |

Each column spans **5,000 frame intervals**, with simulation and AI active in Chrome/WebGL at 1280×720. An ordinary player move was issued after 30 frames; the tracked unit was observed in transit and at its destination. The windows covered 28 and 34 simulated seconds respectively. Two shorter 800-frame screens per campaign also found less than 0.007 ms/frame in the production bonus context builders. Timings are inclusive elapsed times inside the functions; rows overlap and should not be added. These are measurements of the original engine, not frame-time savings. A paused intro was excluded.

For a closer check in Clone Wars, we embarked Senator Bail Organa's starting ground team and moved it to another Republic planet. Departure and arrival both occurred in the 3,200-frame window. The two production context builders took **3.75 ms total across 27 calls**. This was a player order, not a reproduction of the mod author's AI case. The team didn't expose a galaxy-wide production price/time ability in the definitions checked; scripted bonuses are not ruled out. None of the three longer windows crossed a fiscal payout, and late-game hitches were not tested.

Two tempting shortcuts have correctness costs. [Income](../public/js/game/galacticeconomy.js) can change on siphon expiry and some reads also update the siphon amount. The [movement graph](../public/js/game/galaxy.js) selects only the first trade route between two planets, so it isn't a drop-in substitute for iterating every authored income route. No logic, timing, AI, saves or HUD behavior was changed; no capture/save parity claim is needed for this screening result.

**What to skip:** [Phoenix Rising](https://steamcommunity.com/sharedfiles/filedetails/?id=1235783994) offers a lighter *campaign*, and [a Remake submod](https://steamcommunity.com/sharedfiles/filedetails/?id=3154504069) speeds up projectiles and acknowledges the accuracy/visual tradeoffs. Those change what is being played. Neither is a transparent universal engine optimization.
