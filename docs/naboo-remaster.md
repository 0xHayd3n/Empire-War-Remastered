# Naboo Incursion: meadow and Theed courts

[Play the remaster](http://127.0.0.1:8590/#naboo-remaster) · [Compare the original](http://127.0.0.1:8590/#naboo-original). These are session links for the stock Forces of Corruption battle. **Naboo meadows** in video settings is off by default. A different map, a changed stock texture or a damaged donor keeps the original terrain.

## What to look for

- At the western muster, pan across the troops’ feet, then out toward the dry gravel cut. The dense blades and the thinner shoulder come from the same 2 m scan at its native scale. The eastern field uses the same turf, with a different distribution of sheltered and exposed ground. Sunrise warms it toward gold; at noon it reads green without a scene tint.
- At the domed houses and the palace steps, the joints in the setts are recessed. Five painted, building-anchored aprons admit paving. Of the 1,708 brick-painted vertices, 802 remain paved and 906 outside those footprints draw natural ground. The isolated concrete paint does not create a new yard.
- Follow the bed to the steep banks. Gravel gives way to projected rock; existing boulders, spray props, trees and herb clumps stay put. The TED has no liquid sheet. Beyond the playable rim, open foothills continue the grade, without extra trees or buildings.

## Verification

Exact binding: `_MP_LAND_NABOO.TED`, TED SHA-256 `c2d8eadb44e17eb259fa169ef58733e42ca49119398fe4569c37fdb8d9662d70`. All 20 used or dynamic slots have matched color/height and normal/roughness inputs. See [scan sources and reproduction](../public/art/naboo-ground/SOURCES.md). The ten place references and gameplay frames remain private local review evidence, not shipped art.

The mounted review covered WebGPU and WebGL at 2048, plus WebGL at 512, with deployed armies and HUD. Nine camera views per tier included the palace, courts, both meadows, close pan and bed. Original/restored comparisons differed at 0–2 pixels per measured region. Both authored clear skies were inspected. The two retained plant classes submitted meshes at the same sampled roots from 128 through maximum zoom (1600) and back. All eight perimeter directions were checked at maximum and oblique angles, including removal of the outer strip. Corrupting the meadow surface retained the stock terrain. A separate launch checked the unmodified shipping presentation.

The final one-worker verification took **5 min 17 s**. Fresh scouting through visual sign-off took **42 min 54 s**, including rejected turf and paving, perimeter and evidence fixes, and reruns. This is one map, not a throughput benchmark. No installed files, simulation data or camera limits were edited. This is not a sustained combat-performance, mobile, or Workshop compatibility test.
