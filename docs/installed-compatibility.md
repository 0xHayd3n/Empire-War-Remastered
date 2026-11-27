# Which load orders have actually been tested?

Compatibility belongs to an **ordered list of Workshop IDs, installed revisions, launch route and game mode**. Reordering the same IDs can change XML, scripts or art. Universal does not merge overlapping files or discover undeclared dependencies. The **first listed item wins**. Leave the author's order alone unless you intend to change that winner.

A compatible load order is not the same as two factions being able to damage one another. For the verified Sith–Trade Federation matchup **without stacking primary mods**, and the design for extending it, see [Cross-era factions in Skirmish and Instant Battle](cross-era-tactical.md).

## Result on this installation

Stock and six primary overhauls were installed, alongside seventeen submods. Six saved collections were discovered: four matched their parent-only order; two contained enabled submods. The nine distinct cases below each ran on both WebGPU and WebGL, starting from the [Universal title screen](http://127.0.0.1:8590/).

| Tested order | Space Instant Battle + save readback | What that establishes |
|---|---|---|
| Stock Forces of Corruption | Passed | Baseline |
| Thrawn’s Revenge, Revan’s Revenge, Awakening of the Rebellion, Awakening of the Clone Wars | All four passed separately | One primary at a time; also the exact ID lists in their saved collections, via the era-pack route |
| Fall of the Republic, Empire at War: Remake | Both passed separately | Their parents without any submods |
| Remake saved collection · 2 enabled IDs | Passed via Workshop → Use collection order | 1,581 paths provided by more than one Workshop layer; both layers had winning files |
| Fall saved collection · 13 enabled IDs | Battle passed via Workshop → Use collection order; **one submod fully overridden** | 1,041 shared Workshop paths; 12 of the 13 layers had winning files |

**Actionable conflict:** [3451902172](https://steamcommunity.com/sharedfiles/filedetails/?id=3451902172) supplies one file, `Data/XML/Structures/Templates_Basic_Resource_Structures.xml`. In the saved Fall order, [2544515545](https://steamcommunity.com/sharedfiles/filedetails/?id=2544515545) wins that path with different bytes. The lower item is mounted but its file has no effect. If you prefer the current behavior, no change is needed. Moving the lower item above the winner would replace that *whole file*, not combine the two changes; test such a change as a new playset. No saved orders were edited. A shared path alone is not a defect: many changes are intentional overrides.

All **17 individual submod + collection-parent pairs** were also checked on disk with the submod first. That includes four disabled items in the Fall collection. Those four were **not enabled**; these pair results describe file precedence, not independently working submods, required dependencies, or successful battles.

## Run it again, or test your own order

Requires local FoC and Workshop sources, imported primary packs, the running Universal host on port 8590, Chrome, and `playwright-core` available to Node. Run from the Universal checkout while Steam is not updating the items:

```sh
node tools/check-installed-compatibility.cjs --backend webgpu
node tools/check-installed-compatibility.cjs --backend webgl
# Test one actual order through the Workshop desk, highest priority first:
node tools/check-installed-compatibility.cjs --order 2794270450,1770851727
```

The default reads the local title catalog. It tests each era once and each distinct saved multi-item collection, without enabling disabled items. `--order` tests the supplied IDs in exactly that order; use it for personal browser playsets too. The test deliberately uses a fresh browser context, not your personal saves or browser-stored playsets. `--only era`, `--only workshop`, or `--only <item-ID>` narrows a matrix run. JSON evidence is saved under `tools/baselines/compatibility/` locally; `--report <file>` changes the output. Custom orders get separate filenames. The tool takes no action to install or update items. Preparing a playset uses Universal's normal local server and stable port registration. If three distinct playsets are already open, save your games and restart Universal yourself before preparing another; the checker never stops them.

**Reading the evidence:** `PASS` means the requested backend ran a populated space battle, the runtime mounted the expected IDs in priority order, selected effective bytes matched SHA-256 of independently read sources, and a real tactical snapshot could be written and read back. The JSON records the actual map, pack revisions where available, local Steam manifest IDs, selected winning paths and completely overridden items. The snapshot check is not a resumed campaign. `FILES ONLY` is a source-file check with no gameplay claim. `BLOCKED` means prerequisites or the route prevent the check (e.g. two primary overhauls in one playset). `FAIL` is an observed assertion mismatch; `NOT VERIFIED` covers runs that did not finish or whose publications changed. Rerun after an engine or mod update. Neither a successful launch nor these file checks establish native-game parity, every feature of every submod, every permutation, land/campaign progression, or multiplayer compatibility.
