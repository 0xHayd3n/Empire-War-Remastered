# Multiplayer operations

**Play → Multiplayer** switches the visible modes without connecting to a lobby. Choose **Custom games** for manual Internet/LAN rooms, or **Matchmaking** to open the flight lobby: playlist and network controls on the left, actual local callsign and one opponent slot on the right. **Playlist → Social or Ranked → choose a ruleset → Use playlist.** Back/Escape discards tentative edits. **Start matchmaking** begins a five-second cancellable countdown. No ticket exists until it expires. The active search scans the selected relay; other-ticket and compatible-ticket counts are measured for that lane/ruleset, not a global player population. The main navigation, bell, cog, build label and section heading leave the screen during matchmaking. A sharp orbital scene replaces the title backdrop; the two command panels have a slight stationary perspective on desktop, flat on narrow screens or reduced-motion settings. The bottom **Back** button, Backspace or Escape cancels one layer at a time; Backspace still edits callsign/relay text. Pairing opens a map ballot, not combat. A mod with a nonstandard native title dialog keeps its native navigation.

**Connection:** inherit the existing game relay, select this machine’s loopback relay, or enter a trusted HTTPS/loopback relay and test its registry. The matchmaking callsign, route and playlist are saved per game origin. Explicit settings apply to queue polling, the room socket and its reconnects. They do not overwrite the native Internet/LAN configuration or the social relay. **Custom games** bypasses matchmaking for existing manual hosting, browsing, code joins and invitations.

**Social** does not track results. **Ranked** uses an isolated queue and prefers the nearest advertised device rating among currently dialable compatible tickets. This is not a skill cutoff or a verified public leaderboard. A new record starts at 1,000; completed wins/losses change it by ±16 within 100–3,000. Records are local to the browser origin, relay, content profile and ruleset. Staging, cancellation, manual rooms, leaving, and draws do not award points. Clearing device storage resets the record. Queues admit solo commanders, one per side; no party, guest slots, fabricated opponents or estimated player populations.

| Intent | Ruleset | What happens in battle |
| --- | --- | --- |
| Build a foothold | Orbital Foundry | Space skirmish economy. Each player starts with 3,500 credits, fog of war, a shipyard and an 18-population cap. |
| Build a foothold | Beachhead | Land skirmish with 9,000 credits, fog and unbuilt faction base sites. Players choose their build order. |
| Strike now | Last Flight | Native instant-battle fleet elimination: no shipyard, no opening credits, open sensors. The host issues one lead ship and two escorts per faction from the active non-hero roster. Both clients receive the same explicit fleet lists. |
| Strike now | Signal Lock | Native land control on an authored control map. Occupy every domination-relevant point and hold for the mounted content's victory countdown. Open sensors and pre-built faction bases where the map provides them. |

Two humans, opposing teams, in separate Social and Ranked queues. Both get a rules card in staging. Faction and color can be selected, but the paired map, teams, economy and victory rules cannot be changed. An operation with no eligible map (or no usable task-group roster) refuses to queue. Manual rooms retain their normal editing controls and never open a ballot.

### Map vote

The playlist picker lists the actual mounted rotation. Stock preferences, listed by battlefield, are:

| Ruleset | Preferred pool |
| --- | --- |
| Orbital Foundry | Geonosis, Kessel, Bespin, Kuat, Coruscant, Kashyyyk, The Maw |
| Beachhead | Alderaan, Polus, Shola, Ryloth, Dathomir, Utapau |
| Last Flight | Endor, Polus, Hoth, Yavin, Alderaan, Felucia, Naboo |
| Signal Lock | Bothawui, Saleucami, Felucia, Bespin, Kamino, Naboo, Tatooine, Yavin, Endor |

These are preferred file IDs, not promises of content: a mod can replace, rename or omit a battlefield. Sparse pools fill from eligible mounted multiplayer maps of the correct domain; Signal Lock always requires a `CONTROL` tag. A shared room ID determines up to three distinct candidates and their order. Actual map pictures are shown when available; a survey grid is used otherwise. Both commanders can change their vote for 15 seconds. Highest count wins; ties (including no votes) go to the first tied candidate in the displayed order. A single-map pool never gets padded with duplicates. Leaving the ballot ends the pairing without a score. On agreement, the elected file is locked in native staging and used by both simulations.

## Match and invitation boundaries

- The playlist lane and variant ID are part of the compatibility digest, the relay ticket, the staging state and the launched battle setup. The protocol revision separates new queues from old clients. Builds, edition, ordered mods, game-object fingerprint, full pack revision and map/faction metadata must match. No checksum of every art asset is claimed.
- Uses the existing relay and `NetSession`; no new relay endpoint or deployment. Both clients need the same reachable relay. Searches time out after 90 seconds; there are no bots or silently widened rulesets.
- **Invite friends** is an explicit action in manual Internet and LAN staging (including Instant Battle) with an open human slot, an active relay connection and no password. It is omitted from reserved operations, and hidden when a manual room fills or leaves staging. Opening a slot makes it available again. Password rooms retain their existing code/password workflow.
- The staging button dynamically loads the coordinator's `socialpanel.js` and calls `openInvitePanel({room: net.gameId, kind: 'lan' | 'internet'})`. It does not advertise room codes to a global inbox or implement delivery. A missing social module does not prevent staging. Acceptance can navigate to **the compatible game origin** `/play.html?multiplayer=lan&join=ROOM` or `?multiplayer=internet&join=ROOM`; preserve the configured relay (`&lobby=...` when overridden). The host must still be present and have space. Invitations do not reserve slots, mount another playset, or confer access to a reserved match.

## Verify locally

From the checkout root, with Chrome, installed FoC game data (or `SWR_GAME`) and the project's local relay dependencies. Git Bash example; both browser commands use the same ports, so run them **sequentially**:

```sh
npm ci --prefix lobby
npm install --no-save --package-lock=false playwright-core
node tools/test-play-compatibility.mjs
node tools/check-play-matchmaking.cjs
node tools/check-play-matchmaking.cjs --battles
```

The first browser check covers the immersive desktop and mobile lobby, reduced-motion fallback, Backspace navigation and text editing, playlist draft, saved queue/network preference, relay probe, five-second countdown cancellation with no ticket, observed incompatible-ticket counts, a full no-match window, leaving a paired ballot, native private room entry and direct-link acceptance. The second verifies Social/Ranked isolation for the *same* ruleset and separation of different variants on identical stock clients. It reads each mounted stock pool, checks that every Signal Lock map has real domination markers, casts and changes votes from two browsers, and compares the elected file to each actual launched world after lockstep advances. A deterministic terminal fixture then resolves Last Flight fleet elimination and Signal Lock domination in their native game engines, verifying opposite local rating deltas. It does not claim a public ranking service or a complete unassisted human playthrough. `--battles signal-lock` runs just that launch after variant isolation. Neither test uses a public relay, player saves, or mocked opponents. The invitation UI and inbox delivery belong to the separate social integration test.
