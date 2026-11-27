# Debris benchmark and engine choice

**Final replacement decision: [keep Rapier](replacement-verdict.md).** The mounted infantry, blast, persistence and stress tests are complete. Jolt's rigid-wreck advantage did not carry over to the live jointed-infantry workload.

**Follow-up: [mounted game A/B results and rerun instructions](mounted-results.md).** Jolt cut the ground wreck update from 0.73 to 0.41 ms in the matched game scene. Ten simultaneous modded capital-ship losses did not show a repeatable whole-frame improvement. Jolt remains a test-only dependency.

`cd tools/bench-debris`, `npm ci`, `npm run bench`. This standalone Node/WASM harness does not add either library to the game bundle. Results go to `results.md` and `results.json`; [reference.md](reference.md) preserves the measured five-round run, versions, settings, initial-state checks, median and p95 times.

**Decision: retain the locally bundled Rapier for solo Instant Battles.** Jolt was faster for all measured workloads. At the 64-piece space budget the default-settings drift difference was 0.040 ms/step; with CCD off (closer to shipping space debris) it was 0.016 ms. At 256 colliding ground boxes the difference was substantial: 8.79 vs 2.72 ms p95. These figures time the solver, not a rendered frame. Neither the skin/terrain edits, picking, draw calls, model loads, worker traffic, nor jointed ragdolls are in the benchmark. Keeping a single offline solver avoids a second runtime or replacing already validated ragdolls on the strength of a box test. Revisit Jolt if large simultaneous losses in a mounted mod actually spend the frame budget in contact solving.

**Mounted checks:** `node tools/check-battle-destruction.cjs` enters a stock fleet battle and verifies shields, a real impact, a disabled engine before death, and independently drifting Star Destroyer pieces. Add `--land` for a tank wreck and visual terrain deformation. `node tools/test-armor-geometry.mjs` raycasts a plate before/after a dent and through a cut. `node --test tools/test-terrain-craters.mjs` checks overlap, duplicate vertices, undo, and invariance of the gameplay grid.
