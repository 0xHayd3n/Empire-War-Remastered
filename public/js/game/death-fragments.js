import * as T from 'three';

// A small piece of ejecta accompanies the authored death; it is not a guessed limb
// or a replacement model. Needs only the confirmed death's position. These are
// render-only ballistics in the existing Rapier world, never gameplay colliders.
const LIMIT = 24;
const finite = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);
const speed = x => T.MathUtils.clamp(finite(x), -600, 600);

export class DeathFragments {
  constructor(R, world, scene, height = null) {
    Object.assign(this, { R, world, scene, height });
    this.pieces = [];
    this.emitted = 0;
  }

  makePiece() {
    if (!this.geo) {
      this.geo = new T.TetrahedronGeometry(1);
      // Baked facet tones work in both the WebGL and WebGPU basic-material paths.
      const shades = new Uint8Array([166, 144, 121, 255, 103, 91, 82, 255, 148, 138, 129, 255, 87, 80, 76, 255]);
      this.map = new T.DataTexture(shades, 4, 1);
      this.map.colorSpace = T.SRGBColorSpace;
      this.map.needsUpdate = true;
      const uv = this.geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (Math.floor(i / 3) + 0.5) / 4, 0.5);
      this.material = new T.MeshBasicMaterial({ map: this.map });
    }
    const obj = new T.Mesh(this.geo, this.material);
    obj.name = 'Death debris';
    const R = this.R,
      body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false));
    // Inertia only. Fragments cannot push units, ragdolls or other debris. Ground
    // fragments disappear on reaching the rendered terrain, even over a new crater.
    this.world.createCollider(R.ColliderDesc.cuboid(0.5, 0.25, 0.35).setCollisionGroups(0), body);
    this.scene.add(obj);
    return { obj, body, age: 0 };
  }

  emit(u, flight) {
    if (!this.world || !Number.isFinite(u.x) || !Number.isFinite(u.y)) return false;
    const { x, y } = u;
    const radius = T.MathUtils.clamp(finite(u.visualRadius, finite(u.hitRadius, 8)), 1, 300);
    const s = this.height ? T.MathUtils.clamp(radius * 0.17, 0.6, 5) : T.MathUtils.clamp(radius * 0.08, 1.3, 14);
    const floor = this.height ? finite(this.height(x, y), finite(u.z)) : -Infinity;
    const z = Math.max(finite(u.z), floor) + (this.height ? Math.max(s, Math.min(radius * 0.4, 12)) : 0);
    // Never refuse a new visible event when a modded battle fills the pool. Reuse
    // the oldest transient, not a persistent corpse or a section of an authored hull.
    const p = this.pieces.length === LIMIT ? this.pieces.shift() : this.makePiece();
    const a = this.emitted++ * 2.399963 + finite(u.heading),
      kick = this.height ? 10 + s * 2 : 5 + s * 1.5;
    p.age = 0;
    p.keepGround = false;
    p.obj.visible = true;
    p.obj.position.set(x, y, z);
    p.obj.scale.set(s, s * 0.47, s * 0.78);
    p.obj.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), a);
    p.body.setTranslation(p.obj.position, true);
    p.body.setRotation(p.obj.quaternion, true);
    p.body.setLinvel(
      {
        x: speed(flight?.x) + Math.cos(a) * kick,
        y: speed(flight?.y) + Math.sin(a) * kick,
        z: speed(flight?.z) + (this.height ? 18 + s * 2 : 0.3 * kick)
      },
      true
    );
    p.body.setAngvel({ x: 2, y: -1.5, z: Math.sin(a) }, true);
    this.pieces.push(p);
    return true;
  }

  sync(dt, fogged, park = null) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i],
        pos = p.body.translation();
      if ((p.age += dt) >= (this.height ? 3 : 6) || (this.height && pos.z <= this.height(pos.x, pos.y))) {
        if (p.keepGround && park) {
          this.pieces.splice(i,1);
          p.obj.quaternion.copy(p.body.rotation());
          this.world.removeRigidBody(p.body);
          park(p.obj,pos);
        } else this.remove(i);
        continue;
      }
      p.obj.position.copy(pos);
      p.obj.quaternion.copy(p.body.rotation());
      p.obj.visible = !fogged?.(pos.x, pos.y);
    }
  }

  remove(i) {
    const [p] = this.pieces.splice(i, 1);
    p.obj.removeFromParent();
    this.world.removeRigidBody(p.body);
  }
  clear() {
    while (this.pieces.length) this.remove(this.pieces.length - 1);
  }
  dispose() {
    this.clear();
    this.geo?.dispose();
    this.material?.dispose();
    this.map?.dispose();
    this.world = null;
  }
}
