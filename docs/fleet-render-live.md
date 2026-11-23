# Why does the main draw take longer in Revan’s Revenge?

In [frozen battles](fleet-render-passes.md), hiding ships saved about 9.4 ms inside Revan’s main-scene render call but only about 4 ms through GPU completion. This follow-up uses **moving** stock and Revan battles. It measures the complete normal main-scene draw, not a ship-on/ship-off delta. No runtime rendering or graphics setting was changed.

## Results and decision

**Both causes show up.** Revan spent more CPU time preparing and issuing draws, and Chrome repeatedly waited for space in its graphics command queue. On this machine a JavaScript-only change cannot account for all the time, and a queue wait is not evidence that shadow quality should be reduced.

Chrome 157, RTX 3070 (ANGLE/D3D11), full detail. Eight serial sessions: two traced and two untraced for each workload. The ranges below are the two run medians, **not** confidence intervals; frame counts are totals across the two traced runs.

| Main-scene measurement | Stock FoC | Revan’s Revenge |
|---|---:|---:|
| Elapsed with profiler | 2.56–3.01 ms | 13.79–14.13 ms |
| Elapsed without profiler | 2.53–2.64 ms | 13.30–14.12 ms |
| Renderer thread on CPU (traced) | 2.54–2.98 ms | 7.69–8.13 ms |
| Renderer thread off CPU (traced) | 0.08–0.10 ms | 5.93–5.99 ms |
| Explicit command-buffer wait (traced) | 0.00 ms | 5.69–5.72 ms |
| Draws with a matching wait | 2 / 560 frames | 445 / 445 frames |
| Main-scene draw calls per frame (traced) | 146–152 | 873–1,012 |

The long Revan draw persisted without tracing. Its explicit queue waits occupied about 5.7 ms per draw and closely tracked the thread's off-CPU time; these are overlapping measurements, **not** 11.7 ms of overhead. The V8 profiler also sampled traversal, state/uniform preparation and WebGL calls, but cannot say how much on-CPU time each caused. Nor does the trace identify whether GPU execution or GPU-process scheduling freed the queue. Neither measurement is a recoverable FPS gain.

**Follow-up:** the [main-scene draw census](fleet-draw-census.md) identifies the dominant individual ship parts and checks their live material and bone state. Test a batching change only if it preserves materials, transparency order, animation and the visible output; compare untraced frame intervals as well as draw counts against stock and Revan. Don't change shadow or effect settings on the basis of this trace.

## How to reproduce

From `universal`, with the [same local Chrome, Playwright and owned-install prerequisites](fleet-render.md#reproduce):

```sh
node tools/bench-space-render.cjs --live                       # stock; trace on
node tools/bench-space-render.cjs --live --primary 3417277973   # Revan; trace on
node tools/bench-space-render.cjs --live --primary 3417277973 --untraced
npm run test:universal                                        # synthetic trace-reduction checks included
```

Run one browser at a time. `--live` defaults to a 1920×1080 drawing buffer and requires hardware/support for the normal shared-memory collection workers; it rejects a silent fallback to local simulation or no collection pool. The untraced control keeps the camera, browser timing hooks and game's own diagnostics, but does not start Chrome tracing or the V8 profiler. No screenshots, assets, event arguments, stacks, per-unit coordinates or raw DevTools profiles are written to disk. [Per-run aggregates (JSON Lines)](fleet-render-live.jsonl) include p50/p95, fleet sizes and worker evidence.

## Method and limits

- Normal game animation loop and battle worker; scripts, warm-up, particle updates and collection workers enabled. No `readPixels`, `finish`, deliberate delay, hiding ships, render-only stepping or substituted RNG. The game's `benchmark=40` mode exercises real movement and weapons but does **not** run the strategic skirmish AI; it is not the F2 profiler in a regular match. An Empire vs Rebel battle requests Kuat; stock uses Kuat and Revan uses its Atravis fallback. Hold the rig on approach and move it along the same arc by **simulation** time from 8 to 14 seconds. The fleets are different workloads, not deterministic replays. How many browser frames fit in this window varies.
- Record applied simulation messages, fleet and projectile counts at each boundary, how many surviving ships moved by more than one world unit, the number of live collection worker objects, and jobs submitted by the collector. The page thread can also claim jobs; a pool of four does not imply four busy cores. Report actual RAF intervals separately from draw times. These are local headless-Chrome diagnostics, not desktop gameplay FPS.
- Bracket only `WebGLRenderer.render(mainScene, camera)` with trace markers, **after** the separate shadow draw and the fleet collector. Chrome thread timestamps at the two markers give **page-thread CPU** (JavaScript **and** native renderer/driver work). Elapsed minus thread CPU, computed per frame, includes descheduling as well as blocking. It cannot identify a wait reason by itself.
- Intersect synchronous Chromium command-buffer wait scopes with each draw **on the same renderer thread**: `WaitForAvailableEntries`, `WaitForGetOffset`/`WaitForToken`, `WaitForCmd`. Union overlapping intervals; exclude plain flushes, ordering barriers, other threads and gaps between draws. This measures elapsed time within explicit queue waits, not GPU execution time. It can overlap thread CPU. Names are Chrome-version-dependent; zero means *no matching wait observed*.
- The 500 µs V8 sampler provides only rough leaf categories (e.g. traversal/sorting, material uploads/state, native WebGL). A sample inside a WebGL call need not represent on-CPU JavaScript. Whole-frame GPU measurements use the game's existing asynchronous GPU timer, not a nested query: completions at the window edges may refer to adjacent frames. It isn't a main-scene-only timer. Neither the wait durations nor whole-frame GPU times can be added to thread CPU as independent costs.
