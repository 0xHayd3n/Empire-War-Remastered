import * as T from 'three';
import { stockHull } from './destroyer-detail.js';
import { unitRadius, visibleSubject } from './close-subject.js';
import { heightAt } from './terrain.js';

export function unitPassSubject(g) {
  if (!g?.cine || !g.world?.units) return null;
  const allowed = u => u && visibleSubject(u, g.world) && (u.obj ? g.cine.visible?.(u) : g.cine.seen?.(u));
  for (const selection of g.ui?.selection || []) {
    if (allowed(selection)) return selection;
    const member = (selection.members || selection.fighters)?.find(allowed);
    if (member) return member;
  }
  const rig = g.view || g.renderer.rig;
  let best = null, score = -1;
  for (const u of g.world.units) if (allowed(u)) {
    const rank = unitRadius(u) / (1 + Math.hypot(u.x-rig.x, u.y-rig.y));
    if (rank > score) { score = rank; best = u; }
  }
  return best;
}
export function passSubject(g) {
  return g?.cine && g.world?.units.find(u => !u.dead && !u.scriptHidden && !u.hyper && u.obj?.visible && g.cine.visible(u) && stockHull(u));
}
// Repeatable 8s three-quarter pass, relative to the subject rather than a fixed map coordinate.
function points(u, k, side, lift) {
  const hull = stockHull(u);
  if (!hull) {
    const r = unitRadius(u), a = (u.heading || 0) + side * (-.95 + 1.9*k);
    const at = (u.obj || u.holder).position.clone();
    if (u.holder) at.z += u.aimZ || 0;
    return [at.clone().add(new T.Vector3(2.25*r*Math.cos(a), 2.25*r*Math.sin(a), r*(.72+.12*Math.cos(Math.PI*k)) + lift)), at];
  }
  hull.updateWorldMatrix(true, false);
  const a = -0.92 + 2.05 * k,
    point = (x, y, z) => new T.Vector3(x, y, z).applyMatrix4(hull.matrixWorld);
  return [point(side * 560 * Math.cos(a), 20 + 560 * Math.sin(a), 244 + lift + 55 * Math.cos(Math.PI * k)), point(0, 20 + 80 * k, 69)];
}
export function passRoute(g, u) {
  // Sample both shoulders before starting, so the shot does not begin inside an escort.
  const peers = g.world.units.filter(
      s => s !== u && s.obj?.visible && !s.isFighter && !s.scriptHidden && !s.dead && s.model && g.cine.visible(s)
    ),
    p = new T.Vector3(),
    q = new T.Vector3();
  let best,
    bestScore = Infinity;
  for (const lift of [0, 170, 350])
    for (const side of [1, -1]) {
      let score = lift * 0.002;
      for (const k of [0, 0.25, 0.5, 0.75, 1]) {
        const [eye, at] = points(u, k, side, lift),
          line = new T.Line3(eye, at);
        for (const s of peers) {
          p.set(s.x, s.y, s.z || 0);
          line.closestPointToPoint(p, true, q);
          score += Math.max(0, 1.15 - p.distanceTo(q) / Math.max(1, s.visualRadius));
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = { side, lift };
      }
    }
  return best;
}
export function frameDestroyer(cam, u, k, route = { side: 1, lift: 0 }) {
  const [eye, at] = points(u, k, route.side, route.lift);
  cam.position.copy(eye);
  cam.up.set(0, 0, 1);
  cam.lookAt(at);
  cam.fov = 49;
  cam.near = 1;
  cam.far = Math.max(cam.far, 10000);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}
export function playDestroyerPass(g, u = passSubject(g), spaceCamera = null) {
  if (!u) return false;
  const land = !!u.holder && !u.obj;
  const c = g.cine,
    r = land ? g : g.renderer,
    cam = r.camera,
    clip = [cam.near, cam.far],
    origin = land && { x:g.view.x, y:g.view.y },
    selection = [...g.ui.selection],
    route = land || spaceCamera ? { side:1, lift:0 } : passRoute(g, u);
  g.menus.closeAll();
  if (c.on) c.stop();
  c.start();
  r.flybySubject = c.subject = u;
  let t = 0;
  const skip = e => {
    if (['Escape', 'Space', 'Enter'].includes(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      c.stop();
    }
  };
  addEventListener('keydown', skip, true);
  c.sequence = {
    stop() {
      removeEventListener('keydown', skip, true);
      r.flybySubject = c.subject = null;
      if (land) {
        Object.assign(g.view, origin);
        [cam.near, cam.far] = clip;
        cam.updateProjectionMatrix();
      }
      if (!land && selection.length)
        g.ui.select(
          selection.filter(s => !s.dead),
          false
        );
    },
    frame(dt) {
      if (!visibleSubject(u, g.world) || !(land ? c.seen(u) : c.visible(u)) || g.over || t >= 8) return false;
      if (spaceCamera) spaceCamera(cam,t/8);
      else frameDestroyer(cam, u, t / 8, route);
      if (land) {
        const at = u.holder.position.clone(); at.z += u.aimZ || 0;
        // Keep the camera and the sightline clear of the terrain on either shoulder.
        const eye = cam.position;
        for (const k of [0,.25,.5,.75]) {
          const floor = heightAt(g.terrain, eye.x+(at.x-eye.x)*k, eye.y+(at.y-eye.y)*k) + 2;
          eye.z = Math.max(eye.z, (floor - k*at.z)/(1-k));
        }
        cam.lookAt(at); cam.updateMatrixWorld();
        g.view.x = u.x; g.view.y = u.y;
      }
      c.lookX = u.x;
      c.lookY = u.y;
      c.camDist = cam.position.distanceTo((u.obj || u.holder).position);
      t += Math.min(dt, 0.12);
      return true;
    }
  };
  return true;
}
