# What could be shared next?

## Does Rapier let us strip installed assets?

**No installed asset was proved safe to delete because of Rapier; no files were removed.** Physics changes how a supported death is presented. Space still loads the authored `DIE` animation before releasing the pieces (`public/js/game/render.js`, `deathClone`); land still selects ordinary and specific death clips (`public/js/game/land.js`, `die`) and preserves the gameplay lifetime of obstacle wrecks (`blockWreck`). Meshes and skeletons provide the pieces themselves. Unsupported or over-budget deaths still use the authored path. These requirements are independent of whether one observed kill visibly played its death clip. Do not remove animations, models, collision helpers or scripts from a subscribed item based on their name or one playthrough.

Read-only Windows snapshot at `757bab3` (local working tree). Steam's installed-items manifest listed **26 items** for app 32470; audited each directory once, plus the full base game and Forces of Corruption install. Saved load orders are not extra copies of those directories.

| Measurement | Result | Interpretation |
|---|---:|---|
| Steam files | 166,827 paths, 137.23 GiB | Logical contents, not allocated clusters. No symlinks/reparse points skipped or unreadable paths reported. |
| Identical whole files | **43.46 GiB** (46,666,351,349 bytes) | 60,772 extra copies across 37,636 identical-content groups. Size buckets followed by full SHA-256, including differently named files. Counted distinct file identities; no existing hard links counted as savings. MEGs count as whole files here, not individually reclaimable members. |
| Where those duplicates are | 22.77 GiB DDS, 14.15 GiB ALO, 2.70 GiB TED, 1.72 GiB WAV, 2.12 GiB other | For example, both Awakening mods' `Kuat_Ring.ALO` files also compared equal byte-for-byte (141,712,896 bytes). The paths must still resolve independently. |
| Death-named `.ALA` candidates | 4,307 entries, **160.45 MiB** | Loose files plus the directories of all 54 MEGs. Basename tokens `DIE`, `DEATH`, `DYING`, `DEAD`, including numbered variants; duplicates counted. This is a filename inventory, **not** measured unused bytes or a complete semantic animation list. |
| Universal's six primary manifests | **41.54 GiB already avoided** vs six separate expanded payloads | `node tools/audit-universal-packs.mjs`: 117.56 GiB logical, 76.02 GiB distinct. This comparison is **not additive** to the Steam figure. |
| Universal's current object cache | **33.84 GiB** (36,340,514,999 bytes) | All 25,927 cached objects hashed correctly. For each referring primary, verified an installed winning loose file or MEG slice against that digest: 42,147 profile/digest checks, zero mismatches, zero orphan objects. Count bytes once per digest. |

**What changed since this audit:** the [installed-parent reader](universal-library.md#what-is-stripped) verifies and serves the selected parent’s bytes without making another disk copy. The 33.84 GiB above was an upper bound for that installation, **not** a claim of space freed. `npm run universal:trim` reports which private cached objects are reproducible; it does not delete them by default. The audit did not write to the game, Workshop or packs.

## Earlier measurements

Read-only measurements against the six built mini-mod manifests at `9b6b330`, the local stock game and the six corresponding installed parents. These are alternatives to **whole-object sharing already in place**. No cache was purged, no pack format changed, and none of the numbers below is freed disk, a Steam download saving or an in-game timing.

## Installed mode: avoid the second copy

At the time of this earlier audit, `buildPack()` cataloged a parent's winning paths and the reader copied and verified an object on first use, even when its parent was still installed. For each of the six packs, resolved each *already cached* distinct digest back through that pack's own parent layer (`openGame(..., {collectMod})`), then streamed and hashed its winning loose file or MEG slice. **26,957 parent/digest checks, 0 mismatches; all 16,709 unique cached objects (20,966,253,776 bytes / 19.53 GiB) had verified installed sources.** Counted each object only once for the storage figure. This suggests a direct-from-parent mode, not one overhaul depending on another. Offlining a pack still needs an independent verified copy. A source change must never silently change a mounted revision; fall back to already-verified bytes or ask for a rebuild. A bounded cache may still be desirable if cold or repeated range reads regress. Do not evict existing offline objects as part of enabling this mode.

## Portable mode: one lossless map reader, not one map layout

Enumerated every distinct `.TED` digest across the manifests. For each file, verified its source against its recorded SHA-256. Split it at fixed 256 KiB boundaries, tried raw DEFLATE level 1 per block, retained the smaller of raw and compressed, inflated every compressed block, and checked each complete reconstructed file against the original digest. This was an in-memory experiment, not a production writer, loader or disk-allocation benchmark.

| All six packs; identical whole maps counted once | Bytes |
|---|---:|
| 1,959 distinct original TEDs | 7,005,851,437 |
| Stored block bytes, each map independent | 571,372,784 |
| Estimated index: 64 bytes/map and 12 bytes/block (27,838 blocks) | 459,432 |
| Independent seekable map records, estimated total | 571,832,216 |
| Alternative with one global block dictionary, estimated including larger index/headers | 555,165,145 |

**Recommendation:** Start with independent compressed map records in the existing content-addressed store. Compared with a fully materialized raw map set, this is **6.52 → 0.53 GiB**, about **5.99 GiB** less before filesystem overhead. Cross-file block sharing only improves on that by another ~16 MiB in this experiment and complicates offline independence. A shared reader must return original bytes, length, and range responses; maps retain all their original objects, scripts, art references and placements. First test mixed raw/encoded objects, corruption, ranges crossing blocks, parent-absent loads and actual tactical startup vs. the current reader. See `tools/megfs.mjs:openGame()/readPart()`, `tools/universal-atlas.mjs:completeOfflinePack()`, `server.mjs`'s `/asset/` and `/api/modinfo` handling, and `tools/test-universal-library.mjs` for the existing compatibility requirements.

As a follow-up only: tested 64 cached files each of `.ALO` models and `.DDS` textures (at least 256 KiB, first 64 by SHA-256 in each class). The same independent block encoding and round trip gave **80.5%** and **51.5%** less on those samples. This is not a whole-library forecast and doesn't justify changing the rendered data. The installed-mode and portable-mode savings overlap; **do not add them**.

## What can share gameplay code?

Thrawn, Fall and Revan's `.../ui/category-filter/CategoryFilter.lua` all have the planet-selection, category change and yard-level filter flow. An options/shipyard UI adapter could unify *how* a player requests a native option while each mod specifies *which* orders are valid. This fits `public/js/game/universalcanon.js:stepCanonOrder()` and `startingappearance.js:stepAppearance()`, which both use `availableUnits()` and `queueUnit()`. It is an interoperability opportunity, not a disk-size project: the three native category scripts are already just two distinct files (7,812 and 7,806 bytes). All distinct Lua payloads combined are about 16.3 MiB. Do not delete native handlers, balance data or campaign rules to achieve the storage estimates above.
