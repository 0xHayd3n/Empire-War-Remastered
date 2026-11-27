# Geonosis ground scans

Four locally cooked [Poly Haven CC0 materials](https://polyhaven.com/license). `sources.json` pins the four native 2048² inputs for each material (diffuse, OpenGL normal, displacement, roughness), source URL, scan dimensions and credited artists. `materials.json` pins the resulting BC3 color/height and normal/roughness pairs. These files do not contain stock-game textures or reference stills.

| Runtime ID | Source | Use on this board |
|---|---|---|
| `scoured-crust` | [Cracked Red Ground](https://polyhaven.com/a/cracked_red_ground) | Dried, compact sediment among the finer wash deposits |
| `fan-gravel` | [Dry Ground Rocks](https://polyhaven.com/a/dry_ground_rocks) | Pebbles restricted to shoulders and interrupted fans, not the entire floor |
| `mineral-skin` | [Mud Cracked Dry 03](https://polyhaven.com/a/mud_cracked_dry_03) | Partial pale surface crust in mapped, dry channels |
| `scarp-stone` | [Tiger Rock](https://polyhaven.com/a/tiger_rock) | Rock on the level shelves and the slope-facing projections |

[Gravelly Sand](https://polyhaven.com/a/gravelly_sand) reuses `tatooine-ground/alluvial-grit`; [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02) reuses the existing construction cook in `endor-terrain`. Neither DDS pair is copied here. Shared inputs are pinned in the lock. No tint or upsampling pass. `levelTangent` on the two indicated local rows in the [terrain ledger](../../../tools/remaster/terrain/03c5994c8a8ae367ceabbc3fab0af4b6c29df55f35e8d464a85b1c3a3b14a434.json) removes the scan plane's mean tilt, not its local slopes. Rebuild with `python tools/remaster/cook-polyhaven.py cook tools/remaster/terrain/03c5994c8a8ae367ceabbc3fab0af4b6c29df55f35e8d464a85b1c3a3b14a434.json`.
