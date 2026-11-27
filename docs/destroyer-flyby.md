# Star Destroyer close-ups

In mounted **Universal → Settings → Video → Graphics Quality → Space battles**, choose **Star Destroyer close-ups**. **Stock hull** is the default. **Detailed hull** adds geometry under the existing light. **Detailed hull + sky reflections** changes the response of those fittings to the battlefield. These controls do not select a Space battle look or change land, HUD, simulation, collision, hardpoints or other ships. In battle, with a visible stock Star Destroyer, **Play Star Destroyer flyby** runs an eight-second bow-to-stern pass; Escape returns to the strategy camera.

This is a close-up treatment of the mounted asset, not a replacement high-resolution Star Destroyer. The stock paint and tangent normal still set the resolution limit on large, uninterrupted surfaces. The [generated fittings](../public/js/game/destroyer-detail.js) add 5,188 triangles in five shared material groups. Paint-bearing plates sample the stock hull UVs, rejecting chart boundaries; the bridge visor/windows, trench rails and three open nozzle lips use independent finishes. The original emitters are not painted over. The script checks the actual vertex/index signature, not just the model filename. No game archive art is bundled.

A hull enters near detail at an estimated 30% of viewport height, exits below 24%, and is never selected behind the camera. Up to four visible hulls share geometry. A [separate atlas](../public/js/finishatlas.js) captures the mounted sky and modeled planets once per backend/environment/sky exposure, **on demand**. Three roughness bands at 48px per face occupy 162 KiB RGBA8 altogether per captured exposure. Linear-light filtering crosses cube-face edges. This approximates rough reflections; it does not trace other ships, resolve sub-pixel stars, or implement a full scene-linear PBR pipeline. By default shadow casting uses the existing fleet shadow map. Enable **Close-up hull shadows** in the same panel to supplement it for one near ship; it also requires the master **Shadows** setting.

## What was checked

Reference: running stock Abregado-rae in the mounted Universal window, 1920×1080, Orbital lighting, Instant Battle rosters of 100 per side. At the same two frozen flyby positions, geometry alone changed 54–60k pixels; the roughness-dependent finish then changed 37–40k more. At fleet zoom there were **zero** active detail hulls and the stock and upgraded frames were identical. Both close views also restored stock exactly on both backends. No shader validation errors. The UI check went through the normal settings and pause menu, checked persistence, keyboard/narrow layout with art removed and reduced motion, and started/skipped the flyby. The ship stays in the battle view; the new settings reuse the existing space controls, not a separate gallery.

Live fleet-zoom **browser frame intervals** (ms), not GPU-only render time. Four alternating windows (stock / finish / finish / stock), 192 live game frames, 80 sampled intervals per mode, warm-up excluded. The camera pans and the simulation advances; current fleet positions are not replay-identical. These short local runs do not establish a portable FPS guarantee or measure close-range GPU cost. Testing machine has an RTX 3070.

| Mounted backend | Stock median / p95 | Detailed + reflections median / p95 |
|---|---:|---:|
| WebGPU | 5.56 / 11.10 | 5.56 / 11.19 |
| WebGL | 16.65 / 22.11 | 16.72 / 22.35 |

The independent [Blender Cycles script](../tools/render-destroyer-reference.py) rendered the same bow camera, hull/fitting transforms, and sun on OptiX (RTX 3070): 1920×1080, 13 opaque meshes, 9,535 triangles, 128 samples/pixel. This **clay reference** shows the modeled silhouette and self-shadowing without distracting paint, engine sprites, or UI. It is not a match of the sky, textures, or final grade. Its better-defined tower/deck shadow motivated the near-shadow pass below.

## Close-up hull shadows

The [local shadow pass](../public/js/game/hullshadow.js) fits a 1024² depth map to the visible opaque hull, hardpoints and fittings of the flyby subject (otherwise the largest detailed hull in view). It uses the map’s sun direction. An unchanged relative sun and pose reuse the depth image as the camera or ship translates. The original fleet shadow remains. Only direct sunlight and direct glints are reduced by the new map; emission, sky bounce, and HUD do not get a shadow tint. The effect is off by default and issues no depth draw at fleet zoom or with master Shadows off.

At Abregado-rae the sun is only 6° above the deck. Biasing against painted normals can make sunlit plates mistakenly shadow themselves. The shader uses the actual triangle plane and the local texel footprint. The [independent ray check](../tools/hull-shadow-rays.cjs) classified 324 bow and 530 aft samples as having a clear line to the sun. Their median change was **0/255** on both backends. For deck samples with a real obstruction, the median drop was **15/255 at the bow, 13/255 aft**. Both frozen angles restored exactly when the extra shadow was switched off; the wide pair and the master-Shadows-off pair were identical. Scene scale, shaders and samples were verified on mounted stock Abregado-rae, not every Workshop map or GPU.

In the separate live 1080p close flyby on the same RTX 3070 machine (80 RAF intervals per setting), WebGPU median frame time was **5.60 → 5.63 ms**, p95 **11.24 → 11.25 ms**; WebGL was **16.74 → 22.12 ms**, p95 **22.28 → 22.28 ms**. These are short unsynchronised gameplay samples, not isolated GPU costs. Prefer leaving the feature off on a frame-limited fallback. The earlier fleet timings above are from the original geometry/reflections milestone.

For **all** ships, ground units and structures, use [Battle realism → On · land and space](battle-realism.md). The named Star Destroyer controls below are still available under **Use individual settings**.

## Stable flyby edges

With a **Detailed hull**, **Standard** anti-aliasing and native battle resolution, enable **Stable flyby edges** in the same Space battles section. It is off by default. While a detailed hull is close, the entire scene is shaded at up to 1.5× per axis (4/3× on WebGL); the [area filter](../public/js/closeedges.js) averages the source texels that cover each output pixel **in that frame**. Bloom, sharpening, heat, grade and HUD remain at their normal resolutions. This is spatial supersampling, not temporal AA or a video blur. The feature itself does nothing at fleet zoom, with upscaling or global supersampling, or when the drawing-buffer budget (3840 × 2160 pixels) leaves too little headroom. The independent fleet-sampling setting is not required.

Mounted 1920×1080 Abregado-rae, 100 entries per side, same stock ship, paint, light and cameras. For 12 successive positions on the eight-second flyby (1/60 s spacing), a **320×180 bridge crop was independently rendered at 1920×1080** and box-averaged on the CPU. Reference gradients selected edges; the score is the mean absolute error in the frame-to-frame luminance change at those pixels (0–255 scale), **not** an estimate of all game shimmer. Post-AA, heat, flare and bloom were suppressed for the reference so their radii didn't change with the crop. The normal effects stack was also tested separately.

| Backend | Moving-edge error, off → on | Mean edge contrast vs reference, on | Live flyby median, off → on |
|---|---:|---:|---:|
| WebGPU | 5.09 → 3.06 (−40%) | 96% | 5.56 → 5.56 ms |
| WebGL | 5.06 → 3.89 (−23%) | 93% | 16.65 → 27.71 ms |

Live timings are short alternating windows on the local RTX 3070 machine (80 RAF intervals per setting), not isolated GPU timings or a performance guarantee. The test moved a mounted fighter mesh and a bright additive bolt fixture: neither left changed pixels at its old position above the 2/255 per-channel threshold. Removing each restored the empty frame exactly. The fleet frame and switching off the default effects-stack comparison restored exactly on both renderers. WebGPU retained FP16 scene and resolve targets with highlights above SDR white when the test signaled HDR display support; this is readback, not a physical display assessment.

## Reproduce

With the stock installation mounted at `http://127.0.0.1:8590/`, Chrome and `playwright-core` available to Node:

```
node tools/test-close-edges.mjs
node tools/test-hull-shadow.mjs
node tools/test-finish-atlas.mjs
node tools/test-orbit-probe.mjs
npm run test:modules
node tools/check-destroyer-pass.cjs
```

Set `LOOK_EDGES=1` for the moving-edge reference, ghosting fixtures and live AA timings. Set `LOOK_BACKEND=webgl` to exercise the fallback. `LOOK_SHOTS` chooses the output directory (default: OS temp). For a **private local** Cycles comparison set `PRIVATE_REF` to a JSON path **outside the repository** during the WebGPU check, then run `blender -b --factory-startup -P tools/render-destroyer-reference.py -- PRIVATE_INPUT.json clay.png`. The JSON contains locally mounted geometry: do not commit or distribute it. No Blender installation or RTX hardware is needed to play.
