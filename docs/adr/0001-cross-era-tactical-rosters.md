# Compose tactical rosters, not primary mod installations

**Status: proposed.** For solo cross-era Skirmish and Instant Battle, keep exactly one [battlefield host](../../GLOSSARY.md) and compose a battle-local roster from revision-pinned faction sources. Both modes and their simulations must consume the same resolved roster; the player picks a map and factions independently.

Merging primary mod file systems cannot represent two different `Rebel` factions, damage tables or versions of the same model at one path without making one win. Running a simulation per mod would instead give two authorities over collisions, damage and victory. One simulation with isolated faction data preserves native battles and existing Workshop load order, at the cost of explicitly supporting each kind of imported behavior. An unsupported roster must be identified, not silently replaced with host units.

See the [architecture and release gates](../cross-era-tactical.md).
