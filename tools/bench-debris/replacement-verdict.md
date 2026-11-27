# Verdict: keep Rapier as the game's single physics engine

The previous [mounted wreck comparison](mounted-results.md) favored Jolt on rigid vehicle wrecks (0.73 → 0.41 ms/update), not on whole-frame fleet performance. The missing replacement test was a crowd of constrained humanoids. **In the live battle the tested Jolt integration was slower, not faster, and it did not pass all of the pose gates. Do not replace Rapier or ship a second runtime for wrecks.** This is a decision about this game and these pinned builds, not a universal engine ranking.

### Measured whole frames (ms; lower is better)

| Mounted stock infantry workload | Rapier median / p95 | Jolt median / p95 |
|---|---:|---:|
| 6 falling, matched background | 5.56 / 8.38 | 5.56 / 8.36 |
| 24 falling, matched background | 5.56 / 11.14 | 8.32 / 11.15 |
| 24 falling, live Tatooine battle | **11.11 / 16.71** | **16.67 / 25.03** |
| 24 falling, matched background, simulated 4× CPU slowdown | **25.00 / 38.88** | **30.54 / 52.77** |

Chrome WebGPU at 1280×720, NVIDIA Ampere / i7-12700KF. Per-engine medians of four leg medians or p95s, not a pooled percentile. Two fresh launches per workload, reversing order (R-J-J-R, J-R-R-J), 120 measured presented frames per leg. Primary comparison: 3,840 measured frames. Equal starting transforms and velocities on paired legs; 24 casualties means 240 dynamic bodies and 216 starting joints, plus local terrain patches. The controlled-background paired full-ragdoll update took 4.23 ms with Rapier and 5.85 ms with Jolt. In live play it was 5.82 vs 9.29 ms. The controlled legs isolate the physics difference; live AI windows are not identical. CPU throttling is not a second machine or a real low-end GPU. Timings exclude creation of the staged casualties and initialization. Independent fresh workers took about 25 / 73 ms median to import and initialize the local Rapier / Jolt modules (not full load-screen timings).

### Behavior and cleanup

Both handled normal six-person falls, neck limits, explosive separation, unchanged authoritative units and persistence. In the matched 24-person pile (22 overlapping casualties receive the blast) both detached 22 limbs and kept remaining triangles intact. Peak attached joint separation was 0.128 game units for Rapier vs 0.456 for Jolt, marginally over the existing 0.45 bound. The skin's parent-pivot reconstruction prevents this number alone from implying a visible tear. The retained full-pose report also captures transient clipping on both; in this paired pile their parked skins were within tolerance. A Rapier-only preparatory pile run did show intermittent parked clipping (worst −0.965). Jolt also fell outside the parked-skin tolerance in one paired CPU-stress launch (−0.462). Neither engine is a universal fix for skin-to-ground correction.

The soak initially exposed non-recycled contact-filter IDs in the **test adapter**. We corrected that prototype bookkeeping and held an explicit reference to the pair filter across waves. Both then passed 144 casualties (24 consecutive waves on one world), kept the latest 128 visual bodies, evicted older ones, and cleared all on toggle-off. After **every** wave, native Jolt body count and tracked joint/collider counts were zero; the JS binding doesn't expose an independent physics-system constraint count. This isn't a process-heap leak certification. The 11 local capsule/constraint checks and the existing translated-ground rigid check also passed.

Jolt's primary configuration honors the game's four additional solver iterations on each ragdoll (Jolt uses absolute 14 velocity / 6 position steps here; iteration counts aren't equivalent across engines). A secondary test removed the extra iterations, leaving Jolt's native 10/2 defaults. That did **not** rescue the heavy live workload in the configuration tested; in the paired pile it widened the joint gap to 0.499 and missed the post-fall clearance gate. Results under `infantry-evidence/sensitivity` are not mixed into the primary timings.

### Reproduce

With Universal listening at `http://127.0.0.1:8590/`, stock assets, Chrome and `playwright-core` on Node's module path, from `tools/bench-debris`:

```sh
npm ci
node check-bridge.mjs && node joint-check.mjs
node qualify-infantry.cjs ./local-infantry-results
node infantry-summary.mjs ./local-infantry-results/joint-*.json
node infantry.cjs --suite=perf --live=1 --first=jolt --budget=native
```

The suite deliberately returns nonzero on any acceptance failure and preserves failing reports. The wildcard above assumes a shell that expands globs. Run the browser tests serially. See the [acceptance protocol](infantry-protocol.md) and [saved runs](infantry-evidence/). No player settings, production engine, multiplayer, campaign or replay path changed. If addressing the remaining visible problem, work on the skin/terrain correction for parked bodies before revisiting engine migration.
