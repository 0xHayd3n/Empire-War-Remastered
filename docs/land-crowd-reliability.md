# Crowded land battles: what is verified

## Formation movement (mounted Universal)

`npm run test:physics-crowds` uses the actual group move command in `#ground-offensive`, followed by ordinary world ticks. Eight allied Stormtrooper squads start close together without overlap. This fixture tests inter-squad movement: each squad has one soldier. A single squad could already cross the narrow lane. Before the fix only one of eight arrived, five remained pinned, and none of four arrived in the smaller crowd. The first segment of the group's route doubled back inside its steering distance, so members chased slots through their neighbours.

In new solo land battles, infantry on such an entry turn aim farther along the same route **only when both the lane centre and their offset slot have a clear path**. The lookahead blends back to normal as the group passes the turn. The troops do not teleport, lose their destination, turn off terrain checks, or stop colliding. The save records the formation rule. Old saves and multiplayer do not opt in.

Afterwards all eight arrived on both runs of the original pinch, all four in the smaller crowd, and all eight on the open lane, grid-start control and second pinch. The worst remaining distance to a slot on the original pinch was 18.5 map units (30-unit acceptance radius); none remained pinned. No measured soldier entered a closed cell, took damage, or died. This is not a guarantee for every map, multi-member company or mod. The test emits JSON and Markdown with the lanes, orders and per-squad outcomes; `EW_OUT` sets the output prefix.

## Repeat the playable opening on a low-end machine

From the Universal checkout on the machine to measure, with stock game data mounted at `http://127.0.0.1:8590/`, Chrome available and `playwright-core` resolvable (or `PLAYWRIGHT_CORE` pointing at it):

```
npm run bench:ground-battle -- --out=ground-perf.json
```

This starts a clean, headed browser at 1280×800, unpauses `#ground-offensive` at normal speed and writes the first 15 simulation seconds to JSON. It records animation-frame intervals, `LandWorld.update` elapsed times, death events and machine/backend details. Run unthrottled on real hardware for a hardware result. `--contrast` adds a separate fresh run under synthetic 4× CPU pressure; that is not a substitute for a slower CPU or GPU. For comparison, retain the JSON and use the same stock content, viewport and settings.

One unthrottled desktop run (i7-12700KF, 32 GiB, NVIDIA Ampere WebGPU, Chrome 158) advanced 15 simulation seconds in **15.017 s** of wall time. It recorded 1,478 frame intervals (median 6.215 ms, p95 22.485 ms) and 451 world updates (median 2.800 ms, p95 7.315 ms). Combat deaths occurred; no page error was reported. This measures a 90-unit opening, **not** the stress battle below or physical low-end hardware.

## Large-battle throughput (headless, **not certified**)

`npm run test:lockstep-land -- --report land-lockstep.json` runs the same seeded stock Tatooine battle twice, 24 extra companies per side, 1,800 steps per run. Set `SWR_GAME` to the installed game directory. This fixture deliberately does **not** install solo Rapier movement. It measures whole lockstep turns including orders, Lua and the event-loop yield, not rendering or display FPS. The existing gate is at least 20 ticks/s in the slowest 30-step window; averages and short trials aren't substitutes.

On the i7-12700KF / 32 GiB development machine, the first uninstrumented baseline had a 17.8 ticks/s worst window. CPU sampling found projectile candidate eligibility and formation walking were large costs; path search was not the dominant cost over the full run. Ordinary shots now reject spatially impossible candidates before the eligibility/mesh tests, using ordered, per-batch numeric bounds for crowded cells. Impact callbacks invalidate those bounds. A matched 1,200-step instrumented comparison visited the ordinary-shot eligibility check 16,778,365 times without that filter and 330,241 with it. All 40 checkpoint hashes agreed. Those counts measure work avoided, **not** a frame-rate gain.

The final 1,800-step runs started with 965 units and ended with 678; both matched all 60 checkpoints and the pre-change recording. Their worst windows still fell to **11.6 and 17.4 ticks/s**. The target remains open. The test also checks that tick yields do not leave a growing count of active MessagePorts. Re-run the same fixture on a quiet host and inspect the worst windows, rather than qualifying the build from a favourable single run. No results here certify physical low-end hardware or a live network session.
