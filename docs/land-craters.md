# Land impact scars

A hand blaster burns the surface. A wider, harder bolt can dig a shallow pit. A damaging explosion close enough to the ground leaves a bowl with an uneven lip and darkened soil. Width, blast-area damage and blast-area range come from the active weapon definition. The gameplay damage radius is **not** the excavation radius. A miss in mid-air, a shield dud, water or a raised platform does not dig the TED ground below it. Planted charges and orbital bombardments use the actual detonation, not the flight of their carrier or every particle it spawns.

In a new solo battle, feet, vehicles, ordinary ground impacts and visual wrecks can sample the excavated terrain. Foot soldiers keep their walking animation and add a short step over a shallow scar, or a sustained forward lean and weight shift on the uphill side of a deeper bowl. They return upright outside it. The navigation grid and original TED heights are not rewritten. Hidden hits reserve the same fine cells and give the same simulation heights as visible hits; their mesh is published only once visible. Multiplayer, old saves and replays do not acquire a new movement rule. New solo saves carry `craterRule: 1`, the crater field and the small marks.

Only impacted cells are subdivided. Once established, bowls do not time out or evict older bowls; moving the camera or receiving the 25th impact does not repair the map. Depth and the height of overlapping lips are bounded. If the map's fine-mesh budget or its 512-impact limit is exhausted, further hits leave marks rather than silently flattening old terrain. Small marks have a separate 512-slot cosmetic pool. Leaving the tactical map releases both.

## Footsteps and crushing

In new solo land battles, travelling infantry and walkers leave shallow, unscorched depressions. Alternating strides come from accepted movement, not an animation event or a camera-dependent bone. The unit’s in-game dimensions set the size and depth; tracked and hovering units do not leave bootprints. A confirmed crush also presses the soil under the victim. Prints displace the same replacement triangles used for walking, without changing the source map. Fog can postpone showing a mark, but does not change its physical depth.

Up to 96 recent prints share the map, separately from the blast budget. Busy battles limit new ordinary prints to 36 per simulation second, with a small burst allowance. Old prints can be recycled; explosive bowls cannot be evicted by footsteps. New saves mark this rule with `footfallRule: 1` and preserve the depressions. Older saves, multiplayer and replays do not acquire it. `npm run test:land-aftermath` checks the surface in stock battles; `npm run test:physics-workshop-land` includes an ordered *Awakening of the Rebellion* walker on a *Thrawn’s Revenge* battlefield.

## Verify

Run `npm run test:ground-craters` with the stock game mounted through Universal at `http://127.0.0.1:8590/`. `LOOK_BACKEND=webgl` selects the WebGL check instead of the default backend. The test directs a real stock hand blaster and T4-B shot into dry ground. It uses the normal detonation handler with a stock SPMA-T grenade, checks the bowl after 29 further blasts and a JSON save-field round trip, raycasts the rendered surface, and reads the same ground pixels with the soot mask on and off. The mounted test then orders a Stormtrooper across a T4-B scar and an orbital-bombardment bowl. It checks the unit's height each tick, its actual holder transform on the climb, and restoration after exit. The height tests also cover holes, paint, close-relief ownership, hidden impacts and capacity. These are tactical scars, not permanent changes to a campaign planet.

### Mounted rebuilt-map results

The seven registered Forces of Corruption landscape rebuilds were checked through the Universal battle window, with each rebuild verified active. On **Geonosis, Hoth, Naboo, Tatooine, Utapau and Yavin**, an ability detonation left a visibly scorched, walkable bowl on both WebGPU and WebGL. The bowl survived a zoom away and back and a crater save-field restore; a nine-member squad received a move order across it. These battles did not field a suitable blast projectile for the separate fired-shot check.

**Endor:** the bowl was visible on WebGPU. On WebGL its geometry and persistence passed, but the ground itself was not drawn in the test environment, including with the rebuild disabled. That leaves the WebGL visual result blocked, not passed. Squad traversal was not verified on either backend: the deployed squads were too far from the dry test lane. A second run of all fourteen map/backend combinations returned the same verdicts. This matrix covers blast craters, not footfall depth or wreck pushing on each rebuild.

### Verify a whole installed library

From the Universal checkout, with game data installed:

```sh
npm run test:craters-library -- --out land-crater-maps.json
node tools/map-remaster.mjs plan --scope all
npm run test:craters-map-paint -- --plan <path-to-plan.json> --terrain land-crater-maps.json --out land-crater-pixels.json
node tools/craters/join-library.mjs --plan <path-to-plan.json> --terrain land-crater-maps.json --pixels land-crater-pixels.json --out land-crater-matrix.json
node tools/check-crater-save-menu.cjs
```

The first command mounts both stock editions, the installed Workshop primaries and saved enabled load orders. It scans both `Data/Art/Maps` and `Data/CustomMaps`, including nested and non-menu land maps. Each winning path is recorded; identical TED bytes share one traversal run, not one run per alias. `--scope <Workshop ID or ordered comma-separated IDs>` and `--match <map name>` narrow the check. It tests the production terrain geometry, a real stock blaster and bombardment definition, and an infantry move order. The same reference soldier and weapons are deliberate: this isolates map compatibility from the local roster. A map entirely painted as holes must produce **no** pit or ground burn; it is not counted as a successful crossing.

The installed-library run joined **3,035 map/load-order rows** across both stock editions, six Workshop primaries and two saved multi-item orders. Of 1,268 distinct terrain files, **1,266** had a dry traversable site. In each, the reference infantry crossed the bowl and climbed out; the original bowl survived 29 later blasts and a fresh save-field restore. The other two were the CIS and Republic *Venator Venture* maps: every terrain cell was a hole, and neither created phantom soil. The WebGL check found visible soot on **1,495** distinct excavatable map/material combinations. The pause-menu Save → Load on stock Tatooine restored the physical depth from −3.59668 to −3.59668 world units. These results apply to the installed inputs tested, not future versions or every native mission and unit.

The pixel test reads back pixels from the production WebGL ground material, through an isolated frame in mounted Universal. It uses the winning TED and painted layers in the plan, comparing the same excavated parcel with and without soot under constant illumination. A texture override requires a separate measurement even when the TED is identical. It does not launch each mission, enable each reviewed rebuild, or claim to test all weather and camera angles. For a full run, check `complete` and failures, not just the existence of the incremental JSON. Browser checks require Chrome, `playwright-core` and the mounted launcher. The save-menu check uses an isolated browser profile and a real pause-menu save slot on stock Tatooine.
