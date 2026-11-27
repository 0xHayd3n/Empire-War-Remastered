# Three.js showcase reference — @0xca0a "making WebGL look good"

Sourced notes on <https://x.com/0xca0a/status/1625177704323596305/video/1>.
No code in this repo was changed. Everything below was checked against the
live post, the deployed demo and its source map on 2026‑11‑25.

## What the post is

| Item | Value |
| --- | --- |
| Author | ☄︎ `@0xca0a` = Paul Henschel / `drcmda` (R3F, Zustand, react‑spring), per profile + <https://github.com/sponsors/drcmda> |
| Posted | 2023‑02‑13 16:58:53 UTC |
| Text | "Mini tutorial on making WebGL look ✨ good ✨ … 🔑 SRGB, Gamma & tonemapping 🔐 Env maps and good lighting" |
| Media | video id `1625154556840509441`, 31.166 s, 60 fps, silent; source 2546×1536, rendition checked 1192×720 |
| Deployed demo | <https://csb-lwo219-oegdjlwa3-drcmda.vercel.app/> |
| Sandbox | <https://codesandbox.io/s/building-live-envmaps-lwo219> (CodeSandbox now Cloudflare‑gated; not readable) |
| Recovered source | `App.js` from the deployed build's `main.91eac648.js.map` (see "Provenance") |

The t.co links resolve to the Vercel deployment, the CodeSandbox, the author's
GitHub Sponsors page and the three.js color‑management docs. The deployment is
still up; `/911-transformed.glb` (3.46 MB) and the JS source map are still served.

## What the video actually shows

Extracted frames (0.1 s → 30.9 s) show **one continuous shot**: a Porsche 911
Carrera 4S GLB, static except for a slow camera orbit, on a purple/magenta
gradient backdrop, with a red rim/accent reflection running along the roofline
and upper body, a bright key reflection on the hood, and a soft contact shadow.
There are no captions, no before/after split and no UI in the video. It is a
showcase of the finished look, not an explanation of the steps.

The thread's other clips (lighting comparisons, "DOM as environment") are
separate demos and are *not* the sandbox above.

## Provenance (verified vs inferred)

- **Verified**: post text, author, date, media id/duration via the syndication
  API (`api.fxtwitter.com/0xca0a/status/1625177704323596305`); video frames via
  `ffmpeg`; demo HTML/assets via `curl`; `App.js` via the deployed source map.
- **Verified**: the deployed bundle contains three.js `REVISION "149"`, so the
  color‑management API in the tweet's screenshots is r149‑era.
- **Inferred**: the exact per‑frame GPU cost (six cube renders + PMREM per
  frame) follows from the three r149 code paths cited below; it was not profiled.
- **Not done**: the demo was not executed in a browser here, so no runtime FPS
  or visual comparison was measured.

## Techniques in the real source (`App.js`)

1. **Canvas / tone mapping.** R3F `<Canvas shadows camera={{ position: [5,0,15], fov: 30 }}>`;
   drei/R3F set ACES‑filmic tone mapping and sRGB output by default. Plus a
   `spotLight` (intensity 2, penumbra 1, `shadow-bias={-0.0001}`) and
   `ambientLight` 0.5.
2. **Painted HDR environment, rebuilt every frame.**
   ```jsx
   <Environment frames={degraded ? 1 : Infinity} resolution={256} background blur={1}>
     <Softboxes />
   </Environment>
   ```
   `Environment` (drei 9.x) portals its children into a private scene and renders
   it with a `CubeCamera` into a `WebGLCubeRenderTarget` of `resolution` 256,
   `HalfFloatType`, then assigns that cube texture to `scene.environment`
   (and `scene.background` when `background` is set). `frames={Infinity}` makes
   it update every frame.
3. **`Lightformer` = a light‑painted softbox.** Each one is a plane/ring/circle
   mesh with `meshBasicMaterial` (`toneMapped={false}`), colour multiplied by
   `intensity`, optionally aimed at a `target`. Intensities above 1 push the
   colour into HDR so it reads as a light source in reflections. In the app they
   are never visible directly — only through the cube camera.
4. **The actual rig (`Softboxes`)** is richer than the tweet's code screenshot:
   - ceiling panel `[0,5,−9]`, scale 10×10, intensity 0.75;
   - a group of eight `circle` formers at y=4 that scroll in +z and wrap
     (`> 20 → −60`), giving moving highlights;
   - two tall side strips at x=−5 (intensity 4 and 1) and one at x=+10;
   - a red `ring` at `[−15,4,−18]` inside `<Float speed={5} floatIntensity={2}
     rotationIntensity={2}>`, aimed at the origin — this is the red rim;
   - a 100‑unit `sphereGeometry` with `lamina` `LayerMaterial`
     (`Color "#444"` + `Depth colorA="blue" colorB="black" near 0 far 300`).
     That gradient sphere is the backdrop **and** part of the lighting, because
     it lives in the same environment scene.
5. **Material tuning of the GLB** (`applyProps`): paint `envMapIntensity 2`,
   roughness 0.45, metalness 0.8, colour `#555`; clearcoat `envMapIntensity 4`,
   roughness 0.5, metalness 1; windows black, roughness 0, clearcoat 0.1; rubber
   colour `#222`, normalScale 4.
6. **Shadows.** `AccumulativeShadows frames={100} alphaTest={0.9} scale={10}` with
   `RandomizedLight amount={8} radius={10} ambient={0.5}` — progressive,
   accumulated soft shadow rather than a single shadow map.
7. **Graceful degradation.** `PerformanceMonitor onDecline={() => degrade(true)}`
   switches the env from `Infinity` to `1` (static, one render).
8. **Camera.** `CameraRig` lerps the camera on a circle
   (`sin(t/5)`, `12 + cos(t/5)/2`) and looks at the origin — the orbit in the video.

## Vanilla three.js equivalent (the post's own pointer)

The thread points vanilla users at:

- `examples/jsm/environments/RoomEnvironment.js` — a `Scene` of emissive boxes and
  a point light (<https://github.com/mrdoob/three.js/blob/r150/examples/jsm/environments/RoomEnvironment.js>).
- `PMREMGenerator.fromScene(environment)` — e.g.
  <https://github.com/mrdoob/three.js/blob/r150/examples/webgl_loader_gltf_sheen.html#L84-L88>:
  ```js
  const environment = new RoomEnvironment();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(environment).texture;
  ```
  `RoomEnvironment` is exactly the "add planes/circles and crank their RGB above
  0–1 for intensity" idea, at the cost of more setup than `Lightformer`.

The tweet's screenshot is a **simplified illustration**, not the app source: it
shows only three formers (`rect` 2 @ [−5,1,−1], `ring` 2 @ [−5,−1,−1],
`circle` 4 @ [10,1,0]) and omits the scrolling ceiling rig, the red `Float` ring
and the gradient sphere.

## Colour management (and what has changed since)

The post's r149 snippet:

```js
THREE.ColorManagement.enabled = true
THREE.ColorManagement.legacyMode = false   // deprecated in 0.150.0
renderer.outputEncoding = THREE.sRGBEncoding
renderer.toneMapping = THREE.ACESFilmicToneMapping
```

Modern three.js (≥ r152/r155) equivalents:

```js
THREE.ColorManagement.enabled = true        // default since r152
renderer.outputColorSpace = THREE.SRGBColorSpace  // default since r152
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.useLegacyLights = false            // default since r155
```

Verified in the three.js release notes: r152 "Replace `outputEncoding` with
`outputColorSpace`", "ColorManagement – Enable by default"; r155 "Deprecate
`useLegacyLights`, change default to `false`". Copying the tweet's snippet
verbatim into a current project is wrong twice over, and light intensities
authored under legacy lights will look different.

## Caveats / don't over‑copy

- **"Infinite lights for free" is per‑light, not per‑frame.** The cost is the
  environment pass: six cube‑face renders at 256² plus a PMREM convolution every
  frame. In r149, `CubeCamera.update()` sets `needsPMREMUpdate = true`, and
  `WebGLCubeUVMaps` re‑runs `PMREMGenerator.fromCubemap()` on the next use
  (`src/cameras/CubeCamera.js`, `src/renderers/webgl/WebGLCubeUVMaps.js`). Cost
  scales with the *environment scene's* geometry/shaders, not with light count.
  `frames={1}` pays it once; `Infinity` pays it continuously and can hitch on
  mobile — hence the `PerformanceMonitor` fallback.
- **`blur` only blurs the background,** not the environment lighting
  (`scene.backgroundBlurriness`). Reflection softness comes from material
  roughness + PMREM mips.
- **HDR needs a float target.** Intensities >1 only survive because drei uses
  `HalfFloatType` for the cube render target. A default `UnsignedByteType` target
  clips them.
- **The tweet's code image ≠ the demo.** Use the recovered `App.js` for the real
  rig; the screenshot is illustrative.
- **API/unit drift** (above): r149‑era settings and light intensities are not
  drop‑in on current three.js.
- **Asset licence.** `App.js` credits the model: Karol Miklas,
  "(FREE) Porsche 911 Carrera 4S",
  <https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf>,
  **CC‑BY‑SA‑4.0**. Attribution and share‑alike apply; do not ship the GLB or a
  derived asset without complying. The technique (env‑map light painting) is not
  the licensed part; the model is.
- **Build exposure.** The deployed CRA build still serves `main.js.map` and the
  full original `App.js`, which is how this trace was possible — useful, but not
  something to ship in production.

## Primary sources

1. Post: <https://x.com/0xca0a/status/1625177704323596305>
2. Video: `https://video.twimg.com/ext_tw_video/1625154556840509441/pu/vid/1192x720/lfvbrMY1PucIaicu.mp4?tag=12`
3. Deployed demo: <https://csb-lwo219-oegdjlwa3-drcmda.vercel.app/>
4. Recovered source: `/static/js/main.91eac648.js.map` → `App.js` (same origin)
5. Code screenshots in thread: `pbs.twimg.com/media/Fo231tPXEAMT75r`, `Fo24RVfX0AApNZp`, `Fo3BQX1XwAEUiUc`
6. three.js color management: <https://threejs.org/docs/#manual/en/introduction/Color-management> (r150 copy: `docs/manual/en/introduction/Color-management.html`)
7. three.js r152 release notes: <https://github.com/mrdoob/three.js/releases/tag/r152>
8. three.js r155 release notes: <https://github.com/mrdoob/three.js/releases/tag/r155>
9. drei `Environment` (v9.97.0): <https://github.com/pmndrs/drei/blob/v9.97.0/src/core/Environment.tsx>
10. drei `Lightformer`: <https://github.com/pmndrs/drei/blob/master/src/core/Lightformer.tsx>
11. three r149 PMREM path: `src/cameras/CubeCamera.js`, `src/renderers/webgl/WebGLCubeUVMaps.js`
