# Yavin ground — Poly Haven, CC0

[Licence](https://polyhaven.com/license). `sources.json` pins the official catalogue URLs, authors, native 2K input bytes for diffuse, normal, height and roughness, and catalogue dimensions in **millimetres**. `materials.json` pins the output pairs cooked here. Each pair is BC3, 2048² through 1² (12 mips); albedo/height and tangent normal/roughness have registered sampling. OpenGL normal G is flipped for top-down rows. Restored art stays in the mounted game, never in a production texture. No network request to Poly Haven during play.

[Review and slot ledger](../../../tools/remaster/terrain/d96aa07683839825c24b8653663e554a88948f6d4e2ff1a198d77b426f1bb03e.json) · [five environment views and land-use decisions](../../../tools/remaster/directions/d96aa07683839825c24b8653663e554a88948f6d4e2ff1a198d77b426f1bb03e.json).

| Use | Scan |
| --- | --- |
| Low open growth | [Forest Ground 01](https://polyhaven.com/a/forrest_ground_01) |
| Dark rooted, leafy ground | [Brown Mud Leaves 01](https://polyhaven.com/a/brown_mud_leaves_01) |
| Worn earth | [Forest Ground 05](https://polyhaven.com/a/forest_ground_05) |
| Sandy lane | [Dense Sand](https://polyhaven.com/a/dense_sand) |
| Temple threshold only | [Large Grey Tiles](https://polyhaven.com/a/large_grey_tiles) |
| Exposed natural rock, including tile-rock away from temples | [Mossy Rock](https://polyhaven.com/a/mossy_rock) (existing verified Endor cook) |
| Actual building paving only | [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02) (existing verified Endor cook) |
| Organic floor in sheltered pockets | [Mud Forest](https://polyhaven.com/a/mud_forest) and [Leaves Forest Ground](https://polyhaven.com/a/leaves_forest_ground) (existing verified jungle cooks) |

From the Universal root, `python tools/remaster/cook-polyhaven.py cook <review.json>` authenticates the locked four-channel sets and reproduces the five new packs using Pillow, NumPy and DirectXTex `texconv`. A reviewed donor change uses `lock` explicitly, then `cook`; rebuild with `node tools/remaster/bind-yavin.mjs`. The four previously licensed sets are shared rather than duplicated. The shader uses the physical repeat in the review (existing leaf/mud repeats are art-directed). Catches: `node tools/test-yavin-recipe.mjs`, `node tools/test-ground-zones.mjs`, mounted `check-yavin-remaster.cjs`, then `fit`.
