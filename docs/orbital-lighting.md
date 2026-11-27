# Compare the fleet over Abregado Rae

In the [mounted Universal window](http://127.0.0.1:8590/), start a stock Abregado Rae space Instant Battle with a Star Destroyer. Wait for the ship to finish arriving. Open **Settings → Video → Graphics Quality**. For a controlled comparison, set **Battle realism** to **Use individual settings**, then use **World environments → Orbital lighting**:

| Choice | What to look for |
| --- | --- |
| Current environment (individual default) | Keeps the map, existing atmosphere slider, sun direction, exposure and chosen hull material. |
| Sunlit atmosphere | Haze grows with the distance seen through the planet’s air. It takes its color from the mounted atmosphere and sunlight. Surface contrast drops near the sunlit horizon; the night limb is not a glowing outline. Shader detail 2 or higher. |
| Sunlit atmosphere + planet light | Adds a small amount of reflected light on armor facing the planet. Compare the side and lower plates, not the top deck. No extra sun or full-screen brightness adjustment. **Battle realism: On** selects this option. |

Click **Pan past the planet** under **All battles** to replay the eight-second camera move. It appears when a stock Star Destroyer is visible and the map contains a positioned planet model. Escape returns to play early. The fight keeps running. You can change the lighting without using this camera; the planet light also reaches opaque surfaces on other ships. A planet painted into a sky texture is not a light source.

## Rendering limits

This is a thin spherical air layer and a single diffuse light source, not a volumetric atmosphere simulation. The shell uses a slant path length, one transmission/in-scattering term and the mounted cloud shadow. For bounce the renderer captures only the dominant planet disk as seen from the battlefield origin into a 40×40 target. It averages the disk in linear RGB and caches that color for the environment. At each receiving plate the direction and projected solid angle depend on the planet’s actual center and radius. Color is not recaptured as a ship moves. There are no per-ship cameras, planet eclipses, dynamic clouds in the bounce measurement, or new game rules. If there is no suitable disk or no usable reading, keep the existing fleet lighting. When using the broader sky lighting, the resolved disk is excluded from that diffuse capture; it remains in material reflection maps.

## Verification

`node tools/test-planetshine.mjs` checks covered disk color, world-space disk selection, the empty-map path and master settings. `node tools/check-orbital-lighting.cjs` checks the narrow keyboard control and saved choice, starts the pan from the in-battle Settings button, checks that simulation time advances and that Escape exits. Repeat with `LOOK_BACKEND=webgl`. It then replays matched pan positions with the simulation frozen and reads the actual HUD-free canvas at 1920×1080. Temporarily hiding the flagship and then the planet identifies opaque ship pixels independently of the backdrop. Both backends changed the planet for atmosphere alone and a smaller region of the ship for planet light. Returning to Current environment restored the baseline at the comparison threshold.

With 100 roster entries per side on this machine, a short matched pan had median frame intervals of about 5.6 ms (WebGPU) and 16.7 ms (WebGL) in both Current environment and the full treatment. These are render-path samples after warm-up, not sustained combat, GPU-only timing, or mobile benchmarks. The comparison writes local pictures and reports only to the temporary directory `universal-orbital-lighting`.
