# Assault on Hoth · ground scans

All five terrain sets come from [Poly Haven (CC0)](https://polyhaven.com/license). `sources.json` records the author, first-party input URL, size, MD5 and SHA-256 per channel. Four pairs here contain native 2048² diffuse + displacement and OpenGL normal + roughness with 12 BC3 mip levels. The fifth set is reused from the existing authenticated construction cook. No photo, movie frame or mounted game texture is distributed in this pack.

| Scan | Physical repeat | In play |
|---|---:|---|
| [Snow 02](https://polyhaven.com/a/snow_02) | 2 m | Continuous open mantle. |
| [Snow 01](https://polyhaven.com/a/snow_01) | 2 m | Rougher packed snow in sheltered depressions and around the existing service equipment. |
| [Rocks Ground 05](https://polyhaven.com/a/rocks_ground_05) | 3 m | Pale broken rubble at steep shoulders; not a blanket grey snow layer. |
| [Dark Rock 02](https://polyhaven.com/a/dark_rock_02) | 2 m | Exposed bedrock at steep faces. |
| [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02) | 2 m | Construction receipts only; shared `endor-terrain` cook. |

The raw snow normals had an average tilt. Rotating that tilt with every stochastic tile lit the open basin in patches. The reviewed `levelTangent` cook removes only the mean tangent-plane slope before packing the two snow scans and the rubble. Local slopes, raw diffuse, displacement and roughness remain; the map normal supplies the actual hill slope. `node tools/test-hoth-recipe.mjs` checks both residual tilt and retained slope variance in the shipped bytes.

Recipe and reproducible build: `tools/remaster/terrain/fdc163a7603ac69e3ca7e160b5e7207ff7a89d903e9b393512e9eb3ee9f43a1e.json`; use `python tools/remaster/cook-polyhaven.py cook <recipe>` followed by `node tools/remaster/bind-land.mjs <job-id>`.
