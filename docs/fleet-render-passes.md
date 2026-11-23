# What costs more in a fleet: building shadows or drawing ships?

**Keep the shadows.** In stock Forces of Corruption and each of the six modded fleets at 1080p, hiding mobile ships from the main scene saved more synchronized render time than reusing the complete shadow map. Even the Remake battle, where rebuilding the map had the largest cost, followed this pattern. These are diagnostic controls in a frozen battle, not two settings to ship. No renderer, asset, launcher or graphics default changed.

## What the measurements mean

The same [fleet and camera benchmark](fleet-render.md) runs 240 fixed simulation ticks, freezes the battle, then sweeps 48 camera poses. Here it uses full-detail WebGL, a 4096² shadow map (reach 8), drawing-buffer DPR 1, and the RTX 3070 via ANGLE D3D11. GPU runs are serial. Screen shake is held at zero; the particle batches are frozen within a run. Simulation and collection workers are disabled so worker waits aren't reported as fleet collection CPU time. This is not a live battle FPS or WebGPU test.

At **every** pose, first build a real, unmasked shadow map. Then run the following three arms, cycling through all six possible orders:

- **Full:** rebuild and sample the shadow map; draw the normal scene.
- **Reuse map:** skip only the shadow-map update. Ships still receive shadows from that pose’s existing depth texture and light matrix. This tests the entire map update, not the cost of shadow sampling and not just mobile casters. It does not establish that reusing the map is safe in a moving battle.
- **Hide mobile color:** build the complete shadow map first. Hide mobile ship roots only for main-scene collection and draw; restore them before post-processing. This removes visible mobile meshes and their attachments without removing their shadows, the stations, or independent projectile and particle batches.

The harness rejects a sample if the view or light matrix changes at a pose, the receiver stops sampling the original depth texture, hiding ships changes shadow calls or triangles, or map reuse changes main-scene calls or triangles. It also checks that each mask actually takes effect. Per-pass draw counts are differences of cumulative Three.js counters, with automatic per-pass resets disabled.

**Wall time** runs from renderer entry through a one-pixel readback (GPU completion). **Collection** is elapsed browser time inside the instance collector. **Main submission** is elapsed time inside Three.js’s main-scene render, including traversal, sorting, uploads, driver work and any stalls before the call returns. The difference made by hiding mobile ships estimates their incremental cost; it is not a stopwatch on individual ship draw calls or a measure of CPU utilization. **GPU time** uses non-overlapping `EXT_disjoint_timer_query_webgl2` queries on the unmasked priming frames: shadow target bind/clear through draw, and main-scene draw. Background and post-processing are outside both GPU spans. A missing timer gives `null`; disjoint results are discarded. CPU, GPU and wall time **overlap; don't add the columns**.

## 1080p results on `universal`

Milliseconds, median of 48 poses. For **Δ** columns, compute `full − control` at the same pose **before** taking the median. Positive means the control took less time. The two wall columns are directly comparable.

| Fleet | Wall Δ: reuse shadow map | Wall Δ: hide mobile ships | Browser Δ: collect ships | Browser Δ: submit main scene | GPU: shadow map | GPU: full main scene |
|---|---:|---:|---:|---:|---:|---:|
| Stock Forces of Corruption | 0.93 | 1.45 | 0.50 | 0.59 | 0.41 | 7.26 |
| Awakening of the Clone Wars | 2.26 | 4.27 | 1.44 | 1.75 | 0.94 | 10.74 |
| Awakening of the Rebellion | 2.57 | 5.70 | 1.27 | 1.86 | 1.14 | 13.11 |
| Empire at War: Remake | 2.70 | 3.44 | 1.62 | 1.63 | 1.00 | 15.06 |
| Fall of the Republic | 0.81 | 4.61 | 0.84 | 0.91 | 0.52 | 12.97 |
| Revan’s Revenge | 1.03 | 4.10 | 1.54 | 9.43 | 0.51 | 10.28 |
| Thrawn’s Revenge | 0.77 | 4.68 | 0.97 | 1.35 | 0.48 | 11.55 |

Ships don't account for every shadow triangle. In the Remake scene, mobile casters supplied about **15%** of the shadow triangles (189,264 of 1,257,699); in stock it was about **94%** (425,480 of 453,739). That matters before spending time on a *ship-only* shadow optimization. Conversely the full main GPU span includes more than ships; it cannot be read as ship-only GPU time.

### Cross-checks and decision

- The same ordering held on `main` for stock, Awakening of the Rebellion and Remake at 1080p, and on `universal` at 720p for stock and Awakening of the Rebellion. Every run matched its fleet fingerprint from the original benchmark. These are checks on the attribution, not a claim that one branch is faster.
- In a fresh stock 1080p run, mobile collection plus submission cost **1.05 ms** on the browser thread versus **1.11 ms** initially (paired medians). In Revan’s Revenge the **9.43 ms** main-submission delta repeated at **9.45 ms**, but hiding ships reduced synchronized wall time by only **4.10 / 3.86 ms** in those runs. That long return time is real; it is **not** nine milliseconds of proven CPU computation or recoverable frame time. Driver stalls or backpressure remain possible.
- Prioritize tracing main-scene submission in a **moving** Revan battle against stock, with normal collection workers, before changing batching. Use a browser CPU/driver trace to distinguish scene traversal and uploads from waiting on GPU work. There's no support here for reducing shadow resolution globally or caching shadows across live camera/ship movement.

## Reproduce

Use the same [local installation and optional Playwright prerequisites](fleet-render.md#reproduce). From the `universal` checkout:

```sh
node tools/bench-space-render.cjs --passes                              # stock, 1920×1080
node tools/bench-space-render.cjs --passes --primary 1397421866        # Awakening of the Rebellion
node tools/bench-space-render.cjs --passes --size 1280x720             # resolution cross-check
node tools/bench-space-render.cjs --passes --root ../Empire-War-Remastered  # same harness against main
```

The command emits one JSON object. [Recorded runs (JSON Lines)](fleet-render-passes.jsonl) contain renderer revisions, scene hashes, viewports, shadow settings, p50/p95 stage timings, calls, triangles, paired deltas and valid GPU sample counts. They contain no captures, profiles or game assets.
