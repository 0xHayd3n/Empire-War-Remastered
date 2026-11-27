# Forest Ground 04 — runtime material tiles

Two 512×512 tileable runtime textures derived from the Poly Haven **Forest Ground 04**
PBR texture set (CC0). Ground/dirt-and-gravel surface for terrain shaders or ground
decals. Nothing here is game- or UI-specific: these are plain PNG material sources.

```
public/art/forest-ground-04/
  color.png    512×512 RGB  sRGB albedo, tileable
  normal.png   512×512 RGB  tangent-space normal, OpenGL (+Y up), tileable
  README.md
tools/prepare-forest-ground.py   regeneration + verification script
```

| file | dimensions | mode | bytes | sha256 |
|---|---|---|---|---|
| `color.png` | 512×512 | RGB (no alpha) | 576374 | `80b4b74aaf6a0ea672d67fe1c68ba15d7b41fa0dd1735d11e905f4dfffd15bc8` |
| `normal.png` | 512×512 | RGB (no alpha) | 612738 | `6649f25d043466fc9aa795933dfbc439ab823ab9dc4a0a3424425941d927fa87` |

Combined 1,189,112 bytes. PNG sizes are inherent to the source: this is a high-frequency
gravel/dirt scan, so `optimize=True` already sits at the zlib floor (compress level 6 and 9
produce byte-identical files).

## Attribution / licence

- Asset: Forest Ground 04 — <https://polyhaven.com/a/forest_ground_04>
- Licence: **CC0 1.0 Universal** (public domain dedication) — <https://creativecommons.org/publicdomain/zero/1.0/>
- Author: Poly Haven (Rob Tuytel / Rico Cilliers — see the asset page for the current credit list).
- No attribution is required under CC0; it is recorded here as provenance.
- Source data is first-party only: files listed by <https://api.polyhaven.com/files/forest_ground_04>.
  No Workshop, stock, or third-party assets are involved.

## Sources (exact inputs)

| variant | resolution | URL | bytes | md5 (pinned by the API) |
|---|---|---|---|---|
| `Diffuse` | 1k PNG | <https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/forest_ground_04/forest_ground_04_diff_1k.png> | 2364487 | `8f4318ba5044aa147999b08a10302fb4` |
| `nor_gl` | 1k PNG | <https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/forest_ground_04/forest_ground_04_nor_gl_1k.png> | 2537954 | `77c2337c8c8c47357f69b598e73a72de` |

Verification-only input used to prove the green axis (see below):

| variant | resolution | URL | bytes | md5 |
|---|---|---|---|---|
| `nor_dx` | 1k PNG | <https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/forest_ground_04/forest_ground_04_nor_dx_1k.png> | 2537895 | `17d3c9b519ab281d57723a53c9c888e7` |

Both inputs are 1024×1024 RGB PNG. Downloaded md5 values matched the API listing exactly.

## How the tiles were made

1024 → 512 is an exact 2×2 box reduction, applied differently per channel meaning:

**`color.png`** — decoded sRGB → **linear light**, 2×2 mean per channel in linear light,
re-encoded to sRGB with rounding to 8 bit. Averaging a gamma-encoded image would bias the
result dark/desaturated (a gamma-space mean of 0 and 255 is 128, whose linear value is
0.216 rather than the correct 0.5). The script uses the exact sRGB piecewise transfer
function, not a 2.2 power approximation.

**`normal.png`** — each texel decoded from 8 bit to `v = byte/255*2 - 1` in `[-1, 1]`,
2×2 mean of the three components, then every vector **renormalised to unit length** before
re-encoding (`round((v*0.5+0.5)*255)`, clamped). Renormalisation is what keeps the reduced
map a valid normal map: averaging shortens vectors, and a shortened normal under-lights.
Vectors that cancel to (near) zero are replaced by flat `+Z`.

**Tiling** — the 1K sources are seamless and a symmetric 2×2 box of a seamlessly tiling
texture stays seamless. Measured on the outputs (mean absolute 0-255 neighbour delta):

| tile | interior neighbour delta | wrap-around (edge) neighbour delta |
|---|---|---|
| `color.png` | 12.649 | 12.095 |
| `normal.png` | 15.958 | 15.587 |

Wrap deltas are no larger than interior deltas, i.e. no visible seam.

## Observed normal convention: OpenGL (+Y up)

The shipped `normal.png` is the **OpenGL / +Y-up** bake. This is not inferred from the file
name: Poly Haven ships the identical bake as `nor_gl` and `nor_dx`, and comparing the two 1K
sources (`tools/prepare-forest-ground.py` does this automatically) gives

- red channels byte-identical,
- blue channels byte-identical,
- green: `mean |g_gl − (255 − g_dx)| = 0.751` (max 2) versus `mean |g_gl − g_dx| = 48.42`.

So the two differ only by a green flip, and the input we reduced is the `+Y`-up member of
the pair. Shipped tile statistics (decoded to `[-1, 1]`): R mean −0.0121, G mean −0.0002,
B mean 0.9498, blue always positive (`min 0.302`) — the usual blue-dominant tangent-space
distribution, no ±Y symmetry to confuse it.

Consumers that expect DirectX (−Y down) normals must flip green: `g' = 1 − g` (or negate
the Y component after decode). The engine's own convention was not inspected or changed
here — do that at the integration point.

## Reproduction

```bash
# from the repo root, with Pillow (and optionally numpy) already available
python tools/prepare-forest-ground.py            # download sources to a temp dir, write tiles, verify
python tools/prepare-forest-ground.py --check    # re-hash and re-report the existing tiles only
python tools/prepare-forest-ground.py --no-download --cache DIR   # use pre-fetched sources
```

The script needs only Pillow; numpy makes it fast but is optional. It installs nothing, writes
only the two PNGs into this directory, keeps its download cache under the system temp dir, and
prints the source md5/sha256, output sha256, dimensions, byte sizes, tiling deltas and the
GL/DX check.

A full run from an empty cache reproduced `color.png` sha256
`80b4b74a…15bc8` and `normal.png` sha256 `6649f25d…7fa87` byte for byte, so the pipeline is
deterministic. The hashes above are from the numpy path. The pure-Pillow fallback (used only
when numpy is missing, ~2 s) agrees with it to within 1/255 on 0.29% of `color.png` and 0.02%
of `normal.png` channel values — quantisation ties, no visible difference — but it is not
byte-identical, so use numpy if you need to match these hashes.

## Not included / out of scope

Roughness, AO, displacement and ARM maps exist upstream but were not downsampled — only
diffuse and normal were requested. No game, UI, engine, manifest or publisher config was
touched; nothing was committed or published.
