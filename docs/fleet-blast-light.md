# Explosion light at fleet zoom

Open the mounted [Universal window](http://127.0.0.1:8590/). **Settings → Video → Graphics Quality → Space battles → Explosion light on hulls** is on by default. Watch the side of a ship facing a nearby explosion, rather than the fireball itself: armor picks up the flash and loses it as the blast cools. Turn the option off for the previous lighting. It doesn't switch on bloom, grade the sky, require detailed ships, or change simulation, orders, saves or damage.

The space renderer consumes existing ship-death, hardpoint and detonation FX. Each source has a fixed world-space radius and fades with battle presentation time (pause freezes it). Up to four visible sources illuminate opaque lit surfaces; size on screen and remaining energy determine priority. Fogged sources are rejected. Both backends use the same bounded falloff, surface normals and a highlight shaped by authored gloss. This is direct local lighting, **not** bounce lighting or shadow casting between ships. Existing orbital sky/planet lighting and close-up geometry remain separate options. With the new option off, the separate Cinematic Lighting setting still controls the older bolt-style flash.

## Mounted comparison

`node tools/test-blast-field.mjs` checks culling, pause, zoom, cooling and source limits. With Chrome, `playwright-core` and the mounted stock game available, run `node tools/check-fleet-blast.cjs`; repeat with `LOOK_BACKEND=webgl`. Local before/after PNGs and `report.json` go to the OS temp directory under `universal-fleet-blast`, never to the repository. Use `LOOK_SHOTS` to change the output root.

In the mounted 1080p check, the same stock Abregado Rae battle frame was drawn with and without the light, keeping the explosion sprites, camera position and Orbital look identical. The test used 100 roster entries per side, issued a turn to a Star Destroyer and a move to its fighters, then triggered **one visual explosion, not simulated damage**, to control the timing. At fleet zoom, 5,101 pixels near the flagship changed on WebGPU and 5,537 on WebGL. The default (non-orbital) space look also responded. After expiry the captures matched the baseline on both backends; immediately switching off matched exactly on WebGPU and differed at 11 pixels on WebGL. This measures an isolated lighting change, not a judgement about the original ship art.

Short live samples while panning and triggering FX (80 browser frame intervals per setting after warm-up; alternating off/on/on/off):

| Backend | Off median / p95 | On median / p95 |
|---|---:|---:|
| WebGPU | 5.56 / 5.63 ms | 5.55 / 5.64 ms |
| WebGL | 16.83 / 27.81 ms | 16.71 / 27.90 ms |

The simulation advanced during sampling; fleet positions aren't replay-identical across windows or backends. These are not GPU timings or a speedup claim. In particular, WebGL was already above a 60 Hz frame budget before the feature was enabled. Mobile GPU performance, land battles and temporal anti-aliasing are not part of this milestone.
