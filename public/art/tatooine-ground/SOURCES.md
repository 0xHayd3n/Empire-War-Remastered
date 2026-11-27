# Clash on Tatooine · ground scans

These are [Poly Haven CC0](https://polyhaven.com/license) materials, not colors sampled from films, location photographs or mounted art. `sources.json` records the first-party URL, author, size and hashes for each native 2048² diffuse, OpenGL normal, roughness and displacement input. `materials.json` pins the five local DDS pairs (12 mips). Two existing cooks are shared, not copied.

| Asset | Reviewed use |
|---|---|
| [Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01) | Open lee sand, using the shallow ripples and the measured 30 m repeat; a physical sand analogue, not a shoreline. |
| [Sand 01](https://polyhaven.com/a/sand_01) | Pale fine deposit, at its native 1.5 m scale, mixed with the ripple scan. It is not a blanket replacement or a color overlay. |
| [Gravelly Sand](https://polyhaven.com/a/gravelly_sand) | Wind-winnowed gravel fans and grit under the sand. |
| [Sandstone Cracks](https://polyhaven.com/a/sandstone_cracks) | Consolidated, sunlit shoulders at the transition to rock. |
| [Rock Face 03](https://polyhaven.com/a/rock_face_03) | Broken ledges and steeper parts of the dry bowl. |
| [Dense Sand](https://polyhaven.com/a/dense_sand) | Compacted working yards; shared from `yavin-ground`. |
| [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02) | Actual construction only; shared from `endor-terrain`. |

Rebuild with `python tools/remaster/cook-polyhaven.py cook tools/remaster/terrain/801c35a32439b92bb81d9f45c3aa6b405dc260362096156eb42e25ae84acd9e5.json` and `node tools/remaster/bind-land.mjs 801c35a32439b92bb81d9f45c3aa6b405dc260362096156eb42e25ae84acd9e5`. `lock` is an explicit re-review operation, not part of a normal build. Source images stay in OS temp.
