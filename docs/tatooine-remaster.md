# Clash on Tatooine

[Play the remaster](http://127.0.0.1:8590/#tatooine-remaster) · [Play stock](http://127.0.0.1:8590/#tatooine-original). Both open the same stock Forces of Corruption battlefield. The comparison links are session-only.

## Which Tatooine?

[Inspected place references and individual source links](../tools/remaster/directions/801c35a32439b92bb81d9f45c3aa6b405dc260362096156eb42e25ae84acd9e5.json). Six landscapes, three buildings and three settlement edges. The wide [Jundland Wastes](https://www.starwars.com/databank/jundland-wastes) wash and the floor of [Beggar’s Canyon](https://www.starwars.com/databank/beggar-s-canyon) show where sand collects below broken rock. The [palace approach](https://www.starwars.com/databank/jabba-the-hutts-palace), [Mos Espa](https://www.starwars.com/databank/mos-espa) and [Lars farm courtyard](https://www.starwars.com/databank/lars-moisture-farm) distinguish a hard threshold from dusty ground around a building. They do not justify adding a city to this skirmish map. Death Valley [location photographs](https://www.starwars.com/news/fully-operational-fandom-tatooine-looks-awfully-bright-to-me) and the NPS [Golden Canyon photographs](https://www.nps.gov/deva/planyourvisit/golden-canyon.htm) inform physical terrain only. No character shots or repackaged website stills in the game.

From the Universal checkout, reopen the inspected board:

```
node tools/map-remaster.mjs references --job 801c35a32439b92bb81d9f45c3aa6b405dc260362096156eb42e25ae84acd9e5
```

This reads and hashes every private image before reopening that exact job. `--refresh --places jundland-wastes,beggar-s-canyon,mos-espa` collects new candidates, not a new approval. A missing private image is not silently replaced on the reviewed board.

## What to inspect in battle

At the western deployment, look for shallow ripples at squad height and an uninterrupted sandy approach at command height. An earlier gravel candidate formed a repeating square pattern under the troops and was rejected. The krayt skull, ribs, dry Sarlacc bowl, working yards and authored hills keep their original locations. Sand gives way to gravel fans and fractured ledges; construction alone can authorize a concrete footing. The bushes and sparse trees are the mounted models at their authored roots. No extra plants were added at the perimeter. The distant relief meets the actual terrain rim, not the camera-pivot boundary.

**Within the sand:** the earlier ripple-to-fines mix cycled along a sine wave; loose sand looked stamped even though individual donor samples were decorrelated. The mix now follows irregular wind deposits at two scales. Under the western deployment and in the krayt basin, the mounted ripple share within the loose mantle spans 55 and 47 percentage points (p10–90). Ripple detail still reads up close; lighter granular stretches now break up those runs at command height. This is a material change, not a lighting overlay.

**Color under the desert sky.** Two adjacent sand windows in the western muster ground previously had median RGBs of (188,127,65) and (153,126,83). Holding only diffuse RGB constant nearly removed that hue step without removing any sunlight, normals, dust or shadows. The old recipe exposed bright sandstone wherever a rocky paint hint or nearby rock model suggested it, even on flats. Now pale fines and ripples carry across those flats, grit accumulates at the shoulders, and a sloped face is needed to expose the harder bed. The exterior uses the same mixture. No color grade, visibility change or weather edit is applied. The [climate review](map-remaster-workbench.md#substrate-light-and-weather) covers the western deployment and the Krayt basin under both authored skies and the storm/clear schedule.

The final [terrain ledger](../tools/remaster/terrain/801c35a32439b92bb81d9f45c3aa6b405dc260362096156eb42e25ae84acd9e5.json) binds 29 used/dynamic slots to seven [native-2K Poly Haven sets](../public/art/tatooine-ground/SOURCES.md). Mounted WebGPU, WebGL and 512px WebGL checks used the authored sandstorm environment. The nine camera pairs restored stock pixels exactly; the submitted scrub and tree groups remained visible in the class-on/off checks at 128 and 1600. Sixteen edge checks per run kept the intended ground windows clear of backdrop; the NW WebGPU control went from 403,612 exposed pixels to zero. The original link and rejected broken-ledge texture were tested separately. This is not a Workshop Tatooine release, a live construction-event test or a frame-rate benchmark.
