# Land scenery at command zoom

Land props and procedural forest batches can select geometry using the same display-pixel footprint and hysteresis (`public/js/game/land-detail.js`). Use display height, the camera projection and the object's world-space bounds, not distance to the tactical focus. The promotion and demotion thresholds differ so a small camera move does not continually swap geometry. The policy doesn't change the simulation, terrain elevation, texture resolution, or rendering resolution.

- **Endor:** the seeded old-growth batches now have three 3D meshes per kind, with lower radial/height subdivisions in distant crowns, trunks, firs, logs, stones, shrubs and ferns. Even the tiny crown has horizontal extent when seen from above. The same materials, sunlight and alpha cutoffs remain. If a more detailed batch fills, a root can demote; the last batch grows rather than arbitrarily dropping an eligible plant. The edge of the local groundcover is staggered by root and has a small reversal margin. The tactical sightline cutaway is deliberate and still works. Shadow instances remain separate from camera detail selection.
- **Yavin:** previously the forest was already using a 270-triangle crown proxy. Tiny crowns now use 107 triangles with the same UVs and texture. The proxy is simplified once while loading and falls back to the authored mesh if not available. The high-detail tree and herb neighborhood tapers as the camera pulls back rather than switching the entire population on one zoom tick. Cheap existing herb proxies are not simplified again.
- **Other land remasters:** retained scenery props continue to use authored or worker-generated detail tiers, now via the shared selector and index simplifier. No change was made to unit skeletons, gameplay visibility, space battles or terrain LOD in this pass.

## Mounted A/B on the RTX 3070, WebGPU

Same fixed-step battle and moving camera route in a 1280×720 window; Endor Ultra still renders internally at 2560×1440. Two counterbalanced before/after pairs per map. Each leg measures 240 animation-frame intervals per view after 120 warm-up frames. FPS is total frames / total elapsed seconds. Triangle numbers are mean main scene submissions, not a prediction of FPS. Mirror, shadows, simulation, post and presentation remain in the timing. Supersampling and shadows were not reduced.

| Map / view | Main triangles, before → after | Whole-frame FPS, before → after |
|---|---:|---:|
| Endor near | 506,760 → 528,739 | 133.3 → 143.0 |
| Endor overhead | 917,166 → 585,816 | 114.9 → 137.1 |
| Endor low angle | 957,483 → 643,497 | 125.6 → 129.1 |
| Yavin near | 244,700 → 244,700 | 179.2 → 177.8 |
| Yavin overhead | 646,447 → 516,515 | 179.6 → 178.1 |
| Yavin low angle | 653,077 → 562,441 | 170.1 → 175.3 |

The clearest gain was Endor overhead: both pairs improved (+34.9%, +4.9%). The Endor and Yavin low-angle FPS comparisons changed sign between pairs. Yavin overhead was already near the 180 Hz presentation ceiling. Even when geometry cost falls, overlapping leaf pixels can still be expensive. This is not a universal FPS guarantee.

[Individual benchmark runs](benchmarks/land-zoom-lod.json). `node tools/test-land-detail.mjs` checks the screen-space selector and the actual reduced crown indices and silhouette extents. `ASSERT_DISTANT=1 LOOK_WORLD=endor,yavin node tools/check-land-zoom-lod.cjs` checks live geometry submission; add `LOOK_BACKEND=webgl` for the fallback. For a timing comparison, add `REF_DIR` pointing to the pre-change `public/js` and `BENCH_PAIRS=2`. These browser tools need the mounted Universal window and Playwright.
