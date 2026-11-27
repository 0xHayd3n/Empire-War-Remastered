# Native rendering feasibility (appendix)

**Status: research only.** Nothing in this appendix is implemented, planned or shipped, and no app code was changed to produce it. It exists so that requests for “DLSS in the browser build”, “RTX Remix support” or “ray tracing” can be answered with a source-backed answer instead of a guess.

It is an appendix to — and is deliberately separate from — the portable renderer described in [battle upscaling](battle-upscaling.md) and [HDR output](hdr-output.md). Those documents describe WebGL 2 / WebGPU shader paths that run in any Chromium-based host. Everything below requires a *different, native* renderer. The portable renderer’s stated limits (single-frame spatial filters, no motion vectors, no AI reconstruction) are unchanged by this note, and no wording here should be reused as a product claim.

Sources were read from the publishers on 2026-11-25 and are linked in [Sources](#sources). Where a claim is my inference rather than a quoted requirement, it is marked **inference**.

## What the portable renderer actually provides

| Fact | Where it lives | Why it matters below |
| --- | --- | --- |
| Main-thread WebGPU (WGSL) gameplay path, WebGL 2 fallback | [`public/js/gpu/`](../public/js/gpu), [`public/js/game/`](../public/js/game) | Browser-defined API surface; no access to DXGI/D3D12/Vulkan, NGX or a camera the vendor can hook |
| FSR 1 EASU/RCAS only; single-frame, spatial | [`public/js/spatialupscale.js`](../public/js/spatialupscale.js) | No temporal history, no jitter, no motion vectors |
| Depth buffer exists (SSAO, contact shading) | graphics settings path | Depth alone is not enough for DLSS |
| No `motionvector`/motion-vector buffer anywhere in `public/js` | verified by search | DLSS Super Resolution’s core input is absent |
| No projection jitter; camera `jitter()` is screen shake only | [`public/js/game/shooter.js`](../public/js/game/shooter.js) | DLSS expects jitter-free matrices plus a per-frame jitter offset |
| RGBA16F extended canvas for HDR | [`public/js/gpu/renderer.js`](../public/js/gpu/renderer.js), [hdr-output](hdr-output.md) | Format is the *only* piece DLSS would accept as input |
| Desktop build is Tauri 2 hosting Edge **WebView2** | [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json), [`src-tauri/src/report.rs`](../src-tauri/src/report.rs) | The swap chain belongs to WebView2, not to this app |

The distinction that decides everything else: this project renders from game data with its own scene graph. DLSS, NGX and RTX Remix all attach to either a native D3D/Vulkan device or a fixed-function D3D8/D3D9 pipeline. Neither exists here.

## Option A — DLSS / DLAA / Frame Generation via Streamline

Verdict: **not feasible in the portable renderer, and not addable through the Tauri shell.** It is a native renderer rewrite plus a new integration.

Streamline (SL) 2.14.16 is NVIDIA’s cross-vendor super-resolution framework: the game links `sl.interposer.dll` *instead of* `d3d11.dll` / `d3d12.dll` / `dxgi.dll`, or takes `vkGetInstanceProcAddr`/`vkGetDeviceProcAddr` through it. Every requirement below therefore presupposes a native device and a present the app owns.

| Requirement (as published) | Consequence here |
| --- | --- |
| GPU supporting DirectX 11 **and** Vulkan 1.2+; Windows 10 20H1+; NVIDIA driver 512.15+ | The browser build has none of these entry points |
| SL interposes `d3d11/d3d12/dxgi/vulkan-1`; Vulkan needs `slSetVulkanInfo` | WebGPU hides the device; nothing to interpose |
| DLSS SR needs **depth, motion vectors, render-resolution colour in and final-resolution colour out** | Only colour exists |
| All SL matrices row-major and **must not contain jitter offsets**; jitter offsets supplied separately in pixel space; motion-vector scale normalised to `{-1,1}` | No jitter convention or motion-vector buffer to match |
| Optional exposure texture; auto-exposure otherwise | Not authored |
| DLSS-G (frame generation) additionally needs HUD-less colour, per-frame tagged resources valid at present, Reflex integrated, a **Streamline proxy swap chain**, and Windows **hardware-accelerated GPU scheduling** enabled | Requires owning `Present` — impossible under WebView2 |
| Streamline supports D3D11, D3D12 and Vulkan only | The original *Empire at War* is a DirectX 9 title, so SL cannot attach to the classic game either |

Hardware notes that survive even a native rewrite: the DLSS suite is described by NVIDIA as Tensor-Core technologies, Multi Frame Generation is stated as GeForce RTX 50 Series (fifth-generation Tensor Cores), and the DLSS-G guide asks testers to “set up a machine with an **Ada** board” (RTX 40). **Inference:** on this checkout’s RTX 3070 (Ampere), Super Resolution, DLAA and Ray Reconstruction are plausible; Frame Generation is not. Confirm per adapter with `slIsFeatureSupported`, never by model name.

What a native path would need, in order: a D3D12 or Vulkan renderer for this engine’s geometry; CPU-side camera/projection data exported per view; per-object previous-frame transforms for motion vectors (the scene graph already holds transforms, so this is tractable); TAA-style jitter in the projection; a swap chain the app owns; then SL. That is a renderer, not a setting. The browser build keeps FSR 1 and says so.

## Option B — RTX Remix

Verdict: **not a feature of this engine; a competing way to remaster the original *native* game.** Remix cannot be aimed at a WebGPU scene.

NVIDIA’s own compatibility page is the gate: Remix is “designed for DirectX 8 and 9 games that use a fixed function pipeline”, is “unlikely to work with other types of games”, and later shader-pipeline games lead to incompatibility. It works by capturing fixed-function draw data, rebuilding the scene and path tracing it; there is only experimental support for simple vertex shaders, and a mixed fixed-function/shader title may get “only the fixed function parts” enhanced. Remix replaces DirectX 9 and does not directly support OpenGL or older DirectX.

Local evidence about the target game: the installed Forces of Corruption asset tree ships compiled shaders at `DATA/ART/SHADERS` (`BATCHMESHALPHA.FXO`, `GRASS.FXO`, `MESHLIGHTVISUALIZE.FXO`; from the local decompiled-asset copy on this machine, not from this repo). A shader directory of that shape is consistent with a mixed DX9 title rather than a pure fixed-function one. **Inference:** expect partial interception and missing effects, not a clean remaster. This must be settled empirically, not argued — see [How to test](#how-to-test).

Remix requirements are also a floor no portable path meets: Windows 10/11, **any RTX GPU** minimum, RTX 4070 / 12 GB / 32 GB RAM recommended. Remix itself injects path tracing, DLSS and Reflex into the native game — so “DLSS support” for the classic game already exists *through Remix*, independent of this project.

Relevant to expectations: a Remix mod changes the *original* executable’s look on RTX hardware. It does not give this browser engine ray tracing, and it does not reuse this engine’s asset loader, UI or netcode.

## Option C — hand-written ray tracing / ray-marched lighting in the portable renderer

This is the only native-feature-adjacent option that stays inside the existing product, and it stays *approximate*: screen-space AO, screen-space reflections, analytic sun shadows, or compute ray marching against height/SDF data. Those are shader work in WGSL, not a vendor feature, and they do not require anything in this appendix. Nothing here justifies calling such work “ray tracing” in player-facing copy; the existing settings note already draws that line ([universal library](universal-library.md)).

## WebGPU ray tracing baseline vs native

Verdict: **WebGPU has no ray tracing API today.** Native APIs have had one for years.

| | WebGPU (what this app can use) | Native |
| --- | --- | --- |
| Spec status for ray tracing | Absent. The W3C Candidate Recommendation Draft (2026-11-16) contains **zero** occurrences of “ray”/“rays” and no `GPURayTracing*` interface at all | Mature: D3D12 DXR, `VK_KHR_ray_tracing`/`ray_query`, Metal acceleration structures |
| Acceleration structures (BVH/TLAS) | Not exposed. Tracked by gpuweb issue #11053 and an acceleration-structure proposal pull request opened 2026-10-13; still open, and reviewers are still debating build flags, batching and CPU-side TLAS overhead | Core to the above |
| Hardware traversal, any-hit/intersection shaders, denoisers | Not exposed | Available; DLSS Ray Reconstruction replaces hand-tuned denoisers |
| What the baseline does give | Raster + compute only: depth-prepass tricks, screen-space GI/AO, compute ray marching with your own spatial structure, and `rgba16float` output (already used for HDR) | — |

The generic ray-tracing request has been open on the WebGPU tracker since 2020 (issue #535) and is still open, with the acceleration-structure piece only reaching a proposal in late 2026. **Inference:** even a best case would be a multi-year gap between proposal and a shipped, cross-browser API with a usable browser path — and it would still leave GPU vendor SDKs (NGX/Streamline) outside the browser sandbox.

That last point is the structural one: ray tracing in the browser would be a WebGPU API for *traversal*. DLSS is a driver-side SDK that consumes a native swap chain. They are different problems, and only the first could ever be portable.

## Decision summary

| Option | Gate | Reversible? | Recommendation |
| --- | --- | --- | --- |
| DLSS/DLAA in the shipped browser build | Needs native D3D12/Vulkan device + swap chain + motion vectors + jitter | n/a — never existed | Do not promise. Keep the documented FSR 1 wording |
| Streamline behind the Tauri shell | WebView2 owns composition; SL needs `Present` | n/a | Do not attempt; a proxy compositor is not a setting |
| Native RTX renderer for this engine | New renderer, per-view motion vectors, app-owned swap chain | Large, but self-contained if built as a separate app | Only as a separate experimental target, never as a browser option |
| RTX Remix mod of the classic game | Fixed-function DX8/9 compatibility; RTX GPU | Independent of this repo | Treat as its own product line; test before promising |
| WGSL screen-space / compute lighting | Shader only | Fully | Fair game, but never label it RTX or ray tracing |

## How to test

No browser runs, no engine changes. Each step tests the claim, not the doc.

1. **Remix compatibility of the classic game.** Apply the public Remix runtime to the retail install, enable the runtime log, and check how many draw calls are intercepted versus skipped, then compare one scene. Absence of a shader-compatible scene means the answer is no.
2. **DLSS on this machine.** In any Streamline-integrated title, or via `slIsFeatureSupported` in a test harness, check DLSS SR / DLAA / DLSS-G availability for the adapter. Expect SR/DLAA yes on the 3070 and DLSS-G no; that confirms the hardware inference above.
3. **WebGPU baseline.** In a Chromium host, confirm no acceleration-structure or ray-tracing members exist on the device/limits surface — matching the spec check above rather than any blog.
4. **Renderer input audit.** Re-run the motion-vector and jitter searches under `public/js` before repeating the “no temporal inputs” claim.

## Sources

Read 2026-11-25.

- Streamline SDK README (2.14.16) — hardware/OS/driver prerequisites, interposer use: <https://github.com/NVIDIAGameWorks/Streamline/blob/main/README.md>
- Streamline Programming Guide — API surface, Vulkan/`slSetVulkanInfo`, `slInit`: <https://github.com/NVIDIAGameWorks/Streamline/blob/main/docs/ProgrammingGuide.md>
- Streamline DLSS Super Resolution guide — depth/motion-vector/colour tagging, matrices free of jitter, motion-vector scale, presets: <https://github.com/NVIDIAGameWorks/Streamline/blob/main/docs/ProgrammingGuideDLSS.md>
- Streamline DLSS Frame Generation guide — HUD-less buffers, proxy swap chain, Reflex, HWS, Ada test machine: <https://github.com/NVIDIAGameWorks/Streamline/blob/main/docs/ProgrammingGuideDLSS_G.md>
- NVIDIA DLSS developer page — Tensor Cores, MFG on RTX 50 Series, Ray Reconstruction: <https://developer.nvidia.com/rtx/dlss>
- RTX Remix repository README — fixed-function DirectX 8/9 scope, path tracing/DLSS/Reflex injection: <https://github.com/NVIDIAGameWorks/rtx-remix>
- RTX Remix — Game Compatibility (fixed function vs shaders, DX9 only, experimental vertex-shader support): <https://docs.omniverse.nvidia.com/kit/docs/rtx_remix/latest/docs/introduction/intro-compatibility.html>
- RTX Remix — Technical Requirements (Windows, any RTX GPU, RTX 4070/12 GB recommended): <https://docs.omniverse.nvidia.com/kit/docs/rtx_remix/latest/docs/introduction/intro-requirements.html>
- dxvk-remix README — the DXVK fork that implements the fixed-function pipeline the runtime above relies on: <https://github.com/NVIDIAGameWorks/dxvk-remix>
- W3C WebGPU Candidate Recommendation Draft, 2026-11-16 — searched for ray-tracing API surface; none present: <https://www.w3.org/TR/webgpu/>
- gpuweb issue #535 “Ray Tracing extension” — open since 2020-01-06: <https://github.com/gpuweb/gpuweb/issues/535>
- gpuweb issue #11053 and PR #11054 “Add proposal for acceleration structure” — opened 2026-10-13, still open: <https://github.com/gpuweb/gpuweb/issues/11053>, <https://github.com/gpuweb/gpuweb/pull/11054>
