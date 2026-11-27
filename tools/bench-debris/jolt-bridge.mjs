/**
 * joltBridge — benchmark-only Rapier-shaped physics seam over real JoltPhysics WASM 1.1.2.
 *
 * Test fixture under tools/bench-debris, never imported by the game. It exists so the
 * *actual* `SpaceWrecks` (space-wrecks.js), `VehicleWrecks.buildVehicle` / `release` /
 * `dispose` (vehicle-wrecks.js) and `infantryRagdoll` (infantry-ragdoll.js) code paths can
 * run with `R = joltBridge(J)` and be compared with the same code on `R = RAPIER`, without
 * editing any game file.
 *
 *   const J = await (await import('jolt-physics/wasm-compat')).default({});
 *   const R = joltBridge(J);                       // { World, RigidBodyDesc, ColliderDesc, JointData }
 *   new SpaceWrecks(R, scene) / new VehicleWrecks(R, scene, height, fogged)
 *
 * Emulated Rapier 0.17 surface — the exact subset those paths use, plus the readback needed
 * to validate them:
 *   World          gravity ctor, `timestep`, createRigidBody(desc), createCollider(desc[, body]),
 *                  removeRigidBody(body), removeCollider(collider, wakeUp), step(), free(),
 *                  numBodies(), numColliders(), numJoints(), stats()
 *   RigidBodyDesc  dynamic(), fixed(), setTranslation, setRotation, setLinvel, setAngvel,
 *                  setLinearDamping, setAngularDamping, setCanSleep, setCcdEnabled,
 *                  setGravityScale, setAdditionalSolverIterations
 *   ColliderDesc   cuboid(hx,hy,hz), capsule(halfHeight, radius), trimesh(verts, idx),
 *                  setTranslation, setRotation, setCollisionGroups, setFriction,
 *                  setRestitution, setDensity
 *   RigidBody      translation(), rotation(), linvel(), angvel(), isSleeping(),
 *                  setLinvel(vec, wakeUp), setAngvel(vec, wakeUp), wakeUp()
 *   JointData      revolute(anchor1, anchor2, axis), spherical(anchor1, anchor2)
 *   ImpulseJoint   setLimits(min, max) (hinge only), setContactsEnabled(bool), angle() (hinge
 *                  readback, radians; benchmark validation only)
 *   World joints   createImpulseJoint(data, body1, body2, wakeUp), removeImpulseJoint(joint, wakeUp)
 *
 * Rapier semantics reproduced (this is what makes the benchmark a seam swap, not a
 * different simulation):
 *  - collision groups use Rapier's 32-bit encoding verbatim:
 *      collide(a, b) = (a.memberships & b.filter) && (b.memberships & a.filter)
 *    So `setCollisionGroups(0)` (space hull pieces) collides with nothing, and
 *    `0x00020001` (wreck pieces) collides only with `0x00010002` (ground patch):
 *    sibling wreck pieces and sibling ground patches never collide, exactly as in Rapier.
 *    Implemented with Jolt object layers (<= 32) + an `ObjectLayerPairFilterTable`.
 *  - cuboid half extents are outer extents; Jolt's 0.05 convex radius lives inside, so
 *    box volume/mass match Rapier at Rapier's default density 1.
 *  - `capsule(halfHeight, radius)` keeps Rapier's meaning (half height of the *cylindrical*
 *    part, radius of the caps) because Jolt's `CapsuleShape` uses the same two numbers.
 *  - a collider translation/rotation on a body-attached collider is supported by wrapping the
 *    shape in `RotatedTranslatedShapeSettings`. Rapier's two frames are preserved exactly:
 *    the *body origin* stays the body origin (`translation()` is `BodyInterface::GetPosition`,
 *    verified below) and the offset collider's centre-of-mass offset becomes the body's COM
 *    offset, so joint anchors (given in Rapier's body space) are converted to Jolt's
 *    `LocalToBodyCOM` space by subtracting that COM offset.
 *  - trimesh vertices/indices stay in collider space; the collider translation becomes the
 *    (static) body transform — the same world-space geometry Rapier resolves.
 *  - friction/restitution/damping/CCD/canSleep/sleeping are forwarded to the matching
 *    Jolt per-body or per-shape fields; gravity is `PhysicsSystem::SetGravity`.
 *  - `translation()` is the body-origin position (Rapier `RigidBody.translation()`), read
 *    from `BodyInterface::GetPosition`, not the centre of mass.
 *  - `RigidBodyDesc.setAdditionalSolverIterations(n)` (Rapier: "extra solver iterations for
 *    this body") becomes Jolt's *absolute* override on the same budget:
 *      mNumVelocityStepsOverride = PhysicsSettings.mNumVelocitySteps + n
 *      mNumPositionStepsOverride = PhysicsSettings.mNumPositionSteps + n
 *    on the body (body creation settings) and, taking `max(parent, child)`, on every joint the
 *    body is part of. Jolt has no additive counter; 0 keeps Jolt's default. The world defaults
 *    here are 10 velocity / 2 position steps, so `setAdditionalSolverIterations(4)` maps to
 *    14 / 6. Rapier's own default budget is 4 iterations, so identical iteration *counts* are
 *    not claimed — only the same "+4 on top of this engine's default" shape.
 *  - `RigidBody.setLinvel/setAngvel(vec, wakeUp)` write through
 *    `BodyInterface::SetLinearVelocity / SetAngularVelocity` and only activate the body when
 *    `wakeUp` is true (Rapier never wakes on `false`). Jolt's write activates the body even when
 *    the caller did not ask (`Body::SetLinearVelocity` calls `Activate()`), so a write with
 *    `wakeUp === false` to a *sleeping* body is held and applied by the next `step()` that finds
 *    the body awake again — exactly Rapier's "stored velocity" behaviour (and `linvel()` reports
 *    the stored value meanwhile). `isSleeping()` is `!IsActive()`.
 *  - `JointData.revolute(anchor1, anchor2, axis)` → Jolt `HingeConstraint` (3 positional DOF
 *    locked, one angular DOF free) and `JointData.spherical(anchor1, anchor2)` → Jolt
 *    `PointConstraint` (3 positional DOF locked, all rotation free). Anchors are Rapier's
 *    body-space anchors, converted to `LocalToBodyCOM`. Unlike Rapier, which takes one axis for
 *    both bodies, Jolt stores an axis *and a reference normal axis* per body: both bodies get
 *    the same world-space axis/normal (deterministic perpendicular of `axis`), which is exactly
 *    the initial configuration Rapier encodes, so the hinge angle starts at 0 and the limits
 *    keep Rapier's sign convention (positive = right-handed rotation about `axis`).
 *  - `joint.setLimits(min, max)` sets the native hinge limits; `joint.setContactsEnabled(false)`
 *    is Rapier's "connected bodies do not collide" and is implemented the Jolt way, with a
 *    world-owned `GroupFilterTable`: the two bodies get distinct sub-group ids and the pair is
 *    disabled. Unlike Rapier, only the *pair* is excluded — every other limb pair, including
 *    non-adjacent bodies of the same ragdoll, still collides. `detach` (Rapier
 *    `removeImpulseJoint`) re-enables exactly that pair, so the detached limb can hit its
 *    former parent again.
 *  - `removeRigidBody` removes the impulse joints attached to the body first, like Rapier.
 *  - `world.numJoints()` is the bridge's own live-constraint count. This build exposes no
 *    `PhysicsSystem::GetNumConstraints` (nor a per-body constraint count), so no native number
 *    exists to compare against; the count is maintained from every successful
 *    `AddConstraint`/`RemoveConstraint`, which is the same set of calls Jolt made.
 *
 * WASM lifetime rules for this build (each verified in Node against the real WASM, see
 * check-bridge.mjs, joint-check.mjs and mounted-results.md). Porting this bridge is mostly
 * about these categories:
 *  - OWNED — created with `new J.X` by us, so destroyed by us: Vec3, RVec3, Quat, BodyID,
 *    BodyCreationSettings, TriangleList/Triangle, PhysicsMaterialList, MeshShapeSettings
 *    (released with `ClearCachedResult()` before `J.destroy`), the shape settings that only
 *    exist to build a `RotatedTranslatedShape` (same cache rule), and the joint settings.
 *  - BORROWED — never destroyed: PhysicsSystem, BodyInterface, `PhysicsSettings`, `Body*` from
 *    `BodyLockInterface::TryGetBody`, the `CollisionGroup` handed back by
 *    `Body::GetCollisionGroup()` (it aliases storage inside the body — mutating it is how the
 *    pair filter is installed), and the BodyID/position/rotation/velocity wrappers they return
 *    (the bindings hand back one reused scratch object per call site, so every value is copied
 *    out immediately).
 *  - REFERENCE COUNTED — never `J.destroy`ed directly: the shape returned by Create(). Their refcount starts at
 *    0; BodyCreationSettings and then the Body each AddRef, and the Body's reference frees the
 *    shape when the body is destroyed. `ShapeResult.Get()` is owned by the settings' cache and
 *    must not be destroyed directly.
 *  - CONSTRAINTS — `BodyInterface::CreateConstraint` returns a `TwoBodyConstraint` whose refcount
 *    is 0 at creation, `PhysicsSystem::AddConstraint` takes the one reference (1) and
 *    `RemoveConstraint` drops it (0, the object is deleted). Measured on this build: create → 0,
 *    add → 1, remove → 0. So a removed constraint is never `Release()`d or touched again, and
 *    constraints are always removed *before* their bodies are destroyed (also on `free()`).
 *  - The JoltInterface (`world.free()`) owns the world's preallocated arena and returns it.
 *    Its settings/filters are deliberately NOT destroyed afterwards: this build's bindings
 *    crash ("table index is out of bounds") when they are, and they cost ~0.25 KB per world.
 *    Hold one explicit AddRef on the joint pair filter across waves, then Release it after
 *    all native bodies are destroyed. Do not delete a borrowed reference.
 *
 * Deliberate limitations — none exercised by space-wrecks.js, vehicle-wrecks.js or
 * infantry-ragdoll.js:
 *  - one collider per body (Rapier allows a compound of several colliders per body);
 *  - a translated/rotated *trimesh* collider on a body is rejected (the shape settings path is
 *    only wired for cuboids and capsules; every trimesh the game attaches is at the body origin);
 *  - removeCollider() removes body-less colliders only; remove the body otherwise;
 *  - <= 31 distinct collisionGroups values per world (Jolt's 32 object layers, layer 0 is
 *    the inert layer used for Rapier's "collides with nothing" group 0);
 *  - at most `jointGroups - 1` concurrently active bodies may take part in filtered joints;
 *    their sub-group IDs are recycled after removal. A full table fails explicitly.
 *  - joint bodies get their Rapier collision groups plus a Jolt sub-group id lazily, at
 *    `setContactsEnabled(false)` time, so worlds without joints carry no collision-group data
 *    at all (the pure rigid benchmark is byte-for-byte the same code path as before);
 *  - a dynamic body with no collider is emulated as a tiny sensor with gravity factor 0
 *    (Rapier: infinite mass, no contacts, drifts at its initial velocity), so it needs one
 *    body slot and is invisible to collision;
 *  - Jolt preallocates: maxBodies / maxBodyPairs / maxContactConstraints are fixed per world
 *    (defaults 1024 / 8192 / 4096) instead of Rapier's growable storage;
 *  - a hinge created without `setLimits` keeps Jolt's default ±π stop; Rapier's unbounded
 *    revolute has no stop at all (infantry-ragdoll.js always sets limits, so this is not hit);
 *  - `JoltPhysics` approximates a capsule's inertia (cylinder-based) instead of Rapier's exact
 *    capsule integral, and `setDensity` is forwarded per shape, not per collider mass;
 *  - `numJoints()` is bridge-side (see above), and a constraint leaked without
 *    `removeImpulseJoint` cannot be detected natively — the tests only prove the count returns
 *    to 0 and that repeated worlds do not grow the WASM heap.
 */

const DEFAULT_TIMESTEP = 1 / 60;
/** `ObjectLayerPairFilterTable` supports at most 32 object layers; 0 is the inert layer. */
const MAX_LAYERS = 32;
const INERT_LAYER = 0;
/** Jolt's own default convex radius for `BoxShape`; outer extents are unaffected. */
const BOX_CONVEX_RADIUS = 0.05;
/** Rapier defaults for a collider. */
const DEFAULT_FRICTION = 0.5;
const DEFAULT_RESTITUTION = 0;
const DEFAULT_DENSITY = 1;
/** Rapier's default collision groups: member of every group, filters everything. */
const DEFAULT_GROUPS = 0xffffffff;
/** Joint pairs whose contacts are suppressed get a sub-group id; 0 is the "shared" row. */
const DEFAULT_JOINT_GROUPS = 512;

const noop = () => {};
const memberships = groups => (groups >>> 16) & 0xffff;
const filter = groups => groups & 0xffff;
/** Rapier's rule, verbatim. */
const groupsCollide = (a, b) => ((memberships(a) & filter(b)) !== 0) && ((memberships(b) & filter(a)) !== 0);

function numbers(x, y, z) {
  if (Array.isArray(x)) return [Number(x[0]) || 0, Number(x[1]) || 0, Number(x[2]) || 0];
  if (x && typeof x === 'object') return [Number(x.x) || 0, Number(x.y) || 0, Number(x.z) || 0];
  return [Number(x) || 0, Number(y) || 0, Number(z) || 0];
}

function quaternion(q) {
  if (!q) return [0, 0, 0, 1];
  return [Number(q.x) || 0, Number(q.y) || 0, Number(q.z) || 0, q.w === undefined ? 1 : Number(q.w)];
}

/** True when a collider desc carries a non-identity offset in body space. */
function hasOffset(desc) {
  const t = desc.translation, r = desc.rotation;
  return t[0] !== 0 || t[1] !== 0 || t[2] !== 0 || r[0] !== 0 || r[1] !== 0 || r[2] !== 0 || r[3] !== 1;
}

/** Rotate `(x, y, z)` by the inverse of the unit quaternion `q` (world → body space). */
function unrotate(q, x, y, z) {
  const ix = -q.x, iy = -q.y, iz = -q.z, iw = q.w;
  const tx = 2 * (iy * z - iz * y),
    ty = 2 * (iz * x - ix * z),
    tz = 2 * (ix * y - iy * x);
  return [
    x + iw * tx + (iy * tz - iz * ty),
    y + iw * ty + (iz * tx - ix * tz),
    z + iw * tz + (ix * ty - iy * tx)
  ];
}

/**
 * A unit vector perpendicular to `axis`, chosen deterministically from nothing but the axis.
 * Both bodies of a hinge get this same world-space normal, which is what makes the initial
 * hinge angle exactly 0 (Rapier's starting configuration).
 */
function perpendicularAxis([x, y, z]) {
  const [ax, ay, az] = Math.abs(x) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = ax * x + ay * y + az * z;
  const nx = ax - x * d,
    ny = ay - y * d,
    nz = az - z * d;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function joltBridge(J, options = {}) {
  if (!J || typeof J.JoltInterface !== 'function' || typeof J.BoxShape !== 'function')
    throw new TypeError('joltBridge(J): pass the initialized jolt-physics module (const J = await Jolt())');

  const config = {
    maxBodies: 1024,
    maxBodyPairs: 8192,
    maxContactConstraints: 4096,
    maxWorkerThreads: 1, // single-threaded, like Rapier's wasm build
    collisionSteps: 1, // JoltInterface.Step(dt, 1) == Rapier world.step()
    jointGroups: DEFAULT_JOINT_GROUPS,
    ...options,
  };

  /** Owned Jolt wrappers only. Never call this on a borrowed wrapper. */
  const destroy = o => {
    if (o && typeof J.destroy === 'function') J.destroy(o);
  };

  const motionType = kind => (kind === 'fixed' ? J.EMotionType_Static : J.EMotionType_Dynamic);

  /* ------------------------------------------------------------ descriptors */

  class RigidBodyDesc {
    constructor(kind = 'dynamic') {
      this.kinematic = kind;
      this.translation = [0, 0, 0];
      this.rotation = [0, 0, 0, 1];
      this.linvel = [0, 0, 0];
      this.angvel = [0, 0, 0];
      this.linearDamping = 0;
      this.angularDamping = 0;
      this.canSleep = true;
      this.ccd = false;
      this.gravityScale = 1;
      this.additionalSolverIterations = 0;
    }
    static dynamic() {
      return new RigidBodyDesc('dynamic');
    }
    static fixed() {
      return new RigidBodyDesc('fixed');
    }
    setTranslation(x, y, z) {
      this.translation = numbers(x, y, z);
      return this;
    }
    setRotation(q) {
      this.rotation = quaternion(q);
      return this;
    }
    setLinvel(x, y, z) {
      this.linvel = numbers(x, y, z);
      return this;
    }
    setAngvel(x, y, z) {
      this.angvel = numbers(x, y, z);
      return this;
    }
    setLinearDamping(v) {
      this.linearDamping = Number(v) || 0;
      return this;
    }
    setAngularDamping(v) {
      this.angularDamping = Number(v) || 0;
      return this;
    }
    setCanSleep(v) {
      this.canSleep = !!v;
      return this;
    }
    setCcdEnabled(v) {
      this.ccd = !!v;
      return this;
    }
    setGravityScale(v) {
      this.gravityScale = Number(v);
      return this;
    }
    /** Rapier: extra solver iterations on top of the world default (see the header mapping). */
    setAdditionalSolverIterations(v) {
      this.additionalSolverIterations = config.nativeBudget ? 0 : Math.max(0, Math.round(Number(v) || 0));
      return this;
    }
  }

  class ColliderDesc {
    constructor(kind, data) {
      this.kind = kind;
      Object.assign(this, data);
      this.translation = [0, 0, 0];
      this.rotation = [0, 0, 0, 1];
      this.collisionGroups = DEFAULT_GROUPS;
      this.friction = DEFAULT_FRICTION;
      this.restitution = DEFAULT_RESTITUTION;
      this.density = DEFAULT_DENSITY;
    }
    /** hx/hy/hz are the full outer half extents, as in Rapier. */
    static cuboid(hx, hy, hz) {
      return new ColliderDesc('cuboid', { half: [Math.abs(hx), Math.abs(hy), Math.abs(hz)] });
    }
    /**
     * Rapier `ColliderDesc.capsule(halfHeight, radius)`: `halfHeight` is the half height of the
     * cylindrical part (Jolt's `CapsuleShape(inHalfHeight, inRadius)` uses the same numbers).
     * The capsule axis is local Y in both engines.
     */
    static capsule(halfHeight, radius) {
      const h = Math.abs(Number(halfHeight) || 0),
        r = Math.abs(Number(radius) || 0);
      return new ColliderDesc('capsule', { halfHeight: h, radius: r });
    }
    static trimesh(vertices, indices) {
      // Copy: Rapier copies into its collider, and the game reuses/overwrites its arrays.
      const verts = new Float32Array(vertices);
      const idx = indices instanceof Uint32Array ? new Uint32Array(indices) : Uint32Array.from(indices);
      return new ColliderDesc('trimesh', { verts, idx });
    }
    setTranslation(x, y, z) {
      this.translation = numbers(x, y, z);
      return this;
    }
    setRotation(q) {
      this.rotation = quaternion(q);
      return this;
    }
    setCollisionGroups(groups) {
      this.collisionGroups = groups >>> 0;
      return this;
    }
    setFriction(v) {
      this.friction = Number(v);
      return this;
    }
    setRestitution(v) {
      this.restitution = Number(v);
      return this;
    }
    setDensity(v) {
      this.density = Number(v);
      return this;
    }
  }

  /* ------------------------------------------------------------ joint data */

  /**
   * Rapier's `Rapier.JointData`, restricted to the two joint kinds the raggdoll code builds.
   * Anchors and the axis are in each body's own space (Rapier's `*_local` convention).
   */
  class JointData {
    constructor(kind, data) {
      this.kind = kind;
      Object.assign(this, data);
    }
    static revolute(anchor1, anchor2, axis) {
      const [ax, ay, az] = numbers(axis);
      const len = Math.hypot(ax, ay, az);
      if (!(len > 1e-6)) throw new Error('joltBridge: JointData.revolute needs a non-zero axis');
      return new JointData('revolute', {
        anchor1: numbers(anchor1),
        anchor2: numbers(anchor2),
        axis: [ax / len, ay / len, az / len]
      });
    }
    static spherical(anchor1, anchor2) {
      return new JointData('spherical', { anchor1: numbers(anchor1), anchor2: numbers(anchor2) });
    }
  }

  /* ------------------------------------------------------------- colliders */

  class Collider {
    constructor(world, desc, body) {
      this.world = world;
      this.desc = desc;
      this.body = body || null;
      this.id = null; // owned J.BodyID of the implicit static body (body-less colliders only)
      this.removed = false;
      this.inert = false; // empty/degenerate trimesh: Rapier's valid-but-contactless collider
    }
  }

  /* ----------------------------------------------------------------- bodies */

  class RigidBody {
    constructor(world, desc) {
      this.world = world;
      this.desc = desc;
      this.collider = null;
      this.id = null; // owned J.BodyID, created on materialisation
      this.removed = false;
      this.jointGroup = 0; // 0 = shares the always-colliding default row of the pair table
      this.pendingLinvel = null; // velocity written to a sleeping body with wakeUp = false
      this.pendingAngvel = null;
    }

    /** Bodies are materialised lazily so a collider can be attached first (as the game does). */
    _materialize() {
      if (this.id || this.removed) return;
      const world = this.world;
      world._assertLive();
      const desc = this.desc;
      const live = world.stats().bodies;
      if (live >= world.config.maxBodies)
        throw new Error(
          `joltBridge: world is at maxBodies (${world.config.maxBodies}); raise the bridge's maxBodies option`
        );
      // The collider's offset belongs to the shape when the collider rides a body: the body
      // frame Rapier exposes (`translation()`) is the body origin, not the collider centre.
      const graph = this.collider ? world._shapeOf(this.collider.desc, true) : world._inertShapeOf();
      const bcs = new J.BodyCreationSettings();
      const scratch = [];
      try {
        bcs.SetShape(graph.shape);
        const position = new J.RVec3(...desc.translation);
        scratch.push(position);
        bcs.mPosition = position;
        const rotation = new J.Quat(...desc.rotation);
        scratch.push(rotation);
        bcs.mRotation = rotation;
        const linvel = new J.Vec3(...desc.linvel);
        scratch.push(linvel);
        bcs.mLinearVelocity = linvel;
        const angvel = new J.Vec3(...desc.angvel);
        scratch.push(angvel);
        bcs.mAngularVelocity = angvel;

        const collider = this.collider?.desc;
        bcs.mMotionType = motionType(desc.kinematic);
        bcs.mObjectLayer = collider ? world._layerFor(collider.collisionGroups) : INERT_LAYER;
        bcs.mFriction = collider ? collider.friction : DEFAULT_FRICTION;
        bcs.mRestitution = collider ? collider.restitution : DEFAULT_RESTITUTION;
        bcs.mLinearDamping = desc.linearDamping;
        bcs.mAngularDamping = desc.angularDamping;
        bcs.mAllowSleeping = desc.canSleep;
        bcs.mMotionQuality = desc.ccd ? J.EMotionQuality_LinearCast : J.EMotionQuality_Discrete;
        bcs.mGravityFactor = desc.gravityScale;
        if (!collider) {
          // Rapier: a body with no collider has no mass, so gravity cannot accelerate it and
          // nothing can touch it. Mirror that with a sensor on the inert layer.
          bcs.mIsSensor = true;
          bcs.mGravityFactor = 0;
          bcs.mAllowSleeping = false;
        }
        // Rapier's additional iterations are additive; Jolt's override is absolute.
        const extra = desc.additionalSolverIterations;
        if (extra > 0) {
          const steps = world._solverSteps();
          bcs.mNumVelocityStepsOverride = steps.velocity + extra;
          bcs.mNumPositionStepsOverride = steps.position + extra;
        }
        const activation =
          bcs.mMotionType === J.EMotionType_Dynamic ? J.EActivation_Activate : J.EActivation_DontActivate;
        const created = world._bi.CreateAndAddBody(bcs, activation);
        // CreateAndAddBody's BodyID wrapper is reused by the binding: keep the raw id.
        this.id = new J.BodyID(created.GetIndexAndSequenceNumber());
      } finally {
        for (const s of scratch) destroy(s);
        // Releases the settings' shape reference; the Body keeps its own reference.
        destroy(bcs);
        graph.finalize();
      }
    }

    _id() {
      if (this.removed) throw new Error('joltBridge: this rigid body was removed');
      if (!this.id) this._materialize();
      return this.id;
    }

    /** Body-origin position, `{x,y,z}` (Rapier `RigidBody.translation()`). */
    translation() {
      const p = this.world._bi.GetPosition(this._id()); // borrowed scratch: read immediately
      return { x: p.GetX(), y: p.GetY(), z: p.GetZ() };
    }

    /** Body rotation, `{x,y,z,w}` (Rapier `RigidBody.rotation()`). */
    rotation() {
      const q = this.world._bi.GetRotation(this._id()); // borrowed scratch
      return { x: q.GetX(), y: q.GetY(), z: q.GetZ(), w: q.GetW() };
    }

    linvel() {
      if (this.pendingLinvel) {
        const [x, y, z] = this.pendingLinvel;
        return { x, y, z };
      }
      const v = this.world._bi.GetLinearVelocity(this._id()); // borrowed scratch
      return { x: v.GetX(), y: v.GetY(), z: v.GetZ() };
    }

    angvel() {
      if (this.pendingAngvel) {
        const [x, y, z] = this.pendingAngvel;
        return { x, y, z };
      }
      const v = this.world._bi.GetAngularVelocity(this._id()); // borrowed scratch
      return { x: v.GetX(), y: v.GetY(), z: v.GetZ() };
    }

    /** Rapier `setLinvel(vel, wakeUp)`: exact write, wake only when asked. */
    setLinvel(vel, wakeUp = true) {
      this.world._assertLive();
      const id = this._id();
      const values = numbers(vel);
      if (!wakeUp && !this.world._bi.IsActive(id)) {
        // Rapier stores the velocity on a sleeping body without waking it, so it only takes
        // effect once something else wakes the body. Jolt's write activates the body, so keep
        // the value here and let `World.step` apply it when the body is awake again.
        this.pendingLinvel = values;
        return;
      }
      this.pendingLinvel = null;
      const v = new J.Vec3(...values);
      try {
        this.world._bi.SetLinearVelocity(id, v);
      } finally {
        destroy(v);
      }
      if (wakeUp) this.world._bi.ActivateBody(id);
    }

    /** Rapier `setAngvel(vel, wakeUp)`. */
    setAngvel(vel, wakeUp = true) {
      this.world._assertLive();
      const id = this._id();
      const values = numbers(vel);
      if (!wakeUp && !this.world._bi.IsActive(id)) {
        this.pendingAngvel = values; // see setLinvel
        return;
      }
      this.pendingAngvel = null;
      const v = new J.Vec3(...values);
      try {
        this.world._bi.SetAngularVelocity(id, v);
      } finally {
        destroy(v);
      }
      if (wakeUp) this.world._bi.ActivateBody(id);
    }

    /** Apply a velocity written to a sleeping body with `wakeUp = false`, once it is awake. */
    _flushPendingVelocity() {
      if (!this.pendingLinvel && !this.pendingAngvel) return;
      const id = this.id;
      if (!id || !this.world._bi.IsActive(id)) return;
      if (this.pendingLinvel) {
        const v = new J.Vec3(...this.pendingLinvel);
        try {
          this.world._bi.SetLinearVelocity(id, v);
        } finally {
          destroy(v);
        }
        this.pendingLinvel = null;
      }
      if (this.pendingAngvel) {
        const v = new J.Vec3(...this.pendingAngvel);
        try {
          this.world._bi.SetAngularVelocity(id, v);
        } finally {
          destroy(v);
        }
        this.pendingAngvel = null;
      }
    }

    /** Rapier `RigidBody.wakeUp()`. */
    wakeUp() {
      this.world._assertLive();
      this.world._bi.ActivateBody(this._id());
    }

    /** Rapier `isSleeping()`: Jolt reports inactivity for sleeping bodies. */
    isSleeping() {
      return !this.world._bi.IsActive(this._id());
    }

    /**
     * Local (body-frame) offset of the body's centre of mass from its origin: zero unless the
     * collider is offset. Joint anchors are given in this same body space by Rapier, and Jolt's
     * `LocalToBodyCOM` wants them relative to the COM, so the two differ by exactly this vector.
     */
    _centerOfMassInBodySpace() {
      const world = this.world;
      const id = this._id();
      // Borrowed Body*: never destroyed, only read from.
      const impl = world._ps.GetBodyLockInterfaceNoLock().TryGetBody(id);
      const com = impl.GetCenterOfMassPosition(); // borrowed RVec3: copy out now
      const cx = com.GetX(), cy = com.GetY(), cz = com.GetZ();
      const p = world._bi.GetPosition(id);
      const px = p.GetX(), py = p.GetY(), pz = p.GetZ();
      const q = world._bi.GetRotation(id);
      const rot = { x: q.GetX(), y: q.GetY(), z: q.GetZ(), w: q.GetW() };
      const local = unrotate(rot, cx - px, cy - py, cz - pz);
      return [local[0] || 0, local[1] || 0, local[2] || 0];
    }
  }

  /* ----------------------------------------------------------------- joints */

  /**
   * Rapier `ImpulseJoint`. One Jolt `TwoBodyConstraint`, plus the pair-filter bookkeeping that
   * Rapier hides behind `setContactsEnabled()`.
   */
  class ImpulseJoint {
    constructor(world, data, body1, body2) {
      this.world = world;
      this.data = data;
      this.body1 = body1;
      this.body2 = body2;
      this.constraint = null; // owned by PhysicsSystem while added (see the header note)
      this.hinge = null; // borrowed HingeConstraint view of `constraint` (`J.castObject`)
      this.contacts = true; // Rapier keeps contacts between jointed bodies enabled by default
      this.removed = false;
    }

    _create(wakeUp) {
      const world = this.world;
      const id1 = this.body1._id(),
        id2 = this.body2._id();
      const com1 = this.body1._centerOfMassInBodySpace(),
        com2 = this.body2._centerOfMassInBodySpace();
      const anchor1 = this.data.anchor1.map((v, i) => v - com1[i]);
      const anchor2 = this.data.anchor2.map((v, i) => v - com2[i]);
      const settings =
        this.data.kind === 'revolute'
          ? hingeSettings(this.data.axis, anchor1, anchor2)
          : pointSettings(anchor1, anchor2);
      const extra = Math.max(
        0,
        this.body1.desc.additionalSolverIterations || 0,
        this.body2.desc.additionalSolverIterations || 0
      );
      if (extra > 0) {
        const steps = world._solverSteps();
        settings.mNumVelocityStepsOverride = steps.velocity + extra;
        settings.mNumPositionStepsOverride = steps.position + extra;
      }
      let constraint = null;
      try {
        constraint = world._bi.CreateConstraint(settings, id1, id2);
      } finally {
        // The constraint copies everything it needs; drop our settings object.
        destroy(settings);
      }
      world._ps.AddConstraint(constraint);
      this.constraint = constraint;
      if (this.data.kind === 'revolute' && J.castObject) {
        // `CreateConstraint` returns the base `TwoBodyConstraint` wrapper. The native object must
        // be a HingeConstraint; check the subtype, then ask embind for the derived view so the
        // hinge-only entry points (SetLimits/GetCurrentAngle) are reachable.
        if (constraint.GetSubType() !== J.EConstraintSubType_Hinge)
          throw new Error('joltBridge: Jolt created a non-hinge constraint for JointData.revolute');
        this.hinge = J.castObject(constraint, J.HingeConstraint);
      }
      if (wakeUp) {
        if (!this.body1.removed) this.body1.wakeUp();
        if (!this.body2.removed) this.body2.wakeUp();
      }
    }

    /** Rapier `setContactsEnabled(false)`: exclude this body pair from contacts, and only it. */
    setContactsEnabled(enabled) {
      this.world._assertLive();
      if (this.removed) throw new Error('joltBridge: this impulse joint was removed');
      const contacts = !!enabled;
      this.world._setJointPairCollide(this, contacts); // may throw when the table is full
      this.contacts = contacts;
    }

    /** Rapier `setLimits(min, max)`: native angular limits about the hinge axis, radians. */
    setLimits(min, max) {
      this.world._assertLive();
      if (this.removed) throw new Error('joltBridge: this impulse joint was removed');
      if (!this.hinge)
        throw new Error('joltBridge: setLimits is emulated for revolute (hinge) joints only');
      this.hinge.SetLimits(Number(min) || 0, Number(max) || 0);
    }

    /** Benchmark readback: current hinge angle in radians (null for non-hinge joints). */
    angle() {
      return this.hinge ? this.hinge.GetCurrentAngle() : null;
    }

    _release(wakeUp) {
      if (this.removed) return;
      this.removed = true;
      const world = this.world;
      const at = world._joints.indexOf(this);
      if (at >= 0) world._joints.splice(at, 1);
      if (this.constraint) {
        // RemoveConstraint drops the physics system's reference, which destroys the native
        // constraint on this build. Never Release() it afterwards (see the header note).
        if (!world.freed) world._ps.RemoveConstraint(this.constraint);
        this.constraint = null;
        this.hinge = null;
      }
      // Rapier re-enables the pair when the joint that disabled it goes away, so a detached
      // limb can hit its former parent again.
      if (!this.contacts) world._setJointPairCollide(this, true, false);
      if (wakeUp && !world.freed) {
        if (!this.body1.removed) this.body1.wakeUp();
        if (!this.body2.removed) this.body2.wakeUp();
      }
    }
  }

  const hingeSettings = (axis, anchor1, anchor2) => {
    const settings = new J.HingeConstraintSettings();
    settings.mSpace = J.EConstraintSpace_LocalToBodyCOM;
    const normal = perpendicularAxis(axis);
    const scratch = [];
    try {
      const p1 = new J.RVec3(...anchor1);
      scratch.push(p1);
      settings.mPoint1 = p1;
      const p2 = new J.RVec3(...anchor2);
      scratch.push(p2);
      settings.mPoint2 = p2;
      const a = new J.Vec3(...axis);
      scratch.push(a);
      settings.mHingeAxis1 = a;
      settings.mHingeAxis2 = a; // same world axis for both bodies: initial angle 0
      const n = new J.Vec3(...normal);
      scratch.push(n);
      settings.mNormalAxis1 = n;
      settings.mNormalAxis2 = n;
      // Jolt's own default (a ±π stop); `setLimits` replaces it. Rapier's unbounded revolute
      // has no stop at all — documented limitation, never hit by infantry-ragdoll.js.
      settings.mLimitsMin = -Math.PI;
      settings.mLimitsMax = Math.PI;
    } finally {
      for (const s of scratch) destroy(s);
    }
    return settings;
  };

  const pointSettings = (anchor1, anchor2) => {
    const settings = new J.PointConstraintSettings();
    settings.mSpace = J.EConstraintSpace_LocalToBodyCOM;
    const scratch = [];
    try {
      const p1 = new J.RVec3(...anchor1);
      scratch.push(p1);
      settings.mPoint1 = p1;
      const p2 = new J.RVec3(...anchor2);
      scratch.push(p2);
      settings.mPoint2 = p2;
    } finally {
      for (const s of scratch) destroy(s);
    }
    return settings;
  };

  /* ------------------------------------------------------------------ world */

  class World {
    constructor(gravity, worldOptions = {}) {
      this.config = { ...config, ...worldOptions };
      this.gravity = numbers(gravity);
      this.timestep = this.config.timestep ?? DEFAULT_TIMESTEP;
      this.freed = false;
      this._bodies = [];
      this._colliders = [];
      this._joints = [];
      this._groups = [0]; // object layer -> Rapier collisionGroups; layer 0 is the inert group 0
      this._table = null; // lazy J.GroupFilterTable for joint pair suppression
      this._recycledJointGroups = [];
      this._nextJointGroup = 1; // 0 stays the shared "always collide" row

      const layers = MAX_LAYERS;
      this._pair = new J.ObjectLayerPairFilterTable(layers);
      this._bpLayers = new J.BroadPhaseLayerInterfaceTable(layers, 1);
      const bpLayer = new J.BroadPhaseLayer(0);
      for (let i = 0; i < layers; i++) this._bpLayers.MapObjectToBroadPhaseLayer(i, bpLayer);
      destroy(bpLayer);
      // Explicitly enable pairs before constructing this table (the initial table is empty).
      // ObjectVsBroadPhaseLayerFilterTable
      // precomputes its answers at construction and must stay permissive. Exact filtering
      // happens in the pair filter, which Jolt queries while building collision pairs.
      for (let i = 0; i < layers; i++) for (let j = 0; j <= i; j++) this._pair.EnableCollision(i,j);
      this._ovb = new J.ObjectVsBroadPhaseLayerFilterTable(this._bpLayers, 1, this._pair, layers);

      this._settings = new J.JoltSettings();
      this._settings.mMaxBodies = this.config.maxBodies;
      this._settings.mMaxBodyPairs = this.config.maxBodyPairs;
      this._settings.mMaxContactConstraints = this.config.maxContactConstraints;
      this._settings.mMaxWorkerThreads = this.config.maxWorkerThreads;
      this._settings.mBroadPhaseLayerInterface = this._bpLayers;
      this._settings.mObjectLayerPairFilter = this._pair;
      this._settings.mObjectVsBroadPhaseLayerFilter = this._ovb;

      this._jolt = new J.JoltInterface(this._settings);
      this._ps = this._jolt.GetPhysicsSystem();
      this._bi = this._ps.GetBodyInterface();
      const g = new J.Vec3(...this.gravity);
      this._ps.SetGravity(g);
      destroy(g);
      this._configureLayer(INERT_LAYER);

      if (this.config.velocitySteps != null || this.config.positionSteps != null || this.config.allowSleeping != null) {
        // Borrowed snapshot: mutate the copy and hand it back, never destroy it.
        const pset = this._ps.GetPhysicsSettings();
        if (this.config.velocitySteps != null) pset.mNumVelocitySteps = this.config.velocitySteps;
        if (this.config.positionSteps != null) pset.mNumPositionSteps = this.config.positionSteps;
        if (this.config.allowSleeping != null) pset.mAllowSleeping = !!this.config.allowSleeping;
        this._ps.SetPhysicsSettings(pset);
      }
    }

    _assertLive() {
      if (this.freed) throw new Error('joltBridge: this world has been freed');
    }

    /** Jolt's current solver budget, used for Rapier's additive iteration counts. */
    _solverSteps() {
      const pset = this._ps.GetPhysicsSettings(); // borrowed copy
      return { velocity: pset.mNumVelocitySteps, position: pset.mNumPositionSteps };
    }

    /** Enable/disable every layer pair involving layer `k` according to Rapier's rule. */
    _configureLayer(k) {
      const groups = this._groups[k];
      const set = (a, b, collide) => (collide ? this._pair.EnableCollision(a, b) : this._pair.DisableCollision(a, b));
      for (let i = 0; i < MAX_LAYERS; i++) {
        if (i < k) {
          const collide = groupsCollide(groups, this._groups[i]);
          set(k, i, collide);
          set(i, k, collide); // the pair filter is queried in both orders
        } else if (i === k) {
          set(k, k, k !== INERT_LAYER && groupsCollide(groups, groups));
        } else {
          set(k, i, false); // not registered yet; registered later from the other side
          set(i, k, false);
        }
      }
    }

    _layerFor(groups) {
      const value = groups >>> 0;
      const found = this._groups.indexOf(value);
      if (found >= 0) return found;
      if (this._groups.length >= MAX_LAYERS)
        throw new Error(`joltBridge: more than ${MAX_LAYERS - 1} distinct collisionGroups values in one world`);
      this._groups.push(value);
      const layer = this._groups.length - 1;
      this._configureLayer(layer);
      return layer;
    }

    /**
     * Build the Jolt shape for a collider desc.
     * @param {ColliderDesc} desc
     * @param {boolean} withOffset
     *   true for a body-attached collider: its translation/rotation is baked into a
     *   `RotatedTranslatedShape` so the body origin stays Rapier's body origin. False for a
     *   body-less collider, whose offset is already carried by the implicit static body.
     * @returns {{shape: object|null, finalize: () => void}}
     *   `shape` is null when the mesh cannot be represented (see `_attachStatic`), and
     *   `finalize` must run once the shape has been handed to a BodyCreationSettings.
     */
    _shapeOf(desc, withOffset = false) {
      const offset = withOffset && hasOffset(desc);
      if (desc.kind === 'cuboid') {
        if (!offset) {
          const halfExtent = new J.Vec3(desc.half[0], desc.half[1], desc.half[2]);
          const shape = new J.BoxShape(halfExtent, BOX_CONVEX_RADIUS);
          destroy(halfExtent);
          // Rapier: mass = volume * density; Jolt's shape density default is 1000.
          shape.SetDensity(desc.density);
          return { shape, finalize: noop };
        }
        const halfExtent = new J.Vec3(desc.half[0], desc.half[1], desc.half[2]);
        let child = null;
        try {
          child = new J.BoxShapeSettings(halfExtent, BOX_CONVEX_RADIUS);
        } finally {
          destroy(halfExtent);
        }
        child.mDensity = desc.density;
        return this._wrappedShape(child, desc);
      }
      if (desc.kind === 'capsule') {
        if (!offset) {
          const shape = new J.CapsuleShape(desc.halfHeight, desc.radius);
          shape.SetDensity(desc.density);
          return { shape, finalize: noop };
        }
        const child = new J.CapsuleShapeSettings(desc.halfHeight, desc.radius);
        child.mDensity = desc.density;
        return this._wrappedShape(child, desc);
      }
      if (desc.kind === 'trimesh') {
        if (offset)
          throw new Error(
            'joltBridge: a translated/rotated trimesh collider on a rigid body is not emulated (no game path uses one)'
          );
        return this._meshShape(desc);
      }
      throw new Error(`joltBridge: unknown collider kind ${desc.kind}`);
    }

    /**
     * Wrap shape settings in a `RotatedTranslatedShapeSettings`, i.e. Rapier's collider offset on
     * a body. `RotatedTranslatedShape` itself has no JS constructor in this build, so the shape
     * is created through the settings cache and the cache is dropped in `finalize` (the Body
     * keeps the only reference to the shape).
     */
    _wrappedShape(child, desc) {
      const position = new J.Vec3(...desc.translation);
      const rotation = new J.Quat(...desc.rotation);
      let settings = null;
      try {
        settings = new J.RotatedTranslatedShapeSettings(position, rotation, child);
      } finally {
        destroy(position);
        destroy(rotation);
      }
      const result = settings.Create();
      if (result.HasError() || !result.IsValid()) {
        settings.ClearCachedResult();
        destroy(settings);
        throw new Error('joltBridge: could not build the offset (rotated/translated) shape for this collider');
      }
      const shape = result.Get(); // owned by the settings' cache until `finalize`
      return {
        shape,
        finalize: () => {
          // `DecoratedShapeSettings::mInnerShape` is a Ref: the settings own the child
          // settings, so the child must NOT be destroyed here (verified against this build:
          // destroying it frees a shape the body still uses and the next Step traps).
          settings.ClearCachedResult();
          destroy(settings);
        },
      };
    }

    _meshShape(desc) {
      const { verts, idx } = desc;
      if (verts.length < 9 || idx.length < 3) return { shape: null, finalize: noop };
      for (let i = 0; i < verts.length; i++) if (!Number.isFinite(verts[i])) return { shape: null, finalize: noop };

      const triangles = new J.TriangleList();
      const materials = new J.PhysicsMaterialList();
      let settings = null;
      try {
        const vertex = k => new J.Vec3(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]);
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const a = vertex(idx[t]);
          const b = vertex(idx[t + 1]);
          const c = vertex(idx[t + 2]);
          const triangle = new J.Triangle(a, b, c, 0);
          triangles.push_back(triangle); // copied by value into the list
          destroy(triangle);
          destroy(a);
          destroy(b);
          destroy(c);
        }
        settings = new J.MeshShapeSettings(triangles, materials); // copies the lists
      } finally {
        destroy(triangles);
        destroy(materials);
      }

      const result = settings.Create();
      if (result.HasError() || !result.IsValid()) {
        // Rapier accepts a degenerate trimesh as an inert collider; Jolt rejects it, so the
        // caller falls back to a collider that owns no body (see `_attachStatic`).
        settings.ClearCachedResult();
        destroy(settings);
        return { shape: null, finalize: noop };
      }
      // Borrowed: owned by the settings' cached ShapeResult, never destroyed directly.
      const shape = result.Get();
      return {
        shape,
        finalize: () => {
          // Drops the cache's reference; the Body (already created) keeps the shape alive.
          settings.ClearCachedResult();
          destroy(settings);
        },
      };
    }

    /** Placeholder shape for Rapier bodies that have no collider (see `_materialize`). */
    _inertShapeOf() {
      const halfExtent = new J.Vec3(0.001, 0.001, 0.001);
      const shape = new J.BoxShape(halfExtent, 0.0005);
      destroy(halfExtent);
      return { shape, finalize: noop };
    }

    createRigidBody(desc) {
      this._assertLive();
      if (!(desc instanceof RigidBodyDesc)) throw new TypeError('joltBridge: createRigidBody expects a RigidBodyDesc');
      const body = new RigidBody(this, desc);
      this._bodies.push(body);
      return body;
    }

    createCollider(desc, body) {
      this._assertLive();
      if (!(desc instanceof ColliderDesc)) throw new TypeError('joltBridge: createCollider expects a ColliderDesc');
      const collider = new Collider(this, desc, body || null);
      if (body) {
        if (!(body instanceof RigidBody)) throw new TypeError('joltBridge: createCollider body must come from this world');
        if (body.world !== this) throw new Error('joltBridge: rigid body belongs to a different world');
        if (body.removed) throw new Error('joltBridge: rigid body was removed');
        if (body.collider)
          throw new Error('joltBridge: one collider per body (Rapier compound colliders are not emulated)');
        if (body.id) throw new Error('joltBridge: attach the collider before the body is stepped or read');
        body.collider = collider;
        body._materialize();
        this._colliders.push(collider);
        return collider;
      }
      this._colliders.push(collider);
      this._attachStatic(collider);
      return collider;
    }

    /** A Rapier collider with no parent body: one implicit static body at the collider transform. */
    _attachStatic(collider) {
      const desc = collider.desc;
      // No shape offset here: the collider transform *is* the implicit body transform.
      const graph = this._shapeOf(desc, false);
      if (!graph.shape) {
        // Rapier keeps an empty/degenerate trimesh as a valid, contactless collider.
        collider.inert = true;
        return;
      }
      const bcs = new J.BodyCreationSettings();
      const scratch = [];
      try {
        bcs.SetShape(graph.shape);
        const position = new J.RVec3(...desc.translation);
        scratch.push(position);
        bcs.mPosition = position;
        const rotation = new J.Quat(...desc.rotation);
        scratch.push(rotation);
        bcs.mRotation = rotation;
        bcs.mMotionType = J.EMotionType_Static;
        bcs.mObjectLayer = this._layerFor(desc.collisionGroups);
        bcs.mFriction = desc.friction;
        bcs.mRestitution = desc.restitution;
        bcs.mAllowSleeping = false;
        const created = this._bi.CreateAndAddBody(bcs, J.EActivation_DontActivate);
        collider.id = new J.BodyID(created.GetIndexAndSequenceNumber());
      } finally {
        for (const s of scratch) destroy(s);
        destroy(bcs);
        graph.finalize();
      }
    }

    /* ---------------------------------------------------------------- joints */

    /**
     * Rapier `world.createImpulseJoint(data, body1, body2, wakeUp)`.
     * `body1` is the parent (its anchor is `data.anchor1`), `body2` the child.
     */
    createImpulseJoint(data, body1, body2, wakeUp = true) {
      this._assertLive();
      if (!(data instanceof JointData))
        throw new TypeError('joltBridge: createImpulseJoint expects JointData.revolute(...) or JointData.spherical(...)');
      for (const body of [body1, body2]) {
        if (!(body instanceof RigidBody)) throw new TypeError('joltBridge: createImpulseJoint expects rigid bodies');
        if (body.world !== this) throw new Error('joltBridge: impulse joint body belongs to a different world');
        if (body.removed) throw new Error('joltBridge: impulse joint body was removed');
      }
      if (body1 === body2) throw new Error('joltBridge: an impulse joint needs two distinct bodies');
      const joint = new ImpulseJoint(this, data, body1, body2);
      this._joints.push(joint);
      try {
        joint._create(wakeUp);
      } catch (e) {
        const at = this._joints.indexOf(joint);
        if (at >= 0) this._joints.splice(at, 1);
        joint.removed = true;
        throw e;
      }
      return joint;
    }

    /** Rapier `world.removeImpulseJoint(joint, wakeUp)`. */
    removeImpulseJoint(joint, wakeUp = true) {
      this._assertLive();
      if (!(joint instanceof ImpulseJoint)) throw new TypeError('joltBridge: removeImpulseJoint expects an ImpulseJoint');
      if (joint.world !== this) throw new Error('joltBridge: impulse joint belongs to a different world');
      joint._release(wakeUp);
    }

    /**
     * The joint pair filter. Rapier `setContactsEnabled(false)` == "these two bodies never
     * collide while the joint lives"; Jolt expresses that with a `GroupFilterTable` and a
     * distinct sub-group id per body, leaving every other pair (including non-adjacent limbs of
     * the same ragdoll) untouched.
     */
    _setJointPairCollide(joint, collide, throwWhenUnsatisfiable = true) {
      // Nothing to re-enable if no table was ever allocated for this world.
      if (collide && !this._table) return;
      const table = this._jointTable();
      const g1 = this._jointGroupOf(joint.body1);
      const g2 = this._jointGroupOf(joint.body2);
      if (g1 === g2 || g1 === 0 || g2 === 0) {
        // Sub-group 0 is the shared row every other body also uses; disabling it would silently
        // suppress unrelated pairs, so refuse instead of guessing.
        if (throwWhenUnsatisfiable && !collide)
          throw new Error(
            `joltBridge: no free joint collision groups left (jointGroups=${this.config.jointGroups}); ` +
              'raise the bridge option to give each jointed body its own pair-filter id'
          );
        return;
      }
      if (collide) table.EnableCollision(g1, g2);
      else table.DisableCollision(g1, g2);
    }

    _jointTable() {
      if (!this._table) {
        this._table = new J.GroupFilterTable(this.config.jointGroups);
        this._table.AddRef(); // Bridge owns a reference even between waves with no live bodies.
      }
      return this._table;
    }

    /** Claim (once) a pair-filter sub-group id for a body and install the filter on it. */
    _jointGroupOf(body) {
      if (body.jointGroup) return body.jointGroup;
      if (!this._recycledJointGroups.length && this._nextJointGroup >= this.config.jointGroups) return 0;
      const id = this._recycledJointGroups.pop() ?? this._nextJointGroup++;
      const groupId = body._id();
      // Borrowed Body* / CollisionGroup: the wrapper aliases storage inside the body, so the
      // filter is installed by mutating it (verified against the real WASM; a copy would not
      // suppress anything). Neither wrapper is destroyed.
      const impl = this._ps.GetBodyLockInterfaceNoLock().TryGetBody(groupId);
      const group = impl.GetCollisionGroup();
      group.SetGroupFilter(this._jointTable());
      group.SetGroupID(0); // Jolt only consults the filter when both group ids match
      group.SetSubGroupID(id);
      body.jointGroup = id;
      // Pair filtering is re-evaluated per step; wake the body so its cached pairs refresh.
      this._bi.ActivateBody(groupId);
      return id;
    }

    /* --------------------------------------------------------------- removal */

    removeRigidBody(body) {
      this._assertLive();
      if (!(body instanceof RigidBody) || body.world !== this)
        throw new Error('joltBridge: removeRigidBody expects a body from this world');
      if (body.removed) return;
      body.removed = true;
      const at = this._bodies.indexOf(body);
      if (at >= 0) this._bodies.splice(at, 1);
      if (body.collider) {
        body.collider.removed = true;
        const c = this._colliders.indexOf(body.collider);
        if (c >= 0) this._colliders.splice(c, 1);
      }
      // Rapier drops the impulse joints attached to a removed body, so do that first: Jolt
      // constraints must be gone before their bodies are destroyed.
      for (const joint of [...this._joints])
        if (joint.body1 === body || joint.body2 === body) joint._release(false);
      this._destroyBody(body);
    }

    _destroyBody(body) {
      if (!body.id) return; // never materialised: nothing was allocated
      this._bi.RemoveBody(body.id);
      // Frees the body and, with it, the shape it held the only reference to.
      this._bi.DestroyBody(body.id);
      destroy(body.id);
      body.id = null;
      if (body.jointGroup) { this._recycledJointGroups.push(body.jointGroup); body.jointGroup=0; }
    }

    removeCollider(collider, wakeUp) {
      this._assertLive();
      if (!(collider instanceof Collider) || collider.world !== this)
        throw new Error('joltBridge: removeCollider expects a collider from this world');
      if (collider.body)
        throw new Error(
          'joltBridge: removeCollider on a body-attached collider would need a shape swap; call removeRigidBody instead'
        );
      if (collider.removed) return;
      collider.removed = true;
      const at = this._colliders.indexOf(collider);
      if (at >= 0) this._colliders.splice(at, 1);
      if (collider.id) {
        this._bi.RemoveBody(collider.id);
        this._bi.DestroyBody(collider.id);
        destroy(collider.id);
        collider.id = null;
      }
    }

    /** One fixed step, exactly Rapier's `world.step()` at `world.timestep`. */
    step() {
      this._assertLive();
      if (!(this.timestep > 0)) throw new Error('joltBridge: world.timestep must be > 0');
      for (let i = 0; i < this._bodies.length; i++) {
        const body = this._bodies[i];
        body._materialize();
        body._flushPendingVelocity();
      }
      this._jolt.Step(this.timestep, this.config.collisionSteps);
    }

    /** Live Jolt body count — includes the implicit static bodies of body-less colliders, like Rapier. */
    numBodies() {
      this._assertLive();
      return this._ps.GetNumBodies();
    }

    numColliders() {
      this._assertLive();
      return this._colliders.length;
    }

    /**
     * Live impulse joints. Bridge-side count: this build's binding exposes no
     * `PhysicsSystem::GetNumConstraints`, so there is no native number to read (see header).
     */
    numJoints() {
      this._assertLive();
      return this._joints.length;
    }

    /** Validation helper: Jolt's own counters plus the world's remaining arena budget. */
    stats() {
      if (this.freed) return { bodies: 0, activeDynamic: 0, colliders: 0, joints: 0, freeMemory: 0 };
      return {
        bodies: this._ps.GetNumBodies(),
        activeDynamic: this._ps.GetNumActiveBodies(J.EBodyType_Dynamic),
        colliders: this._colliders.length,
        joints: this._joints.length,
        freeMemory: this._jolt.sGetFreeMemory(),
      };
    }

    free() {
      if (this.freed) return;
      // Constraints first: a Jolt constraint must not outlive either of its bodies.
      for (const joint of this._joints.splice(0)) {
        joint.removed = true;
        if (joint.constraint) this._ps.RemoveConstraint(joint.constraint);
        joint.constraint = null;
        joint.hinge = null;
      }
      for (const body of this._bodies.splice(0)) {
        body.removed = true;
        this._destroyBody(body);
      }
      for (const collider of this._colliders.splice(0)) {
        collider.removed = true;
        if (!collider.id) continue;
        this._bi.RemoveBody(collider.id);
        this._bi.DestroyBody(collider.id);
        destroy(collider.id);
        collider.id = null;
      }
      this.freed = true;
      // All native bodies are gone. Balance our explicit AddRef, never delete a borrowed table.
      this._table?.Release(); this._table = null;
      // The interface owns this world's preallocated arena (temp allocator + physics system).
      // Its settings/filters are allocated from that arena and are referenced by the physics
      // system during teardown, so they are neither destroyed here nor usable afterwards.
      destroy(this._jolt);
      this._jolt = null;
      this._ps = null;
      this._bi = null;
      this._settings = null;
      this._pair = null;
      this._ovb = null;
      this._bpLayers = null;
    }
  }

  return { World, RigidBodyDesc, ColliderDesc, JointData };
}
