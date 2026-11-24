# Galactic Conquest preview switching

## First paint and map switches after the portrait update

Compared `85083d5` with the queue/renderer changes using `node tools/bench-universal-switch.cjs` on the same loopback port, in real Chrome, 1366×768, four fresh contexts per build. **Planets** is the first animation frame after new foreground canvas drawing and the requested destination's complete detailed body count (model-less placeholders are not mistaken for art). **Complete** includes two consecutive animation frames with the requested map's native sky, lanes, rings and detailed planets painted. No browser automation polling is included in these times. Local indexes and portraits were already built. Single Player may now read the campaign index before the Galactic Conquest click; that read does not open a gameplay document or load planet pictures.

| Input (samples per build) | Planets, before → after | Complete, before → after |
| --- | ---: | ---: |
| First Galactic Conquest preview (4) | 155 → 113 ms | 843 → 526 ms |
| Escape and reopen the same starting preview (4) | 41 → 27 ms | 709 → 32 ms |
| First Fall map after stock (4) | 25 → 39 ms | 378 → 280 ms |
| Later Fall year/map-size changes (32) | 14 → 16 ms | 69 → 64 ms |

These are medians on one machine, not a guaranteed gain on every click. The biggest saving was reopening. Subsequent detailed bodies were already fast; there was no measured speedup in that column. This measures indexed browsing, not a cold install, first-time portrait generation, or campaign launch. The timing run uses the real sky. In a separate `SWR_SWITCH_PIXELS=1` run the two builds used the same fixed opaque background to compare route/ring rendering without background-render variation: all 11 full-resolution foreground-canvas hashes matched. Chrome also checked all seven normal previews and exact campaign launch.

## Normalized planet portraits

Compared `4440d61`'s native per-map planet instances with private, 128×128 portraits baked from each installed model/material set. Same local library, viewport, two fresh Chrome contexts per build and the nine inputs described below. The painted milestone on the new build includes decoding the selected map's portraits and drawing its native routes/rings. In both runs all 18 target IDs matched.

| Fall preview on this PC | Previous | Portraits |
| --- | ---: | ---: |
| First Fall map, individual times | 5.51 / 4.92 s | 1.03 / 0.60 s |
| Following 16 map/year switches, median | 1.07 s | 0.13 s |
| Following switches, range | 0.15–2.18 s | 0.10–0.27 s |

This is browsing with an indexed library, not first-install time or gameplay FPS. The one-time local indexing pass with portrait generation took about 47 s in a development run. The final seven-profile set has 46 PNG sheets (20.9 MiB encoded). Of 2,286 pack-scoped world records, 2,264 had visible textured mesh art; the other 22 use three invisible/particle-only model names. These are not 2,286 distinct named systems. The chooser requests every sheet but prioritizes the map being opened. No generated art belongs in the repository.

## Earlier comparison: per-map worker versus reusable model pool

Local installed-data Chrome check, 1366×768. Baseline: `f003534` (fresh WebGL worker on every uncached map). Candidate: shared chart with gray context, per-profile model pool, same three-entry whole-still cache. Both use the same cached local library, the actual title screen and native Galactic Conquest button. No saves or campaigns are launched by this benchmark.

`node tools/bench-universal-switch.cjs` opens two fresh browser contexts. In each, from the loaded stock preview it switches to Clone Wars, 22 BBY, then selects Fall's Known Galaxy Small, advances through 21/20/19 BBY, switches to Medium at 19, steps to 20/21, returns to Small at 21, then 22. Each sample begins on the click/keydown event and ends after two animation frames with the active foreground marked native. All 18 destination IDs matched between builds. Indexing, starting the game and entering an actual campaign are excluded.

| Input → painted planet preview | Baseline | Reusable pool |
| --- | ---: | ---: |
| First Fall map (two sessions, individual times) | 4.18 / 5.02 s | 5.42 / 4.18 s |
| Subsequent switches (16 samples, median) | 4.38 s | 0.45 s |
| Subsequent switches (range) | 4.05–6.49 s | 0.11–2.18 s |
| ↳ Change year (12 of those 16, median) | 4.30 s | 0.51 s |
| ↳ Change map size (4 of those 16, median) | 4.51 s | 0.25 s |

First-map loading did not show an improvement. This measures map/year switches in a single tested storyline on one PC, not simulation FPS, all profiles, cold disk, or campaign launch time. An earlier interrupted first pass had much higher cold-system timings; the comparison above uses two completed runs with warmed local files on both builds. Returning to another storyline may require loading its models again. Locally: requires `playwright-core`, Chrome, and the installed stock and Fall profiles. Use `SWR_TEST_WINDOW_PORT` to choose an unused port block.
