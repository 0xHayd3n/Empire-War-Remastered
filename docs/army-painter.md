# Army Painter

Open **Army Painter** on the start page or from game setup. In the Universal title hub choose **Home → Army Painter**; **Fleet registry** still opens the separate ship cards and fleet blueprints. With a local game mounted you can also go directly to `play.html?army-painter`.

1. Choose a faction. Use the **Preview unit** list or arrows to inspect a ground unit or ship from the mounted data; **Rotate unit** turns it to inspect the sides and back. Changing units never changes the draft or a battle roster.
2. Choose **+** to start a livery, or edit a material while viewing stock to create one. Name it, choose the primary and secondary colors, then the two smaller trim/detail colors. **Standard**, **Banded**, **Split** and **Chevron** distribute those colors differently. The original surface detail remains visible; the coverage depends on each model's materials.
3. **Save & equip** makes that livery the faction's choice on this device. Select a different saved livery and equip it, or select **Stock markings → Equip stock** to opt out without deleting anything. Deleting an equipped livery restores stock. Back and faction/preset switches ask before discarding edits.

A livery paints the army, not the minimap, team indicators or selection rings. It does not grant units, equipment or stats. Presets are local to the mounted content profile and faction; match setup shares just the equipped paint, not the preset library or its names. Missing models fall back to the mounted unit icon or a text notice. Reduced motion leaves the preview posed.

## Checks

- `npm run test:painter`: saved/stock state, profile and owner isolation, ready/start validation, shader pattern coverage, material pools and portrait resources.
- With a local retail-data server, Chrome and `playwright-core`: `node tools/test-army-painter-browser.cjs` exercises the real editor, mounted ground and space previews, reload, narrow layout and delete. `node tools/test-livery-staging-browser.cjs` exercises local and two-player Instant Battle staging in separate browser stores with an in-process message relay. Use `BASE_URL` to select a running local server. With a local lobby Worker, set `SWR_TEST_RELAY` and run `node tools/test-livery-room-browser.cjs` to join and launch an actual two-client LAN room; it checks both paint patterns in both live render scenes.

## Visual review

Reference: the **Command deck** loading card. The primary decision is which livery to equip; the live mounted model occupies the space reserved for artwork. At 1440×900 the title and controls share a left edge, separate from the unit. At 390×844 the unit sits above the controls, and Back and Save remain in view. Checked the small layout with the ALO blocked: the original command icon and an explicit availability message replace the model without disabling the editor. The selection underline and keyboard outline are separate from the editable colors. No private game or mod images are bundled.
