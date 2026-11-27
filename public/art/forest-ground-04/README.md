# Forest Ground 04 — BC3 (DXT5) material pair

Two standard DDS textures for the forest ground material, cooked from the first-party
Poly Haven **Forest Ground 04** 4K maps. Nothing is upscaled, and no game or mod assets are
used. The repository stores only the two `.dds` files; source PNGs are downloaded to a cache
directory outside the repo when you re-cook.

| file | size | contents |
| --- | --- | --- |
| `color-height.dds` | 22,369,776 B | sRGB albedo in RGB + linear height in A |
| `normal-roughness.dds` | 22,369,776 B | tangent normal in RGB (nor_dx) + linear roughness in A |

Both files: 4096x4096, DXT5 (BC3) FourCC, 13 mips (4096 -> 1), 128-byte `DDS_HEADER`, mips
stored largest first. Alpha is the DXT5 8-value interpolation block.

## Regenerating

```sh
node tools/cook-forest-ground-04.mjs            # downloads sources if absent, then cooks
node tools/cook-forest-ground-04.mjs --verify   # also re-reads both DDS and prints checks
```

The tool uses the project encoder (`public/js/ddsmips.js` `encodeDXT(..., 5)`) and the project
decoder (`public/js/ddsdecode.js`) for the self-check. No dependencies are installed. Sources
are cached at `$FG04_CACHE` or `<tmpdir>/forest-ground-04-source`, and intermediate images are
never written into the repo.

## Sources

All four maps come from `https://api.polyhaven.com/files/forest_ground_04` (`4k`/`png`):

| map | URL | bytes | md5 |
| --- | --- | --- | --- |
| Diffuse (sRGB albedo) | `.../Textures/png/4k/forest_ground_04/forest_ground_04_diff_4k.png` | 34,352,704 | `8ef79e766dcaed16fafdf6676ede9a5a` |
| Normal (OpenGL, `nor_gl`) | `.../forest_ground_04_nor_gl_4k.png` | 37,822,518 | `0dbcfa2a379e0b10dbc01151099764b2` |
| Roughness | `.../forest_ground_04_rough_4k.png` | 9,552,055 | `44ded6d079237fd8782c50057f5928b7` |
| Displacement (16-bit height) | `.../forest_ground_04_disp_4k.png` | 20,789,218 | `17fe418956c73e204cb162c2686c4466` |

The tool refuses to cook if a downloaded file does not match its manifest md5. Every source is
a real 4096x4096 map (8-bit RGB for diffuse/normal, 8-bit gray for roughness, 16-bit gray for
displacement) — no 512 or upscaled data is involved.

License: **CC0 1.0 Universal** (public domain dedication), as published for this Poly Haven
asset. See <https://polyhaven.com/license>. Attribution is not required; "Forest Ground 04"
by Rob Tuytel (photography/processing) and Rico Cilliers (adjustment), [Poly Haven](https://polyhaven.com/a/forest_ground_04), is credited here for provenance.

## Channel conventions

`color-height.dds`

- RGB is albedo, stored sRGB-encoded exactly as sampled from the diffuse map, so it must be
  decoded to linear once. Universal samples both maps as UNORM and explicitly decodes **only** the color RGB in its terrain shader. Mip levels were filtered in **linear** light: decode to
  linear, box-filter 2x2, re-encode to sRGB per level.
- A is **linear height**, 0 = lowest, 255 = highest (higher = protruding). The source
  displacement is 16-bit linear with an observed range of 0.288014 - 0.568353, so it is
  normalised to its own range to keep all 8 bits of signal:
  `alpha = (disp16 / 65535 - 0.288014) / 0.280339`. Mips average height linearly (in float).

`normal-roughness.dds`

- RGB is a tangent-space normal, **nor_dx / DirectX convention**: green was flipped from the
  source `nor_gl` map (`ny = -ny`) so the top-down DDS rows light correctly. Values are
  `(n * 0.5 + 0.5) * 255` of unit vectors, linear data — do not sample this as sRGB.
  Mip levels average the vectors and renormalise, so BMP-style component averaging artefacts do
  not accumulate. Blocks are compressed per-channel, so renormalise after decode if you need
  exact unit length (decoded mean length 0.993).
- A is **linear roughness** copied from the roughness map, 0 = smooth, 255 = rough.

## Encoded channel ranges and means

Decoded from the shipped files with a third-party BC3 decoder (Pillow), top mip:

| file | channel | min | max | mean |
| --- | --- | --- | --- | --- |
| color-height.dds | R | 0 | 255 | 105.85 |
| | G | 0 | 235 | 89.20 |
| | B | 0 | 231 | 67.26 |
| | A (height) | 0 | 255 | 88.75 |
| normal-roughness.dds | R | 0 | 255 | 125.66 |
| | G | 0 | 255 | 127.62 |
| | B | 132 | 255 | 239.44 |
| | A (roughness) | 41 | 253 | 229.30 |

For reference the source maps measure R/G/B mean 106.05/89.54/67.56 (diffuse), roughness mean
229.57, and source height mean 0.3866 linear (normalised alpha mean 88.89). The 1x1 mip decodes
to `rgba(106, 93, 74, 89)` (colour-height) and `rgba(123, 129, 255, 230)` (normal-roughness).

## Verification

`node tools/cook-forest-ground-04.mjs --verify` checks the DDS header, FourCC, dimensions, mip
count, and that 128 + the 13-level BC3 chain equals the file size (both files:
128 + 22,369,648 = 22,369,776 B). Top-level colour round-trips through the project encoder and
decoder with mean absolute error 3.4/255. Independently decoded with Pillow, albedo matches the
sRGB source to 4.9/4.2/4.5 (R/G/B mean absolute), height to 0.37/255, roughness to a p99 error
of 2/255, and every decoded normal has `z > 0`. The green flip was cross-checked against the
published `nor_dx` map: our G channel matches it to 9.48/255 (the same magnitude as the
compression error on the untouched R channel) and differs from the unflipped `nor_gl` by 61.08.

File hashes of the shipped binaries:

```
dab732cf0063bc96d71b6fd77acceb0a  color-height.dds
db9e10854bebc42780b88c0f5922aed5  normal-roughness.dds
```
