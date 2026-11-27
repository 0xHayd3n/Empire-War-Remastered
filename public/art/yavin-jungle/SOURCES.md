# Yavin jungle render assets

All four source assets are [Poly Haven CC0](https://polyhaven.com/license). The names describe earth analogues, not species identified in Star Wars. `sources.json` pins upstream URLs, MD5s and sizes. `materials.json`, `models.json` and the generated `public/js/yavin-recipe.js` identify the shipped results. No Lucasfilm still, matte, concept art or game installation bytes are embedded here.

| Source | Use |
| --- | --- |
| [Jacaranda Tree](https://polyhaven.com/a/jacaranda_tree) | The actual branching trunk/crown geometry and masked leaf, branch and trunk albedos, baked into 12 depth-separated orthographic cutouts with near/far depth-fitted meshes. Not an Endor pine recolor. |
| [Anthurium Botany 01](https://polyhaven.com/a/anthurium_botany_01) | Three source mesh variants, vertex-clustered with UVs retained, cutout diffuse and tangent normal. |
| [Mud Forest](https://polyhaven.com/a/mud_forest) | Dark earth with scattered organics. Albedo/height + tangent normal/roughness, 2048 BC3 + mips. |
| [Leaves Forest Ground](https://polyhaven.com/a/leaves_forest_ground) | Mixed broad fallen leaves beneath the canopy and on authored litter. Same two-map packing. |

`python tools/cook-yavin-jungle.py` verifies all input bytes, invokes `tools/remaster/crown-slices.mjs` and cooks into this directory. Requires Node, Python with Pillow/NumPy/SciPy, DirectXTex `texconv` on PATH and network for missing source files. Terrain normal G is inverted from the donor’s `nor_gl` convention to match top-down uploaded height rows before producing BC3 mips. `tools/remaster/surface-audit.mjs` measures both axes from the cooked bytes. Originals and bake scratch live in OS temp. Re-run `node tools/remaster/bind-yavin.mjs` only after reviewing any changed inputs or outputs; then check `node tools/test-yavin-recipe.mjs` and the mounted comparisons. Ground 037 is an ambientCG scan in the shared library; ferns and other reused donors retain their existing source notices.
