# Naboo meadow and civic paving

Seven [CC0 Poly Haven](https://polyhaven.com/license) scans supply eight material families on the stock Forces of Corruption map. All four inputs per scan are native 2048×2048. `sources.json` pins the exact color, OpenGL normal, displacement and roughness files. `materials.json` records the locally cooked BC3 pairs; the generated `public/js/naboo-recipe.js` also identifies the reused pairs. No reference photograph or game texture is redistributed here.

| Draw family | Scan (physical repeat) | Treatment |
|---|---|---|
| Meadow turf and open shoulder | [Forrest Ground 01](https://polyhaven.com/a/forrest_ground_01), Rob Tuytel (2 m) | The dense stand overlays translated silhouettes of the source's live blades. All four channels follow the same native pixel coordinates. No tint, rescale, or global color filter. The sparse shoulder uses Yavin’s verified, unlayered `open-cover` pair. |
| Worn track | [Grass Path 3](https://polyhaven.com/a/grass_path_3), Rob Tuytel (1 m) | Worn ground on authored lanes; not the main meadow. Level the scan’s mean tangent tilt, retaining its local relief. |
| Dry channel bed | [Gravel Floor 02](https://polyhaven.com/a/gravel_floor_02), Jenelle van Heerden and Dimitrios Savva (2 m) | Pale, washed gravel in mapped incisions. |
| Bank stone | [Mossy Rock](https://polyhaven.com/a/mossy_rock), Rob Tuytel (3 m) | Reuse the Endor rock pair on the steep bank projections. |
| Root soil | [Brown Mud Leaves 01](https://polyhaven.com/a/brown_mud_leaves_01), Rob Tuytel (1.3 m) | Reuse Yavin’s `root-mat` beneath actual deciduous roots. |
| Court setts | [Cobblestone 05](https://polyhaven.com/a/cobblestone_05), Rob Tuytel (2.4 m) | Aligned, recessed joints within the painted palace and house courts. `cobblestone_color` was rejected: its cooked normal pointed against its height gradient on both axes. |
| Construction | [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02), Rob Tuytel (2 m) | Shared concrete pair, only for a construction receipt. |

To reproduce from the Universal checkout, use `python tools/remaster/cook-polyhaven.py cook tools/remaster/terrain/490435e4137147e142c9c3df434cbcee7946d04f977fcba6e668d96b6ac17b83.json`, then `node tools/remaster/bind-land.mjs 490435e4137147e142c9c3df434cbcee7946d04f977fcba6e668d96b6ac17b83`. The input cache and build receipts live outside the checkout.
