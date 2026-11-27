# Enhanced texture showcase · local builder v1

The downloadable ZIP contains code and recipes, not game art. Use it with a legally installed copy of Empire at War Gold / Forces of Corruption and, for the Republic pack, Fall of the Republic (Workshop 1976399102). Keep generated DDS files and private ZIPs on your device. The original showcase is an eight-texture pilot; Endor and the Venator refit are separate editions, not a remaster of every mod.

## In Universal

Open the matching profile in the mounted Universal window. For Fall of the Republic, use Workshop → the overhaul → Play this overhaul, then Back from Play to its home screen. Under **Settings → Video → Graphics Quality → Enhanced texture pack**, choose **Build local pack**. The builder reads only the selected source files from the mount, checks their SHA-256 hashes, builds offline in a worker, and installs the result in that browser profile's IndexedDB. Stay in Settings during the build. Turn on **Use enhanced textures**, save any battle, then choose **Reopen profile**. Other profiles and graphics presets do not change. **Save private ZIP** exports just that profile’s DDS files.

To undo it, turn off **Use enhanced textures** and reload. The original files are used immediately in the new game session. Choose **Remove pack** after reloading to reclaim browser storage. No saves, Steam files, Workshop files, XML, shaders or UVs are changed. The installation is private to the browser, Universal origin/port and profile. If site storage is cleared, rebuild. A changed source is never replaced by a same-named texture from a different release. Prebaked backdrops and cached library thumbnails are not live materials.

## Downloadable command-line builder (optional)

**Download builder** in the same panel, extract the ZIP outside your installs, and open a terminal in its extracted folder. Requires Node.js 22 or later; no npm install, network or graphics software. Run once per desired profile, substituting your actual folder paths:

```sh
node tools/texture-showcase-cli.mjs "D:/SteamLibrary/steamapps/common/Star Wars Empire at War"
node tools/texture-showcase-cli.mjs "D:/SteamLibrary/steamapps/common/Star Wars Empire at War" "D:/SteamLibrary/steamapps/workshop/content/32470/1976399102"
```

The first path is the Gold install root containing GameData and corruption/EAWX, **not** its Data directory. A successful build prints a fresh output path in your OS temporary directory. Use **Import private ZIP** in the matching profile; do not unzip it into Steam. Move the private ZIP somewhere safe if you want a backup. The folder picker / generic Mods installer is not required. The builder never overwrites an earlier pack. A missing/changed source stops the build before output is written.

## Endor · Forest floor and canopy (stock)

For the separate, live **Endor scanned earth** switch, which uses a licensed 4K dirt material and does not replace grass, see [Endor scanned earth](endor-forest-floor.md).

In the **stock** profile, open **Settings → Video → Graphics Quality → Enhanced texture pack**. Choose **Texture edition → Endor · Forest floor and canopy**, then **Build local pack → Use enhanced textures → Reopen profile**. Play a stock Endor land Instant Battle. For the offline builder use `node tools/texture-showcase-cli.mjs "GOLD INSTALL FOLDER" --endor`. The stock showcase remains available as a separate edition. To restore original art disable the pack and reopen.

The two evergreen atlases on `_MP_LAND_ENDOR.TED` pack trunk and branches into different regions of the same 256² image. The local recipe reconstructs each at 2048² and finishes bark and needles separately. Four 512² moss/ground/grass textures are refinished at the terrain atlas’s actual sampling resolution. Complete mip chains preserve original BC3 mask blocks at authored sizes and original mip levels from 64² down; the added tree levels interpolate original coverage. No changes to tree geometry, placement, units, lighting or visibility. Identical source textures shared by other stock maps also receive the finish while enabled. No Battlefront artwork or presets are used or distributed.

`node tools/check-endor-forest.cjs` builds and enables the edition in an isolated mounted Universal session, spawns a stock walker and infantry fixture, then switches only the relevant diffuse material bindings between verified stock bytes and installed output in one frozen battle. By default it captures 3840×2160 PNGs; `LOOK_BACKEND=webgl` selects fallback and `ENDOR_OUT` selects a private output folder. `python tools/endor-comparison.py "CAPTURE FOLDER"` (Pillow) generates an offline wipe with links to the full PNGs. Never package the resulting texture files in the code-only download.

## Venator · Shipyard Refit (Fall of the Republic)

For a more pronounced redesign, select **Texture edition → Venator · Shipyard Refit** before choosing **Build local pack**. Enable it, then **Reopen profile**. The two editions are stored separately: switching back does not erase the first showcase. For the command-line builder, append `--refit` after the Workshop folder, then import into that same edition.

The refit replaces the standard hull and turret **colour and normal/gloss pairs**, not just the colour image. New UV-positioned hatches, louvers, interrupted guide rails, keep-clear chevrons, recessed panel joints and edge wear distinguish pale armor from cool structural steel. Height and gloss follow the fittings, not the brightness of painted symbols. The existing team mask is retained; engine lights, emissive decals, model geometry, and nonmatching hero paint stay original. The hull uses two 2048² maps, the turrets two 512² maps, all with full mip chains. Unlike the restoration, this works by changing the material design, not by enlarging the hull map. Shader detail below 2 still displays the paint but not the per-pixel normals or gloss. It is not a full metalness/roughness pipeline.

## What changes in the original showcase

| Profile / binding | Treatment |
| --- | --- |
| Stock `EV_STARDESTROYER`, `meshbumpcolorize.fx` BaseTexture | Hull diffuse 512 → 1024; bounded reconstruction, panel edge contrast and low-chroma brushed finish. Normal / colourization maps are unchanged. |
| Stock Naboo high/low ALOs, `planet.fx` BaseTexture | Shared Alderaan surface 1024 → 2048 and 256 → 512. Longitude wraps; a low-amplitude land finish leaves blue water quieter. Clouds, atmosphere and normal maps stay original. |
| `_Land_Planet_Kuat_02` TED | The three most frequent painted layers are grass/rock, brown gravel and flower meadow. Distinct fine grain at the terrain renderer’s native 512 per layer; no change to terrain bounds, tile size, bump or placement. Other maps using identical assets see the same treatment. |
| Republic `EV_VENATOR`, `meshbumpcolorize.fx` BaseTexture | Main hull 2048 → 4096; turret atlas 256 → 512. Does not replace alternate hero paint, additive lights, damaged decks, or normals. |

Outputs are ordinary BC3/DXT5 DDS files with complete mip chains. Colour processing never edits alpha. Existing alpha blocks are copied verbatim at matching authored resolutions; a new top level linearly resamples the mask and compresses it to BC3. New colour mips average in linear light. Original mips at 64×64 and below are retained when available. This is source-guided restoration with procedural material finishes, not AI or hand-painted new hull geometry. The largest build (Republic) produces about 22 MiB of DDS and needs additional temporary RAM. The same pack feeds both render backends.

Development: `node tools/package-texture-showcase.mjs` regenerates the code-only download from a fixed allowlist. Never add source or generated game art to that allowlist.
