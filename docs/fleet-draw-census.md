# Which ships still draw one mesh at a time?

**Revan’s Sith Interceptor accounted for about 76% of all main-scene draw calls in both runs.** All individually drawn mobile parts in those battles came from its seven skinned pieces: the body, two wings, two tail fins, and two supports. This is not a station, shield or mounted-weapon problem. In stock, the largest individual source was instead a single opaque X-wing mesh, about 70–72% of individual mobile draws. Neither observation means the rest of either ship was absent from unit batches.

## Measurements

Two fresh 1080p WebGL runs per workload, same moving battle setup and worker checks as the [live trace](fleet-render-live.md). Each box below is a per-frame median, except the last column, which divides the sum of individual mobile draws by the sum of all main-scene calls across the run. Independent medians need not add to the median total. **Actual counts *and* triangles reconciled on every one of the 885 measured frames.**

| Run | Frames | Main calls | Unit batch calls | Individual mobile | Other unit roots | Outside unit roots/pools | Individual mobile share |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stock A | 250 | 147 | 87 | 49 | 0 | 14 | 29.6% |
| Stock B | 249 | 147 | 87 | 48 | 0 | 16 | 28.3% |
| Revan A | 183 | 877 | 131 | 665 | 3 | 69 | 76.1% |
| Revan B | 203 | 880 | 127 | 672 | 3 | 74 | 75.8% |

### Why not just combine the seven pieces?

- They are **skinned**: their vertices are positioned by bone matrices, which can differ per aircraft. The current [space instance collector](../public/js/game/instances.js) admits those materials to its skinned pool only on the WebGPU path. The checks here concern WebGL only.
- **About 85% of Revan’s individual mobile draws across the two runs were transparent at submission** (221,571 of 261,116). Every one of those transparent draws used the exact temporary material assigned by the renderer’s [fade path](../public/js/game/render.js), not an inferred alpha flag from a model name. The mix varied: 75% of individual draws in A, 94% in B. Removing the fade or sorting differently is a visual change. Shield and mounted-hardpoint groups contributed zero of the individual mobile calls in these two Revan windows.
- Even the opaque case differs between fleets. For stock X-wings, repeated opaque draws with the same geometry, material, render order, side and group had **identical full bone-matrix arrays within each frame** in both windows. For Revan, every repeated opaque group contained at least two different palettes; some draws were singletons. Group membership is not proof that every palette in a mixed group is different. Neither geometry reuse nor equal matrices alone prove a safe batch: tint, visibility, transforms, other uniforms and draw order still matter.

**Decision:** no automatic merge, no removal of fades, and no claimed FPS improvement. The narrowest useful prototype is an **opaque, repeated WebGL skin** with an identical pose, starting with the stock X-wing. Use the original draw on any pose or material mismatch; compare pixels and uninstrumented frame times. It would not solve Revan’s dominant case. A Revan-specific experiment must handle per-instance poses and preserve the order of transparent fades before it is a candidate for shipment.

## How to check it

```sh
node tools/bench-space-render.cjs --live --draw-census                         # stock
node tools/bench-space-render.cjs --live --draw-census --primary 3417277973   # Revan
# Append --local-labels to see the eight most frequent individual unit/part labels from your installation.
npm run test:universal
```

Uses [the existing benchmark prerequisites](fleet-render.md#reproduce). The census brackets only the main scene’s `renderBufferDirect` calls and reads the actual before/after Three.js counters, so skipped draws count as zero and multiple submissions are not collapsed. It rebuilds ownership maps after collection at each pose: known unit pool objects first, then the current unit root via the parent chain, otherwise outside. A unit pool can contain multiple owners; we do not mislabel its calls as uniquely mobile. For individuals, shields/attached hardpoints are classified by object identity, and skin/transparency by the material actually passed. It rejects any mismatch with whole-pass counter deltas. Background, post-processing and the separate shadow map are outside this census.

These are different, moving benchmark fleets, on stock Kuat and Revan’s Atravis fallback; skirmish AI is off. Classification and bone comparisons add overhead, so use this mode for **counts**, not FPS. [Recorded aggregates](fleet-draw-census.jsonl) include the renderer revision, frame count, drawing buffer, worker/motion checks, calls and triangles. Per-unit/part tables, geometry, poses, profiles and captures are not published.
