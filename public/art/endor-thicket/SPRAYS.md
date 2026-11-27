# Endor thicket spray atlas

`sprays.png` is a 2048x2048 RGBA cutout atlas for the dense Endor forest between the near understory and the horizon tree line. Each panel is a **baked render of real Poly Haven CC0 geometry** under neutral daylight, on a transparent background, cut to the donor's own alpha map. Nothing here is a camera-facing sprite and nothing is painted: the panels are meant to be mounted as fixed crossed or canted meshes, so they must be lit by the scene like any other leaf card.

## Panels

Reading order is left to right, top to bottom. Rects are pixels in the atlas with
y measured **down** from the top edge; every panel keeps a 16 px fully
transparent gutter so bilinear and mip sampling cannot pick up its neighbour.

| panel | subject | cell x,y,w,h | alpha rect x,y,w,h | height % of atlas | height % of cell | alpha coverage |
| --- | --- | --- | --- | --- | --- | --- |
| `fir` | Whole upright fir | 0,0,1024,2048 | 16,101,992,1845 | 90.1% | 90.1% | 19.9% |
| `shrub` | Full leafy shrub | 1024,0,1024,1024 | 1043,90,986,842 | 41.1% | 82.2% | 14.5% |
| `fern` | Spreading fern, seen from side and above | 1024,1024,1024,512 | 1091,1040,877,480 | 23.4% | 93.8% | 25.0% |
| `bough` | Conifer bough, pointing up | 1024,1536,1024,512 | 1156,1552,760,480 | 23.4% | 93.8% | 16.3% |

Each panel's `uv` in the machine block is the same rect normalised to 0-1, with v
measured **down** from the top edge, which is the form a mount wants; flip v if the
renderer puts v=0 at the bottom of the image.

Measured against the shipped file: mean colour, colour spread and the share of
covered texels darker than 6% are recorded per panel in the machine block below,
so a re-cook that drifts towards a black silhouette or flat paint fails the check.

## Mounting

- RGBA8, straight (unassociated) alpha, sRGB colour. Sample with alpha test, not
  blending, so a distant spray needs no depth sort and casts the same dappled
  shadow a leaf card would.
- Map each panel's rect onto a fixed quad with that rect as its UV sub-rect. Inset
  the sub-rect by one texel inside the alpha rect to keep filtering off the gutter.
- Canted and crossed quads, not camera-facing: the shading was baked from geometry
  with its own normals, so the spray reads as a volume while the camera turns.
- Cover texels outside each alpha rect are colour bled, so mips thin the cutout edge
  without darkening it. Nothing else in the padding is authored.

## Sources

All donor **models** (topology, UVs and photographic material maps) are
[Poly Haven CC0 assets](https://polyhaven.com/license); no attribution is legally
required and none of it is stock game art. Art is packed into the atlas, so the
player never contacts an asset site.

| asset | contributor(s) | understood from |
| --- | --- | --- |
| [Fir Sapling](https://polyhaven.com/a/fir_sapling) | Rob Tuytel (photography), Rico Cilliers (modeling) | `https://api.polyhaven.com/files/fir_sapling` |
| [Fern 02](https://polyhaven.com/a/fern_02) | Rob Tuytel (scanning), Rico Cilliers (modeling) | `https://api.polyhaven.com/files/fern_02` |
| [Shrub 02](https://polyhaven.com/a/shrub_02) | Rico Cilliers (all) | `https://api.polyhaven.com/files/shrub_02` |

### Pinned files

The cook checks md5 and size of every input before it renders, and stops on drift.

| file | bytes | md5 |
| --- | --- | --- |
| `fir_sapling/fir_sapling_1k.gltf` | 10979 | `7b1a5ceae7be69954510b5a5c719b4fb` |
| `fir_sapling/textures/fir_sapling_branches_diff_1k.jpg` | 776633 | `84f1d40b80a015d65c0ded042a10765b` |
| `fir_sapling/textures/fir_sapling_branches_nor_gl_1k.jpg` | 1137599 | `db70c4595cf207cc04a02b49c195b78d` |
| `fir_sapling/textures/fir_sapling_branches_arm_1k.jpg` | 793567 | `29a9ff22b8f7f224069b1254db171c05` |
| `fir_sapling/textures/fir_sapling_twigs_diff_1k.jpg` | 252678 | `cd218269e0b34bd1bdb48a8daf21be67` |
| `fir_sapling/textures/fir_sapling_twigs_nor_gl_1k.jpg` | 474717 | `764771b717c54b86fa7d3eadc4a1ada5` |
| `fir_sapling/textures/fir_sapling_twigs_arm_1k.jpg` | 300249 | `cf97b5de863ebad9a48cb187ef3c3e74` |
| `fir_sapling/fir_sapling.bin` | 21677180 | `b329143a90d95201891afc52daeb9698` |
| `fir_sapling/fir_sapling_alpha_1k.png` | 107682 | `177123c2b5eaeee068be559ff78e54d0` |
| `fern_02/fern_02_1k.gltf` | 6899 | `cf276874d37bfb73c299504a6b355b77` |
| `fern_02/textures/fern_02_diff_1k.jpg` | 315705 | `82c18a6cfd5ae91c37c0e078f591181c` |
| `fern_02/textures/fern_02_nor_gl_1k.jpg` | 367222 | `43aed63dff79554f6064627515afd9d7` |
| `fern_02/textures/fern_02_arm_1k.jpg` | 280359 | `1bbb2b22951f450720d28e17d93a2987` |
| `fern_02/fern_02.bin` | 176176 | `c061e9255f7d36ae9ce0e92ef3e100b2` |
| `fern_02/fern_02_alpha_1k.png` | 114589 | `1421e5e36946c23a7ddcc907de89025c` |
| `shrub_02/shrub_02_1k.gltf` | 8083 | `8f7254d279c0c49c0b3edfe260aa5c86` |
| `shrub_02/textures/shrub_02_diff_1k.jpg` | 395120 | `3f4ae281928de030c7d4e41ad5b88a8b` |
| `shrub_02/textures/shrub_02_nor_gl_1k.jpg` | 490815 | `51a7f2db7e06a207171fd725585241d5` |
| `shrub_02/textures/shrub_02_arm_1k.jpg` | 313715 | `28c218aeb7cab930d99ee16578984241` |
| `shrub_02/shrub_02.bin` | 758692 | `683b5475238310899eac1458520903e6` |
| `shrub_02/shrub_02_alpha_1k.png` | 91741 | `64a1f609d80ea076b43412498a3d2db5` |

### Materials and alpha

The renders keep the donor albedo, tangent-space normal and arm (AO / roughness / metal) maps. These glTF exports mark their foliage materials `alphaMode: MASK` while pointing base colour at a JPEG, which has no alpha channel, so the cutout would come out as an opaque card. The bake therefore binds each foliage material to the donor's own sibling alpha PNG (pinned above) and clips at 0.5, the cutoff the donor declares. Bark stays opaque. The cards are double sided and Cycles already orients the shading normal to the side the ray came from, so both faces light correctly as long as nothing flips the normal again; a 28% translucent mix on top stands in for light scattering through needles, so nothing bakes to a black silhouette.

## Composition

Fir, fern and shrub use the donors as they ship. Two panels do more than place one node, and both are described here rather than hidden:

- `shrub`: Shrub 02 ships four airy native shrubs, and any one of them alone reads as a spray of twigs rather than a bush. The panel overlaps all four around a shared base with different yaws and scales (see `PANELS`), which is how the donor expects them to be scattered, and bakes them as one full leafy shrub.
- `bough`: one Fir Sapling node, its base trimmed away and the whole crown rolled 40 deg about the view axis so its boughs lead upward across the panel. Whole needle cards are dropped, never sliced, and cards left floating clear of the crown go too.

Everything is still donor geometry and donor material under the same neutral daylight; nothing is painted, cloned in image space or taken from a preview render.

Shrub 03 was fetched and evaluated for the shrub panel and is not shipped: it is a 0.30-0.40 m seedling, and at that size its cutout spends most of a panel on empty texels. Shrub 02, at 2.4 m, holds the silhouette at middle distance.

## Bake

- Blender 3.6.5, Cycles CPU, 64 samples per pixel, fixed seed, no adaptive sampling, no denoiser, `Standard` view transform.
- Frames are rendered at 1.5x the panel size and area-filtered down in premultiplied linear light, so alpha edges are clean and no dark fringe forms.
- Orthographic camera per panel, aligned to the panel's own view; the subject is
  fitted to the cell by its measured alpha bounds, never stretched.
- Neutral daylight: white key sun at 2.7 W/m2 with a 3 deg disc, a dim cool sky-side
  fill at 1.25 and a grey-blue world at 1.55, giving form without black shadows or
  flat ambient-only paint. No colour grade, no tone curve, alpha threshold 0.5.
- Output: straight (unassociated) alpha RGBA8, sRGB colour, colour bled into
  transparent texels so mips do not darken the cutout edge.

## Reproduce

```
python tools/cook-endor-sprays.py                  # bake atlas and this page
python tools/cook-endor-sprays.py --doc            # rewrite this page from the atlas
python tools/cook-endor-sprays.py --verify         # check shipped atlas, no Blender
python tools/cook-endor-sprays.py --recheck-render # re-bake and diff against shipped
```

Blender is found on `PATH`, in the usual install locations, or via
`$ENDOR_SPRAY_BLENDER`. Sources are cached outside the checkout in
`$ENDOR_SPRAYS_CACHE` or `<tmpdir>/endor-sprays-inputs`; the repo keeps only this
page, the atlas and the script. Rendering is path traced, and the cutout sits on a
hard alpha threshold, so path tracer noise at the boundary repaints a handful of the
4.2 M texels one 8-bit step brighter or darker on a re-cook; `--recheck-render` prints
that count and fails above 0.05% of the atlas. The sha256 below pins the shipped bytes
exactly, so `--verify` proves the file on disk is the one this page describes.

## Machine block

Measured from `sprays.png` by `--verify`.

```json
{
  "alpha_cutoff": 0.5,
  "blender": "3.6.5",
  "bytes": 4666111,
  "cycles_samples": 64,
  "file": "public/art/endor-thicket/sprays.png",
  "gutter": 16,
  "panels": {
    "bough": {
      "alpha_mean": 0.16173,
      "aspect": 1.5833,
      "cell": [
        1024,
        1536,
        1024,
        512
      ],
      "colour_mean": 0.31731,
      "colour_std": 0.07129,
      "coverage": 0.16315,
      "dark_frac": 4e-05,
      "height_frac_atlas": 0.23438,
      "height_frac_cell": 0.9375,
      "local_rect": [
        132,
        16,
        760,
        480
      ],
      "rect": [
        1156,
        1552,
        760,
        480
      ],
      "uv": [
        0.564453,
        0.757812,
        0.935547,
        0.992188
      ],
      "width_frac_cell": 0.74219
    },
    "fern": {
      "alpha_mean": 0.26594,
      "aspect": 1.8271,
      "cell": [
        1024,
        1024,
        1024,
        512
      ],
      "colour_mean": 0.28407,
      "colour_std": 0.07106,
      "coverage": 0.25021,
      "dark_frac": 0.0014,
      "height_frac_atlas": 0.23438,
      "height_frac_cell": 0.9375,
      "local_rect": [
        67,
        16,
        877,
        480
      ],
      "rect": [
        1091,
        1040,
        877,
        480
      ],
      "uv": [
        0.532715,
        0.507812,
        0.960938,
        0.742188
      ],
      "width_frac_cell": 0.85645
    },
    "fir": {
      "alpha_mean": 0.19675,
      "aspect": 0.5377,
      "cell": [
        0,
        0,
        1024,
        2048
      ],
      "colour_mean": 0.30557,
      "colour_std": 0.0703,
      "coverage": 0.19853,
      "dark_frac": 2e-05,
      "height_frac_atlas": 0.90088,
      "height_frac_cell": 0.90088,
      "local_rect": [
        16,
        101,
        992,
        1845
      ],
      "rect": [
        16,
        101,
        992,
        1845
      ],
      "uv": [
        0.007812,
        0.049316,
        0.492188,
        0.950195
      ],
      "width_frac_cell": 0.96875
    },
    "shrub": {
      "alpha_mean": 0.14483,
      "aspect": 1.171,
      "cell": [
        1024,
        0,
        1024,
        1024
      ],
      "colour_mean": 0.39944,
      "colour_std": 0.10235,
      "coverage": 0.14495,
      "dark_frac": 0.0,
      "height_frac_atlas": 0.41113,
      "height_frac_cell": 0.82227,
      "local_rect": [
        19,
        90,
        986,
        842
      ],
      "rect": [
        1043,
        90,
        986,
        842
      ],
      "uv": [
        0.509277,
        0.043945,
        0.990723,
        0.455078
      ],
      "width_frac_cell": 0.96289
    }
  },
  "sha256": "e2999b1118e0a351a58b1ef9c4946a3b494c8ff2fb3567db8dac4962cc15efe9",
  "size": [
    2048,
    2048
  ],
  "supersample": 1.5
}
```
