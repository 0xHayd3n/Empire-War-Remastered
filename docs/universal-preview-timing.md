# Galactic Conquest preview switching

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
