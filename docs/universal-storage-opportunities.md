# What could be shared next?

Read-only measurements against the six built mini-mod manifests at `9b6b330`, the local stock game and the six corresponding installed parents. These are alternatives to **whole-object sharing already in place**. No cache was purged, no pack format changed, and none of the numbers below is freed disk, a Steam download saving or an in-game timing.

## Installed mode: avoid the second copy

`buildPack()` catalogs a parent's winning paths; `loadPack()` / `ensureObject()` currently copy and verify an object on first use, including when its parent is still installed. For each of the six packs, resolved each *already cached* distinct digest back through that pack's own parent layer (`openGame(..., {collectMod})`), then streamed and hashed its winning loose file or MEG slice. **26,957 parent/digest checks, 0 mismatches; all 16,709 unique cached objects (20,966,253,776 bytes / 19.53 GiB) had verified installed sources.** Counted each object only once for the storage figure. This suggests a direct-from-parent mode, not one overhaul depending on another. Offlining a pack still needs an independent verified copy. A source change must never silently change a mounted revision; fall back to already-verified bytes or ask for a rebuild. A bounded cache may still be desirable if cold or repeated range reads regress. Do not evict existing offline objects as part of enabling this mode.

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
