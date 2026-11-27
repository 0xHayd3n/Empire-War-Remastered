import assert from 'node:assert/strict';
import * as T from 'three';
import {fitHullShadow,HULL_SHADOW_SIZE} from '../public/js/game/hullshadow.js';
const b=new T.Box3(new T.Vector3(-210,-435,-49),new T.Vector3(210,209,141));
const corners=[b.min,b.max].flatMap(x=>[b.min,b.max].flatMap(y=>[b.min,b.max].map(z=>new T.Vector3(x.x,y.y,z.z))));
const cam=new T.OrthographicCamera(),sun=new T.Vector3(.7,-.7,.105).normalize();
function fit(world,s){const m=new T.Matrix4(),p=new T.Vector3();fitHullShadow(cam,b,s,world,m,p);assert(p.x>0 && p.y>0 && p.z===1/HULL_SHADOW_SIZE);
  return corners.map(c=>{const v=c.clone().applyMatrix4(world).applyMatrix4(m);assert(v.toArray().every(x=>x>0&&x<1));return v;});}
const pose=new T.Matrix4().makeRotationZ(.43),a=fit(pose,sun);pose.setPosition(23000,-35000,780);
assert(fit(pose,sun).every((v,i)=>v.distanceTo(a[i])<1e-10),'flying across the map must not move the depth grid on the hull');
fit(pose,new T.Vector3(0,0,1));fit(pose,new T.Vector3(0,0,-1));
assert(fit(pose,new T.Vector3(0,.8,.6)).some((v,i)=>v.distanceTo(a[i])>.1),'the actual sun sets the projection');
console.log('Near hull shadow: fitted bounds, translation invariance, polar and moving sun passed');
