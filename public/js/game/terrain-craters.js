// Local sub-cell replacement for land impact bowls.
//
// WHY THIS EXISTS
// ---------------
// The coarse land mesh (public/js/game/terrain.js `buildTerrain`) is a NON-indexed
// BufferGeometry, 6 vertices per TED cell quad, one vertex per grid corner at
// CELL = 20 world units. A real blast radius is 5..26 units: a grid-vertex-only
// deformation cannot show it at all (no corner inside the blast) or turns a whole
// 20x20 quad into a funnel. So this module performs a LOCAL REPLACEMENT:
//
//   * every coarse quad the blast disc touches is *retired* from the coarse mesh,
//   * an identically-materialled, sub-cell-resolution patch for exactly that quad
//     is drawn by a child mesh of the ground mesh.
//
// Nothing else in the mesh, in `t.heights`, or in the map is touched, so nothing is
// tessellated map-wide and memory/work is proportional to `craters x footprint`.
//
// HOW A QUAD IS RETIRED WITHOUT RE-UPLOADING THE TERRAIN
// -----------------------------------------------------
// The ground geometry is converted ONCE, in place, from non-indexed to a purely
// sequential index (`[0,1,2,...]`), which renders byte-identically. Retiring one
// quad then means writing its 6 index entries into a degenerate triangle and
// bumping the index attribute version - no position/normal/layer upload, no
// re-packing of a multi-megabyte vertex buffer (public/js/gpu/renderer.js re-packs
// and re-uploads EVERY attribute of a geometry when any one of them changes
// version, so a vertex write would cost a full terrain re-upload per crater).
// WebGL gets `addUpdateRange()` on the same attribute, so one retirement uploads
// 24 bytes. `dispose()` writes the identity back and drops the index, restoring
// the exact non-indexed geometry buildTerrain produced.
//
// WATER-TIGHTNESS AT THE PATCH BORDER
// -----------------------------------
// Patch boundary samples lie on the coarse quad's own edge and the crater field is
// exactly 0 with 0 slope at the rim, so a patch always meets its retired-but-unpatched
// neighbours seamlessly. Inside, the base height uses the SAME [a,b,d]/[a,d,c]
// split `buildTerrain` emits and `heightAt(..., true)` samples, so
// Sampling the original triangle plus drawnOffsetAt reproduces each drawn subtriangle.
//
// INTEGRATION CONTRACT
// ------------------------------------
//   ownsCell(cx,cy[, includeConcealed])  cell is crater-owned -> relief must skip it
//   revision                             bumped by every field change
//   onChange(this)                       fires when the WHOLE field is consistent
//   replacement `shade` attribute        2 + scorch (0..1): sentinel for the land
//                                        vertex shader (bypass reliefCutVertex,
//                                        open shelter, subtract 2 for char)
//   hit(..., {concealed:true})           field-only hit, published by reveal(test)
//   sync()                               re-read coarse per-cell data (layer paint)
//   bindMaterial()                       re-clone after ground.material is swapped

import * as THREE from 'three';
import { CELL, seedPad, seedCrater, fieldHeight, fieldSlope, fieldChar, footprintQuads } from './crater-field.js';

import { CraterGround } from './crater-ground.js';
export { CELL };

const DEFAULTS = {
  cell: CELL,
  // The land battle caller applies tighter weapon-scale limits and an explicit save rule.
  minRadius: 1.5,
  maxRadius: 120,
  depthRatio: 0.22,
  maxDepth: 40,
  lipRatio: 0.16,
  // Sub-cell resolution: target sub-vertex spacing = radius/4, in [minEdge,maxEdge].
  minEdge: 1.5,
  maxEdge: 4.5,
  minSubdiv: 2,
  maxSubdiv: 14,
  // Memory/work bounds. The vertex budget scales with the map and is the real cap;
  // `maxCraters` (0 = no separate cap) exists for callers that want one.
  budgetFactor: 0.12,
  minBudget: 64_000,
  maxBudget: 160_000,
  maxPatchVerts: 0, // explicit override of the budget
  maxVertsPerCrater: 24_000,
  maxCraters: 0,
  maxCells: 1_100_000,
  maxVertices: 12_000_000,
  scorch: 0.5,
  shadeSentinel: 2,
  onChange: null
};

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Same planes `buildTerrain` emits and `heightAt(t,x,y,true)` samples.
function splitHeight(z0, z1, z2, z3, lx, ly) {
  return lx >= ly ? z0 + lx * (z1 - z0) + ly * (z3 - z1) : z0 + ly * (z2 - z0) + lx * (z3 - z2);
}

export class TerrainCraters {
  /**
   * @param terrain   TED terrain (`{size,width?,height?,heights,...}`) - never written
   * @param ground    mesh returned by `buildTerrain(...)`
   * @param options   see DEFAULTS
   */
  constructor(terrain, ground, options = {}) {
    this.opts = { ...DEFAULTS, ...(options || {}) };
    this.terrain = terrain || null;
    this.ground = ground || null;
    this.onChange = typeof this.opts.onChange === 'function' ? this.opts.onChange : null;

    this.ready = false;
    this.reason = '';
    this.lastSkip = '';
    this.saturated = false;

    this.cell = Math.max(1, num(this.opts.cell, CELL));
    this.maxDepth = Math.max(1, num(this.opts.maxDepth, DEFAULTS.maxDepth));
    this.sentinel = num(this.opts.shadeSentinel, 2);

    // Field state: every live hit in insertion order, concealed or not.
    this.craters = [];
    this.byId = new Map();
    this.seq = 0;
    this.hits = 0;
    this.pads = new Set();
    this.skipped = 0;
    this.revision = 0;
    this.lastChange = null;

    // Replacement mesh state.
    this.quadsW = 0;
    this.quadsH = 0;
    this.quads = new Map(); // key -> quad record
    this.patchQuads = []; // dense, mirrors `quads` for relayout
    this.quadAt = null; // Int32Array cell -> index+1 (0 = not crater-owned)
    this.blockAt = null; // Int32Array cell -> 6-vertex block offset (-1 = hole)
    this.baseVerts = 0;
    this.budgetVerts = 0;
    this.maxVertsPerCrater = 0;
    this.capacityVerts = 0;
    this.usedVerts = 0;
    this.usedIndices = 0;
    this.layoutDirty = false; // slots must be (re)assigned
    this.layoutFull = false; // existing slots are invalid (removal / resubdivision)
    this.dirty = [];
    this.indexDirty = []; // coarse ground index blocks to re-upload
    this.indexRanges = []; // replacement index ranges to re-upload
    this.hideMode = 'none';
    this.paintRevision = -1;

    this.attr = null;
    this.geo = null;
    this.mesh = null;
    this.material = null;
    this.groundIndex = null; // sequential index of the coarse ground geometry
    this.groundIndexArray = null;
    this.origDraw = null;

    const geo = ground && ground.geometry,
      attrs = geo && geo.attributes,
      pos = attrs && attrs.position,
      nor = attrs && attrs.normal;
    if (!ground || !geo || !pos || !pos.array || !nor || !nor.array || nor.array.length !== pos.array.length) {
      this.reason = 'ground mesh has no matching position/normal attributes';
      return;
    }
    if (!attrs.layers || !attrs.corner || !attrs.shade) {
      this.reason = 'ground mesh is not remastered land geometry (layers/corner/shade missing)';
      return;
    }
    this.posAttr = pos;
    this.norAttr = nor;
    this.layAttr = attrs.layers;
    this.corAttr = attrs.corner;
    this.shaAttr = attrs.shade;
    this.posArray = pos.array;
    this.norArray = nor.array;
    this.layArray = attrs.layers.array;

    const size = terrain && (terrain.size | 0),
      w = terrain && ((terrain.width | 0) || size),
      h = terrain && ((terrain.height | 0) || size);
    if (w > 0 && h > 0 && (w - 1) * (h - 1) > this.opts.maxCells) {
      this.reason = `map too large (${(w - 1) * (h - 1)} cells)`;
      return;
    }
    if (pos.count > this.opts.maxVertices) {
      this.reason = `map too large (${pos.count} vertices)`;
      return;
    }
    if (pos.count % 6 !== 0) {
      this.reason = 'ground geometry is not 6 vertices per quad';
      return;
    }
    const dr = geo.drawRange || { start: 0, count: pos.count },
      drawn = Math.min(pos.count, (Number.isFinite(dr.start) ? dr.start : 0) + (Number.isFinite(dr.count) ? dr.count : pos.count));
    this.origDraw = { start: dr.start | 0, count: Number.isFinite(dr.count) ? dr.count : pos.count };
    if (!this.#buildTopology(drawn)) return;

    this.budgetVerts = Math.max(
      64,
      this.opts.maxPatchVerts > 0
        ? this.opts.maxPatchVerts | 0
        : Math.round(clamp(this.baseVerts * num(this.opts.budgetFactor, DEFAULTS.budgetFactor), num(this.opts.minBudget, DEFAULTS.minBudget), num(this.opts.maxBudget, DEFAULTS.maxBudget)))
    );
    this.maxVertsPerCrater = Math.max(64, this.opts.maxVertsPerCrater | 0);

    if (this.opts.fixedGrid) {
      const n = clamp(this.opts.fixedGrid|0, 2, 14);
      this.physical = new CraterGround(this,n);
      this.opts.minSubdiv = this.opts.maxSubdiv = n;
    }
    this.ready = true;
    this.#createChild();
  }

  // ---------------------------------------------------------------- public API

  /**
   * Blast at world (x,y). Returns the live record, or null when the hit was
   * refused (out of map, invalid, only holes, cap or budget).
   *
   * options: {depth, lip, scorch, seed, concealed}
   *   concealed: record the field (`offsetAt` sees it) but publish no geometry;
   *              `reveal(testVisibleXY)` publishes it later in one batch.
   *              Physics/sampling is never conditioned on fog.
   */
  hit(x, y, radius, options) {
    if (!this.ready) return null;
    const opt = options || {};
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return null;
    const r = Math.min(num(this.opts.maxRadius, DEFAULTS.maxRadius), radius);
    if (!(r >= this.opts.minRadius)) return null;
    const spanX = this.quadsW * this.cell,
      spanY = this.quadsH * this.cell;
    if (x < 0 || y < 0 || x > spanX || y > spanY) return null;
    const depth = Math.min(num(opt.depth, r * num(this.opts.depthRatio, DEFAULTS.depthRatio)), this.maxDepth);
    if (!(depth > 0)) return null;
    const lip = clamp(num(opt.lip, depth * num(this.opts.lipRatio, DEFAULTS.lipRatio)), 0, depth * 0.6);
    const scorch = clamp(num(opt.scorch, num(this.opts.scorch, 0)), 0, 1);
    const pad=opt.pad;
    if (pad && !(this.opts.maxPads && this.physical && Number.isFinite(pad.yaw) && pad.halfWidth>0 && pad.halfWidth<=r && r<=6 && depth<=1)) return null;
    if (!pad && num(this.opts.maxCraters, 0) > 0 && this.craters.length-this.pads.size >= this.opts.maxCraters) {
      this.lastSkip = 'cap';
      this.skipped++;
      return null;
    }

    const rec = seedCrater({
      id: ++this.seq,
      x,
      y,
      radius: r,
      depth,
      lip,
      scorch,
      seed: Number.isFinite(opt.seed) ? opt.seed : undefined,
      concealed: !!opt.concealed,
      quads: null
    });

    if(pad) seedPad(Object.assign(rec,{pad:true,halfLength:r,halfWidth:pad.halfWidth,yaw:pad.yaw,lip:0,scorch:0}));
    const keys = this.physical?.footprint(rec);
    if(pad){
      if(!keys.length)return null;
      if(this.pads.size>=this.opts.maxPads)this.release(this.pads.values().next().value);
    }
    if (keys && !pad && !this.physical.fits(keys)) { this.skipped++; this.lastSkip='budget'; this.saturated=true; return null; }
    if (rec.concealed) {
      if (keys) this.physical.add(rec,keys);
      // Field only: no geometry, no cell ownership, no coarse geometry writes.
      this.craters.push(rec);
      this.byId.set(rec.id, rec);
      if (pad) this.pads.add(rec); else this.hits++;
      this.#countConcealed(rec, 1);
      this.#change({ reason: 'hit', concealed: true, x, y, radius: r });
      return rec;
    }

    const plan = this.#plan(rec);
    if (!plan) {
      this.skipped++;
      return null;
    }
    this.craters.push(rec);
    this.byId.set(rec.id, rec);
    if (!this.#publish(rec, plan)) {
      this.craters.pop();
      this.byId.delete(rec.id);
      this.skipped++;
      return null;
    }
    if (keys) this.physical.add(rec,keys);
    if (pad) this.pads.add(rec); else this.hits++;
    this.#change({ reason: 'hit', cells: rec.quads.length, verts: plan.cost, x, y, radius: r });
    return rec;
  }

  /**
   * Publish concealed hits whose origin passes `testVisibleXY(x,y)` (all of them
   * when omitted). Returns how many were published. One batch, one revision.
   */
  reveal(testVisibleXY) {
    if (!this.ready) return 0;
    let published = 0,
      cells = 0;
    for (const rec of this.craters) {
      if (!rec.concealed || (testVisibleXY && !testVisibleXY(rec.x, rec.y))) continue;
      const plan = this.#plan(rec);
      if (!plan) continue;
      rec.concealed = false;
      this.#countConcealed(rec, -1);
      if (!this.#publish(rec, plan)) {
        rec.concealed = true; // stay field-only; retried on the next reveal
        this.#countConcealed(rec, 1);
        continue;
      }
      published++;
      cells += rec.quads.length;
    }
    if (published) this.#change({ reason: 'reveal', published, cells });
    return published;
  }

  /** Release one crater (record or id) and restore every quad only it owned. */
  release(cr) {
    const rec = typeof cr === 'number' ? this.byId.get(cr) : cr;
    if (!rec) return false;
    const at = this.craters.indexOf(rec);
    if (at < 0) return false;
    this.pads.delete(rec);
    this.physical?.remove(rec);
    this.byId.delete(rec.id);
    const wasConcealed = !!rec.concealed;
    if (wasConcealed) {
      this.#countConcealed(rec, -1);
      rec.concealed = false;
    } else {
      this.#unpublish(rec);
    }
    this.craters.splice(at, 1);
    this.#change({ reason: 'release', concealed: wasConcealed, cells: this.patchQuads.length });
    return true;
  }

  /**
   * Visual-only surface displacement at world (x,y): <= 0 on the floor, > 0 on the
   * lip. Inside a published patch this is the exact interpolation of the triangles
   * that are drawn, so `heightAt(t,x,y,true) + offsetAt(x,y)` is what a unit stands
   * on. Elsewhere it is the analytic field, which still includes concealed hits
   * (simulation never depends on fog).
   */
  nearOffset(x,y,reach) {
    if (!this.physical) return this.craters.length>0;
    if (!this.physical.cells.size) return false;
    const size=this.cell;
    for(let j=Math.max(0,Math.floor((y-reach)/size));j<=Math.min(this.quadsH-1,Math.floor((y+reach)/size));j++)
      for(let i=Math.max(0,Math.floor((x-reach)/size));i<=Math.min(this.quadsW-1,Math.floor((x+reach)/size));i++)
        if(this.physical.cells.has(j*this.quadsW+i)) return true;
    return false;
  }

  drawnOffsetAt(x,y) {
    const q = this.patchAt(x,y);
    return q ? this.#sampleQuad(q,x,y)-this.#baseQuad(q,x,y) : 0;
  }

  offsetAt(x, y) {
    if (this.physical) return this.physical.offsetAt(x,y);
    if (!this.ready || !(x >= 0) || !(y >= 0)) return 0;
    const qx = Math.floor(x / this.cell),
      qy = Math.floor(y / this.cell);
    if (qx >= 0 && qy >= 0 && qx < this.quadsW && qy < this.quadsH) {
      const at = this.quadAt[qy * this.quadsW + qx];
      if (at) {
        const q = this.patchQuads[at - 1];
        if (q && q.concealed === 0) return this.#sampleQuad(q, x, y) - this.#baseQuad(q, x, y);
      }
    }
    return this.craters.length ? fieldHeight(this.craters, x, y, this.maxDepth) : 0;
  }

  /** Convenience for a supplied *undisturbed* base height. */
  sample(baseAt, x, y) {
    const base = typeof baseAt === 'function' ? baseAt(x, y) : baseAt;
    return (base || 0) + this.offsetAt(x, y);
  }

  /**
   * True when coarse cell (cx,cy) - the quad spanning [cx,cx+1]x[cy,cy+1] in cell
   * units - is crater-owned and must be skipped by close-relief / reviewed-landscape
   * cell building. `includeConcealed` also answers for field-only (fogged) hits.
   */
  ownsCell(cx, cy, includeConcealed = false) {
    if (!this.ready) return false;
    if (!(cx >= 0) || !(cy >= 0) || cx >= this.quadsW || cy >= this.quadsH) return false;
    if (this.quadAt[cy * this.quadsW + cx]) return true;
    if (!includeConcealed) return false;
    const ax = cx * this.cell,
      ay = cy * this.cell,
      bx = ax + this.cell,
      by = ay + this.cell;
    for (const rec of this.craters) {
      if (!rec.concealed) continue;
      const nx = rec.x < ax ? ax : rec.x > bx ? bx : rec.x,
        ny = rec.y < ay ? ay : rec.y > by ? by : rec.y,
        dx = nx - rec.x,
        dy = ny - rec.y;
      if (dx * dx + dy * dy < rec.radius * rec.radius) return true;
    }
    return false;
  }

  /** Published patch covering a world point, or null. */
  patchAt(x, y) {
    if (!this.ready) return null;
    const qx = Math.floor(x / this.cell),
      qy = Math.floor(y / this.cell);
    if (qx < 0 || qy < 0 || qx >= this.quadsW || qy >= this.quadsH) return null;
    const at = this.quadAt[qy * this.quadsW + qx];
    return at ? this.patchQuads[at - 1] : null;
  }

  /**
   * Re-read the coarse per-cell attributes (layer painting, paving) into the
   * replacement geometry. Cheap no-op unless `t.paint.paintRevision` moved.
   */
  sync(force = false) {
    if (!this.ready || !this.patchQuads.length) return false;
    if (this.material && this.ground.material && this.material.userData.craterSource !== this.ground.material) this.bindMaterial();
    const rev = this.terrain && this.terrain.paint ? this.terrain.paint.paintRevision | 0 : -1;
    if (!force && rev === this.paintRevision) return false;
    this.paintRevision = rev;
    for (const q of this.patchQuads) this.#readQuadCell(q);
    this.#writeAllLayers();
    return true;
  }

  /** Rebind the replacement material after `ground.material` is swapped. */
  bindMaterial() {
    if (!this.ready) return false;
    const src = this.ground && this.ground.material;
    if (!src || !src.isShaderMaterial) return false;
    if (this.material && this.material.userData.craterSource === src) return false;
    this.#disposeMaterial();
    // Same shaders, same defines, same LIVE uniform objects (lighting, fog, layer
    // tables, soil), but our own reliefPatch: the replacement must never be
    // suppressed by the coarse mesh's close-relief cut.
    const uniforms = {};
    for (const k of Object.keys(src.uniforms || {})) {
      const d = Object.getOwnPropertyDescriptor(src.uniforms, k);
      if (d && d.get) Object.defineProperty(uniforms, k, { get: d.get, enumerable: true, configurable: true });
      else if (d) uniforms[k] = d.value;
    }
    uniforms.reliefPatch = { value: new THREE.Vector4(0, 0, 0, 0) };
    const mat = new THREE.ShaderMaterial({
      glslVersion: src.glslVersion,
      vertexShader: src.vertexShader,
      fragmentShader: src.fragmentShader,
      defines: { ...(src.defines || {}) },
      uniforms
    });
    for (const k of [
      'side',
      'transparent',
      'opacity',
      'alphaTest',
      'depthTest',
      'depthWrite',
      'colorWrite',
      'blending',
      'premultipliedAlpha',
      'toneMapped',
      'polygonOffset',
      'polygonOffsetFactor',
      'polygonOffsetUnits',
      'stencilWrite',
      'stencilRef',
      'stencilFunc',
      'stencilFail',
      'stencilZFail',
      'stencilZPass',
      'stencilWriteMask',
      'stencilFuncMask'
    ])
      if (src[k] !== undefined) mat[k] = src[k];
    mat.userData.craterSource = src;
    this.material = mat;
    if (this.mesh) {
      this.mesh.material = mat;
      this.mesh.renderOrder = this.ground.renderOrder || 0;
      this.mesh.castShadow = !!this.ground.castShadow;
      this.mesh.receiveShadow = !!this.ground.receiveShadow;
    }
    return true;
  }

  /** Every crater in the field, as plain data (no geometry, no THREE objects). */
  snapshot() {
    return {
      v: this.pads.size ? 2 : 1,
      cell: this.cell,
      quadsW: this.quadsW,
      quadsH: this.quadsH,
      revision: this.revision,
      seq: this.seq,
      craters: this.craters.map((c) => ({
        x: c.x,
        y: c.y,
        radius: c.radius,
        depth: c.depth,
        ...(c.pad ? {pad:true,halfWidth:c.halfWidth,yaw:c.yaw} : {}),
        lip: c.lip,
        scorch: c.scorch,
        seed: c.seed,
        concealed: !!c.concealed
      }))
    };
  }

  /**
   * Replace the whole field from `snapshot()`. Validates everything before it
   * touches anything, so a bad snapshot leaves the live field intact.
   *
   * Returns `false` when the snapshot is refused (callers can simply test
   * `if (restore(snap) === false) ...`), and the stats object
   * `{restored, concealed, skipped, reason:''}` on success. `lastRestore` always
   * holds the same object, so a refusal's reason is available.
   */
  restore(snapshot, options = {}) {
    const res = { restored: 0, concealed: 0, skipped: 0, reason: '' };
    this.lastRestore = res;
    if (!this.ready) {
      res.reason = 'not ready';
      return false;
    }
    const bad = (why) => {
      res.reason = why;
      return false;
    };
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.craters)) return bad('no crater list');
    if (snapshot.v !== undefined && snapshot.v !== 1 && !(snapshot.v===2 && this.opts.maxPads)) return bad(`unsupported snapshot version ${snapshot.v}`);
    if (snapshot.cell !== undefined && snapshot.cell !== this.cell) return bad('cell size differs');
    if (snapshot.quadsW !== undefined && snapshot.quadsW !== this.quadsW) return bad('map width differs');
    if (snapshot.quadsH !== undefined && snapshot.quadsH !== this.quadsH) return bad('map height differs');
    const limit=this.opts.maxCraters || 4096;
    if (snapshot.craters.length > limit+(this.opts.maxPads||0)) return bad('too many marks');
    const pads=snapshot.craters.filter(s=>s?.pad).length;
    if(pads>(this.opts.maxPads||0) || snapshot.craters.length-pads>limit || (pads && snapshot.v!==2)) return bad('too many or unsupported marks');
    const spanX = this.quadsW * this.cell,
      spanY = this.quadsH * this.cell,
      minR = num(this.opts.minRadius, DEFAULTS.minRadius),
      maxR = num(this.opts.maxRadius, DEFAULTS.maxRadius) + 1e-6;
    const list = [];
    for (let i = 0; i < snapshot.craters.length; i++) {
      const s = snapshot.craters[i];
      if (!s || typeof s !== 'object') return bad(`crater ${i} is not an object`);
      const x = s.x,
        y = s.y,
        radius = s.radius;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return bad(`crater ${i} has a non-finite position`);
      if (x < 0 || y < 0 || x > spanX || y > spanY) return bad(`crater ${i} is outside the map`);
      if (!(radius >= minR) || radius > maxR) return bad(`crater ${i} radius out of range`);
      const depth = num(s.depth, radius * num(this.opts.depthRatio, DEFAULTS.depthRatio));
      if (!(depth > 0) || depth > this.maxDepth + 1e-6) return bad(`crater ${i} depth out of range`);
      if(s.pad && !(s.halfWidth>0 && s.halfWidth<=radius && radius<=6 && depth<=1 && s.scorch===0 && s.lip===0 && Number.isFinite(s.yaw)))return bad('invalid footprint');
      list.push({
        ...(s.pad ? {pad:true,halfWidth:s.halfWidth,halfLength:radius,yaw:s.yaw} : {}),
        x,
        y,
        radius,
        depth,
        lip: clamp(num(s.lip, depth * num(this.opts.lipRatio, DEFAULTS.lipRatio)), 0, depth * 0.6),
        scorch: clamp(num(s.scorch, num(this.opts.scorch, 0)), 0, 1),
        seed: Number.isFinite(s.seed) ? s.seed : undefined,
        concealed: !!s.concealed
      });
    }

    if (this.physical) {
      const occupied=new Set();
      for (const r of list) {const keys=this.physical.footprint(r); if(r.pad && keys.length)continue; if (!this.physical.fits(keys,occupied)) return bad('field exceeds surface budget');
        for(const key of keys) occupied.add(key);}
    }
    // Commit: drop everything, replay the validated list as ONE batch.
    this.#clearField();
    for (const s of list) {
      const rec = seedCrater({ id: ++this.seq, ...s, quads: null });
      if(rec.pad){seedPad(rec);this.pads.add(rec);}
      if (this.physical) this.physical.add(rec,this.physical.footprint(rec));
      this.craters.push(rec);
      this.byId.set(rec.id, rec);
      if (rec.concealed) {
        this.#countConcealed(rec, 1);
        res.concealed++;
        res.restored++;
        continue;
      }
      const plan = this.#plan(rec);
      if (!plan) {
        // Over budget: keep the field (offsetAt still sees it) and publish later.
        rec.concealed = true;
        this.#countConcealed(rec, 1);
        res.concealed++;
        res.skipped++;
        continue;
      }
      if (!this.#publish(rec, plan)) {
        rec.concealed = true;
        this.#countConcealed(rec, 1);
        res.concealed++;
        res.skipped++;
        continue;
      }
      res.restored++;
    }
    if (Number.isFinite(options.seq)) this.seq = Math.max(this.seq, options.seq | 0);
    else if (Number.isFinite(snapshot.seq)) this.seq = Math.max(this.seq, snapshot.seq | 0);
    const want = Number.isFinite(snapshot.revision) ? snapshot.revision + 1 : 0;
    this.revision = Math.max(this.revision, want);
    this.#change({ reason: 'restore', restored: res.restored, concealed: res.concealed, skipped: res.skipped });
    return res;
  }

  /** Remove every crater and restore the coarse geometry exactly. */
  dispose() {
    if (!this.ready) return false;
    this.#clearField();
    if (this.geo) {
      const geo = this.ground.geometry;
      if (geo && geo.index === this.groundIndex) geo.setIndex(null);
      if (this.origDraw && geo) geo.setDrawRange(this.origDraw.start, this.origDraw.count);
    }
    // Listeners still see the (now empty) field and the restored coarse geometry.
    this.#change({ reason: 'dispose' });
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this.geo) this.geo.dispose();
    this.#disposeMaterial();
    this.mesh = null;
    this.geo = null;
    this.attr = null;
    this.groundIndex = null;
    this.groundIndexArray = null;
    this.quads.clear();
    this.patchQuads.length = 0;
    this.quadAt = null;
    this.byId.clear();
    this.ready = false;
    this.hideMode = 'none';
    this.reason = 'disposed';
    return true;
  }

  get stats() {
    let concealed = 0,
      published = 0;
    for (const c of this.craters) if (c.concealed) concealed++;
    for (const q of this.quads.values()) if (q.members.size) published++;
    return {
      ready: this.ready,
      reason: this.reason,
      lastSkip: this.lastSkip,
      craters: this.craters.length,
      publishedQuads: published,
      concealedCraters: concealed,
      hiddenQuads: this.quads.size,
      hits: this.hits,
      skipped: this.skipped,
      revision: this.revision,
      verts: this.usedVerts,
      indices: this.usedIndices,
      budgetVerts: this.budgetVerts,
      capacityVerts: this.capacityVerts,
      saturated: this.saturated,
      baseVerts: this.baseVerts,
      quadsW: this.quadsW,
      quadsH: this.quadsH
    };
  }

  // ------------------------------------------------------------------ internals

  // One pass over the 6-vertex blocks `buildTerrain` emits, so quad -> vertex block
  // is authoritative and does not depend on t.paint (absent for procedural maps and
  // in tests). Blocks past drawRange are unwritten zeros and are never scanned.
  #buildTopology(count) {
    const P = this.posArray,
      cell = this.cell,
      tol = Math.max(1e-3, cell * 1e-3),
      blocks = Math.floor(count / 6),
      gxs = new Int32Array(blocks),
      gys = new Int32Array(blocks);
    let maxGx = -1,
      maxGy = -1;
    for (let b = 0; b < blocks; b++) {
      const v = b * 6,
        px = P[v * 3],
        py = P[v * 3 + 1],
        gx = Math.round(px / cell),
        gy = Math.round(py / cell);
      if (Math.abs(px - gx * cell) > tol || Math.abs(py - gy * cell) > tol) {
        this.reason = 'ground geometry does not sit on the terrain grid';
        return false;
      }
      // The block must be the two triangles of quad (gx,gy): a,b,d then a,d,c.
      for (let k = 0; k < 6; k++) {
        const x = P[(v + k) * 3],
          y = P[(v + k) * 3 + 1],
          wx = Math.round(x / cell),
          wy = Math.round(y / cell);
        if (Math.abs(x - wx * cell) > tol || Math.abs(y - wy * cell) > tol || wx < gx || wx > gx + 1 || wy < gy || wy > gy + 1) {
          this.reason = 'ground geometry is not 6 vertices per terrain quad';
          return false;
        }
      }
      gxs[b] = gx;
      gys[b] = gy;
      if (gx > maxGx) maxGx = gx;
      if (gy > maxGy) maxGy = gy;
    }
    if (maxGx < 0) {
      this.reason = 'ground geometry is empty';
      return false;
    }
    this.quadsW = maxGx + 1;
    this.quadsH = maxGy + 1;
    const blockAt = new Int32Array(this.quadsW * this.quadsH).fill(-1);
    for (let b = 0; b < blocks; b++) {
      const key = gys[b] * this.quadsW + gxs[b];
      if (blockAt[key] !== -1) {
        this.reason = 'duplicate terrain quad in ground geometry';
        return false;
      }
      blockAt[key] = b * 6;
    }
    this.blockAt = blockAt;
    this.baseVerts = count;
    this.quadAt = new Int32Array(this.quadsW * this.quadsH);
    this.hideMode = 'index';
    return true;
  }

  #createChild() {
    const geo = new THREE.BufferGeometry();
    geo.name = 'Crater ground replacement';
    const capacity = 8;
    this.attr = {
      position: new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
      normal: new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
      layers: new THREE.BufferAttribute(new Float32Array(capacity * 4), 4),
      corner: new THREE.BufferAttribute(new Float32Array(capacity * 2), 2),
      shade: new THREE.BufferAttribute(new Float32Array(capacity), 1)
    };
    for (const a of Object.values(this.attr)) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr.position);
    geo.setAttribute('normal', this.attr.normal);
    geo.setAttribute('layers', this.attr.layers);
    geo.setAttribute('corner', this.attr.corner);
    geo.setAttribute('shade', this.attr.shade);
    // Zero-area warm-up triangle: both backends build the pipeline while the map
    // loads, instead of hitching on the first explosion.
    const childIndex = new THREE.BufferAttribute(new Uint32Array(capacity), 1);
    childIndex.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(childIndex);
    geo.setDrawRange(0, 3);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const mesh = new THREE.Mesh(geo, null);
    mesh.name = 'Crater ground replacement';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.userData.craters = this;
    this.geo = geo;
    this.mesh = mesh;
    this.capacityVerts = capacity;
    this.ground.add(mesh);
    this.bindMaterial();
    if (this.material) mesh.material = this.material;
    mesh.renderOrder = this.ground.renderOrder || 0;
  }

  #disposeMaterial() {
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }

  /** Preferred sub-cell subdivision for a radius (small blast -> fine patch). */
  #subdivFor(radius) {
    const edge = clamp(radius / 4, num(this.opts.minEdge, DEFAULTS.minEdge), num(this.opts.maxEdge, DEFAULTS.maxEdge));
    return clamp(Math.ceil(this.cell / edge), this.opts.minSubdiv | 0, this.opts.maxSubdiv | 0);
  }

  /**
   * Decide, without touching anything, which quads a hit needs and what it costs.
   * Coarsens the subdivision until it fits both budgets, then refuses. Never evicts:
   * existing craters keep their geometry (see README "saturation").
   */
  #plan(rec) {
    if (this.hideMode !== 'index') {
      this.lastSkip = 'unsupported';
      return null;
    }
    const full = footprintQuads(this.cell, rec.x, rec.y, rec.radius, this.quadsW, this.quadsH),
      quads = [];
    for (const f of full) {
      const key = f.qy * this.quadsW + f.qx;
      if (this.blockAt[key] < 0) continue; // hole / omitted quad: never fabricate ground
      quads.push({ qx: f.qx, qy: f.qy, key, patch: this.quads.get(key) || null });
    }
    if (!quads.length) {
      this.lastSkip = 'holes';
      return null;
    }
    // A replacement patch must have ONE subdivision per connected region: two patch
    // quads sharing an edge with different `n` would sample that edge at different
    // points and leave a sliver gap (a T-junction). So the region around this blast
    // adopts the finest subdivision any of its members needs.
    // The versioned walkable surface already uses identical subdivisions.
    const region = this.physical ? new Set() : this.#regionOf(quads);
    const minN = Math.max(1, this.opts.minSubdiv | 0);
    let regionN = this.#subdivFor(rec.radius);
    for (const q of region) if (q.n > regionN) regionN = q.n;
    const fresh = quads.reduce((n, q) => n + (q.patch ? 0 : 1), 0);
    for (;;) {
      let held = 0;
      for (const q of region) held += (q.n + 1) * (q.n + 1);
      const after = this.usedVerts - held + (region.size + fresh) * (regionN + 1) * (regionN + 1);
      const cost = Math.max(0, after - this.usedVerts),
        overBudget = after > this.budgetVerts+(this.opts.maxPads||0)*4*(regionN+1)**2,
        overPerCrater = cost > this.maxVertsPerCrater;
      if (!overBudget && !overPerCrater) return { quads, region, n: regionN, cost };
      if (regionN > minN) {
        regionN = Math.max(minN, regionN >> 1);
        continue;
      }
      this.lastSkip = overBudget ? 'budget' : 'per-crater';
      if (overBudget) this.saturated = true;
      return null;
    }
  }

  /** Connected component of existing patch quads that touches these quads. */
  #regionOf(quads) {
    const region = new Set(),
      seen = new Set(),
      stack = [];
    for (const q of quads) if (q.patch) stack.push(q.patch.key);
    while (stack.length) {
      const key = stack.pop();
      if (seen.has(key)) continue;
      seen.add(key);
      const q = this.quads.get(key);
      if (!q) continue;
      region.add(q);
      const x = key % this.quadsW,
        y = (key / this.quadsW) | 0;
      if (x > 0) stack.push(key - 1);
      if (x < this.quadsW - 1) stack.push(key + 1);
      if (y > 0) stack.push(key - this.quadsW);
      if (y < this.quadsH - 1) stack.push(key + this.quadsW);
    }
    return region;
  }

  /** Read a quad's untouched coarse corner data (position/normal/layers). */
  #createQuad(qx, qy) {
    const key = qy * this.quadsW + qx,
      block = this.blockAt[key];
    if (block < 0) return null;
    const P = this.posArray,
      N = this.norArray,
      L = this.layArray,
      cell = this.cell,
      z = new Float32Array(4),
      nr = new Float32Array(12),
      seen = [false, false, false, false];
    for (let k = 0; k < 6; k++) {
      const v = block + k,
        lx = Math.round((P[v * 3] - qx * cell) / cell),
        ly = Math.round((P[v * 3 + 1] - qy * cell) / cell),
        corner = ly * 2 + lx;
      if (seen[corner]) continue;
      seen[corner] = true;
      z[corner] = P[v * 3 + 2];
      nr[corner * 3] = N[v * 3];
      nr[corner * 3 + 1] = N[v * 3 + 1];
      nr[corner * 3 + 2] = N[v * 3 + 2];
    }
    const q = {
      qx,
      qy,
      key,
      block,
      base: { z, n: nr },
      layers: new Float32Array([L[block * 4], L[block * 4 + 1], L[block * 4 + 2], L[block * 4 + 3]]),
      n: 0,
      z: null,
      nrm: null,
      char: null,
      members: new Set(),
      concealed: 0,
      slot: 0,
      idxStart: 0,
      placed: false,
      hidden: false,
      dirty: false
    };
    this.quads.set(key, q);
    this.#hideQuad(q);
    if (!q.hidden) {
      // The coarse quad could not be retired: a patch under an intact coarse cap
      // would be invisible, so never publish one.
      this.quads.delete(key);
      return null;
    }
    // Full member scan: a quad is created once, and this removes any dependence on
    // "every intersecting crater already registered this quad".
    for (const rec of this.craters) if (this.#intersects(rec, qx, qy)) this.#addMember(q, rec);
    return q;
  }

  #intersects(rec, qx, qy) {
    const ax = qx * this.cell,
      ay = qy * this.cell,
      nx = rec.x < ax ? ax : rec.x > ax + this.cell ? ax + this.cell : rec.x,
      ny = rec.y < ay ? ay : rec.y > ay + this.cell ? ay + this.cell : rec.y,
      dx = nx - rec.x,
      dy = ny - rec.y;
    return dx * dx + dy * dy < rec.radius * rec.radius;
  }

  #addMember(q, rec) {
    if (rec.concealed) q.concealed++;
    else q.members.add(rec.id);
  }

  #publish(rec, plan) {
    const mine = [],
      touched = new Set(),
      mark = (q) => {
        if (!q.dirty) {
          q.dirty = true;
          this.dirty.push(q);
        }
        touched.add(q);
      };
    for (const p of plan.quads) {
      let q = this.quads.get(p.key),
        created = false;
      if (!q) {
        q = this.#createQuad(p.qx, p.qy);
        if (!q) continue; // hole, or the coarse quad could not be retired
        created = true;
        this.layoutDirty = true;
      }
      if (q.n !== plan.n) {
        q.n = plan.n;
        this.layoutDirty = true;
        if (!created) this.layoutFull = true; // an already placed quad was resubdivided
      }
      q.members.add(rec.id);
      mine.push(p.key);
      mark(q);
    }
    if (!mine.length) {
      rec.quads = null;
      this.lastSkip = this.hideMode === 'index' ? 'holes' : 'unsupported';
      return false;
    }
    // Neighbours in the same region keep their members but adopt the region's
    // subdivision, so the shared edges stay free of T-junctions.
    for (const q of plan.region) {
      if (q.n === plan.n) continue;
      q.n = plan.n;
      this.layoutDirty = true;
      this.layoutFull = true;
      mark(q);
    }
    for (const q of touched) this.#computeQuad(q);
    rec.quads = mine;
    this.#flush();
    return true;
  }

  #unpublish(rec) {
    if (!rec.quads) return;
    for (const key of rec.quads) {
      const q = this.quads.get(key);
      if (!q) continue;
      q.members.delete(rec.id);
      if (!q.members.size) {
        this.#unhideQuad(q);
        const at = this.dirty.indexOf(q);
        if (at >= 0) this.dirty.splice(at, 1);
        q.dirty = false;
        this.quads.delete(key);
        if(this.physical && q.placed && !this.layoutDirty){
          // Fixed-grid tiles use identical slot-relative indices. Move the last
          // tile into the gap rather than rewriting every retained blast bowl.
          const tail=this.patchQuads.pop();this.quadAt[key]=0;
          if(tail!==q){
            tail.slot=q.slot;tail.idxStart=q.idxStart;tail.index=q.index;
            this.patchQuads[q.index]=tail;this.quadAt[tail.key]=q.index+1;this.#writeQuad(tail);
          }
          this.usedVerts-=(q.n+1)**2;this.usedIndices-=6*q.n*q.n;
          this.geo.setDrawRange(0,this.usedIndices);
        } else { this.layoutDirty=true;this.layoutFull=true; }
      } else {
        // Membership shrank: recompute from the survivors so the ground returns to
        // exactly their profile (never to a remembered older mesh state).
        if (!q.dirty) {
          q.dirty = true;
          this.dirty.push(q);
        }
        this.#computeQuad(q);
      }
    }
    rec.quads = null;
  }

  #clearField() {
    this.pads.clear();
    this.physical?.cells.clear();this.physical?.shellCells.clear();
    for (const q of this.quads.values()) this.#unhideQuad(q);
    this.quads.clear();
    this.patchQuads.length = 0;
    if (this.quadAt) this.quadAt.fill(0);
    this.craters.length = 0;
    this.byId.clear();
    this.dirty.length = 0;
    this.layoutDirty = true;
    this.layoutFull = true;
    this.#flush();
  }

  #countConcealed(rec, delta) {
    if (!rec.concealed && delta > 0) return;
    for (const q of this.quads.values()) if (this.#intersects(rec, q.qx, q.qy)) q.concealed = Math.max(0, q.concealed + delta);
  }

  // ---- coarse geometry retirement (index degeneracy, no vertex upload) ----

  #ensureIndex() {
    if (this.hideMode !== 'index') return false;
    const geo = this.ground.geometry,
      pos = this.posAttr;
    if (geo.index) {
      const arr = geo.index.array;
      if (geo.index.count !== pos.count) {
        this.hideMode = 'none';
        this.reason = 'ground geometry is already indexed with a different count';
        return false;
      }
      for (let i = 0; i < arr.length; i++)
        if (arr[i] !== i) {
          this.hideMode = 'none';
          this.reason = 'ground geometry carries a non-sequential index';
          return false;
        }
      this.groundIndex = geo.index;
      this.groundIndexArray = arr;
      return true;
    }
    const arr = pos.count <= 65536 ? new Uint16Array(pos.count) : new Uint32Array(pos.count);
    for (let i = 0; i < arr.length; i++) arr[i] = i;
    const index = new THREE.BufferAttribute(arr, 1);
    index.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(index);
    this.groundIndex = index;
    this.groundIndexArray = arr;
    return true;
  }

  #hideQuad(q) {
    if (q.hidden) return;
    if (!this.groundIndex && !this.#ensureIndex()) return;
    const b = q.block,
      a = this.groundIndexArray;
    for (let k = 0; k < 6; k++) a[b + k] = b; // all three corners identical: no fragments
    q.hidden = true;
    this.indexDirty.push(b);
  }

  #unhideQuad(q) {
    if (!q.hidden || !this.groundIndexArray) return;
    const b = q.block,
      a = this.groundIndexArray;
    for (let k = 0; k < 6; k++) a[b + k] = b + k;
    q.hidden = false;
    this.indexDirty.push(b);
  }

  #flushIndex() {
    const attr = this.groundIndex;
    if (!attr || !this.indexDirty.length) return;
    if (attr.addUpdateRange) for (const b of this.indexDirty) attr.addUpdateRange(b, 6);
    attr.needsUpdate = true;
    this.indexDirty.length = 0;
  }

  // ---- replacement geometry ----

  #ensureCapacity(verts, indices) {
    if (verts <= this.capacityVerts && indices <= this.capacityIndices) return false;
    const capV = Math.max(verts, this.capacityVerts * 2, 64),
      old = this.attr,
      attr = {
        position: new THREE.BufferAttribute(new Float32Array(capV * 3), 3),
        normal: new THREE.BufferAttribute(new Float32Array(capV * 3), 3),
        layers: new THREE.BufferAttribute(new Float32Array(capV * 4), 4),
        corner: new THREE.BufferAttribute(new Float32Array(capV * 2), 2),
        shade: new THREE.BufferAttribute(new Float32Array(capV), 1)
      };
    for (const key of Object.keys(attr)) {
      attr[key].setUsage(THREE.DynamicDrawUsage);
      if (old && old[key]) attr[key].array.set(old[key].array.subarray(0, Math.min(old[key].array.length, attr[key].array.length)));
      this.geo.setAttribute(key, attr[key]);
    }
    this.capacityVerts = capV;
    this.attr = attr;
    const oldIndex = this.geo.index;
    if (indices > oldIndex.array.length) {
      const capI = Math.max(indices, oldIndex.array.length * 2, 64),
        wide = oldIndex.array instanceof Uint16Array && capI > 65536,
        grown = wide ? new Uint32Array(capI) : new (oldIndex.array instanceof Uint16Array ? Uint16Array : Uint32Array)(capI);
      grown.set(oldIndex.array);
      const index = new THREE.BufferAttribute(grown, 1);
      index.setUsage(THREE.DynamicDrawUsage);
      this.geo.setIndex(index);
    }
    this.capacityIndices = this.geo.index.array.length;
    this.layoutDirty = true;
    this.layoutFull = true;
    return true; // every existing slot moved into a new attribute array
  }

  /** Assign slots for every patch quad, then write vertices and indices. */
  #relayout() {
    let verts = 0,
      indices = 0;
    for (const q of this.quads.values()) {
      const edge = q.n + 1;
      verts += edge * edge;
      indices += q.n * q.n * 6;
    }
    this.#ensureCapacity(verts, indices);
    this.patchQuads.length = 0;
    this.quadAt.fill(0);
    let v = 0,
      ix = 0;
    for (const q of this.quads.values()) {
      q.slot = v;
      q.idxStart = ix;
      q.index = this.patchQuads.length;
      q.placed = true;
      this.patchQuads.push(q);
      this.quadAt[q.key] = q.index + 1;
      v += (q.n + 1) * (q.n + 1);
      ix += q.n * q.n * 6;
    }
    this.usedVerts = v;
    this.usedIndices = ix;
    const I = this.geo.index.array;
    for (const q of this.quads.values()) {
      const n = q.n,
        edge = n + 1,
        base = q.slot;
      let k = q.idxStart;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const A = base + y * edge + x,
            B = A + 1,
            C = A + edge,
            D = C + 1;
          I[k++] = A;
          I[k++] = B;
          I[k++] = D;
          I[k++] = A;
          I[k++] = D;
          I[k++] = C;
        }
      this.#writeQuad(q, true);
    }
    this.dirty.length = 0;
    for (const q of this.quads.values()) q.dirty = false;
    this.layoutDirty = false;
    this.layoutFull = false;
    this.indexRanges.length = 0; // the whole index was just rewritten
    this.#flushIndex();
    this.geo.index.needsUpdate = true;
    this.geo.setDrawRange(0, ix);
    if (this.mesh) this.mesh.visible = ix > 0;
    for (const a of Object.values(this.attr)) a.needsUpdate = true;
  }

  /**
   * Append-only relayout: a new crater almost always adds quads at the end, and
   * existing slots never move, so only the new quads are written. This is what
   * keeps a hit in the tens of microseconds instead of rebuilding the field.
   */
  #appendLayout() {
    let v = this.usedVerts,
      ix = this.usedIndices,
      added = 0;
    for (const q of this.quads.values()) {
      if (q.placed) continue;
      q.slot = v;
      q.idxStart = ix;
      v += (q.n + 1) * (q.n + 1);
      ix += q.n * q.n * 6;
      added++;
    }
    if (!added) {
      this.layoutDirty = false;
      return;
    }
    if (this.#ensureCapacity(v, ix)) {
      // Attributes were re-created (or the index widened): everything must re-fill.
      this.#relayout();
      return;
    }
    const I = this.geo.index.array;
    for (const q of this.quads.values()) {
      if (q.placed) continue;
      const n = q.n,
        edge = n + 1,
        base = q.slot;
      let k = q.idxStart;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const A = base + y * edge + x,
            B = A + 1,
            C = A + edge,
            D = C + 1;
          I[k++] = A;
          I[k++] = B;
          I[k++] = D;
          I[k++] = A;
          I[k++] = D;
          I[k++] = C;
        }
      (this.indexRanges ||= []).push([q.idxStart, n * n * 6]);
      this.#writeQuad(q);
      q.placed = true;
      q.index = this.patchQuads.length;
      this.patchQuads.push(q);
      this.quadAt[q.key] = q.index + 1;
    }
    this.usedVerts = v;
    this.usedIndices = ix;
    this.layoutDirty = false;
    // Existing quads that only gained a member are in `dirty` as well, so one pass
    // writes both the appended quads and the re-evaluated ones.
    for (const q of this.dirty) if (q.placed && q.dirty) this.#writeQuad(q);
    this.dirty.length = 0;
    const idx = this.geo.index;
    if (this.indexRanges && this.indexRanges.length && idx.addUpdateRange) {
      for (const [start, count] of this.indexRanges) idx.addUpdateRange(start, count);
      this.indexRanges.length = 0;
    }
    idx.needsUpdate = true;
    this.geo.setDrawRange(0, ix);
    if (this.mesh) this.mesh.visible = ix > 0;
  }

  #readQuadCell(q) {
    const L = this.layArray,
      v = q.block;
    if (!L || v * 4 + 3 >= L.length) return;
    q.layers[0] = L[v * 4];
    q.layers[1] = L[v * 4 + 1];
    q.layers[2] = L[v * 4 + 2];
    q.layers[3] = L[v * 4 + 3];
  }

  /** Re-evaluate one patch quad's sub-vertices from its published members. */
  #computeQuad(q) {
    const n = q.n,
      edge = n + 1,
      cell = this.cell,
      step = cell / n,
      ox = q.qx * cell,
      oy = q.qy * cell;
    if (!q.z || q.z.length !== edge * edge) {
      q.z = new Float32Array(edge * edge);
      q.nrm = new Float32Array(edge * edge * 3);
      q.char = new Float32Array(edge * edge);
    }
    const members = [];
    for (const id of q.members) {
      const rec = this.byId.get(id);
      if (rec && !rec.concealed) members.push(rec);
    }
    this.#readQuadCell(q);
    const z = q.base.z,
      bn = q.base.n,
      slope = [0, 0],
      maxDepth = this.maxDepth,
      has = members.length > 0;
    for (let j = 0; j <= n; j++) {
      const ly = j / n,
        py = oy + j * step;
      for (let i = 0; i <= n; i++) {
        const lx = i / n,
          px = ox + i * step,
          k = j * edge + i;
        const h = has ? fieldHeight(members, px, py, maxDepth) : 0;
        q.z[k] = splitHeight(z[0], z[1], z[2], z[3], lx, ly) + h;
        // Base normal: bilinear over the untouched coarse corner normals, so a
        // patch vertex on the quad border carries exactly the coarse normal.
        let bx = (bn[0] * (1 - lx) + bn[3] * lx) * (1 - ly) + (bn[6] * (1 - lx) + bn[9] * lx) * ly,
          by = (bn[1] * (1 - lx) + bn[4] * lx) * (1 - ly) + (bn[7] * (1 - lx) + bn[10] * lx) * ly,
          bz = (bn[2] * (1 - lx) + bn[5] * lx) * (1 - ly) + (bn[8] * (1 - lx) + bn[11] * lx) * ly;
        const bl = Math.hypot(bx, by, bz) || 1;
        bx /= bl;
        by /= bl;
        bz /= bl;
        const zc = bz < 0.2 ? 0.2 : bz;
        let gx = -bx / zc,
          gy = -by / zc;
        if (has) {
          fieldSlope(members, px, py, maxDepth, slope);
          gx += slope[0];
          gy += slope[1];
        }
        const len = Math.hypot(gx, gy, 1);
        q.nrm[k * 3] = -gx / len;
        q.nrm[k * 3 + 1] = -gy / len;
        q.nrm[k * 3 + 2] = 1 / len;
        q.char[k] = has ? fieldChar(members, px, py) : 0;
      }
    }
    q.dirty = true;
  }

  #writeQuad(q, full = false) {
    const a = this.attr;
    if (!a) return;
    const n = q.n,
      edge = n + 1,
      cell = this.cell,
      step = cell / n,
      ox = q.qx * cell,
      oy = q.qy * cell,
      slot = q.slot,
      count = edge * edge,
      P = a.position.array,
      N = a.normal.array,
      L = a.layers.array,
      C = a.corner.array,
      S = a.shade.array,
      sentinel = this.sentinel,
      z = q.z,
      nrm = q.nrm,
      ch = q.char;
    if (!z || z.length !== count) return;
    for (let j = 0; j < edge; j++)
      for (let i = 0; i < edge; i++) {
        const k = j * edge + i,
          v = slot + k;
        P[v * 3] = ox + i * step;
        P[v * 3 + 1] = oy + j * step;
        P[v * 3 + 2] = z[k];
        N[v * 3] = nrm[k * 3];
        N[v * 3 + 1] = nrm[k * 3 + 1];
        N[v * 3 + 2] = nrm[k * 3 + 2];
        L[v * 4] = q.layers[0];
        L[v * 4 + 1] = q.layers[1];
        L[v * 4 + 2] = q.layers[2];
        L[v * 4 + 3] = q.layers[3];
        C[v * 2] = i / n;
        C[v * 2 + 1] = j / n;
        // Contract with the land vertex shader: values >= 2 mean "replacement
        // ground" - bypass the close-relief cut, treat shelter as open and use the
        // fractional part as char intensity.
        const c = ch[k];
        S[v] = sentinel + (c > 1 ? 1 : c > 0 ? c : 0);
      }
    if (full) return; // relayout marks every attribute dirty once
    const range = (attr, size) => {
      if (attr.addUpdateRange) attr.addUpdateRange(slot * size, count * size);
      attr.needsUpdate = true;
    };
    range(a.position, 3);
    range(a.normal, 3);
    range(a.layers, 4);
    range(a.corner, 2);
    range(a.shade, 1);
    q.dirty = false;
  }

  #writeAllLayers() {
    const a = this.attr;
    if (!a) return;
    const L = a.layers.array;
    for (const q of this.quads.values()) {
      const count = (q.n + 1) * (q.n + 1);
      for (let k = 0; k < count; k++) {
        const v = q.slot + k;
        L[v * 4] = q.layers[0];
        L[v * 4 + 1] = q.layers[1];
        L[v * 4 + 2] = q.layers[2];
        L[v * 4 + 3] = q.layers[3];
      }
      if (a.layers.addUpdateRange) a.layers.addUpdateRange(q.slot * 4, count * 4);
    }
    a.layers.needsUpdate = true;
  }

  // Exact sampler of the triangles that were emitted for this quad.
  #sampleQuad(q, x, y) {
    const n = q.n,
      lx = clamp((x - q.qx * this.cell) / this.cell, 0, 1),
      ly = clamp((y - q.qy * this.cell) / this.cell, 0, 1),
      i = Math.min(n - 1, Math.max(0, Math.floor(lx * n))),
      j = Math.min(n - 1, Math.max(0, Math.floor(ly * n))),
      fx = lx * n - i,
      fy = ly * n - j,
      edge = n + 1,
      z = q.z,
      A = z[j * edge + i],
      B = z[j * edge + i + 1],
      C = z[(j + 1) * edge + i],
      D = z[(j + 1) * edge + i + 1];
    return fx >= fy ? A + fx * (B - A) + fy * (D - B) : A + fy * (C - A) + fx * (D - C);
  }

  // Coarse base surface of the same quad (what heightAt(..., true) returns).
  #baseQuad(q, x, y) {
    const z = q.base.z,
      lx = clamp((x - q.qx * this.cell) / this.cell, 0, 1),
      ly = clamp((y - q.qy * this.cell) / this.cell, 0, 1);
    return splitHeight(z[0], z[1], z[2], z[3], lx, ly);
  }

  #flush() {
    if (!this.ready) return;
    // reviewed-landscape / Endor swap `ground.material`; keep the replacement on the
    // same program without asking the caller to remember.
    if (this.material && this.ground.material && this.material.userData.craterSource !== this.ground.material) this.bindMaterial();
    if (this.layoutDirty && !this.layoutFull) this.#appendLayout();
    else if (this.layoutDirty) this.#relayout();
    else if (this.dirty.length) {
      for (const q of this.dirty) this.#writeQuad(q);
      this.dirty.length = 0;
    }
    this.#flushIndex();
    if (this.geo && this.usedIndices) this.geo.setDrawRange(0, this.usedIndices);
    if (this.mesh) this.mesh.visible = this.usedIndices > 0;
  }

  #change(change) {
    // Everything (field, coarse retirement, replacement geometry, index version) is
    // consistent before this fires, so a listener may sample or render.
    this.#flush();
    this.revision++;
    this.lastChange = change;
    if (this.onChange) this.onChange(this);
  }
}

export default TerrainCraters;
