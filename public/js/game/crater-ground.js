import { fieldHeight, footprintQuads } from './crater-field.js';

// Fixed, sparse sampling lattice for the walkable rule. Reserve the same cells
// and interpolate the same sub-triangles whether an impact is visible or not.
// Rendering may catch up with fog; it can't change the height under a foot.
export class CraterGround {
  constructor(pits,n) { this.pits=pits; this.n=n; this.cells=new Map(); this.shellCells=new Set(); }
  footprint(rec) {
    const p=this.pits;
    return footprintQuads(p.cell,rec.x,rec.y,rec.radius,p.quadsW,p.quadsH)
      .map(({qx,qy})=>qy*p.quadsW+qx).filter(k=>p.blockAt[k]>=0);
  }
  fits(keys,occupied=this.shellCells) {
    return keys.length>0 && (occupied.size+keys.filter(k=>!occupied.has(k)).length)*(this.n+1)**2 <= this.pits.budgetVerts;
  }
  add(rec,keys) {
    for(const key of keys) {
      let cell=this.cells.get(key); if(!cell) this.cells.set(key,cell={members:[],z:null});
      if (!rec.pad) this.shellCells.add(key);
      cell.members.push(rec); cell.z=null;
    }
  }
  remove(rec) {
    for(const key of this.footprint(rec)) {const cell=this.cells.get(key);if(!cell)continue;
      cell.members=cell.members.filter(c=>c!==rec);if(!rec.pad && !cell.members.some(c=>!c.pad))this.shellCells.delete(key);cell.z=null;if(!cell.members.length)this.cells.delete(key);
    }
  }
  offsetAt(x,y) {
    const p=this.pits,size=p.cell,X=Math.floor(x/size),Y=Math.floor(y/size);
    if(X<0||Y<0||X>=p.quadsW||Y>=p.quadsH)return 0;
    const cell=this.cells.get(Y*p.quadsW+X);if(!cell)return 0;
    const n=this.n,edge=n+1;
    if(!cell.z) {
      const z=cell.z=new Float32Array(edge*edge);
      for(let j=0;j<=n;j++) for(let i=0;i<=n;i++)z[j*edge+i]=fieldHeight(cell.members,X*size+i*(size/n),Y*size+j*(size/n),p.maxDepth);
    }
    const gx=(x/size-X)*n,gy=(y/size-Y)*n,i=Math.min(n-1,Math.floor(gx)),j=Math.min(n-1,Math.floor(gy));
    const fx=gx-i,fy=gy-j,k=j*edge+i,z=cell.z,a=z[k],d=z[k+edge+1];
    return fx>=fy ? a+fx*(z[k+1]-a)+fy*(d-z[k+1]) : a+fy*(z[k+edge]-a)+fx*(d-z[k+edge]);
  }
}
