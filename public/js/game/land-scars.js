import { TerrainCraters } from './terrain-craters.js';
import { GroundSteps } from './ground-steps.js';
import { FOOTFALL } from './footfall.js';
import { GroundBurns } from './ground-burns.js';
import { groundImpact, walkableCraters, wreckImpact } from './ground-impact.js';
import { heightAt, CELL } from './terrain.js';

// Share the visible surface with wrecks and decals. Installing it as gameplay
// ground is a separate, versioned decision; network peers never take that path.
export class LandScars {
  constructor(world, ground, scene, setup) {
    this.world = world;
    const t = this.terrain = world.terrain, saved = setup.restore?.battle;
    const steps=walkableCraters(setup) && (!setup.restore || saved?.footfallRule===1);
    this.pits = new TerrainCraters(t,ground,{ maxRadius:26, maxDepth:6, maxCraters:512, maxPads:steps ? FOOTFALL.maxPads : 0, fixedGrid:10, scorch:.9 });
    t.craterGeometry = this.pits;
    this.walkable = this.pits.ready && walkableCraters(setup);
    if (walkableCraters(setup) && saved?.craterRule && !this.pits.ready)
      throw Error('This saved land battle requires walkable terrain: '+this.pits.reason);
    if (this.walkable) t.craterSurface = this.pits;
    if (this.walkable && steps) world.groundSteps=this.steps=new GroundSteps(world,this.pits);
    if (saved?.craters && this.pits.restore(saved.craters) === false && this.walkable)
      throw Error('Cannot restore the saved crater surface for this land battle.');
    const published = { offsetAt:(x,y)=>this.pits.drawnOffsetAt(x,y) };
    this.visibleZ = (x,y) => heightAt(t,x,y,true,published);
    this.burns = new GroundBurns(scene,this.visibleZ);
    this.burns.restore(saved?.groundBurns);
    this.nextReveal = 0;
  }
  crushPrint(crusher,u,concealed){ return this.steps?.crush(crusher,u,concealed); }
  shot(s, concealed) {
    const x = s.ax, y = s.ay;
    return this.apply(x,y,groundImpact(s,heightAt(this.terrain,x,y,true,this.pits)),concealed);
  }
  wreck(u,concealed) {
    if (u.scriptHidden || u.inside) return false;
    return this.apply(u.x,u.y,wreckImpact(u),concealed);
  }
  apply(x,y,impact,concealed) {
    if (!impact || (concealed && !this.walkable) || !Number.isFinite(x+y)) return false;
    const t = this.terrain, cx = Math.floor(x/CELL), cy = Math.floor(y/CELL), width = t.width ?? t.size, height = t.height ?? t.size;
    if (cx < 0 || cy < 0 || cx >= width-1 || cy >= height-1 || t.paint.triAt[2*(cy*(width-1)+cx)] < 0 ||
      this.world.wet[Math.round(y/CELL)*t.size+Math.round(x/CELL)]) return false;
    // A shooter platform is a separate collision surface above the TED soil.
    const pad = t.padTop;
    if (pad) {
      const i = Math.floor(x/pad.cell), j = Math.floor(y/pad.cell);
      if (i<pad.w && j<pad.w && pad.a[j*pad.w+i] >= heightAt(t,x,y,true,this.pits)) return false;
    }
    if (impact.depth && this.pits.hit(x,y,impact.radius,{depth:impact.depth,concealed})) {
      if (!concealed) this.burns.settle(x,y,impact.radius+2);
    } else if (!concealed) this.burns.hit(x,y,Math.min(impact.radius,4));
    return true;
  }
  update() {
    if (this.world.time >= this.nextReveal) {
      this.nextReveal = this.world.time+.3;
      if (this.pits.reveal((x,y)=>!this.world.viewFogged(x,y)))
        for (let i=0;i<this.burns.rows.length;i++) this.burns.place(i);
    }
  }
  save() {
    return { ...(this.steps ? {footfallRule:1} : {}), ...(this.walkable ? {craterRule:1} : {}), ...(this.pits.ready ? {craters:this.pits.snapshot()} : {}), groundBurns:this.burns.snapshot() };
  }
  dispose() {
    if (this.terrain.craterSurface===this.pits) delete this.terrain.craterSurface;
    if (this.terrain.craterGeometry===this.pits) delete this.terrain.craterGeometry;
    if(this.steps && this.world.groundSteps===this.steps) delete this.world.groundSteps;
    this.burns.dispose(); this.pits.dispose();
  }
}
