# Battle upscaling

Open **Video → Graphics Quality → Image quality**. Scale is a fraction of the selected battle output in **each** dimension, not a multiplier on texture resolution. At 1280×720, 90% renders 1152×648, 67% renders 858×482, and 50% renders 640×360. Each produces a 1280×720 battle image. The DOM HUD and menus are composited separately.

| What you want | What to select |
| --- | --- |
| Highest input detail while still upscaling | **Ultra quality · 90% → AMD FSR 1**, start at **50% sharpness**. |
| Reduce scene work further | Try **77%**, then **67%**, with FSR 1. At 50%, fine detail can disappear before the filter sees it. Reconstruction itself also costs GPU time; lower input resolution is not a guarantee of higher FPS. |
| Sharper native image | **Native + sharpening · 100%** applies RCAS without scaling. Pair with geometry AA or FXAA if desired. This is not DLAA. |
| Classic or soft presentation | **Bicubic** for the previous adjustable filter; **Bilinear** for simple interpolation. **Off · native** bypasses the reconstruction stage entirely and remains the scale default. |
| A different sharp reconstruction | **Lanczos 3** uses a six-by-six source neighborhood, limited to the nearest four colours to reduce ringing. Its sharpness control blends with bilinear. |

## Implementation and limits

- **FSR 1** ports the FP32 EASU and RCAS kernels in [AMD’s MIT-licensed `ffx_fsr1.h`](https://github.com/GPUOpen-Effects/FidelityFX-FSR/blob/a21ffb8f6c13233ba336352bdff293894c706575/ffx-fsr/ffx_fsr1.h) to WebGL 2 fragment shaders and WebGPU WGSL. The port and license notice live in [`public/js/spatialupscale.js`](../public/js/spatialupscale.js). EASU estimates local edge direction from 12 source texels; its output is bounded by the central 2×2 texels. RCAS then sharpens the reconstructed image **at output resolution**. At zero sharpness EASU writes straight to the output, without the extra full-size intermediate or RCAS pass. Native sharpening skips EASU instead.
- Geometry anti-aliasing, FXAA, bloom, contact shading and tactical colour grading run before reconstruction when selected. Texture magnification is a separate material filter. No installed texture or model is changed. An older saved scale and sharpness keep the previous bicubic blend rather than silently switching renderers.
- SDR keeps the game's display-like colour signal. Extended WebGPU output wraps the FSR kernels in a reversible gamma-2 shoulder so values fit their required 0–1 working range. The FSR intermediate stays in that range in FP16; the signal is expanded before the normal HDR display calibration. No display transform is applied twice.
- These are single-frame filters. They do not reconstruct geometry absent from the input, accumulate motion samples, generate frames or use AI. DLSS Super Resolution and DLAA require a supported NVIDIA RTX GPU and a native integration not provided by this renderer. FSR 2 and later temporal paths are not implemented. There is no NVIDIA- or AMD-only requirement for this FSR 1 shader path.

## Verify

Use the mounted Universal host, not a standalone play page. `node tools/check-image-reconstruction.cjs` opens an isolated settings profile, exercises the controls, freezes a real battle camera and compares the same pixels under each filter. Set `LOOK_DOMAIN=land` for Kuat and `LOOK_BACKEND=webgl` for the fallback. The check covers the full-resolution intermediate, output alignment, the sharpening-only and zero-sharpness paths, and restoration of the old filters. `HDR_RECONSTRUCT=1 HDR_FSR=1 node tools/check-universal-hdr.cjs` checks the FP16 render path and extended readback, not physical HDR display performance.
