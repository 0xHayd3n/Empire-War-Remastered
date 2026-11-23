# Fleet rendering: ships, weapon draws, or particles?

**Decision:** retain full-detail ships by default. Across stock FoC and six Workshop primaries, removing the mobile ship draw (including its shadows) changed median render time more than removing the direct weapon draws or particle batches. Trying the next cheaper *authored* mesh on small fighters reduces triangles in three scenes, but did **not** produce a consistent frame-time improvement. Do not lower effects globally or generate replacement geometry on this evidence.

## What was measured

Chrome / WebGL on an RTX 3070 (ANGLE D3D11), 800 × 450 drawing buffer, same machine. Start the engine's `40 v 40` space benchmark; squadron spawns explain the much larger ship counts. Use the primary mod alone, not its submods. Request Kuat, accepting the engine's actual fallback map when unavailable. Advance the local simulation exactly 240 fixed ticks and freeze it. In each branch pair, map, factions, unit types and XY positions, projectile types and XY positions matched the recorded fingerprint. Different mods are **not** the same battle.

Warm then replay 48 camera poses. At every pose alternate the order of four render modes. `full` draws the normal scene; three diagnostic modes suppress mobile hulls (also hiding their shadow casters), direct weapon geometry (bolts, lasers, projectile models and tractor beams), or particle batches (including engine glows and smoke). Visibility changes only during draw; simulation and weapon rules aren't toggled. These are overlapping costs, **not additive shares**. GPU work is synchronized by pixel readback. Particle worker results are held fixed within a run; their counts can vary between processes. These timings are renderer samples, not whole-game FPS, and do not include advancing AI, networking or simulation. The Clone Wars baseline run on `universal` had a large timing outlier; do not infer a branch regression or speedup from these single runs.

| Primary | Ships / projectiles | `main` median / p95 ms | `universal` baseline median / p95 ms | `main` median ms: hide hulls / hide weapons / hide particles |
|---|---:|---:|---:|---:|
| Stock FoC | 339 / 418 | 7.0 / 10.0 | 6.8 / 15.0 | 4.9 / 6.9 / 6.7 |
| Awakening of the Clone Wars | 509 / 334 | 18.3 / 31.2 | 33.9 / 230.4 | 11.5 / 18.2 / 18.6 |
| Awakening of the Rebellion | 400 / 334 | 17.2 / 22.4 | 16.4 / 23.9 | 10.9 / 16.8 / 17.0 |
| Empire at War: Remake | 556 / 403 | 14.6 / 19.6 | 16.2 / 19.2 | 11.6 / 14.6 / 15.0 |
| Fall of the Republic | 776 / 1,114 | 12.9 / 15.1 | 11.5 / 16.2 | 7.9 / 12.7 / 12.8 |
| Revan’s Revenge | 662 / 296 | 15.8 / 23.8 | 14.8 / 33.8 | 10.5 / 16.1 / 16.0 |
| Thrawn’s Revenge | 602 / 807 | 13.9 / 17.6 | 14.6 / 18.3 | 9.1 / 13.5 / 13.5 |

[Machine-readable results](fleet-render-results.json) include branch pins, maps, hashes, draw calls, triangles and timings for every mode.

## Opt-in: authored distant fighter meshes

[Try stock Kuat on the local universal server](http://127.0.0.1:8577/play.html?benchmark=40&map=KUAT&faction=Empire&enemy=Rebel&webgl&fleetlod=1). Remove `fleetlod=1` to compare the default. The experiment only operates in the **instanced WebGL space renderer**. WebGPU, land, shadow geometry, collision, targeting, animations and simulation use their original paths.

Below an estimated 18-pixel diameter, eligible fighters can use an existing `_LOD` mesh with at least 20% fewer indices. Above 24 pixels they return to full detail. Only visible rigid, single-part meshes with matching bone, vertex format, material parameters and close local bounds qualify; ambiguous high levels, skins and unsupported content keep full detail. The original mesh isn't replaced in the gameplay object. Nothing is copied from a mod into the fork.

A second run alternated opt-in and full detail **at every camera pose in the same browser**, without removing ships or weapons:

| Primary | Change in median triangles | Median render ms: full → opt-in | Zoom check |
|---|---:|---:|---|
| Stock FoC | −11.30% | 10.19 → 10.19 | Alternate → original → alternate |
| Thrawn’s Revenge | −3.50% | 17.00 → 17.06 | Passed |
| Fall of the Republic | −0.72% | 13.19 → 13.56 | Passed |
| Remake, both Awakening mods, Revan’s Revenge | No change | See raw results | No eligible switch on this path |

The zoom check inspects the actual instanced geometry pools. It does not certify visual quality across all resolutions, optics, units, or GPUs. Draw calls didn't fall in these comparisons. Next, separate CPU submission and shadow-pass cost for ship-heavy scenes at common play resolutions before proposing a default change.

## Reproduce

Install Node dependencies with `npm ci`. The optional measurement harness also needs local Chrome and `playwright-core` (e.g. `npm install --no-save --package-lock=false playwright-core`), your own game install, and any Workshop primaries you want to test. Reads local Steam libraries or `SWR_GAME`, serves each checkout on a fresh loopback origin, and closes its browser and server afterward. No asset exports.

```sh
node tools/bench-space-render.cjs --root ../Empire-War-Remastered
node tools/bench-space-render.cjs
node tools/bench-space-render.cjs --primary 1125571106
node tools/bench-space-render.cjs --primary 1125571106 --fleet-lod
npm run test:universal
```

The module graph, production build, loose-stack check and focused LOD checks passed. The independent stock space-mirror regression test still reports `Unit.startingPlaced` for `Generic_Star_Destroyer#31`. The same single-field mismatch reproduced against `main` with the same game data; this renderer experiment does not fix it.
