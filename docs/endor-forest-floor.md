# Endor scanned earth

To replace all of Endor's painted terrain and forest scenery rather than this one bare-earth layer, see [Endor full landscape](endor-full-landscape.md).

**Try it:** Open the stock profile in [Universal](http://127.0.0.1:8590/), choose **Settings → Video → Details → Texture detail → High**, then **Graphics Quality → Endor scanned earth**. Launch **Instant Battle → Endor → Land** and zoom in on bare brown ground at the edge of a clearing. You can switch between original and scanned earth in the same battle. Texture detail is read on first material load in that battle; change it before starting a new battle to compare tiers. The scan is opt-in and independent of the Battle realism preset.

## Which surface, and why

Side-by-side review of the mounted source textures showed that `W_TempGrnd08` (the previous target) is green grass; `W_DirtRock00` also contains plants despite its name. The main `W_SmoothDirt00.tga` / `W_SmoothDirt00_B.tga` paint layer, by contrast, is exposed brown dirt. Its authored blend boundaries are a good place for soil to meet grass. Only this exact pair on the reviewed Endor map is replaced: 7,818 painted vertices in stock FoC, 7,778 in EaW. Other layers, including moss, mud, sand, grass and cliffs, still render their own materials. No filename-only mod overrides. The previous contrast-on-grass asset is no longer shipped. Map shape, unit placement, collision and saves are untouched.

## Rendering the scan rather than recoloring the old ground

The locally packaged [Forest Ground 04 material](../public/art/forest-ground-04/README.md) uses its own color, roughness, tangent normals and height. Two dedicated BC3 textures per battle sit outside the legacy 512-square terrain arrays. Color and surface are selected atomically, after validating the installed edition, map, source textures and replacement files. No external service runs during play. Other maps don't fetch or reserve a scan slice. Missing, corrupt or unsupported maps leave stock dirt in place.

The replacement bypasses legacy tint, normal, gloss and repeated legacy detail on the matched layer. The shader decodes albedo to linear light, lights a rough dielectric under the map's sun and fill, and returns it to the land compositor. Near the camera, the height map offsets samples along the view ray and reduces direct light where a higher neighboring stone blocks it. Explicit mip gradients and anisotropic filtering retain stable detail down the path; costly height tracing fades out as stones shrink. This is shading on the existing terrain mesh, not raised collision geometry or a promise to reproduce a studio render under every map sun. Terrain wetness, shadows, painted blends and fog of war still apply.

| Texture detail | Loaded width / map | Mips | Added compressed texture payload (both maps) |
| --- | ---: | ---: | ---: |
| High | 4096 | 13 | 42.67 MiB |
| Medium | 2048 | 12 | 10.67 MiB |
| Low | 1024 | 11 | 2.67 MiB |

Device texture limits can lower these sizes. Both complete DDS files are read locally on first opt-in even when fewer mips are uploaded. These are texture payload sizes, not whole-process RAM/VRAM. Toggling off restores the original shader immediately and keeps the pair warm until leaving that battle. A backend without confirmed BC texture support or a reported texture size stays stock; worker-mirror support isn't assumed.

## Mounted results

At 1920×1080 on the RTX 3070 desktop, the ground inspection view showed individual stones and their shaded edges instead of enlarged, blurred earth. At normal command distance they resolve into broad patches of brown soil, not oversized pebbles. The adjacent green layer matched stock: zero pixels changed by more than two luminance levels in the grass control on all four runs. Turning the material back off restored the matched views to within one pixel at that threshold. Each run fetched the local donor files once each and bound two 4096-square textures with 13 levels. The photo and material ball are references, not textures pasted into the frames.

| Mounted run | Inspection: pixels differing from a 512px cap¹ | Command pan p95, stock → scan (ms) |
| --- | ---: | ---: |
| FoC / WebGPU | 1,290,079 | 5.61 → 5.62 |
| FoC / WebGL | 1,236,126 | 5.61 → 5.61 |
| EaW / WebGPU | 959,865 | 5.69 → 11.13 |
| EaW / WebGL | 931,436 | 5.63 → 11.13 |

¹ More than two luminance levels; **same material and lighting**, only the highest available mip changed. Pans used four alternating warmed windows with a moving camera, frozen poses and 120 frame intervals per setting. The short EaW runs had slower tail frames, despite similar medians. This isn't a mobile, sustained-combat or first-upload benchmark. Separate live checks confirmed 2K on Medium, 1K on Low and stock fallback in a running battle with deliberately corrupted files.

## Reproduce

`node tools/test-endor-soil.mjs` checks the exact bare-earth identities, negative grass/mud/mod cases, size tiers, asset hashes and both complete native mip chains. With Chrome, `playwright-core` and the mounted game installed, `node tools/check-endor-soil.cjs` exercises the setting at desktop and keyboard-only narrow width with reduced motion, the current stock edition, a live grass control, and matched inspection / close / command captures. In the inspection view it also binds the same maps and shader with their top three mips removed (512px) to distinguish visible high-frequency detail from a lighting change. Repeat with `LOOK_BACKEND=webgl` and/or `LOOK_EDITION=eaw`. `SOIL_FALLBACK=1` substitutes corrupt payloads and checks that neither half is bound and the stock battle keeps advancing. Captures and measurements stay under the OS temporary directory, `universal-endor-earth-4k`.
