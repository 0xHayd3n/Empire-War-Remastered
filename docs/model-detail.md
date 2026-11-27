# Distance detail for models

**Settings → Video → Details → Distance detail for models** is on by default. It is independent of the map, mounted era, shading preset and GPU backend. The old WebGL-only fighter experiment is no longer the default selection path. No pack rebuild, XML tag or per-map list is needed.

The ALO loader registers ordinary opaque colour meshes. The tactical collectors partition instances by geometry; direct meshes and Galactic Conquest scene layers use the same selector. At over about 64 display pixels a part stays full-detail; below that, a background worker can build an index-only reduction, then a smaller one below 22 pixels. Compatible authored rigid alternatives are preferred and switch only in the smallest band. The return thresholds are higher than the departure thresholds to avoid oscillation. A capital ship filling the foreground therefore doesn't turn into a coarse model just because the camera pivot is far away. For deferred fleet instances the entire ship sets the footprint so its hull and attachments agree.

Generated levels keep the original vertices, UVs, normals, skin weights, textures and material. Mixed-weight joints and triangles spanning different rigid bones are locked during simplification. Each original geometry is processed once per scene cache, not once per soldier or frame. Worker failure, negligible savings, tiny geometry, groups, morphs and incompatible geometry fall back to the original. Blended effects, shields, HUD, terrain tessellation and particle sprites aren't treated as ordinary models. Procedural forests retain their separately tuned tiers. This switch isn't an instruction to remove units or scenery at distance.

Geometry is swapped only for the generic colour draw and restored even on a failed frame. A split instance batch keeps a full-detail wrapper outside that draw; the buffers specifying pose, colour and transforms are the same in both wrappers. The previous specialised remaster scenery/foliage paths retain their own shadow behaviour. Simulation, picking and visibility rules for units are unchanged.

## Mounted verification

- **Original Tatooine (stock)** and **Abregado Rae land (Fall of the Republic):** fewer submitted triangles for both rigid and skinned batches, with full-detail draws on switching the setting off. The isolated mounted AT-ST's visible opaque submeshes returned to exactly the original counts after zooming back in: 1,476 → 958 → 1,476 (stock); 4,777 → 2,701 → 4,777 (mod).
- **Stock Abregado Rae space battle:** after hyperspace arrival, 349 instance rows used reduced meshes, avoiding 248,666 triangles at the sampled fleet view on WebGPU. The isolated stock Star Destroyer returned to full detail. The normal simulation worker was enabled.
- **Stock Galactic Conquest:** reduced meshes were observed in the actual campaign presentation. Original Tatooine also passed on WebGL. The earlier remastered Tatooine retained-prop and land-unit shadow checks still passed.
- [Per-leg rAF and submission data](benchmarks/model-detail.json). These are stationary render checks with a paused battle, not claims about every live match. FPS was near the presentation ceiling on several routes; the mod's two enabled runs varied substantially. Geometry savings are not a blanket FPS improvement.

Reproduce with the mounted Universal launcher at `http://127.0.0.1:8590/` and Playwright on the Node module path:

```
node tools/test-model-detail.mjs
node tools/check-model-detail.cjs
LOD_ROUTE=space node tools/check-model-detail.cjs
LOD_PACK=1976399102 node tools/check-model-detail.cjs
LOOK_BACKEND=webgl node tools/check-model-detail.cjs
node tools/check-galaxy-detail.cjs
```
