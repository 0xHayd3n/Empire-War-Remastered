# Workshop · HoloNet exchange

The previous single wall mixed acquisition, organization and launch priority, and made every named group look like a load order. **Workshop → Browse by category** now starts with overhauls, collection members, verified mirrors, browser imports, and your own categories. **New category** creates one; **File in categories** assigns a mod to several or creates a category with the mod already filed. Select a personal category to rename/delete it. Categories are stored in this browser profile. Deleting one removes only its filing labels, never files, subscriptions or priority.

The gallery and the selected item’s dossier are independent of the running game. Search by name, ID or saved collection. Use arrows or Home/End on the tiles; Tab goes into the dossier instead of through every tile. On a phone the gallery becomes a horizontal strip. Stamped numbers identify gallery entries, not ratings. Gold priority tags are positions in **your** working order.

**Missing a mod?** **Open Steam to subscribe** opens the item's Workshop page in a new tab. Complete any subscription/download there, then **Refresh** the local inventory. **Discover on Steam** opens the app's Workshop catalog. Neither link performs an installation. Ordinary browsing doesn't contact Steam. **Look up titles** asks before sending unnamed item IDs to Steam's public item-details endpoint. Pictures use the existing bounded local media route, never a URL supplied in mod metadata.

**Have the files?** **Add to playset** adds an installed, unambiguous item, not its dependencies. Expand a collection in the dossier to inspect enabled/off items and use its saved order. In **My playset**, raise/lower entries (first wins conflicts), save the order by name, or restore a saved order. **Prepare playset → Open playset game** opens a separate loopback game with exactly those layers; saves belong to that order. Multiple primary overhauls, conflicting editions and unresolved items cannot launch together. Playsets do not change subscriptions. In the standalone/browser game the gallery reports mounted content and links to local import instead of claiming a Steam installation.

## Acquisition evidence and limits

- **Same project, not necessarily the same release:** the [Thrawn’s Revenge publisher’s Downloads page](https://thrawnsrevenge.com/downloads) explicitly pairs Steam item `1125571106` with [Mod DB downloads](https://www.moddb.com/mods/thrawns-revenge/downloads). The dossier exposes that provenance. Other Steam items have no inferred Mod DB mirror. **Discover & import** also opens the independent external catalogs. No scraping, API feed, metadata URLs, remote installers, version matching, or automatic web downloads.
- **Get with Steam / Manage in Steam** opens a confirmation. If a desktop Steam client was found, its link uses Valve’s documented `steam://url/CommunityFilePage/<PublishedFileId_t>` ([Workshop implementation](https://partner.steamgames.com/doc/features/workshop/implementation)). This opens the exact item, not a game install or an automatic subscription. The HTTPS item page works without a local handler. For a known primary, verified item receipt or reviewed edition, the desktop option also shows the literal `workshop_download_item 32470 <ID>` command for manual use in Steam’s console. Evidence: the installed desktop client’s own command help says `workshop_download_item <appid> <PublishedFileId> : download a workshop item`; its client UI includes `steam://open/console`. Steam decides eligibility. The menu never executes commands, logs in, or pretends that opening or copying queued a transfer.
- [ISteamUGC::DownloadItem / GetItemDownloadInfo / SubscribeItem / UnsubscribeItem](https://partner.steamgames.com/doc/api/ISteamUGC) require a Steamworks client context and callbacks, not an anonymous HTTP API available to this browser. No private client RPC, credential collection, generic `steam://install/32470`, or unattended bulk changes. Manage subscriptions in Steam. An absent folder is not proof of unsubscribe.
- **Watch local status** polls only the selected item, every three seconds while visible. A delivered handoff is reported as a *request*, never as receipt by Steam. Per-item queue state and transfer bytes are unknown here. `appworkshop_32470.acf` must have the expected app ID, a committed `WorkshopItemsInstalled` row, and a `Data` directory on **the same drive** to confirm Steam installation. Manifest `size` is installed size, not downloaded bytes. An item missing from a readable commit table cannot enter a playset even if a partial folder exists. Without a readable table, locally indexed files can still be used as local data; they are not labeled confirmed Steam installs. Refresh to update the gallery and actions.
- **App-wide** is intentionally separate: `appmanifest_32470.acf` reports `StateFlags`, `ScheduledAutoUpdate`, `BytesDownloaded`, and `BytesToDownload`. Show a future scheduled update only with update-required set; show byte progress only while downloading with valid counters, or unknown bytes otherwise. An app transfer may be the game or any Workshop item. Idle cached counters never become a progress bar. The real read-only inventory returned 23 matching receipt/folder pairs; Thrawn’s Revenge reported 26,682,023,242 installed bytes, no active transfer. These optional local client file formats are observations, not a guaranteed Valve per-item progress API.
- **Import archive…** accepts an authorized uncompressed `.tar` up to 8 GiB containing a mod’s `Data` folder. Convert an extracted publisher ZIP/RAR yourself; do not run an installer for this menu. Explicit confirmation copies into the browser’s private `mods` storage using the existing streaming importer, showing measured copying and indexing progress. Only a completed archive/index appears in **Browser imports**. This is an enabled browser overlay for the current profile’s next reload, not a Steam installation or a server-side playset layer. **Remove browser copy…** confirms and removes its owned archive plus library record. It does not change source files, Steam folders, saves or other profiles. Cancel leaves the copy intact.

## Which edition is this?

- **Base** means the original/source Workshop item, including an add-on if that is what the item contains. It does not mean the unmodded game. **Universal pack** describes how that source is mounted. An available offline pack can be played without having an installed Steam item to add to a playset.
- **Native** requires a distinct stripped-back publication explicitly identified by the author. The trusted, reviewed pair list in `tools/title-workshop.mjs` is deliberately empty. Do not add a pair without the exact base and stripped item IDs and an evidence note citing the first-party release/manifest and what the author stripped. Do not infer pairs from titles, similar rosters, descriptions, third-party collections, arbitrary `modinfo` switches or matching hashes. A reviewed pair opens the other edition’s dossier and uses **its** Steam ID, installation, playset membership and launch layer. No review means no Native label/button, not a disabled placeholder.

**Read-only audit for this implementation:** 23 enumerated Steam items with `Data`, six saved FoC collections. The three EAWX primary `modinfo.json` files carry name/summary/icon/version/Steam metadata; the other three primaries have no such root metadata. The additional per-submod descriptions (e.g. shield-piercing munitions, CIS/Republic UI) describe add-ons, not verified stripped editions. No reviewed base/stripped pair was found. This is a local inventory finding, not a claim about every publication on Steam.

All six Universal profile manifests contain `format: 1`, `id`, `revision`, `info`, `rows`:

| Source ID | Source | Virtual rows |
| --- | --- | ---: |
| 1125571106 | Thrawn’s Revenge | 28,976 |
| 1976399102 | Fall of the Republic | 26,660 |
| 3417277973 | Revan’s Revenge | 16,567 |
| 1397421866 | Awakening of the Rebellion | 23,823 |
| 3387971722 | Awakening of the Clone Wars | 33,195 |
| 1770851727 | Empire at War: Remake | 26,479 |

`buildPack` in `tools/universal-library.mjs` inventories the effective source layer, records hashes/sizes, loose-vs-MEG provenance and deletion masks, and optionally materializes the bytes. `loadPack` verifies references and serves that layer. Changing byte storage/deduplication is **not** an author's stripped-back edition. See the [library audit](universal-library.md) for source-mount comparisons.

## Checks

```sh
node tools/test-title-workshop.mjs
node tools/test-workshop-status.mjs
# Browser check: install Chrome, then from the checkout root:
npm install --no-save --package-lock=false playwright-core
node tools/check-workshop-exchange.cjs
```

The status check covers wrong-app and partial manifests, mixed libraries, unknown and changing app-wide bytes, and absent client. The browser check also exercises category create/file/rename/reload/delete, exact publisher links, explicit handoff controls (never follows a Steam URI), live fixture byte updates, and a real fixture archive through OPFS install → game overlay read → cancel/confirmed removal with a save marker preserved. No actual Steam download is tested.

The edition unit check compares real thin and materialized fixture packs and verifies a distinct authored-pair fixture (not a production registration). The Chrome check uses disposable inventory, registry and browser storage, the real Universal host and title navigation with two fixture menu control IDs, the Workshop HTTP API, and a real opened `/play.html` server. It also opens the source pack through the actual profile selector. It verifies the mounted IDs **and the winning asset bytes** after reordering, naming and restoring the playset. The server's Steam response is a fixture; browser egress is blocked. Only loopback 9030–9032 and 9048 are used. No real subscriptions, Steam writes, or retail assets are required. These checks do not validate a particular retail campaign's gameplay.
