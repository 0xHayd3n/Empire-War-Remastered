import { Vector3 } from 'three';
import { stockHull } from './destroyer-detail.js';
import { passSubject, playDestroyerPass } from './destroyer-pass.js';
import { dominantDisk } from './planetdisk.js';

// A repeatable strategy-distance pass: retain the planet behind the fleet but see the side plates,
// not just the deck. The camera moves; light, exposure, ship heading and orders do not.
export function orbitalRoute(unit, sphere) {
  const hull = stockHull(unit),
    at = new Vector3(),
    ray = new Vector3(),
    side = new Vector3(),
    move = new Vector3(),
    up = new Vector3(0, 0, 1),
    behind = new Vector3(),
    aim = new Vector3();
  return (cam, k) => {
    hull.updateWorldMatrix(true, false);
    at.set(0, 0, 50).applyMatrix4(hull.matrixWorld);
    ray.copy(sphere.center).sub(at).normalize();
    side.crossVectors(ray, up);
    if (side.lengthSq() < 0.001) side.set(1, 0, 0);
    else side.normalize();
    behind.crossVectors(side, ray).normalize();
    cam.position.copy(at).addScaledVector(ray, -1460).addScaledVector(behind, -860).addScaledVector(side, 480);
    move.copy(side).multiplyScalar((k - 0.5) * 650);
    cam.position.add(move);
    aim.copy(at).addScaledVector(behind, -205).addScaledVector(side, -160).add(move);
    cam.up.copy(up);
    cam.lookAt(aim);
    cam.near = 1;
    cam.far = Math.max(cam.far, at.distanceTo(sphere.center) + sphere.radius + 4000);
    cam.fov = 47;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  };
}
// One local visual event, not damage, audio, a simulation order or camera shake.
export function previewBlast(view, unit, cam) {
  const at=unit.obj.position.clone(), towardEye=cam.position.clone().sub(at).normalize();
  at.addScaledVector(towardEye,unit.visualRadius*.52);at.z+=unit.visualRadius*.16;
  view.explosion(at.x,at.y,at.z,Math.max(55,unit.visualRadius*.28),false);
  return at;
}
export function orbitalPass(game) {
  if (!game?.renderer?.bgScene) return null;
  const unit = passSubject(game);
  if (!unit) return null;
  const source = dominantDisk(game.renderer.scene);
  if (!source) return null;
  const frame = orbitalRoute(unit, source.sphere);
  return (flash=false) => {
    let shown=false;
    return playDestroyerPass(game,unit,(cam,k)=>{frame(cam,k);if(flash===true && !shown && k>=.46){shown=true;previewBlast(game.renderer,unit,cam);}});
  };
}
