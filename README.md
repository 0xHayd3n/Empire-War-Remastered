# Empire War Remastered

Empire War Remastered is 0xHayd3n’s unofficial fork of RIRA’s [Empire at War: Browser Edition](https://github.com/Glenn332/Empire-At-War-Browser-Edition). It runs *Star Wars: Empire at War* and *Forces of Corruption* in a desktop browser using the files from your own Gold Pack installation. It is not a patch for the retail executable, and it does not include the game or any Workshop mod.

**Development build:** `remastered` includes the current Universal engine, remastered battlefields and unfinished experiments. To try it, fight on Endor with the forest overhaul, paint a fleet, or compare the same battle with its original scenery. Settings and save behavior can change between commits. The [earlier checkpoint](https://github.com/0xHayd3n/Empire-War-Remastered/tree/29a04135410f08a2b526346e132400f29d6f934d) predates the physics and map work.

**Where it comes from:** The browser engine, land and space battles, Galactic Conquest, multiplayer and mod loading are the work this fork builds on. [PlayEAW.com](https://playeaw.com) hosts **upstream Browser Edition**, not Remastered.

## Play locally

You need your own installed **Empire at War – Gold Pack** (both the base game and expansion), [Node.js 22 or later](https://nodejs.org/) with npm, and a current desktop browser such as Chrome or Edge. No Workshop subscription or native build is required for stock play. The checkout includes the remaster materials and browser runtimes so you do not have to cook textures or compile physics yourself.

```sh
git clone --branch remastered https://github.com/0xHayd3n/Empire-War-Remastered.git
cd Empire-War-Remastered
npm ci
npm run universal
```

Open **[http://127.0.0.1:8590/](http://127.0.0.1:8590/)** and keep the terminal running. You should see **Home** with **Play**, **Workshop** and **Army Painter**. Try **Play → Single Player → Skirmish** for a battle, or **Galactic Conquest → Galactic Civil War** for a stock campaign. Close the server with `Ctrl+C`. On Windows, double-clicking `Universal Library.cmd` starts the same game.

- **Game not found?** The launcher checks Steam libraries. For a different install, set `SWR_GAME` to the folder containing **both** `GameData` and `corruption`, then restart. For example, in PowerShell: `$env:SWR_GAME = 'D:\Games\Star Wars Empire at War'`. Set `STEAM_PATH` to your Steam client directory if Workshop discovery misses your library.
- **Want to use overhauls?** Install a supported parent mod in Steam, stop the server, run `npm run universal:build`, then `npm run universal` again. The default build indexes installed parents; keep them installed and rebuild after updates. Stock needs no indexing step. See [supported profiles and storage](docs/universal-library.md#what-is-stripped).
- **Want a saved mod collection instead?** Run `npm run workshop`, open [the local collection launcher](http://127.0.0.1:8490/), select the collection and choose **Launch**. For the standalone folder/archive importer, use `npm start` and [open the import page](http://127.0.0.1:8377/). These are alternatives to the Universal window, not extra setup steps.
- **Port conflict or missing saves?** Universal uses `8590`–`8597` on loopback. Use the same browser profile, address and ports when returning: saves belong to the profile’s browser origin. `SWR_UNIVERSAL_PORT` moves the whole block; it does not migrate saves.

### Try a remastered battlefield

With the local server running, open [Endor Ultra](http://127.0.0.1:8590/#endor-ultra) and compare it with [original Endor](http://127.0.0.1:8590/#endor-original). Both launch the same stock battlefield in this engine; neither overwrites your game files. The **seven** map guides explain which map revision is targeted, what changed and how to switch back:

[Endor forest](docs/endor-full-landscape.md) · [Yavin Training Grounds](docs/yavin-remaster.md) · [Tatooine](docs/tatooine-remaster.md) · [Hoth](docs/hoth-remaster.md) · [Geonosis](docs/geonosis-remaster.md) · [Naboo](docs/naboo-remaster.md) · [Utapau](docs/utapau-remaster.md).

These are visual replacements for specific mounted maps, not seven bundled retail maps or a blanket overhaul of Workshop worlds. A changed source or unsupported configuration keeps the original scenery. The [map workbench](docs/map-remaster-workbench.md) includes the recipes, material provenance, capture tools and review gates for further work.

## What Remastered changes

| Area | What you can do in this fork |
| --- | --- |
| Battlefield rendering | Compare original and enhanced lighting, shadows, terrain relief, vegetation, weather, wet ground, orbital light and hull damage. Battle upscaling keeps the HUD at native resolution; HDR requires a supported WebGPU display path. See [battle realism](docs/battle-realism.md), [weather](docs/immersive-weather.md), [upscaling](docs/battle-upscaling.md) and [HDR](docs/hdr-output.md). |
| Tactical physics | The bundled Rapier solver drives infantry ragdolls, wreck sections and debris on rendered land and space battlefields. New solo battles also use collision checks for movement, ramming and projectile contacts. Cosmetic debris does not deal damage; multiplayer, old replays and strategic auto-resolve do not silently adopt the new solo rules. [Physics scope and fallback](docs/mod-death-physics.md) · [Land craters](docs/land-craters.md) |
| Settings and controls | Under **Settings → Video → Graphics Quality**, use the land/space realism switch or tune individual effects. System Settings also covers camera, bindings, audio, HUD, accessibility, replay and campaign defaults. Portable preferences follow you between profiles; saves and network identity do not. [Full settings inventory](docs/settings-inventory.md) |
| Campaign library | Instead of restarting a collection to see its campaigns, compare maps by era, starting period, faction and planet count on one galaxy chart. Launch the chosen campaign under its own rules, scripts and save origin. [Universal campaign guide](docs/universal-library.md) |
| Campaign objectives | On supported starts, opt into missions such as escorting a Rebel freighter from Hoth to Bespin or recovering a derelict at Sullust. In the stock Rebel *Equal Footing* opening, you can commission an existing cruiser as a flagship whose damage persists between battles. These are specific options, not changes to every campaign. [Objectives and eligibility](docs/universal-library.md#start-a-campaign-and-choose-its-path) |
| Workshop and load order | Browse installed items and collections, inspect their sources, and save named playsets. Reorder items to resolve conflicts (first wins), then launch the playset without replacing the running Universal session. Steam still manages subscriptions. [Workshop guide](docs/workshop-exchange.md) |
| Home and fleet setup | **Continue Campaign** returns to an eligible conquest save. Use **Army Painter** to preview and equip a named livery in solo or multiplayer. Open **Fleet registry** to inspect a ship and save a flight card or fleet preset. Skirmish and Instant Battle share a searchable battlefield chart; supported cross-era setups keep each seat’s source roster. [Army Painter](docs/army-painter.md) · [Fleet registry](docs/unit-armory.md) · [Cross-era battles](docs/cross-era-tactical.md) |
| Battlefront ground combat | Choose a class and a friendly spawn on a round command-post map. On the field, the shoulder sight stays on target through zoom, first-person blasters follow supported unit rigs, and vehicles get their own chase framing. The HUD shows the aimed unit’s health, local radar and capture progress. The original deployment layout is still selectable. [Side-by-side comparisons](docs/battlefront/comparisons.md) |
| Multiplayer | Choose one of four land or space rulesets, match with a compatible opponent, and vote on the map before both players ready up. Optional friend codes, messages and invitations complement custom rooms. Ranked results stay on the device; there is no public ladder. [Rulesets](docs/play-operations.md) · [Commander network](docs/commander-network.md) |
| Texture memory | When a compressed texture lacks smaller detail levels, the engine generates them a strip at a time. On a 2048×2048 DXT5 test texture, the two temporary pixel buffers fell from **20 MiB to 4.125 MiB**, with identical output. That is a memory measurement, not an FPS claim. [Texture comparisons](docs/universal.md) · [Opt-in fleet rendering experiments](docs/fleet-render.md) |

[![Same Stormtrooper on Endor: Browser Edition’s deployment dialog on the left and Remastered’s class portrait and command-post map on the right](docs/battlefront/deploy.png)](docs/battlefront/comparisons.md)

*Deployment on Endor, captured in the same scenario. [See the cameras, HUD and moving comparisons](docs/battlefront/comparisons.md).*

## Compatibility and multiplayer

The Universal library recognizes **Thrawn’s Revenge**, **Fall of the Republic**, **Revan’s Revenge**, **Awakening of the Rebellion**, **Awakening of the Clone Wars** and **Empire at War: Remake** as separate profiles. Only the profiles you install and build can launch. Cross-era tactical play does not merge the source campaigns or their scripts, and support for a parent mod does not guarantee every submod combination works. Galactic Conquest and script parity are still in progress; the [engine progress log](progression.md) records known gaps.

To test multiplayer on **one computer**, run `npm ci --prefix lobby` once, then `npm run relay:local` in a second terminal and select the local relay in the game. Use separate browser profiles for the two players. **Across computers**, both players need a matching build, edition and mod order, and the same reachable compatible relay. The loopback command does not deploy an internet service.

## Development and reporting

The browser code is in [`public/js/`](public/js/), the simulation and UI in [`public/js/game/`](public/js/game/), the local launchers and tests in [`tools/`](tools/), and the optional relay in [`lobby/`](lobby/). To check a checkout **without retail files**:

```sh
npm ci
npm run test:universal
npm run test:workshop
npm run test:submods
npm run test:deploy
npm run test:battlefront
npm run test:painter
npm run test:immersive-weather
npm run test:remaster-maps
npm run build:prod
```

`build:prod` checks the module graph and writes a static site to `dist/`; it does not package retail assets or replace the Universal server. For mounted checks, install Chrome and run `npm install --no-save --package-lock=false playwright-core`, then `npm run test:title-menu` with your local Gold Pack available.

[Player guide and controls](docs/player-guide.md) · [Battlefront test coverage](docs/battlefront/README.md) · [Fork compatibility standard](docs/fork-mod-compatibility.md) · [Report a bug](https://github.com/0xHayd3n/Empire-War-Remastered/issues) · [Report a security concern privately](SECURITY.md)

## Credits and license

Original browser engine: **RIRA and the Browser Edition contributors** (Copyright © 2026 RIRA). Remastered fork: **0xHayd3n**. The original game and expansion are by Petroglyph and LucasArts. The Workshop teams retain credit for their own overhauls; no subscription, mod payload or generated Universal library is redistributed here.

The engine code is [GPL-3.0-or-later](LICENSE), without warranty. The remaster adds [Rapier 0.17.3](public/vendor/rapier/LICENSE) and [meshoptimizer](public/vendor/meshoptimizer/LICENSE.md). Redistributable landscape materials and vegetation are credited alongside their outputs in [`public/art/`](public/art/), including [Poly Haven scans and the Endor source notes](public/art/endor-terrain/SOURCES.md). Generated packs that depend on your retail or Workshop files stay private. Bundled dependencies retain their own notices: [three.js](public/vendor/three/LICENSE), [Fengari](public/vendor/fengari/LICENSE), [FFmpeg core and corresponding source](public/vendor/ffmpeg/SOURCE.md), [Oswald](public/fonts/oswald/OFL.txt) and [Aurebesh AF](public/fonts/aurebesh-af/NOTICE.txt).

This is a non-commercial fan project, not an official remaster or an endorsement by Lucasfilm, Disney, Petroglyph or Electronic Arts. The code license grants no rights to *Star Wars*, the retail game data, Workshop content, or the game imagery shown in the comparisons.
