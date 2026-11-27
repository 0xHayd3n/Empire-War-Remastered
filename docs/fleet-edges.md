# Steadier fleet edges

In the mounted [Universal window](http://127.0.0.1:8590/), open **Settings → Video → Graphics Quality → Space battles → Steady fleet edges**. Pan slowly past a cluster of fighters and along a capital ship’s bow at strategy zoom. This optional mode trades GPU time for steadier outlines. It is off by default; turn it off again if the pan feels less responsive.

Use **Standard** anti-aliasing, full resolution scale and native battle scale. The mode respects reduced resolution, upscaling and existing supersampling instead of overriding them. It leaves the output and HUD at their original size. On WebGPU it renders up to 1.5× as many pixels along each axis (1.25× on WebGL) and integrates those samples before bloom, grading or sharpening. A slightly wider positive filter suits thin fleet silhouettes. It shares the close-up resolve target: an enabled detailed flyby keeps its own tighter filter, not a second round of AA. Fleet sampling stays below a 2880×1620 pixel budget and the device’s dimension limit; it bypasses the extra pass if there isn’t at least 15% headroom per axis. Thus it intentionally does nothing on a native 4K canvas. Land and the simulation are unchanged.

This is single-frame sampling, not temporal reconstruction: no jitter, history buffer, trail or camera-cut reset. It cannot restore detail that the geometry or source material does not contain.

## Reproduce

- `node tools/test-fleet-coverage.mjs` checks scale, AA and budget guards.
- `node tools/check-fleet-coverage.cjs` checks Settings in the actual mounted Universal window, including persistence and a narrow keyboard layout, then opens stock Abregado Rae. Repeat with `LOOK_BACKEND=webgl`. Requires Chrome, `playwright-core` and a mounted stock profile. `LOOK_SHOTS` can override the default private TEMP output (`universal-fleet-edges`).
- The check holds simulation poses fixed and shifts the projection by exactly 0.2 horizontal and 0.1 vertical output pixels for each of 13 frames. It measures mean absolute **second frame difference in luma** (roughness of the change, not the amount of movement) in patches centered on visible fighters and the flagship. It also checks patch contrast so hiding ships or indiscriminately blurring the scene cannot qualify just by reducing variation. For a trail check, a visible fighter set is hidden for one draw and compared to the same empty patches captured before it appeared. A separate moving-fleet test resumes the game and pans in alternating off/on/on/off windows.

At 1920×1080 with 100 entries per side, the measured fighter-patch roughness fell from 1.63 to 1.07 on WebGPU (16 fighters) and 1.71 to 1.21 on WebGL (19 fighters); their local contrast stayed above 93% of baseline. Flagship roughness also fell on both. The vacated fighter patches matched their empty references on the first frame on both backends. This is evidence for that battle, not a guarantee of no aliasing on every asset.

Live browser frame intervals (80 samples per setting after warm-up): WebGPU median / p95 was 5.56 / 5.63 ms off and 5.55 / 5.63 ms on. WebGL measured 22.11 / 22.55 ms off and 22.35 / 38.89 ms on. The tails on WebGL are a reason to keep this opt-in. These short runs do not isolate GPU cost or benchmark mobile devices or HDR displays.
