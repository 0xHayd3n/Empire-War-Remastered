# Whole-frame FPS after the land shadow change

## Follow-up: reuse terrain work and the sky render target

Whole-frame WebGPU on the RTX 3070, 1280×720 window, Endor Ultra still rendering at 2560×1440. Compared the same remasters immediately before/after this change, not against absolute FPS from the earlier session. The benchmark served one in-memory snapshot of the runtime JS to both builds, except for the four intentional module substitutions. Two opposite-order pairs/map, 360 warm-up + 960 measured frames/leg; all 15,360 measured frames included. An earlier trial on the mutable checkout was discarded because other JS modules changed during measurement.

| Map | Before FPS | After FPS | Change | Individual pair changes |
|---|---:|---:|---:|---|
| Endor Ultra | 71.3 | 76.9 | +7.9% | +0.8%, +13.8% |
| Yavin | 123.6 | 156.0 | +26.1% | +37.1%, +12.9% |
| Hoth | 172.7 | 157.9 | −8.6% | −16.0%, +0.8% |
| Tatooine | 174.5 | 172.5 | −1.1% | +0.5%, −2.8% |
| **All four** | **118.9** | **126.8** | **+6.6%** | **+5.0%, +8.3%** |

Endor still trails the other maps. The two Endor baseline legs were 83.6 and 62.1 FPS and both were much lower than the earlier session. These measurements show a direction, not an expected FPS on every machine or a fixed uplift. Hoth and Tatooine did not show a repeatable gain.

Changes: the close terrain mesh reuses world-cell vertices when the stitched edge mask is unchanged, and retains a bounded margin of already-sampled heights/normals when the camera reverses. The scan shader avoids the ray entry-height fetch unless step one intersects; it does not trace terrain self-shadow when the direct-light contribution is exactly zero. On native WebGPU the self-contained procedural sky and main scene use one render pass instead of resolving and reopening the full-size color target. Reflection, sky probes, close-shadow overrides and WebGL retain their original draw paths. No changes to scene resolution, AA, texture gradients, tessellation, shadow size/cadence, or vegetation LOD.

[Run measurements](benchmarks/remaster-terrain-reuse.json). Reproduce with `BENCH_BASE=reuse BENCH_PAIRS=2 BENCH_WARM=360 BENCH_FRAMES=960 node tools/bench-remaster-fps.cjs`. `node tools/check-remaster-reuse.cjs` compares old/new shader and sky draws at four frozen camera positions in the mounted window. `node tools/test-relief-scroll.mjs` compares the emitted indices, vertex attributes and displacement range to a cold rebuild, including holes, repaints, and reversing a pan.

## Follow-up: less remaster shading work

Compared **against the corrected shadows immediately before this optimization** on the same RTX 3070/WebGPU route. Two counterbalanced pairs per map, 360 warm-up frames and 960 measured frames per leg (15,360 measured frames total). Both suite-wide pairs improved, +7.47% and +7.56%. These are new paired runs, not a subtraction from the historical table below.

| Map | Before FPS | After FPS | Change |
|---|---:|---:|---:|
| Endor Ultra | 111.3 | 138.7 | +24.7% |
| Yavin | 171.8 | 175.2 | +2.0% |
| Hoth | 178.9 | 176.4 | −1.4% |
| Tatooine | 179.6 | 179.6 | flat |
| **All four** | **154.0** | **165.6** | **+7.5%** |

The repeatable individual gain was Endor (+23.2% and +26.2%). The other three changed sign between pairs and were near the 180 Hz ceiling. Do not infer a universal gain per map or a WebGL FPS result.

The opaque ground and its close relief now draw after ordinary depth-writing foliage/models, before decals and transparency. A covered ground pixel can fail the hardware depth test before running its multi-layer surface shader. Lit leaf cards reject transparent holes before shading, using the same alpha cutoff. Terrain fully inside the fine shadow cascade no longer filters the unused wide cascade; the transition still filters both. Neither shadow map, the camera route, resolution, nor asset detail was reduced.

[Run measurements](benchmarks/remaster-shading-work.json). Reproduce using `BENCH_BASE=shading BENCH_PAIRS=2 BENCH_WARM=360 BENCH_FRAMES=960 node tools/bench-remaster-fps.cjs` with the Playwright environment below. `node tools/check-remaster-ground-order.cjs` isolates the draw-order change against a frozen frame; `LOOK_WORLD` selects the map and `LOOK_BACKEND=webgl` selects fallback. The footprint and AT-ST checks are documented in [ground battlefield lighting](ground-battlefield-lighting.md).

## Historical baseline: shadow correctness

On a GeForce RTX 3070 (616.92), Core i7-12700KF, Chrome 158.0.8127.38, the four stock land remasters together went from **151.5 to 130.9 FPS (-13.6%)** on the measured route. This compares the same remasters before and after the shadow work, not remastered vs original art. See the [per-run measurements](benchmarks/remaster-shadow-fps.json).

| Map | Before FPS | After FPS | Change | Short sweep | Long sweep |
|---|---:|---:|---:|---:|---:|
| Endor | 106.5 | 83.3 | -21.8% | -28.3% | -18.6% |
| Yavin | 174.4 | 143.0 | -18.0% | -0.4% | -24.5% |
| Hoth | 179.4 | 179.0 | -0.2% | -0.5% | -0.1% |
| Tatooine | 175.4 | 167.6 | -4.5% | -9.3% | -1.6% |
| Overall | 151.5 | 130.9 | -13.6% | -13.7% | -13.6% |

**Method.** Headless Chrome on the hardware WebGPU adapter, through the mounted Universal window. 1280×720 viewport; the actual showcase settings render Endor Ultra at 2560×1440 and the other three at 1280×720. The same preset, map, sky, camera path, seed, starting army and 2048-wide/1024-near shadow targets were used within each comparison. At close strategy zoom the camera pans out and back, then orbits a fixed focus. Simulation runs at one 1/60-second input step per measured frame to match work. Each duration is the wall-clock interval to the next animation frame, not the CPU time to submit the draw. Loading is excluded. No other benchmark runs concurrently.

Each version was loaded in a fresh browser context. Before/after order reverses across pairs. Four short pairs per map (120 warm-up, 240 measured frames per leg) were followed by two longer pairs (360 warm-up, 960 measured frames per leg, same route repeated). Short and long suites have different simulation durations; comparisons are matched within each. FPS = all measured frames / total elapsed seconds; equal frame counts per map and build. No slow runs removed. Short runs pooled -13.7%; long runs pooled -13.6%. Individual suite-wide pair changes ranged from -34.1% to -0.0%. The 180 Hz animation-frame ceiling hides potential headroom, particularly on Hoth. This does not measure first load, all battle scenarios, alternate settings, WebGL or other GPUs.

**Reproduce.** From the Universal checkout with the stock game mounted on port 8590, Chrome, Git and Node-resolvable Playwright:

```sh
npm install --no-save --package-lock=false playwright-core
node tools/bench-remaster-fps.cjs
BENCH_PAIRS=2 BENCH_WARM=360 BENCH_FRAMES=960 node tools/bench-remaster-fps.cjs
```

The benchmark reconstructs the eight pre-change runtime modules in a temporary directory using the reference patch; it never rewrites the served working tree. It intercepts the same URLs for both variants and checks which were actually requested. Both versions keep all unrelated Universal work. Per-frame intervals and source hashes go to the printed temporary JSON path. For a different baseline, set `REF_DIR` to a directory mirroring those files under `public/js`.
