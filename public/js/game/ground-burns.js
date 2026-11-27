import * as T from 'three';

// Pinpricks are ink, not holes. Separate from moving tracks so a tank driving
// across the map doesn't erase them. Recycle only ink, never excavated soil.
const LIMIT = 512, SIZE = 48;
function soot() {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const x = (2*i+1)/SIZE-1, y = (2*j+1)/SIZE-1, a = Math.atan2(y,x);
    const d = Math.hypot(x, y) * (1 + .085*Math.sin(a*5+.5) + .05*Math.cos(a*3));
    const noise = Math.sin(i*78.2 + j*43.7)*17892.51, grain = noise - Math.floor(noise);
    const k = 4*(j*SIZE+i);
    rgba[k] = 33 + grain*14; rgba[k+1] = 27 + grain*10; rgba[k+2] = 23 + grain*8;
    rgba[k+3] = 255 * Math.max(0, 1-d*d) ** 2 * (.72+.25*grain);
  }
  const tex = new T.DataTexture(rgba, SIZE, SIZE);
  tex.minFilter = tex.magFilter = T.LinearFilter; tex.needsUpdate = true;
  return tex;
}
export class GroundBurns {
  constructor(scene, surface) {
    this.surface = surface; this.rows = []; this.next = 0;
    this.mesh = new T.InstancedMesh(new T.PlaneGeometry(2,2), new T.MeshBasicMaterial({
      map: soot(), transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2
    }), LIMIT);
    this.mesh.name = 'Small ground impact marks'; this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; scene.add(this.mesh);
    this.pose = new T.Object3D(); this.up = new T.Vector3(0,0,1); this.normal = new T.Vector3();
  }
  hit(x,y,r) {
    if (![x,y,r].every(Number.isFinite) || r<=0 || r>26) return;
    const i = this.next; this.next = (i+1)%LIMIT;
    this.rows[i] = [x,y,r]; this.place(i); this.mesh.count = this.rows.length;
  }
  place(i) {
    const [x,y,r] = this.rows[i], z = this.surface, o = this.pose;
    this.normal.set(z(x-r,y)-z(x+r,y),z(x,y-r)-z(x,y+r),2*r).normalize();
    o.quaternion.setFromUnitVectors(this.up,this.normal); o.rotateZ((x*.71+y*.43)%(2*Math.PI));
    o.scale.set(r,r*.85,1); o.position.set(x,y,z(x,y)+.08); o.updateMatrix();
    this.mesh.setMatrixAt(i,o.matrix); this.mesh.instanceMatrix.needsUpdate = true;
  }
  settle(x,y,r) {
    for (let i=0;i<this.rows.length;i++) {
      const [sx,sy,sr] = this.rows[i]; if ((sx-x)**2+(sy-y)**2 < (sr+r)**2) this.place(i);
    }
  }
  snapshot() { return this.rows.length<LIMIT ? this.rows.slice() : this.rows.slice(this.next).concat(this.rows.slice(0,this.next)); }
  restore(rows) { if (Array.isArray(rows)) for (const row of rows.slice(-LIMIT)) if (Array.isArray(row) && row.length===3) this.hit(...row); }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.map.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}
