// CPU integration pass over actual decoded TEDs. Uses the renderer's geometry
// builder and the real land order/update loop; no renderer, props or Lua mission.
import assert from 'node:assert/strict';
import * as T from 'three';
import {LandWorld} from '../../public/js/game/land.js';
import {terrainGeometry,heightAt,CELL} from '../../public/js/game/terrain.js';
import {LandScars} from '../../public/js/game/land-scars.js';
import {blast} from '../../public/js/game/landabilities.js';
import {db} from '../../public/js/gamedata.js';
import {seedSim} from '../../public/js/game/simrandom.js';

function findLane(w,t,map,triAt) {
  // Start at the playable centre; test both axes on slopes as well as flat
  // ground. Never turn a wet, blocked or omitted cell into a dry control.
  const cols=t.width-1,rows=t.height-1, midX=(map.playMin[0]+map.playMax[0])/2,midY=(map.playMin[1]+map.playMax[1])/2;
  const ok=(x,y)=>x>=map.playMin[0] && x<=map.playMax[0] && y>=map.playMin[1] && y<=map.playMax[1] &&
    x>=0 && y>=0 && x<cols*CELL && y<rows*CELL && triAt[2*(Math.floor(y/CELL)*cols+Math.floor(x/CELL))]>=0 &&
    !w.wet[Math.round(y/CELL)*t.size+Math.round(x/CELL)] && w.isOpen(x,y,1);
  const cx=Math.max(0,Math.min(cols-1,Math.floor(midX/CELL))),cy=Math.max(0,Math.min(rows-1,Math.floor(midY/CELL)));
  for(let d=0;d<=Math.max(cols,rows);d++) for(let j=Math.max(0,cy-d);j<=Math.min(rows-1,cy+d);j++){
    const edge=Math.abs(j-cy)===d, next=edge?1:Math.max(1,2*d);
    for(let i=edge?Math.max(0,cx-d):cx-d;i<=Math.min(cols-1,cx+d);i+=next){
      if(i<0)continue;const x=i*CELL+10.37,y=j*CELL+10.11;if(!ok(x,y))continue;
      for(const [dx,dy] of [[1,0],[0,1]]) {let good=true;
        for(let k=-60;k<=70&&good;k+=5) good=ok(x+dx*k,y+dy*k);
        if(good)return {x,y,dx,dy};}
    }
  }
  return null;
}
export async function exercise(map) {
  seedSim(129443);
  const t=map.terrain;assert.ok(t?.heights && t.layerIndex && t.layers,'no decoded terrain');
  const {geo,triAt,slot}=terrainGeometry(t);t.paint={geo,triAt,slot};
  const scene=new T.Scene(), mat=new T.ShaderMaterial({uniforms:{reliefPatch:{value:new T.Vector4()}}}), mesh=new T.Mesh(geo,mat);scene.add(mesh);
  const w=new LandWorld(map,scene,{}); w.fixed=true;w.aiSuspended=true;
  let scars=new LandScars(w,mesh,scene,{mode:'land'});
  const p=scars.pits;
  try {
    if (!geo.drawRange.count) {
      // Venator Venture, for example, explicitly paints holes over its entire
      // authored rectangle. Verify the negative case, not a fake fallback pit.
      assert.ok(triAt.every(i=>i<0) && t.layerIndex.every(i=>t.layers[i]?.hole || i===255),'missing drawable geometry on non-hole ground');
      const x=(map.playMin[0]+map.playMax[0])/2,y=(map.playMin[1]+map.playMax[1])/2,z=w.groundZ(x,y);
      assert.equal(scars.shot({w:{proj:db.type('Proj_Empire_Bombardment_Turbolaser')},ax:x,ay:y,z,ground:true},false),false);
      assert.equal(p.hits,0);assert.equal(scars.burns.rows.length,0);assert.equal(w.groundZ(x,y),z);
      return {excluded:'all TED ground is authored as holes',emittedGroundTriangles:0,phantomScars:0};
    }
    assert.ok(p.ready,p.reason);assert.ok(scars.walkable);
    const lane=findLane(w,t,map,triAt);assert.ok(lane,'no dry walkable 130-unit lane inside authored play area');
    const {x,y,dx,dy}=lane, shot=(P,a,b)=>scars.shot({w:{proj:P},ax:a,ay:b,z:w.groundZ(a,b),ground:true},false);
    const before=heightAt(t,x,y,true,null);
    assert.ok(shot(db.type('Proj_Hand_Blaster_Red'),x,y));assert.equal(p.hits,0);assert.equal(scars.burns.rows.length,1);
    assert.equal(p.offsetAt(x,y),0);
    w.onBlastGround=(P,ax,ay)=>shot(P,ax,ay);
    blast(w,db.type('Proj_Empire_Bombardment_Turbolaser'),x,y,0);
    const centre=p.offsetAt(x,y);assert.ok(centre< -2 && centre>=-5.5,`invalid centre ${centre}`);
    mesh.updateMatrixWorld(true);
    const ray=new T.Raycaster(new T.Vector3(x,y,before+50),new T.Vector3(0,0,-1));
    // Limit only the CPU ray over the coarse geometry to this quad's packed
    // range. A coarse triangle left on top would beat the refined intersection.
    const range={...geo.drawRange},at=triAt[2*(Math.floor(y/CELL)*(t.width-1)+Math.floor(x/CELL))];geo.setDrawRange(at,6);
    const hit=ray.intersectObject(mesh,true)[0];geo.setDrawRange(range.start,range.count);
    assert.ok(hit && hit.object!==mesh && hit.object.geometry.attributes.shade.getX(hit.face.a)>2.2,'missing burnt drawn bowl');
    assert.ok(Math.abs(hit.point.z-w.groundZ(x,y))<.003,'drawn and physical surfaces disagree');
    const z=hit.point.z,saved=JSON.parse(JSON.stringify(scars.save()));assert.equal(saved.craterRule,1);
    assert.ok(p.restore(saved.craters)); assert.equal(p.offsetAt(x,y),centre);assert.equal(before,heightAt(t,x,y,true,null));
    const start={x:x-60*dx,y:y-60*dy}, end={x:x+70*dx,y:y+70*dy};
    const squad=await w.spawn('Stormtrooper',start.x,start.y,Math.atan2(dy,dx),0);
    assert.ok(squad?.members.length===1,'reference Stormtrooper could not spawn');
    const u=squad.members[0];assert.ok(u.foot && u.inst?.root,'missing reference infantry rig');assert.ok(w.order(squad,end.x,end.y),'move refused');
    let dip=0,climb=0,pose=0,maxError=0,moved=0;
    for(let i=0;i<450;i++) {
      w.update(1/30);moved=(u.x-start.x)*dx+(u.y-start.y)*dy;
      dip=Math.max(dip,-p.offsetAt(u.x,u.y));maxError=Math.max(maxError,Math.abs(u.z-w.groundZ(u.x,u.y)-(u.lift||0)-(u.hoverZ||0)));
      if(moved>=60 && u.craterGait?.mode==='climb'){climb++;pose=Math.max(pose,Math.hypot(u.holder.quaternion.x,u.holder.quaternion.y));}
      if(moved>118)break;
    }
    assert.ok(moved>118&&dip>2&&climb>0&&pose>.018&&maxError<.003,`traversal moved=${moved} dip=${dip} climb=${climb} tilt=${pose} groundError=${maxError}`);
    // Cross the old 24-hit eviction boundary at a second site. Keep those
    // hits concealed through the actual LandScars save/constructor handoff.
    const bx=x+55*dx,by=y+55*dy,clearZ=scars.visibleZ(bx,by),shown=p.drawnOffsetAt(bx,by),walked=p.offsetAt(x,y);
    assert.ok(walked<=centre+.001,'walking cannot refill the original bowl');
    w.onBlastGround=(proj,ax,ay)=>scars.shot({w:{proj},ax,ay,z:w.groundZ(ax,ay),ground:true},true);
    for(let i=0;i<29;i++) blast(w,db.type('Proj_Empire_Bombardment_Turbolaser'),bx,by,0);
    assert.ok(p.offsetAt(bx,by)<-2 && p.drawnOffsetAt(bx,by)===shown,'concealed hits did not stay private');
    assert.equal(scars.visibleZ(bx,by),clearZ);assert.equal(p.offsetAt(x,y),walked);
    const battle=JSON.parse(JSON.stringify(scars.save()));scars.dispose();
    scars=new LandScars(w,mesh,scene,{mode:'land',restore:{battle}});
    assert.equal(scars.pits.offsetAt(x,y),walked);assert.ok(Math.abs(scars.pits.drawnOffsetAt(x,y)-walked)<.003,'visible bowl changed at resume');
    assert.equal(scars.visibleZ(bx,by),clearZ);assert.equal(scars.burns.rows.length,1);
    const hiddenDepth=scars.pits.offsetAt(bx,by);assert.ok(hiddenDepth< -2);scars.pits.reveal(()=>true);
    assert.equal(scars.pits.offsetAt(bx,by),hiddenDepth);assert.ok(Math.abs(scars.pits.drawnOffsetAt(bx,by)-hiddenDepth)<.003,'revealed mesh and hidden physical ground disagree');
    return {at:[x,y],axis:dx?'x':'y',depth:-centre,rayError:Math.abs(z-(before+centre)),climbTicks:climb,travel:moved,laterHits:29};
  }finally{scars.dispose();geo.dispose();mat.dispose();}
}
