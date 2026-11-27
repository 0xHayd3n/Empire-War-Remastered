# Jolt vs Rapier in mounted Universal Instant Battles

**Jolt is worth pursuing for ground vehicle wrecks. It did not show a repeatable whole-battle frame-rate improvement on this machine.** Keep the production default until infantry joint and skin behavior are tested; these runs replace rigid wrecks only.

| Matched scene | Rapier wreck update, ms | Jolt wreck update, ms | Whole frame median, Rapier / Jolt, ms |
|---|---:|---:|---:|
| Tatooine, ground contact | 0.73 | 0.41 | 5.56 / 5.56 |
| Thrawn’s Revenge, space drift | 0.128 | 0.105 | 8.33 / 8.32 |

Numbers are the median of four **per-leg medians** per engine in the controlled scene. Wreck update includes stepping and copying poses back to the actual game meshes. Whole frame is the browser animation-frame interval, including display pacing; it is not a GPU timestamp. Fleet medians across launches reflect different frame pacing (roughly 5.6 or 11.1 ms), not a precise 0.01 ms difference. Controlled ground wreck-update p95 (median of per-leg p95s) was **1.43 / 0.65 ms**. Under live AI, ground wreck updates were **0.64 / 0.40 ms**; whole-frame medians were **5.56 / 5.56 ms**. Live slow-frame comparisons varied with the changing scene. The measured ground savings are headroom, not an FPS multiplier.

- **Fleet:** Thrawn’s Revenge, Abregado Rae, two 64-entry rosters, 699 and 729 world units at capture. Ten simultaneous Imperial I Star Destroyer losses. Advanced the authored visual death clocks to the real breakup hook; 20 actual pieces tumbled and retained velocity. Did not benchmark loading or the full death-animation sequence.
- **Land:** the stock Tatooine ground-offensive encounter (90 world units). Staged eight vehicle loss requests, seven produced physics wrecks, 20 visible rigid sections. Used real authored poses, terrain patches, gravity, damping and collision masks. No center went more than one game unit below the rendered ground; this isn't a per-skin-vertex clipping test. The test caught a prototype collision-filter mistake that made pieces fall straight through the map. Those invalid timings are excluded; `check-bridge.mjs` regression-tests the correction on translated terrain.
- **Method:** Headless Chrome 158, WebGPU/NVIDIA Ampere, i7-12700KF, 1280×720. Rapier 0.17.3 and Jolt 1.1.2, real single-threaded WASM. Both engines capture the same death events/poses on each launch (maximum measured initial position/velocity discrepancy: zero). The normal render loop, HUD and mounted map stay in place. A main-camera draw hook checks that the wrecks are actually submitted before timing. Each leg starts with fresh bodies; fixed one 1/60-second wreck step per rendered frame isolates workload rather than following wall-clock frame rate. Staging, shape creation, engine initialization, shader warmup and teardown are outside the timed windows. Each scene has two fresh launches, R-J-J-R then J-R-R-J. Each launch runs both frozen-background and live-simulation passes, 240 frames per leg: 7,680 measured frames total. Live windows sample a progressing battle rather than bit-identical AI states; interpret them separately.
- **Scope:** this tests visible rigid wreck behavior in the current game. No production switch, multiplayer, replays, jointed ragdolls, low-end hardware or long-session memory benchmark. A test-only adapter is not a production Jolt port. No mounted models or Workshop assets were copied into the repository.

## Reproduce

From `tools/bench-debris`, with Universal running at `http://127.0.0.1:8590/`, Thrawn’s Revenge installed, Chrome installed and `playwright-core` on Node's module path:

```sh
npm ci
node check-bridge.mjs
node mounted.cjs --out=mounted-fleet.json
node mounted.cjs --scene=land --out=mounted-ground.json
node mounted.cjs --first=jolt --out=mounted-fleet-baab.json
node mounted.cjs --scene=land --first=jolt --out=mounted-ground-baab.json
```

Run the browser tests **serially** to avoid competing for the GPU. The four JSON files contain all per-leg median/p95/max times, motion checks, scene and machine identifiers. Neither game settings nor an existing browser profile are changed.
