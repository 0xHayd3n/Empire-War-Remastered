// Lifecycle soak, not part of the frame benchmark. Reuse six mounted art poses with
// fresh casualty identities so one world, not the allocator of a new world, must recycle.
module.exports = async function soak(_, { first, only }) {
  const raf = () => new Promise(requestAnimationFrame),
    limit = performance.now() + 90000;
  while (!window.game?.vehicleWrecks || !game.ui || game.warming) {
    if (performance.now() > limit) throw Error('No mounted infantry encounter');
    await raf();
  }
  game.paused = true;
  game.modeSuspended = true;
  await raf();
  const T = await import('three'),
    base = game.vehicleWrecks,
    J = only === 'rapier' ? null : window.__bridge.joltBridge(await window.__jolt.default());
  const models = game.world.units
    .filter(u => !u.dead && u.foot && (u.type.name === 'Stormtrooper' || u.type.name === 'Rebel_Trooper'))
    .slice(0, 6);
  if (models.length !== 6) throw Error('Six source poses required');
  const results = [];
  for (const engine of only ? [only] : [first, first === 'rapier' ? 'jolt' : 'rapier']) {
    const group = new T.Group();
    let keep = true;
    const layer = new base.constructor(
        engine === 'rapier' ? base.R : J,
        group,
        base.height,
        () => false,
        () => keep
      ),
      z = layer.world;
    const count = () => [
      z.numBodies ? z.numBodies() : z.bodies.len(),
      z.numColliders ? z.numColliders() : z.colliders.len(),
      z.numJoints ? z.numJoints() : z.impulseJoints.len()
    ];
    const failures = [];
    let freedWaves = 0,
      parkedPeak = 0,
      kept = 0;
    let firstRoot;
    game.scene.add(group);
    for (let wave = 0; wave < 24; wave++) {
      for (const source of models) {
        const u = Object.create(source);
        u.holder.visible = true;
        if (!layer.spawn(u)) throw Error('No ' + engine + ' ragdoll during soak');
      }
      if (wave === 0) firstRoot = layer.live[0].doll.root;
      if (count()[2] !== 54) throw Error('Incorrect initial native joint count');
      for (let i = 0; i < 8; i++) layer.step(1 / 60);
      const p = layer.live[0].doll.nodes[0].position;
      layer.blast(p.x, p.y, p.z, 1000);
      for (let i = 0; i < 735 && layer.live.length; i++) layer.step(1 / 60);
      if (count().every(v => v === 0)) freedWaves++;
      const expected = Math.min(128, (wave + 1) * 6);
      if (group.children.length !== expected || layer.settled.length !== expected) failures.push('settled count wave ' + wave);
      parkedPeak = Math.max(parkedPeak, group.children.length);
      kept = layer.settled.length;
    }
    const evicted = !firstRoot.parent;
    keep = false;
    layer.step(0);
    const cleared = group.children.length === 0 && layer.settled.length === 0;
    if (!cleared || !evicted || freedWaves !== 24) failures.push('Persistence / eviction / native release');
    const remaining = count();
    layer.dispose();
    group.removeFromParent();
    const row = { engine, waves: 24, casualties: 144, peakParked: parkedPeak, kept, evicted, cleared, freedWaves, remaining, failures };
    results.push(row);
    console.log('[infantry] ' + JSON.stringify(row));
  }
  return { suite: 'soak', legs: results };
};
