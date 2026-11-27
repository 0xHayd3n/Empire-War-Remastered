// Runs in the mounted battle after the geometry check. Place a real foot unit
// at a route start, then take our hands off its position for the entire order.
module.exports = async function walkBattle() {
  const g=game,w=g.world,t=w.terrain, p=g.craters;
  const {heightAt}=await import('/js/game/terrain.js'), {blast}=await import('/js/game/landabilities.js'), {db}=await import('/js/gamedata.js');
  const u=w.units.find(u=>u.type.name==='Stormtrooper'&&!u.dead&&!u.inside && u.foot && u.speed>0 && u.squad.members.length===1 && !u.squad.box);
  if (!u || t.craterSurface!==p) throw Error('No solo walking Stormtrooper or crater surface');
  g.paused=true;w.aiSuspended=true;
  const span=(t.size-1)*20;
  const lanes=[];
  for(let y=Math.floor(span*.2)+.17;y<span*.8 && lanes.length<2;y+=40)for(let x=Math.floor(span*.2)+.37;x<span*.8 && lanes.length<2;x+=40) {
    if(w.units.some(o=>!o.dead && Math.hypot(x-o.x,y-o.y)<250) || lanes.some(o=>Math.hypot(x-o.x,y-o.y)<200))continue;
    let ok=true; for(let i=-85;i<=85 && ok;i+=5)ok=w.isOpen(x+i,y,2)&&!w.wet[Math.round(y/20)*t.size+Math.round((x+i)/20)] && Math.abs(heightAt(t,x+i,y)-heightAt(t,x,y))<3 && !p.offsetAt(x+i,y);
    if(ok)lanes.push({x,y});
  }
  if(lanes.length<2)throw Error('No unobstructed test lanes');
  const gun=w.units.find(o=>o.weapon?.proj?.name==='Proj_Ground_Laser_Cannon_Red_T4B');
  const shotAt=({x,y})=>{const z=heightAt(t,x,y);w.fire(gun,{x,y,z,spot:true,dead:false,aimZ:0,side:w.wild,hitRadius:-1,type:gun.type},gun.weapon);
    const s=w.shots.pop();Object.assign(s,{sx:x,sy:y,sz:z+8,x,y,z:z+8,vx:0,vy:0,vz:-s.speed,reach:100,total:100,left:100,path:null});
    for(let i=0;i<90&&!s.done;i++)w.flyShot(s,1/60);if(!s.done||!s.ground)throw Error('tank shot missed ground');};
  shotAt(lanes[0]);
  const {x,y}=lanes[1];blast(w,db.type('Proj_Empire_Bombardment_Turbolaser'),x,y,g.me);
  function walk({x,y}) {
    u.x=x-65;u.y=y;u.z=w.groundZ(u.x,u.y)+u.lift+u.hoverZ;
    u.heading=0;u.holder.position.set(u.x,u.y,u.z);
    u.path=[];u.target=null;u.squad.foe=null;u.squad.box=undefined;u.blockFails=u.startAt=u.v=0;
    g.view.x=x;g.view.y=y;w.look=null; // do not cull this posed soldier in the fixture
    if (!w.order(u.squad,x+80,y)) throw Error('move order refused');
    let maxDz=0,minOff=0,climb=0,step=0,descend=0,tilt=0,stepLift=0,exitTilt,anim;
    const actualTilt=()=>2*Math.acos(Math.min(1,Math.abs(u.holder.quaternion.z*Math.sin((u.heading+Math.PI/2)/2)+u.holder.quaternion.w*Math.cos((u.heading+Math.PI/2)/2))));
    for(let i=0;i<350;i++) {
      w.update(1/30);
      const st=u.craterGait, off=p.offsetAt(u.x,u.y);minOff=Math.min(off,minOff);
      maxDz=Math.max(maxDz,Math.abs(u.z-w.groundZ(u.x,u.y)-u.lift-u.hoverZ));
      if(st?.mode==='climb' && u.x>=x){climb++;tilt=Math.max(tilt,actualTilt());anim=u.animKind;}
      if(st?.mode==='step'){step++;stepLift=Math.max(stepLift,u.holder.position.z-u.z);}
      if(st?.mode==='descend')descend++;
      if(u.x>x+65){exitTilt=actualTilt();break;}
    }
    return {who:u.type.name,moved:u.x-x+65,depth:-minOff,maxDz,climb,descend,tilt,step,stepLift,exitTilt,anim};
  }
  return {shallow:walk(lanes[0]),deep:walk(lanes[1])};
};
