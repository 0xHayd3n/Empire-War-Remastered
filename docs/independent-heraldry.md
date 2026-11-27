# Independent Forces on the commander stage

The six installed Independent Forces seats do not identify a usable, distinct faction emblem. Keep the pack/seat binding; do not choose a crest by a unit's allegiance, a translated family label or an internal faction key.

| Installed parent | Seat key | Evidence in the mounted faction record |
|---|---|---|
| Thrawn’s Revenge `1125571106`; Fall of the Republic `1976399102` | `Independent_Forces` | `Infantry_Icon_Name = i_button_pdf.tga`; an infantry button, not heraldry. No multiplayer map preview icon. |
| Revan’s Revenge `3417277973` | `Independent_Forces` | `Infantry_Icon_Name = i_button_navy_trooper.tga`; a trooper, not a faction device. No multiplayer map preview icon. |
| Awakening of the Rebellion `1397421866`; Awakening of the Clone Wars `3387971722` | `Independent` | No multiplayer map preview icon. `Icon_Name = i_icon_pirate.tga`, `Alternate_Icon_Name = pirate_icon.tga`, also used by unrelated seats. |
| Empire at War: Remake `1770851727` | `Pirates` (displayed as **Independent Forces**) | Same generic pirate icon references; the key is not evidence for a cartel insignia. |

Checked with `loadPack` → `openGame` → `loadGameData` → `db.faction(seat)` in a separate process for each parent; compared the winning `Data/Art/Textures/MT_CommandBar.mtd` and loose textures. In the latter three packs `i_icon_pirate.tga` does not resolve; the loose `PIRATE_ICON.DDS` alternative is the same 64×64 pirate sunburst as stock (file SHA-256 prefix `3e62976b0302b1d3b181`). It is not evidence of a distinct Independent Forces polity. The stock game does not supply a seventh independent seat.

Universal’s open orbit and navigation star is therefore labeled a **Universal neutral standard**, not an original faction logo from any of the mods. A verified emblem in a future revision takes precedence. Like other stage art, neither choice affects units, seats or battlefield rules.
