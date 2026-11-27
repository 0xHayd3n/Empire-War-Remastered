# Destruction physics for Workshop units

**Coverage contract:** With Rapier initialized, every visible combat death the game reports on a rendered battlefield at a valid position has a native physics effect. No Workshop ID, unit-name entry, downloaded asset or per-unit opt-in is required. This is a guarantee about death handling, not a guarantee that a mod loads successfully or that every model can be articulated.

- On land, recognized humanoids use ten bodies and nine joints tied to their last rendered pose. Foot infantry with an unrecognized but connected bone hierarchy can instead use up to twelve bodies, following the model’s own pivots, skin weights and bone-mounted rigid meshes. Rigs with ambiguous named anatomy, unusable pivots or no drawable limbs keep their authored death rather than receiving invented joints. Supported ground vehicles and ships use actual visible mesh groups. A walker exported as a single skin can still come apart at its mechanical joints: triangles tied together by skin weights stay together. Separate pods exported under a common parent can detach intact.
- If the unit is a creature, aircraft, building, unusual rig, missing mesh, new unit category, or simply dies after the full-detail budget is exhausted, its authored death stays in charge. A small, tumbling fragment is simulated alongside it. This fallback never hides the unit or pretends that one fragment is an articulated body.
- When there is only one hull, the renderer can cut its posed exterior into two or three rigid sections. The outside keeps the model’s UVs, paint, and materials; closed cut contours get a scorched interior without filling holes such as engine bores. Open or ambiguous contours are not guessed. Plane cutting is limited to 6,000 triangles and 24 submeshes per hull. Oversize single shells can remain intact, and all wrecks stay within six moving sections per casualty.
- A visible space death emits a fragment immediately, including ships whose death animation is indefinitely long or uses `Remove_Upon_Death`. Suitable authored sections can still break away later and inherit flight velocity. The extra fragment is not a replacement ship or an obstacle.
- A separate pool holds up to 24 short-lived fragments per battlefield. At capacity, the newest death reuses the oldest fragment. During a burst of more than 24 deaths before a render, all receive the physics event; they won't all leave simultaneously visible fragments. Ground fragments expire at terrain contact except for fallback ground-vehicle scrap, which stays with the parked wrecks. Pausing the battle pauses the motion.
- No fragments reveal hidden, cloaked, or garrisoned units; no deaths are invented for script removals or retreats. If the local solver cannot initialize, the game keeps the authored effects. Death debris is presentation only: its state never goes into multiplayer commands, campaign results or replay checksums.

## Wrecks left on the battlefield

Ground vehicles keep the actual pieces that fell, not a second destroyed model after a timer. Settled pieces release their Rapier bodies; a travelling heavy ground vehicle can push a contacted section back into motion without losing HP, changing its order or treating the debris as a gameplay obstacle. The map keeps up to **40 parked wrecks / 240 sections**; reaching the limit recycles the oldest. These local remains last for the current tactical session, not across a save/load. An authored path-blocking death clone still controls its original navigation obstacle and lifetime.

A lethal authored crush lays a foot soldier down along the direction of travel or compresses a vehicle's own hull against the local ground slope. It does not flatten a unit that survived, a removal, or an ordinary projectile death. In new solo land battles an eligible ground-vehicle crusher finishing an authored jump can also crush a squashable enemy at touchdown; troops aloft, allies and protected targets are not made squashable by this effect.

## Movement in a tactical battle

In new solo battles, the order controller proposes the path for this tick; Rapier shape casts determine how far the unit can actually move against another solid unit. Infantry, ground vehicles, aircraft and ships participate. Occupied structures and stations can block a path. A slow approach stops without costing hit points. If the front unit in a column stops, the game rechecks its followers in that same tick. A ground move also checks blocked map cells between its endpoints; authored flight and free routes bypass that check. The navigation grid, ground heights, squad orders, garrison entry and existing crush rules still belong to the game. In new solo land battles, the ground height includes [persistent impact bowls](land-craters.md); neither authored map data nor multiplayer movement is changed. Contacts use gameplay shapes, not every painted triangle on a model.

The new authoritative rules are versioned separately from cosmetic physics. Saves store the active version; a v2 space replay retains the earlier ramming-only behavior, and a v1 replay remains on the legacy rules. New recordings use v3. Multiplayer and strategic auto-resolve have not been migrated.

For the narrow-turn squad regression, measured land stress results, and hardware test limits, see [Crowded land battles](land-crowd-reliability.md).

## Projectile contacts

An ordinary projectile segment is tested against eligible units on the simulation owner, not by ray-picking the display. On land, a model's authored collision triangles take precedence over its collision box: a shot can pass through a box corner without damaging the vehicle inside it. In space the same native ray query tests the ship and its individually positioned hardpoints; the closest eligible strike still wins. With no precise mesh, Rapier tests the existing gameplay box, sphere or ellipsoid instead. Collision padding, shield absorption, armor, blast radius, target filters, and event-driven weapons retain their authored behavior. The engine decides contact, not what a weapon does on contact. Cosmetic debris is never a projectile target.

## Ramming during movement

In live solo land and space battles, Rapier also tests the path a ground vehicle or mobile ship travels during a tactical tick. It uses gameplay footprint sizes, not the visible mesh. Long ships have a hull aligned with their heading; units without usable model bounds still have a footprint. A hard closing impact stops the movers at contact and hits both units, friendly or hostile, through the normal shield, armor and death rules. The smaller unit’s hull health limits the raw damage. Spawn overlaps, gentle contact, formation travel and hyperspace arrivals do not by themselves count as rams. Units must separate before the pair can deal another impact. The existing infantry crush rules remain separate.

Ramming is an impact damage rule, not a replacement for pathfinding or victory conditions. In threaded space battles the worker alone resolves the hit; the page only displays it. New solo space recordings save the rule version. Old replays, multiplayer, and auto-resolve do not gain ramming damage.

## Verify a pack

With Universal running at `http://127.0.0.1:8590/` and Chrome and `playwright-core` available:

```
npm run test:physics-rosters                 # every locally ready Universal profile, serially
npm run test:physics-rosters -- 1125571106   # one Workshop profile (Thrawn's Revenge)
npm run test:physics                        # real solver, rig, capacity and mounted battle checks
npm run test:physics-workshop               # visible deaths in stock land and a Thrawn's Revenge fleet battle
npm run test:physics-movement               # mounted solo: slow obstruction, unobstructed lane, space overpass
npm run test:physics-crowds                 # actual group orders through open and narrow lanes
npm run test:physics-weapons                # mounted solo: land and space hits/misses; same shot vs box and precise hull
npm run test:ramming                        # solo ground and space rams, shield/hull damage, overlap controls
npm run test:physics-workshop-land          # Workshop soldier's actual skin and a guest vehicle's independently moving pieces
```

The mounted land check killed a Thrawn’s Revenge Imperial Stormtrooper Sergeant and an Awakening of the Rebellion AT-AT through the normal combat callback. The sergeant’s three skinned meshes moved on ten bodies and nine joints; the AT-AT split into six independently moving sections. Neither result was the generic debris fallback. The unnamed and rigid-only rig paths are separately covered by real Rapier fixture tests, not inferred from the sergeant’s named rig.

The roster check passed for stock, Thrawn’s Revenge, Fall of the Republic, Revan’s Revenge, Awakening of the Rebellion, Awakening of the Clone Wars, and Empire at War: Remake (49,331 land and 22,235 space definition checks across those mounted revisions).

The roster test loads each profile's mounted XML and exercises the fallback with **blank art** for every definition declaring a land or space model. It deliberately fills the space clone slots. This catches dependency on particular unit names or shapes; it is not a visual review of every asset. Catalog counts include noncombat model definitions and can include the same object in both domains or more than one profile.
