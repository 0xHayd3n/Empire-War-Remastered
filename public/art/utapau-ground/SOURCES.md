# Utapau terrain sources

Five [Poly Haven CC0](https://polyhaven.com/license) materials supply paired albedo/height and normal/roughness arrays. All four channels are pinned at native 2048² in `sources.json`. The new DDS pairs contain 12 mip levels each; the other three pairs are reused by hash. Neither the reference photos nor stock game art are distributed in this pack.

| Family | Source and author | Repeat | Use |
|---|---|---:|---|
| `alluvial-grit` | [Gravelly Sand](https://polyhaven.com/a/gravelly_sand), Dario Barresi | 2.48 m | Exposed grit; Tatooine's verified cook |
| `apron-grit` | [Dense Sand](https://polyhaven.com/a/dense_sand), Dimitrios Savva | 1.8 m | Sheltered natural fines; Yavin's verified cook, not paving |
| `rim-talus` | [Dry River Pebbles](https://polyhaven.com/a/dry_river_pebbles), Amal Kumar | 2 m | Loose stones at runnels and bank toes |
| `broken-ledge` | [Rock Face 03](https://polyhaven.com/a/rock_face_03), Dario Barresi and Rico Cilliers | 2.7 m | Inclined fractured faces; Tatooine's verified cook |
| `deck-wear` | [Concrete Floor 03](https://polyhaven.com/a/concrete_floor_03), Rob Tuytel and Matterfield | 2.5 m | Aligned platforms inside reviewed painted footprints |

Reproduce from the Universal root with `python tools/remaster/cook-polyhaven.py cook tools/remaster/terrain/28f3d8fdabd3d79348fa1d91eee7026358f333da7c8f7e21e1d19750377af881.json`, then `node tools/remaster/bind-land.mjs 28f3d8fdabd3d79348fa1d91eee7026358f333da7c8f7e21e1d19750377af881`. Only the two local families are encoded here. `sandy_gravel_02` was auditioned and rejected; it is not a shipping dependency.
