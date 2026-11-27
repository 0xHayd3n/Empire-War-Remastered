// A physical plan for a rig with no canonical anatomy. The authored bone hierarchy
// says which parts are articulated and the drawn geometry says where each part is
// and how much surface it carries, so nothing here reads a bone's name or assumes a
// humanoid. Named humanoids keep the tuned ten-body path in infantry-ragdoll.js.
import { Box3, Matrix4, Vector3 } from 'three';

// Bounded solver cost: the named humanoid path already uses ten bodies.
const MAX_BODIES = 12;
// A part shorter than this fraction of the model carries no reachable span; its
// geometry rides the part above it instead.
const MIN_SPAN = 0.02;
// Radians a general joint may rotate away from the authored pose. Only the rest
// pose is authored, so every joint stays close to it (fixed when it has no plane).
export const FLEX = 0.5;
// A bend any flatter than this authors no plane, so it cannot pick a hinge.
const FLAT = 0.2;

const _v = new Vector3();

const emptyBox = () => new Box3();
const pivot = bone => new Vector3().setFromMatrixPosition(bone.matrixWorld);
const unit = (a, b) => new Vector3().subVectors(b, a).normalize();

// A palette matrix that collapsed (hidden or animation-pinned bone) draws its
// vertices at a point that is not part of the model: leave it out of the plan.
function usable(m) {
  const e = m.elements;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) return false;
  const det = m.determinant();
  return Number.isFinite(det) && Math.abs(det) > 1e-9;
}

// Capsule geometry from the box a part's drawn surface occupies. The collider only
// has to agree with the authored shape: the floor fit and the drawn skin never read it.
function spanOf(box, length) {
  if (!box || box.isEmpty()) return null;
  const size = box.getSize(new Vector3()),
    centre = box.getCenter(new Vector3());
  // Longest box axis, preferring x then y then z. A contact shape only.
  const longest = Math.max(size.x, size.y, size.z),
    dir = longest === size.x ? new Vector3(1, 0, 0) : longest === size.y ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  let lo = Infinity,
    hi = -Infinity,
    perp = 0;
  for (let c = 0; c < 8; c++) {
    _v.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z).sub(centre);
    const along = _v.dot(dir);
    lo = Math.min(lo, along);
    hi = Math.max(hi, along);
    perp = Math.max(perp, _v.addScaledVector(dir, -along).length());
  }
  const reach = hi - lo;
  if (!(reach > MIN_SPAN * length)) return null;
  return {
    start: centre.clone().addScaledVector(dir, lo),
    end: centre.clone().addScaledVector(dir, hi),
    radius: Math.max(Math.min(perp * 0.6, reach * 0.5), MIN_SPAN * length) / length
  };
}

export function articulatedPlan(inst) {
  const bones = inst.bones;
  if (!inst.root || !bones || bones.length < 2 || bones.length > 256 || bones.some(b => !b?.isObject3D)) return null;
  const known = new Set(bones),
    up = new Map(),
    down = new Map(bones.map(b => [b, []]));
  for (const b of bones) {
    const p = known.has(b.parent) ? b.parent : null;
    up.set(b, p);
    if (p) down.get(p).push(b);
  }

  // 1. Where each bone's drawn surface is, and how much of it there is.
  const box = new Map(bones.map(b => [b, emptyBox()])),
    mass = new Map(bones.map(b => [b, 0]));
  const skinned = new Set(),
    drawn = new Set();
  let vertices = 0,
    references = 0;
  inst.root.traverseVisible(m => {
    if (m.isMesh && !m.isInstancedMesh && m.material?.visible && !m.material.userData?.additive) {
      drawn.add(m);
      vertices += m.geometry?.attributes?.position?.count || 0;
      references += m.geometry?.index?.count ?? m.geometry?.attributes?.position?.count ?? 0;
    }
  });
  if (!vertices || vertices > 24000 || references > 100000 || drawn.size > 128) return null;
  const local = new Vector3(),
    blended = new Vector3();
  for (const skin of inst.skins || []) {
    const mesh = skin.mesh,
      g = mesh?.geometry,
      { position: pos, skinIndex: si, skinWeight: sw } = g?.attributes || {};
    const palette = skin.mats;
    if (!drawn.has(mesh)) continue;
    if (!pos || !si || !sw || !palette?.length || !skin.boneMap?.length || si.count !== pos.count || sw.count !== pos.count) return null;
    skinned.add(mesh);
    const slots = [];
    for (let i = 0; i < skin.boneMap.length && i * 16 + 16 <= palette.length; i++) {
      const bone = bones[skin.boneMap[i]],
        m = new Matrix4().fromArray(palette, i * 16);
      slots.push(bone && mass.has(bone) && usable(m) ? { bone, m } : null);
    }
    const toWorld = mesh.matrixWorld;
    const index = g.index,
      seen = index ? new Uint8Array(pos.count) : null;
    const first = g.drawRange.start,
      end = Math.min(index?.count ?? pos.count, first + g.drawRange.count);
    for (let i = first; i < end; i++) {
      const j = index ? index.getX(i) : i;
      if (j < 0 || j >= pos.count) return null;
      if (seen) {
        if (seen[j]) continue;
        seen[j] = 1;
      }
      let owner = null,
        most = 0,
        sum = 0;
      local.fromBufferAttribute(pos, j);
      blended.set(0, 0, 0);
      for (let h = 0; h < 4; h++) {
        const w = sw.getComponent(j, h);
        if (!w) continue;
        const slot = slots[si.getComponent(j, h)];
        if (!slot) continue;
        blended.addScaledVector(_v.copy(local).applyMatrix4(slot.m), w);
        sum += w;
        if (w > most) {
          most = w;
          owner = slot.bone;
        }
      }
      if (!owner || sum < 0.99) continue; // collapsed/hidden influence is not usable support
      blended.applyMatrix4(toWorld);
      box.get(owner).expandByPoint(blended);
      mass.set(owner, mass.get(owner) + most);
    }
  }
  // Rigid kit is authored in bone space, so its own box is its part's box.
  inst.root.traverseVisible(o => {
    if (!o.isMesh || o.isInstancedMesh || skinned.has(o) || !o.material?.visible || o.material?.userData.additive) return;
    const g = o.geometry,
      pos = g?.attributes?.position;
    if (!pos?.count) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox || g.boundingBox.isEmpty()) return;
    let bone = o.parent;
    while (bone && !mass.has(bone)) bone = bone.parent;
    if (!bone) return;
    box.get(bone).union(new Box3().copy(g.boundingBox).applyMatrix4(o.matrixWorld));
    mass.set(bone, mass.get(bone) + pos.count);
  });

  // 2. The drawn model: one authored skeleton, scaled like a battlefield unit.
  const total = bones.reduce((n, b) => n + mass.get(b), 0);
  if (!(total > 0)) return null;
  const subtree = new Map(),
    weigh = b => {
      let n = mass.get(b);
      for (const c of down.get(b)) n += weigh(c);
      subtree.set(b, n);
      return n;
    };
  const tops = bones.filter(b => !up.get(b));
  for (const b of tops) weigh(b);
  let root = tops[0];
  for (const b of tops) if (subtree.get(b) > subtree.get(root)) root = b;
  // Two unconnected bone trees carry two models' worth of surface; which one is the
  // body is not written anywhere, so this rig keeps its authored death.
  if (subtree.get(root) < total - total * 1e-6) return null;
  // A trunk bone with no surface of its own is no body: follow the one continuation.
  while (!(mass.get(root) > 0)) {
    const next = down.get(root).filter(k => subtree.get(k) > 0);
    if (next.length !== 1) return null;
    root = next[0];
  }
  const union = new Box3();
  for (const b of bones) if (!box.get(b).isEmpty()) union.union(box.get(b));
  // A hair over the drawn diagonal, so no single part can be as long as the model.
  const length = union.getSize(new Vector3()).length() * 1.01;
  if (!(length > 1 && length < 100)) return null;

  // 3. Split the skeleton where it carries the most surface. A part only becomes a
  // body once every child with surface becomes one too, so a bone always rides the
  // nearest body above it and never drifts to a guessed "main" body.
  let reps = [root];
  for (;;) {
    const taken = new Set(reps);
    let pick = null,
      heaviest = 0;
    for (const r of reps) {
      const kids = down.get(r).filter(k => subtree.get(k) > 0 && !taken.has(k));
      if (!kids.length || reps.length + kids.length > MAX_BODIES) continue;
      const weight = Math.max(...kids.map(k => subtree.get(k)));
      if (weight > heaviest) {
        heaviest = weight;
        pick = kids;
      }
    }
    if (!pick) break;
    reps = reps.concat(pick);
  }
  // Every drawn bone rides the nearest body above it, so cluster boxes follow the
  // split, including the surface a dropped part hands back to the body above.
  const clusterBoxes = list => {
    const at = new Map(list.map(b => [b, emptyBox()]));
    for (const b of bones) {
      if (box.get(b).isEmpty()) continue;
      let n = b;
      while (n && !at.has(n)) n = up.get(n);
      if (n) at.get(n).union(box.get(b));
    }
    return at;
  };
  let boxes = clusterBoxes(reps);
  for (;;) {
    const bad = reps.filter(b => b !== root && !spanOf(boxes.get(b), length));
    // A part with no reachable span is no body: its surface joins the body above.
    if (!bad.length) break;
    reps = reps.filter(b => !bad.includes(b));
    boxes = clusterBoxes(reps);
  }
  const geometry = new Map(reps.map(b => [b, spanOf(boxes.get(b), length)]));
  if (!geometry.get(root) || reps.length < 2) return null;

  // 4. Joints. Parent bodies are the authored bone's nearest body ancestor.
  const parentOf = new Map(reps.map(b => [b, null]));
  for (const b of reps) {
    let n = up.get(b);
    while (n && !parentOf.has(n)) n = up.get(n);
    if (n) parentOf.set(b, n);
  }
  const at = new Map(reps.map(b => [b, pivot(b)]));
  // A remote helper pivot can be miles from its drawn geometry even when the
  // bind pose itself looks fine. Never use it as a native solver anchor.
  if ([...at.values()].some(p => !Number.isFinite(p.lengthSq()) || union.distanceToPoint(p) > length)) return null;
  const kidsOf = b => reps.filter(k => parentOf.get(k) === b);
  // The authored direction of the joint that created a body; the root has none, so
  // it points at its own first child.
  const seg = b => {
    const p = parentOf.get(b),
      kids = p ? null : kidsOf(b);
    if (p) return unit(at.get(p), at.get(b));
    return kids.length ? unit(at.get(b), at.get(kids[0])) : unit(geometry.get(b).start, geometry.get(b).end);
  };
  // A hinge plane comes from authored pivots only, in order of how much pose they
  // define. A rig that defines none keeps the joint fixed, so nothing is invented.
  const spread = b => {
    const kids = kidsOf(b).map(k => at.get(k));
    let far = 0,
      dir = null;
    for (let i = 0; i < kids.length; i++)
      for (let j = i + 1; j < kids.length; j++) {
        const d = kids[i].distanceTo(kids[j]);
        if (d > far) {
          far = d;
          dir = unit(kids[i], kids[j]);
        }
      }
    return far > MIN_SPAN * length ? dir : null;
  };
  let widest = 0,
    wide = null;
  for (let i = 0; i < reps.length; i++)
    for (let j = i + 1; j < reps.length; j++) {
      const d = at.get(reps[i]).distanceTo(at.get(reps[j]));
      if (d > widest) {
        widest = d;
        wide = unit(at.get(reps[i]), at.get(reps[j]));
      }
    }
  if (!(widest > MIN_SPAN * length)) wide = null;
  const hinge = b => {
    const p = parentOf.get(b),
      own = seg(b),
      kids = kidsOf(b),
      cross = (a, c) => (a && c ? new Vector3().crossVectors(a, c) : null);
    const choices = [p && cross(seg(p), own), kids.length === 1 && cross(own, seg(kids[0])), p && spread(p), wide];
    for (const axis of choices) {
      if (!axis) continue;
      // A hinge has to turn across the part, never along it: an authored spread is
      // projected into the plane the part turns in, so a straight limb still swings.
      const plane = axis.clone().addScaledVector(own, -axis.dot(own));
      if (plane.length() > FLAT) return plane.normalize();
    }
    return null;
  };

  // 5. Spans, parent-first, as the body builder expects them.
  const index = new Map(reps.map((b, i) => [b, i]));
  const spans = reps.map((b, i) => {
    const g = geometry.get(b),
      parent = parentOf.get(b),
      axis = i ? hinge(b) : null;
    return {
      name: b.name || 'part' + i,
      bone: b,
      start: g.start,
      end: g.end,
      pivot: at.get(b),
      radius: g.radius,
      parent: parent ? index.get(parent) : null,
      axis,
      limits: axis ? [-FLEX, FLEX] : null,
      // A generic hinge: Rapier's revolute limits give way under a landing, so the
      // bound is held by the clamped stepping path instead.
      hinge: !!axis,
      weld: !!i && !axis,
      fixed: !!i && !axis,
      // Only the trunk leans into the tumble; every other part rides it.
      kick: i ? 0.2 : 0.66,
      // A part with nothing below it is the only thing a blast can take off.
      detachable: !kidsOf(b).length
    };
  });
  return { length, spans };
}
