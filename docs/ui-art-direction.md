# UI art direction: start with the loading card

The loading cards are the reference for new Remastered UI. Modern Battlefront (2015/2017) informs the **hierarchy**: the scene comes first, the title orients the player, the controls make the next decision clear. Empire at War contributes a little warmth and its faction identities, not a gold frame around every control.

## Choose the reference before drawing the screen

| What is the player doing? | Reference | What carries across |
| --- | --- | --- |
| Navigating or setting up a game | Run `npm start`, open the [loading gallery](http://127.0.0.1:8377/briefings.html), and select **Command deck**, **Galactic Conquest** or **Battle setup**. | One contextual illustration, one left text edge, a small tracked section label above a much larger title. Instant Battle uses the same fleet illustration as Battle setup. |
| Entering a particular land or space map | The tactical `.battle-plate` in [briefing.css](../public/briefing.css), not the gallery’s transition preview. | One verified map photo edge to edge, or a dark text-only field; white place name, battle type and authored description. Aurebesh may repeat a readable place name, never replace it. |
| Deploying or playing | Carry the tactical card’s type hierarchy onto the **live battlefield**. | Keep the unit, aim point and objectives visible. A map, team colour or warning is information, not decoration. |

## Build the menu

- **Compose one scene.** Give the subject room opposite the text. Use a dark scrim behind the copy when needed. For lists or settings, align rows under section headings; use spacing and thin straight rules before adding another panel. A pause menu can keep the game in view rather than introducing new art. If every button has a glowing bevel, flatten the buttons and give only the selected row a short edge mark.
- **Give colour a job.** Use [the shared `--brief-*` tokens](../public/ui-theme.css) for midnight/slate surfaces, ivory titles and cool supporting text. Reserve the card’s muted amber for a small emphasis such as the current choice or main action. A chart or fleet transition can use its existing cool signal instead. Keep faction, readiness and danger colours tied to their actual meanings.
- **Label the decision.** Use local [Oswald (`--ui-font`)](../public/typography.css), a short title, and verbs like **Start battle**. Keep prose mixed-case. Distinguish the current choice with a rule, weight or mark that survives greyscale; give keyboard focus its own visible outline. Motion may explain a change of state; respect reduced motion.
- **Use art with a known source.** Choose a shipped [briefing illustration](../public/art/briefings.svg), an in-engine view, or the relevant mounted game/mod asset. For tactical photographs keep the [exact-map verification](../public/js/game/battleart.js). Missing art or lore means less content, not a generated planet, invented history or substitute photo. Keep private mod art out of the repository.

Scope styles to the new screen. Leave archive-defined layouts, localized fonts and textures, and selectable classic HUD/deployment presentations intact. For example, style the Instant Battle setup, not the restored Single Player dialog that opens it.

## Visual review — required for player-facing changes

1. Name the reference card and the player’s main decision. Compare a **running screen** with that card at desktop and narrow widths, not just a mockup.
2. Check the title, main action and current choice with the art missing; tab to the controls and enable reduced motion. Long map/mod names must not hide the action. Record any state you could not exercise.
3. Account for each accent, badge and paragraph: what location, choice or state does it communicate? Remove anything with no answer. If the screen needs an exception, show why in the review instead of silently creating a second style.

For the Instant Battle example, run `node server.mjs --static` and, in a second terminal with Chrome and `playwright-core` available, `node tools/test-ui-art-direction-browser.cjs`. This checks that card and menu share art and title colour, and exercises keyboard selection and the narrow no-art layout without a game install. It complements, rather than replaces, the visual comparison.

### Single-player setup review

New Campaign follows **Galactic Conquest**: choose an installed story and difficulty. The inset chart reads its planets, trade routes and faction home from campaign data; the ring marks the home, not a selectable starting position. Skirmish and solo Instant Battle follow **Battle setup**: select a battlefield, review the forces, then start or open the detailed controls. A missing preview leaves the map name and setup usable.

`node tools/test-operation-setup-browser.cjs` checks the running screens against the gallery in Chrome with a stock game mounted (`SWR_GAME` for the server, `BASE_URL` for the test). The review covered 1440×900 and 390×844, reduced motion, hidden art, keyboard focus, both editions' story selections and the handoff to and from detailed staging. Instant Battle was also launched from Single Player into a live tactical world. Workshop-specific dialog layouts and full campaign playthroughs were not part of this review.

To check **menu entry** rather than battle startup, run `node tools/test-menu-previews-browser.cjs` against a stock mounted server (`BASE_URL`). It enters all four selectors from Single Player, checks for the selected map and its markers on the first visible frame, and reports click-to-frame times. The main menu warms campaign data and the initially selected battlefields, not every map or a running simulation.
