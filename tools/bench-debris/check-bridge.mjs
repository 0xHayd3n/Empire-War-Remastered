// Fast regression: a faster step is invalid if the two land collision layers never meet.
import assert from 'node:assert/strict';
import init from 'jolt-physics/wasm-compat';
import { joltBridge } from './jolt-bridge.mjs';
const R=joltBridge(await init()), w=new R.World({x:0,y:0,z:-100});
const ground=w.createCollider(R.ColliderDesc.trimesh(new Float32Array([-50,-50,0,50,-50,0,50,50,0,-50,50,0]),new Uint32Array([0,1,2,0,2,3])).setTranslation(800,1500,40).setFriction(.85).setCollisionGroups(0x00010002));
const box=w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(800,1500,52).setCcdEnabled(true));w.createCollider(R.ColliderDesc.cuboid(2,3,2).setFriction(.85).setCollisionGroups(0x00020001),box);
for(let i=0;i<300;i++)w.step();const z=box.translation().z;assert(Math.abs(z-42)<.12,`Ground patch missed; box center z=${z}, expected 42`);
w.removeRigidBody(box);w.removeCollider(ground,false);assert.equal(w.numBodies(),0);assert.equal(w.numColliders(),0);w.free();console.log('Jolt box rests on translated terrain; both native bodies released.');
