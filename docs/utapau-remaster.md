# Utapau Heights

[Play the remaster](http://127.0.0.1:8590/#utapau-remaster) · [Compare the original](http://127.0.0.1:8590/#utapau-original). The links launch the stock Forces of Corruption skirmish for the session. **Utapau heights** is off by default in Graphics Quality.

From the southeast muster, follow the fine sand into the pebbled runnels, then look across the parapet. The six projecting decks keep their straight manufactured edges; the fractured banks and open scrubland outside them do not inherit that paving. The large sink is the original opening and interior model, not a dark texture or a lake. The low exterior hills join the existing ground without changing where the camera can go.

## What was checked

- The 311 × 311 TED (`6a8e1bd4687624b56de293165e17b0c627c52b45b5bb13ff537b8d06209df665`) has 28 drawn terrain slots. All 22,702 fully holed quads remain absent, and the `W_Utapau_Hole.ALO` placement remains at its authored anchor.
- Both concrete-painted slots coincide with the six wall-bounded platforms: 5,216 built and 68,269 natural drawn vertices, with no unauthorized paving at launch. Slot 62 can additionally follow a real construction paint receipt. No live construction event was needed or claimed in this review.
- The southeast and northwest shelves have different mixes of the same fines and grit. A first-pass sand scan produced rectangular bands at command height; isolating that channel reproduced the pattern. Replacing the scan removed it without tinting the ground or changing the Utapau sunrise.
- Nine HUD-on camera views per tier, both formations, close grain pans, retained shrub and tuft draws through zoom 1600, and eight perimeter directions at maximum and oblique angles were checked on WebGPU, WebGL and 512px WebGL. The nine measured off/on/off comparisons per tier differed by at most one pixel on restore. Corrupting the platform surface kept the stock terrain active.

The reference board uses eleven place views: Utapau and Pau City for the relationship of walls, decks and open ground; terrestrial analogues for rock, scrub and settlement edges. The stock board depicts only a few platforms, not the whole inhabited city. The original shrub models also retain their flat silhouettes at some angles. No terrain change is a claim about sustained FPS, all hardware or Workshop maps.

[Material sources](../public/art/utapau-ground/SOURCES.md) · [Workbench](map-remaster-workbench.md)
