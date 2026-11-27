### Environment

- Platform: win32 10.0.26300 (x64); 12th Gen Intel(R) Core(TM) i7-12700KF (20 logical cores); 34.2 GB RAM
- Node v22.17.0 (V8 12.4.254.21-node.26); single-threaded, no worker threads
- Rapier `@dimforge/rapier3d-compat` 0.17.3, ES build the game vendors (`rapier.es.js`, base64-inlined WASM); WebAssembly instantiate calls at init: 2
- Jolt `jolt-physics` 1.1.2, `wasm-compat` build (base64-inlined WASM); WebAssembly instantiate calls at init: 1
- Timestep 0.016667 s (game STEP = 1/60); 5 rounds, median of per-round medians/p95s; engine order alternated per round
- Scene: density 1, friction 0.85 / restitution 0.24 on body *and* ground (equal values so any combine rule agrees), linear damping 0, angular damping 0.45, CCD on (Rapier CCD / Jolt LinearCast), Z-up, land gravity 0,0,-100, space gravity 0,0,0
- Windows: zero-g drift = 150 warm-up + 250 timed steps; rubble impact = 12 warm-up + 60 timed steps; rubble at rest = 240 warm-up + 150 timed steps

### Headline (median step time, ms; both engines at their library defaults)

| workload | bodies | Rapier | Jolt | Jolt/Rapier |
| --- | ---: | ---: | ---: | ---: |
| zero-g drift | 64 | 0.090 | 0.050 | 0.56x |
| zero-g drift | 256 | 0.433 | 0.225 | 0.52x |
| rubble impact | 64 | 0.881 | 0.468 | 0.53x |
| rubble impact | 256 | 3.887 | 2.245 | 0.58x |
| rubble at rest | 64 | 0.472 | 0.199 | 0.42x |
| rubble at rest | 256 | 2.081 | 1.276 | 0.61x |

Solver variants measured:

- `jolt-4v1p-probe` — Rapier 4 solver / 1 PGS / 4 friction iters; Jolt 4 velocity / 1 position steps; sleeping off; CCD on. Jolt at Rapier iteration budget; under-resolved on this scene (loses 1-2 bodies through the trimesh in some runs)
- `library-defaults` — Rapier 4 solver / 1 PGS / 4 friction iters; Jolt 10 velocity / 2 position steps; sleeping off; CCD on
- `defaults+sleep` — Rapier 4 solver / 1 PGS / 4 friction iters; Jolt 10 velocity / 2 position steps; sleeping on; CCD on
- `noccd-probe` — Rapier 4 solver / 1 PGS / 4 friction iters; Jolt 10 velocity / 2 position steps; sleeping off; CCD off. CCD off, otherwise library defaults; only valid for zero-g drift (bodies tunnel through the ground with CCD off in both engines)

Robustness: 14 of 200 runs ended with bodies below the ground mesh (Rapier 0, Jolt 14; by variant {"jolt-4v1p-probe":13,"library-defaults":0,"defaults+sleep":1,"noccd-probe":0}). Dropping those runs changes the primary `library-defaults` medians by at most 0.0%.

### Seeded start state identical in both engines (max abs error before stepping)

| scene | engine | max pos err | max linvel err | max angvel err |
| --- | --- | ---: | ---: | ---: |
| rubble x256 | rapier | 0.00000128 | 0.00000102 | 8.14e-8 |
| rubble x256 | jolt | 0.00000128 | 0.00000102 | 8.14e-8 |
| fleet x256 | rapier | 0.0000014 | 5.91e-7 | 8.25e-8 |
| fleet x256 | jolt | 0.0000014 | 5.91e-7 | 8.25e-8 |

### Step time (ms per physics step)

| workload | bodies | solver config | engine | median | p95 | mean | awake / bodies | moving>0.5 u/s | mean speed | mean z | fell through ground |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zero-g drift | 64 | jolt-4v1p-probe (secondary) | rapier | 0.089 | 0.127 | 0.093 | 64 / 64 | 64 | 7.71 | -5.4 | — |
| zero-g drift | 64 | jolt-4v1p-probe (secondary) | jolt | 0.049 | 0.064 | 0.052 | 64 / 64 | 64 | 7.69 | -5.4 | — |
| zero-g drift | 64 | library-defaults | rapier | 0.090 | 0.126 | 0.094 | 64 / 64 | 64 | 7.71 | -5.4 | — |
| zero-g drift | 64 | library-defaults | jolt | 0.050 | 0.073 | 0.053 | 64 / 64 | 64 | 7.68 | -5.3 | — |
| zero-g drift | 64 | defaults+sleep (secondary) | rapier | 0.092 | 0.160 | 0.096 | 64 / 64 | 64 | 7.71 | -5.4 | — |
| zero-g drift | 64 | defaults+sleep (secondary) | jolt | 0.061 | 0.096 | 0.066 | 64 / 64 | 64 | 7.68 | -5.3 | — |
| zero-g drift | 64 | noccd-probe (secondary) | rapier | 0.061 | 0.076 | 0.067 | 64 / 64 | 64 | 7.71 | -5.4 | — |
| zero-g drift | 64 | noccd-probe (secondary) | jolt | 0.045 | 0.064 | 0.049 | 64 / 64 | 64 | 7.68 | -5.3 | — |
| zero-g drift | 256 | jolt-4v1p-probe (secondary) | rapier | 0.450 | 0.569 | 0.454 | 256 / 256 | 256 | 7.32 | -7.5 | — |
| zero-g drift | 256 | jolt-4v1p-probe (secondary) | jolt | 0.248 | 0.328 | 0.261 | 256 / 256 | 256 | 7.30 | -7.4 | — |
| zero-g drift | 256 | library-defaults | rapier | 0.433 | 0.583 | 0.446 | 256 / 256 | 256 | 7.32 | -7.5 | — |
| zero-g drift | 256 | library-defaults | jolt | 0.225 | 0.300 | 0.235 | 256 / 256 | 255 | 7.26 | -7.4 | — |
| zero-g drift | 256 | defaults+sleep (secondary) | rapier | 0.440 | 0.636 | 0.467 | 256 / 256 | 256 | 7.32 | -7.5 | — |
| zero-g drift | 256 | defaults+sleep (secondary) | jolt | 0.272 | 0.387 | 0.287 | 256 / 256 | 255 | 7.26 | -7.4 | — |
| zero-g drift | 256 | noccd-probe (secondary) | rapier | 0.265 | 0.365 | 0.280 | 256 / 256 | 256 | 7.32 | -7.5 | — |
| zero-g drift | 256 | noccd-probe (secondary) | jolt | 0.205 | 0.280 | 0.219 | 256 / 256 | 255 | 7.26 | -7.4 | — |
| rubble impact | 64 | jolt-4v1p-probe (secondary) | rapier | 0.708 | 2.975 | 1.228 | 64 / 64 | 27 | 1.78 | 1.0 | 0 |
| rubble impact | 64 | jolt-4v1p-probe (secondary) | jolt | 0.485 | 0.594 | 0.438 | 64 / 65 | 19 | 2.18 | 0.7 | 1 |
| rubble impact | 64 | library-defaults | rapier | 0.881 | 3.310 | 1.261 | 64 / 64 | 29 | 2.03 | 1.0 | 0 |
| rubble impact | 64 | library-defaults | jolt | 0.468 | 0.623 | 0.435 | 64 / 65 | 20 | 1.43 | 1.0 | 0 |
| rubble impact | 64 | defaults+sleep (secondary) | rapier | 0.770 | 3.263 | 1.260 | 64 / 64 | 29 | 2.03 | 1.0 | 0 |
| rubble impact | 64 | defaults+sleep (secondary) | jolt | 0.492 | 0.629 | 0.453 | 59 / 65 | 20 | 1.26 | 1.0 | 0 |
| rubble impact | 256 | jolt-4v1p-probe (secondary) | rapier | 3.783 | 8.679 | 4.477 | 256 / 256 | 89 | 1.05 | 1.2 | 0 |
| rubble impact | 256 | jolt-4v1p-probe (secondary) | jolt | 2.270 | 2.748 | 2.045 | 256 / 257 | 46 | 0.96 | 1.0 | 2 |
| rubble impact | 256 | library-defaults | rapier | 3.887 | 8.793 | 4.494 | 256 / 256 | 89 | 1.05 | 1.2 | 0 |
| rubble impact | 256 | library-defaults | jolt | 2.245 | 2.723 | 1.967 | 256 / 257 | 53 | 0.62 | 1.2 | 0 |
| rubble impact | 256 | defaults+sleep (secondary) | rapier | 3.981 | 8.832 | 4.702 | 256 / 256 | 89 | 1.05 | 1.2 | 0 |
| rubble impact | 256 | defaults+sleep (secondary) | jolt | 2.467 | 2.737 | 2.121 | 241 / 257 | 51 | 0.60 | 1.1 | 0 |
| rubble at rest | 64 | jolt-4v1p-probe (secondary) | rapier | 0.479 | 0.597 | 0.494 | 64 / 64 | 0 | 0.02 | 0.9 | 0 |
| rubble at rest | 64 | jolt-4v1p-probe (secondary) | jolt | 0.233 | 0.310 | 0.249 | 64 / 65 | 1 | 7.81 | -25.8 | 1 |
| rubble at rest | 64 | library-defaults | rapier | 0.472 | 0.563 | 0.491 | 64 / 64 | 0 | 0.02 | 0.9 | 0 |
| rubble at rest | 64 | library-defaults | jolt | 0.199 | 0.273 | 0.213 | 64 / 65 | 0 | 0.00 | 0.9 | 0 |
| rubble at rest | 64 | defaults+sleep (secondary) | rapier | 0.068 | 0.098 | 0.073 | 6 / 64 | 0 | 0.00 | 0.9 | 0 |
| rubble at rest | 64 | defaults+sleep (secondary) | jolt | 0.000 | 0.051 | 0.007 | 0 / 65 | 0 | 0.00 | 0.9 | 0 |
| rubble at rest | 256 | jolt-4v1p-probe (secondary) | rapier | 2.101 | 2.395 | 2.126 | 256 / 256 | 1 | 0.03 | 1.1 | 0 |
| rubble at rest | 256 | jolt-4v1p-probe (secondary) | jolt | 1.337 | 1.637 | 1.378 | 256 / 257 | 1 | 1.96 | -5.6 | 1 |
| rubble at rest | 256 | library-defaults | rapier | 2.081 | 2.375 | 2.115 | 256 / 256 | 1 | 0.03 | 1.1 | 0 |
| rubble at rest | 256 | library-defaults | jolt | 1.276 | 1.619 | 1.315 | 256 / 257 | 0 | 0.00 | 1.1 | 0 |
| rubble at rest | 256 | defaults+sleep (secondary) | rapier | 0.459 | 0.708 | 0.472 | 26 / 256 | 0 | 0.01 | 1.1 | 0 |
| rubble at rest | 256 | defaults+sleep (secondary) | jolt | 0.319 | 0.482 | 0.328 | 20 / 257 | 0 | 0.00 | 1.1 | 0 |

### Jolt / Rapier step-time ratio (median, p95)

| workload | bodies | solver config | median ratio | p95 ratio |
| --- | ---: | --- | ---: | ---: |
| zero-g drift | 64 | jolt-4v1p-probe | 0.55x | 0.50x |
| zero-g drift | 64 | library-defaults | 0.56x | 0.58x |
| zero-g drift | 64 | defaults+sleep | 0.66x | 0.60x |
| zero-g drift | 64 | noccd-probe | 0.74x | 0.83x |
| zero-g drift | 256 | jolt-4v1p-probe | 0.55x | 0.58x |
| zero-g drift | 256 | library-defaults | 0.52x | 0.51x |
| zero-g drift | 256 | defaults+sleep | 0.62x | 0.61x |
| zero-g drift | 256 | noccd-probe | 0.77x | 0.77x |
| rubble impact | 64 | jolt-4v1p-probe | 0.69x | 0.20x |
| rubble impact | 64 | library-defaults | 0.53x | 0.19x |
| rubble impact | 64 | defaults+sleep | 0.64x | 0.19x |
| rubble impact | 256 | jolt-4v1p-probe | 0.60x | 0.32x |
| rubble impact | 256 | library-defaults | 0.58x | 0.31x |
| rubble impact | 256 | defaults+sleep | 0.62x | 0.31x |
| rubble at rest | 64 | jolt-4v1p-probe | 0.49x | 0.52x |
| rubble at rest | 64 | library-defaults | 0.42x | 0.49x |
| rubble at rest | 64 | defaults+sleep | 0.01x | 0.52x |
| rubble at rest | 256 | jolt-4v1p-probe | 0.64x | 0.68x |
| rubble at rest | 256 | library-defaults | 0.61x | 0.68x |
| rubble at rest | 256 | defaults+sleep | 0.69x | 0.68x |