import * as THREE from 'three';
import { placeCached } from './posecache.js';
import { infantryRagdoll } from './infantry-ragdoll.js';
import { DeathFragments } from './death-fragments.js';
import { HullCuts } from './hull-cut-cache.js';
import { wreckSkin, releaseSkinGeometry } from './wreck-skin.js';
import { WreckMovers } from './wreck-push.js';

const STEP = 1 / 60,
  LIFETIME = 12,
  MAX_WRECKS = 8,
  MAX_PARTS = 6,
  // Once a wreck settles it is a render-only pose. The archive is bounded by
  // records and by pieces, oldest first, so a long battle cannot grow it.
  MAX_PARKED = 40,
  MAX_PARKED_PARTS = 240,
  // A shove is local and short: only a few archived wrecks may regain bodies at
  // once, and only a bounded number of their pieces.
  MAX_AWAKE = 3,
  MAX_AWAKE_PARTS = 24,
  WAKE_LIFE = 5,
  PIECE_GROUP = 0x00020001;
export { loadWreckPhysics } from './rapier-runtime.js';

// Read-only view of the archive bounds for the mounted acceptance check.
export const VEHICLE_WRECK_LIMITS = Object.freeze({
  MAX_PARKED,
  MAX_PARKED_PARTS,
  MAX_AWAKE,
  MAX_AWAKE_PARTS,
  WAKE_LIFE,
  MAX_PARTS
});

// Keep the visible authored hull, turret, tracks, etc. together by mesh group.
// Snapshot the transforms (and any skin palette), not the shared model assets.
function wreckParts(u) {
  const inst = u.inst;
  if (!inst?.root) return [];
  if (!inst.pc || !placeCached(u)) {
    u.holder.updateWorldMatrix(true, true);
    if (inst.dirty || inst.skins?.some(s=>!s.mats)) inst.syncSkins?.();
  }
  const skins = new Map(inst.skins?.map(s => [s.mesh, s.mats]));
  const groups = new Map();
  inst.root.traverseVisible(mesh => {
    if (
      !mesh.isMesh ||
      mesh.isInstancedMesh ||
      !mesh.geometry?.attributes.position ||
      mesh.material?.transparent ||
      !mesh.material?.visible
    )
      return;
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (box.isEmpty() || !Number.isFinite(box.min.lengthSq() + box.max.lengthSq())) return;
    let part = groups.get(mesh.parent);
    if (!part) groups.set(mesh.parent, (part = { box: new THREE.Box3(), meshes: [] }));
    part.box.union(box);
    part.meshes.push({ mesh, palette: skins.get(mesh)?.slice() });
  });
  const rows = [...groups.values()].sort(
    (a, b) => b.box.getSize(new THREE.Vector3()).lengthSq() - a.box.getSize(new THREE.Vector3()).lengthSq()
  );
  // Keep every opaque surface, but attach small fittings to the hull rather than
  // creating an unbounded number of bodies on high-detail Workshop vehicles.
  for (const extra of rows.splice(MAX_PARTS)) {
    rows[0].box.union(extra.box);
    rows[0].meshes.push(...extra.meshes);
  }
  return rows;
}

function groundPatch(R, world, x, y, radius, height, groups = 0x00010002) {
  const cell = 20;
  x = Math.round(x / cell) * cell;
  y = Math.round(y / cell) * cell;
  radius = Math.ceil(radius / cell) * cell;
  const n = (2 * radius) / cell,
    pos = [],
    ix = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const dx = radius * ((2 * i) / n - 1),
        dy = radius * ((2 * j) / n - 1);
      pos.push(dx, dy, height(x + dx, y + dy));
      if (i < n && j < n) {
        const a = j * (n + 1) + i;
        ix.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      }
    }
  return world.createCollider(
    R.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(ix)).setTranslation(x, y, 0).setCollisionGroups(groups).setFriction(0.85)
  );
}

export class VehicleWrecks {
  constructor(R, scene, height, fogged, keepBodies = () => false) {
    this.keepBodies = keepBodies;
    this.settled = [];
    this.R = R;
    this.scene = scene;
    this.height = height;
    this.fogged = fogged;
    this.world = new R.World({ x: 0, y: 0, z: -100 }); // Land uses Z up and 20 world units per terrain cell.
    this.world.timestep = STEP;
    this.residue = new DeathFragments(R, this.world, scene, height);
    this.cuts = new HullCuts();
    this.live = [];
    this.replaced = new WeakSet();
    this.owed = 0;
    // Vehicle archive: solved poses with their renderables kept, no bodies.
    this.parked = [];
    this.parkedParts = 0;
    this.awake = [];
    this.awakeParts = 0;
    this.movers = new WreckMovers(fogged);
  }

  // Only a successful model-specific handoff may suppress the authored death.
  // Otherwise emit additive ejecta; even a new unit category needs no registration.
  presentDeath(u) {
    if (
      !this.world ||
      u.inside ||
      u.scriptHidden ||
      u.netHidden ||
      u.cloaked ||
      u.seen === false ||
      u.holder?.visible === false ||
      !Number.isFinite(u.x) ||
      !Number.isFinite(u.y) ||
      this.replaced.has(u) ||
      this.fogged(u.x, u.y)
    )
      return false;
    if (this.spawn(u)) return true;
    // Even a vanished model or a full moving pool leaves a little solid wreck
    // on the ground. Do not claim the authored death without capturing its art.
    const emitted=this.residue.emit(u);
    if (emitted && u.kind==='VEHICLE' && !u.flies && !u.foot && !u.structure) this.residue.pieces.at(-1).keepGround=true;
    return emitted;
  }

  spawn(u) {
    if (
      !this.world ||
      !(u.foot ? u.kind === 'INFANTRY' : u.kind === 'VEHICLE') ||
      u.structure ||
      u.flies ||
      u.inside ||
      u.scriptHidden ||
      u.netHidden ||
      u.seen === false ||
      !u.holder?.visible ||
      this.fogged(u.x, u.y) ||
      this.replaced.has(u)
    )
      return false;
    // Keep a bounded moving pool. Never freeze a still-falling body in midair.
    const keep = this.keepBodies();
    const full=this.live.length >= (keep ? 32 : MAX_WRECKS);
    // Do not erase a previously released hull in flight to make room for the
    // next death. Take a sleeping hull out of the solver or use additive scrap.
    if (full && !this.recycleLive() && (keep || !this.live.some(r=>r.doll))) return false;
    const { R, world } = this;
    const wreck = { u, age: 0, pieces: [], ground: null, doll: null };
    try {
      if (u.foot) {
        // Isolate each body and its patch. Overlapping squads must not push
        // against ten neighbours' limbs and duplicate contact surfaces at once.
        let slot = 4;
        while (slot <= 0x8000 && this.live.some(r => r.slot === slot)) slot *= 2;
        const isolated = slot <= 0x8000;
        wreck.slot = isolated ? slot : 0;
        const group = isolated ? ((slot << 16) | slot) >>> 0 : 0x00020001;
        wreck.doll = infantryRagdoll(R, world, u, this.height, group);
        if (!wreck.doll) return false;
        wreck.ground = groundPatch(R, world, u.x, u.y, 60, this.height, isolated ? group : 0x00010002);
        this.scene.add(wreck.doll.root);
      } else if (!this.buildVehicle(u, wreck)) return false;
    } catch (e) {
      this.release(wreck);
      console.warn('Using stock unit death:', e);
      return false;
    }
    if (!keep && this.live.length >= MAX_WRECKS) this.remove(this.live.find(r=>r.doll));
    this.live.push(wreck);
    this.replaced.add(u);
    u.holder.visible = false;
    return true;
  }

  // Under pressure, release the oldest settled vehicle instead of throwing away
  // detailed pieces that already came to rest. A still-falling hull is removed.
  recycleLive() {
    const wreck = this.live.find(r => !r.doll && r.pieces.length && this.piecesAsleep(r));
    return wreck ? this.parkVehicle(wreck) : false;
  }

  buildVehicle(u, wreck) {
    const { R, world } = this;
    let parts = wreckParts(u);
    if (!parts.length) return false;
    const all = parts.reduce((box, p) => box.union(p.box), new THREE.Box3());
    const span = all.getSize(new THREE.Vector3()).length();
    if (!(span > 0 && span < 500)) return false;
    // A skinned walker may export independent parts in a single draw primitive.
    // Use its real separated islands before resorting to plane cuts.
    if (parts.length === 1 && parts[0].meshes.length === 1) {
      const { mesh, palette } = parts[0].meshes[0];
      if (palette && mesh.geometry.index?.count <= 18000) {
        const islands = wreckSkin(mesh, { mats: palette }, true);
        if (islands.length) {
          wreck.skinViews = islands.map(m => m.geometry);
          parts = islands
            .map(m => ({
              box: m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld),
              meshes: [{ mesh: m, palette: m.userData.frozenPalette }]
            }))
            .sort((a, b) => b.box.getSize(new THREE.Vector3()).lengthSq() - a.box.getSize(new THREE.Vector3()).lengthSq());
          for (const extra of parts.splice(MAX_PARTS)) {
            parts[0].box.union(extra.box);
            parts[0].meshes.push(...extra.meshes);
          }
        }
      }
    }
    const cut = parts.length === 1 && this.cuts.cut(parts[0].meshes, u.holder.matrixWorld, MAX_PARTS);
    if (cut) {
      parts = cut;
      wreck.owned = parts.flatMap(p => p.meshes.filter(m => m.generated).map(m => m.mesh.geometry));
    }
    const radius = Math.max(100, span * 2);
    wreck.ground = groundPatch(R, world, u.x, u.y, radius, this.height);
    for (const [i, part] of parts.entries()) {
      const center = part.box.getCenter(new THREE.Vector3()),
        half = part.box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const a = i || cut ? Math.atan2(center.y - u.y, center.x - u.x) : (u.heading || 0) + 0.6;
      const kick = i ? 16 : 7;
      // A tall walker should tip past its footprint, not rock back onto both feet.
      const spin = !i && half.z > Math.min(half.x, half.y) ? 4.5 : 1.8;
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(center.x, center.y, center.z)
          .setLinvel(Math.cos(a) * kick, Math.sin(a) * kick, i ? 30 : 18)
          .setAngvel({ x: -Math.sin(a) * spin, y: Math.cos(a) * spin, z: i % 2 ? 0.9 : -0.4 })
          .setAngularDamping(0.45)
          .setCcdEnabled(true)
      );
      const root = new THREE.Group();
      wreck.pieces.push({
        root,
        body,
        half: { x: Math.max(0.4, half.x), y: Math.max(0.4, half.y), z: Math.max(0.4, half.z) }
      });
      world.createCollider(
        R.ColliderDesc.cuboid(Math.max(0.4, half.x), Math.max(0.4, half.y), Math.max(0.4, half.z))
          .setRestitution(0.24)
          .setFriction(0.85)
          .setCollisionGroups(PIECE_GROUP),
        body
      );
      root.name = 'Vehicle wreck: ' + (u.type?.name || 'vehicle');
      root.position.copy(center);
      const offset = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
      for (const { mesh, palette } of part.meshes) {
        const geo = mesh.geometry.userData.battleCut ? mesh.geometry.clone() : mesh.geometry;
        if (geo !== mesh.geometry) (wreck.owned ||= []).push(geo);
        const piece = new THREE.Mesh(geo, mesh.material);
        piece.matrixAutoUpdate = false;
        piece.matrix.multiplyMatrices(offset, mesh.matrixWorld);
        if (palette)
          piece.onBeforeRender = () => {
            piece.material.uniforms.boneMatrices.value = palette;
            piece.material.uniformsNeedUpdate = true;
          };
        root.add(piece);
      }
      this.scene.add(root);
      root.updateMatrixWorld(true);
    }
    return true;
  }

  blast(x, y, z, radius) {
    if (!(radius > 0)) return;
    for (const r of this.live) {
      const d = r.doll;
      if (!d || d.detached || !d.root.visible) continue;
      const p = d.nodes[0].body.translation();
      if (Math.hypot(p.x - x, p.y - y, p.z - z) < radius) d.blast(x, y, z);
    }
  }

  clearSettled(old) {
    old.root.removeFromParent();
    for (const g of old.owned) g.dispose();
  }

  park(wreck) {
    const d = wreck.doll,
      p = d.nodes[0].body.translation();
    // Freeze the exact floor fit while the bodies still exist, then drop them.
    // A clipped pose parked here would stay clipped for its whole archive life.
    d.park();
    this.settled.push({ root: d.root, owned: d.owned, x: p.x, y: p.y });
    wreck.doll = null;
    this.remove(wreck);
    if (this.settled.length > 128) this.clearSettled(this.settled.shift());
  }

  syncPieces(wreck) {
    for (const { root, body } of wreck.pieces) {
      root.position.copy(body.translation());
      root.quaternion.copy(body.rotation());
      root.visible = !this.fogged(root.position.x, root.position.y);
      root.updateMatrixWorld(true);
    }
  }

  piecesAsleep(wreck) {
    return wreck.pieces.length > 0 && wreck.pieces.every(({ body }) => body.isSleeping());
  }

  // The old timer (or an early all-sleep settle) releases the native bodies but
  // keeps the exact solved meshes, pose and paint. Nothing is swapped for the
  // authored death model: these are the same renderables the player saw fall.
  parkVehicle(wreck) {
    if (!this.world || !wreck.pieces.length) return false;
    this.syncPieces(wreck);
    const rec = {
      pieces: [],
      owned: wreck.owned || [],
      skinViews: wreck.skinViews || [],
      ground: null,
      awake: 0,
      age: 0,
      x: 0,
      y: 0,
      // Only a map's own path-blocking wreck needs the authored obstacle kept.
      unit: wreck.u.deathClone?.bool('Death_Clone_Is_Obstacle') ? wreck.u : null
    };
    let sx = 0,
      sy = 0;
    for (const { root, body, half } of wreck.pieces) {
      const p = root.position;
      this.world.removeRigidBody(body);
      rec.pieces.push({ root, half, x: p.x, y: p.y, body: null });
      sx += p.x;
      sy += p.y;
    }
    rec.x = sx / rec.pieces.length;
    rec.y = sy / rec.pieces.length;
    if (wreck.ground) this.world.removeCollider(wreck.ground, false);
    // Hand ownership to the archive: the live record must not release it again.
    wreck.pieces = [];
    wreck.owned = null;
    wreck.skinViews = null;
    wreck.ground = null;
    const at = this.live.indexOf(wreck);
    if (at >= 0) this.live.splice(at, 1);
    if (!this.live.length && !this.residue.pieces.length) this.owed = 0;
    this.parked.push(rec);
    this.parkedParts += rec.pieces.length;
    this.trimParked();
    return true;
  }

  parkScrap(root,pos) {
    const x=pos.x,y=pos.y,half=root.scale.clone();
    root.position.set(x,y,this.height(x,y)+half.z*.65);root.visible=!this.fogged(x,y);root.updateMatrixWorld(true);
    this.parked.push({pieces:[{root,half,x,y,body:null}],owned:[],skinViews:[],ground:null,awake:0,age:0,x,y,unit:null});
    this.parkedParts++;this.trimParked();
  }

  trimParked() {
    while (this.parked.length > MAX_PARKED || this.parkedParts > MAX_PARKED_PARTS) {
      const rec = this.parked.shift();
      if (!rec) break;
      this.dropParked(rec);
    }
  }

  dropParked(rec) {
    this.parkedParts -= rec.pieces.length;
    for (const p of rec.pieces) {
      if (p.body) {
        this.world?.removeRigidBody(p.body);
        p.body = null;
        this.awakeParts -= 1;
      }
      p.root.removeFromParent();
    }
    rec.owned.forEach(g => g.dispose());
    rec.skinViews.forEach(releaseSkinGeometry);
    if (rec.ground) {
      this.world?.removeCollider(rec.ground, false);
      rec.ground = null;
    }
    if (rec.unit) this.replaced.delete(rec.unit);
    const i = this.awake.indexOf(rec);
    if (i >= 0) this.awake.splice(i, 1);
  }

  // A visible, grounded, genuinely moving hull may shove nearby archived pieces
  // back into the solver for a moment. Paused, teleporting, flying, hidden or
  // fogged movers never qualify, and the mover itself is only read.
  wakeNear(dt, units) {
    if (!this.parked.length || !this.world) return;
    const movers = this.movers.scan(units, dt);
    for (const mover of movers) {
      for (const rec of this.parked) {
        if (!rec.awake && this.awake.length >= MAX_AWAKE) continue;
        for (const p of rec.pieces) {
          if (p.body || this.awakeParts >= MAX_AWAKE_PARTS) continue;
          if (!p.root.visible || this.fogged(p.x, p.y)) continue;
          const reach = mover.reach + Math.max(p.half.x, p.half.y) + 2;
          const dx = p.x - mover.x,
            dy = p.y - mover.y;
          if (dx * dx + dy * dy > reach * reach) continue;
          if (Number.isFinite(mover.u.z)) {
            const h = p.root.position.z, extent=Math.hypot(p.half.x,p.half.y,p.half.z);
            if (mover.u.z>h+extent+1 || mover.u.z+Math.max(4,mover.u.aimZ*2||mover.reach)<h-extent) continue;
          }
          // Only travel toward the piece counts as contact; reversing away is not.
          if (mover.dx * dx + mover.dy * dy <= 0) continue;
          this.wakePiece(rec, p, mover);
        }
      }
    }
  }

  wakePiece(rec, p, mover) {
    const { R, world } = this;
    const ux = mover.dx / mover.dist,
      uy = mover.dy / mover.dist,
      push = 4 + 16 * mover.strength;
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.root.position.x, p.root.position.y, p.root.position.z)
        .setRotation(p.root.quaternion)
        .setLinvel(ux * push, uy * push, 1 + 3 * mover.strength)
        .setAngvel({ x: -uy * 1.1, y: ux * 1.1, z: mover.x > p.x ? -0.6 : 0.6 })
        .setAngularDamping(0.45)
        .setCcdEnabled(true)
    );
    world.createCollider(
      R.ColliderDesc.cuboid(p.half.x, p.half.y, p.half.z).setRestitution(0.24).setFriction(0.85).setCollisionGroups(PIECE_GROUP),
      body
    );
    p.body = body;
    if (!rec.ground) rec.ground = this.wakeGround(rec);
    if (!rec.awake) this.awake.push(rec);
    rec.awake += 1;
    rec.age = 0;
    this.awakeParts += 1;
  }

  // One patch covers a whole archived hull, sized from where its pieces lie.
  wakeGround(rec) {
    let cx = 0,
      cy = 0,
      radius = 40;
    for (const p of rec.pieces) {
      cx += p.root.position.x;
      cy += p.root.position.y;
    }
    cx /= rec.pieces.length;
    cy /= rec.pieces.length;
    for (const p of rec.pieces)
      radius = Math.max(radius, Math.hypot(p.root.position.x - cx, p.root.position.y - cy) + Math.max(p.half.x, p.half.y) + 40);
    return groundPatch(this.R, this.world, cx, cy, Math.min(300, radius), this.height);
  }

  sleepPiece(rec, p) {
    const body = p.body;
    if (!body) return;
    p.root.position.copy(body.translation());
    p.root.quaternion.copy(body.rotation());
    p.root.updateMatrixWorld(true);
    p.x = p.root.position.x;
    p.y = p.root.position.y;
    this.world.removeRigidBody(body);
    p.body = null;
    rec.awake -= 1;
    this.awakeParts -= 1;
  }

  // A re-settled hull goes back to the newest end of the archive, so the oldest
  // untouched wrecks are still the ones recycled first.
  restAwake(rec) {
    if (rec.ground) {
      this.world.removeCollider(rec.ground, false);
      rec.ground = null;
    }
    const i = this.awake.indexOf(rec);
    if (i >= 0) this.awake.splice(i, 1);
    const j = this.parked.indexOf(rec);
    if (j >= 0) this.parked.splice(j, 1);
    this.parked.push(rec);
    rec.age = 0;
  }

  stepAwake(dt) {
    for (const rec of [...this.awake]) {
      rec.age += dt;
      for (const p of rec.pieces) {
        const body = p.body;
        if (!body) continue;
        p.root.position.copy(body.translation());
        p.root.quaternion.copy(body.rotation());
        p.root.visible = !this.fogged(p.root.position.x, p.root.position.y);
        p.root.updateMatrixWorld(true);
        if (rec.age >= WAKE_LIFE || body.isSleeping()) this.sleepPiece(rec, p);
      }
      if (!rec.awake) this.restAwake(rec);
    }
  }

  update(dt, units = null) {
    const keep = this.keepBodies();
    if (!keep && this.settled.length) for (const old of this.settled.splice(0)) this.clearSettled(old);
    for (const old of this.settled) old.root.visible = !this.fogged(old.x, old.y);
    // Archived pieces follow the same fog rule as every other render-only corpse.
    for (const rec of this.parked) for (const p of rec.pieces) p.root.visible = !this.fogged(p.x, p.y);
    if (units && dt > 0) this.wakeNear(dt, units);
    else if (!(dt>0) && !this.wasPaused) this.movers.reset();
    this.wasPaused=!(dt>0);
    if ((!this.live.length && !this.residue.pieces.length && !this.awake.length) || !(dt > 0)) return;
    this.owed += Math.min(dt, 0.15);
    while (this.owed >= STEP) {
      for (const r of this.live) r.doll?.beforeStep();
      this.world.step();
      this.owed -= STEP;
    }
    this.residue.sync(dt, this.fogged, (obj,pos)=>this.parkScrap(obj,pos));
    for (let i = this.live.length - 1; i >= 0; i--) {
      const wreck = this.live[i];
      if (wreck.doll) {
        const d = wreck.doll,
          pos = d.nodes[0].body.translation(),
          asleep = d.nodes.every(s => s.body.isSleeping());
        d.root.visible = !this.fogged(pos.x, pos.y);
        if (!d.asleep || !asleep) d.sync();
        d.asleep = asleep;
      }
      // Draw this step's solved pose before any parking decision freezes it.
      this.syncPieces(wreck);
      if ((wreck.age += dt) >= LIFETIME) {
        if (wreck.doll) {
          if (keep) this.park(wreck);
          else this.remove(wreck);
        } else this.parkVehicle(wreck);
        continue;
      }
      if (keep && wreck.doll && wreck.doll.asleep && wreck.age > 2.5) this.park(wreck);
      else if (!wreck.doll && wreck.age > 2.5 && this.piecesAsleep(wreck)) this.parkVehicle(wreck);
    }
    this.stepAwake(dt);
  }

  // The mounted checks drive the layer directly; passing the local unit list
  // through keeps the same conservative shove rules as the battle frame loop.
  step(dt, units = null) {
    this.update(dt, units);
  }

  release(wreck) {
    wreck.doll?.dispose();
    wreck.owned?.forEach(g => g.dispose());
    wreck.skinViews?.forEach(releaseSkinGeometry);
    for (const { root, body } of wreck.pieces) {
      root.removeFromParent();
      this.world.removeRigidBody(body);
    }
    if (wreck.ground) this.world.removeCollider(wreck.ground, false);
  }

  remove(wreck) {
    this.release(wreck);
    this.live.splice(this.live.indexOf(wreck), 1);
    // If the map keeps a path-blocking wreck, its authored obstacle must stay visible.
    if (wreck.u.deathClone?.bool('Death_Clone_Is_Obstacle')) this.replaced.delete(wreck.u);
    if (!this.live.length && !this.residue.pieces.length) this.owed = 0;
  }

  dispose() {
    if (!this.world) return;
    for (const old of this.settled.splice(0)) this.clearSettled(old);
    for (const wreck of this.live.splice(0)) this.release(wreck);
    for (const rec of this.parked.splice(0)) this.dropParked(rec);
    this.parkedParts = 0;
    this.awake.length = 0;
    this.awakeParts = 0;
    this.movers.reset();
    this.residue.dispose();
    this.cuts.dispose();
    this.world?.free();
    this.world = null;
  }
}
