# Endor planted woodland

All five source **models**, including topology, UVs and photographic materials, are [Poly Haven CC0 assets](https://polyhaven.com/license). Not the stock game's trees with enhanced diffuse maps. Art is packed locally; the player never contacts an asset site. Some of the new foliage uses curved cutout blades/fronds as part of a 3D plant, not camera-facing billboards.

| Model | Contributor(s) | Use |
|---|---|---|
| [Grass Bermuda 01](https://polyhaven.com/a/grass_bermuda_01) | Rico Cilliers | Two sparse living tufts, in grazed meadow patches |
| [Grass Medium 02](https://polyhaven.com/a/grass_medium_02) | Rico Cilliers | Denser meadow clump, near view only |
| [Fern 02](https://polyhaven.com/a/fern_02) | Rob Tuytel, Rico Cilliers | Fern crowns on moss/litter, with a few on grass |
| [Shrub 02](https://polyhaven.com/a/shrub_02) | Rico Cilliers | Near-field leafy understory with the donor’s actual branches and leaves |
| [Fir Sapling](https://polyhaven.com/a/fir_sapling) | Rob Tuytel, Rico Cilliers | Young trees in woodland, not planted on paths |

`python tools/cook-endor-grove.py` (Python 3, NumPy and Pillow; build-time only). The script pins each glTF, geometry buffer, alpha, albedo and normal input to the first-party file catalog MD5. Conversion selects live variants, converts Y-up to Z-up, and packs position/normal/UV and 16-bit triangle indices. The small fir LOD preserves the donor's branches but samples and widens a subset of intact needles rather than distributing the four-million-triangle mature tree. Shaded donors use their own photographed albedo and normal maps; the alpha cutout is packed into color. `models.json` pins the final geometry buffers. No stock artwork borrowed to texture these meshes.
