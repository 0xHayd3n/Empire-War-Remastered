// A complete, identity-bound terrain recipe. Keep the mounted atlas only for rollback;
// no stock color or bump binding participates while the reviewed terrain is active.
import * as T from 'three';
import { gfx } from '../gfx.js';
import { pageOverlay, fetchBinary } from '../vfs.js';
import { mapSourceDigest } from '../ted.js';
import { digest } from '../texture-showcase/recipes.js';
import { readPack, families } from './endor-landscape.js';
import { reliefPatch } from './endor-relief.js';
import { soilGrid } from './groundday.js';
import { shaderScene } from './landinstances.js';
import { prepareJungle } from './jungle-canopy.js';
import { drawFloorSlots } from './endor-habitat.js';
import { composeGround } from './ground-composition.js';
import { prepareOutskirts } from './scenic-outskirts.js';
import { groundZones } from './ground-zones.js';
import { landscapeBinding } from './landscape-binding.js';
export function reviewedLandscape(ground, t, used, map, renderer, signal, recipe, stockPalette, fragment) {
  const stock = ground.material,
    U = stock.uniforms,
    originalSoil = ground.userData.soil,
    originalGrid = ground.userData.makeSoilGrid;
  const status = (ground.userData.reviewedLandscape = { state: 'idle', active: false }),
    old = used.map((_, s) => [U.texU.value[s].w, U.texV.value[s].w]);
  let data, jungle, outskirts, floor, material, patch, ids, palette, mean, weightsMap;
  function soilAt(i,raw){const s=t.paint.slot.get(raw);if(s===undefined)return null;if(!floor?.corner||floor.authorized(i,s))return palette[raw];
    const key=Math.floor(i/t.size)*floor.width+i%t.size,color=[0,0,0];for(let q=0;q<7;q++){const w=floor.corner(key,q),rgb=palette[used[floor.slots[q]]];if(w)for(let k=0;k<3;k++)color[k]+=w*rgb[k];}return color;}
  const grid = () => {
    t.paint.soilGrid?.tex.dispose();
    t.paint.soilGrid = null;
  };
  function swap(on) {
    if (on === status.active) return;
    for (let s = 0; s < used.length; s++) {
      const id = ids[s];
      const row = data.rows[id];
      [U.texU.value[s].w, U.texV.value[s].w] = on
        ? [2 + id, ((row.regular ? -1 : 1) * (t.layers[used[s]].tile || 215)) / (10 * row.tileMeters)]
        : old[s];
    }
    if (floor) {
      t.paint.floorLayout = on ? floor : null;
      drawFloorSlots(t);
    }
    ground.material = on ? material : stock;
    if(outskirts)outskirts.group.visible=on;
    ground.userData.soil = on ? mean : originalSoil;
    ground.userData.makeSoilGrid = on
      ? () => soilGrid(t, palette, mean, 20, null, floor ? soilAt : null)
      : originalGrid;
    grid();
    status.active = on;
  }
  function dispose() {
    if (status.active) swap(false);
    patch?.dispose();
    jungle?.dispose();
    outskirts?.dispose(); outskirts=null;
    weightsMap?.dispose();
    material?.dispose();
    data?.dispose();
    patch = jungle = material = data = null;
  }
  async function load(g) {
    if ((await pageOverlay()) || (await mapSourceDigest(map)) !== recipe.ted) throw Error('Different mount or map');
    const bc = renderer?.device?.features.has('texture-compression-bc') || renderer?.extensions?.has('WEBGL_compressed_texture_s3tc'),
      cap = renderer?.capabilities?.maxTextureSize;
    if (!bc || !cap || renderer.isMirror) throw Error('Renderer cannot upload reviewed BC3 arrays');
    let first = Math.max(0, Math.min(2, gfx.texMip | 0));
    while (2048 >> first > cap && first < 11) first++;
    if (recipe.policy !== 'polyhaven-2k' || Object.keys(recipe.slots).length !== used.length)
      throw Error('Incomplete Poly Haven terrain binding');
    const hashes = new Map();
    function check(name, expected) {
      if (!name || !expected) throw Error('Missing reviewed source');
      const key = 'Data/Art/Textures/' + (/\.[a-z0-9]{2,4}$/i.test(name) ? name : name + '.dds');
      if (!hashes.has(key))
        hashes.set(
          key,
          fetchBinary(key, { keep: false }).then(b => b && digest(b))
        );
      return hashes.get(key).then(actual => {
        if (actual !== expected) throw Error('Changed ground: ' + name);
      });
    }
    await Promise.all(
      used.map(async i => {
        const s = recipe.slots[i],
          l = t.layers[i];
        if (!s?.family || s.retainColor || !recipe.donors.some(d => d.id === s.family)) throw Error('Unreviewed draw slot ' + i);
        await Promise.all([check(l.texture, s.diffuse), check(l.bump, s.bump)]);
      })
    );
    if (signal.aborted) return;
    data = await readPack(first, signal, recipe.donors);
    if (signal.aborted) {
      dispose();
      return;
    }
    ids = used.map(i => data.rows.findIndex(r => r.id === recipe.slots[i].family));
    const habitatIDs = t.layers.map((_, i) => {
      const row = data.rows.find(r => r.id === recipe.slots[i]?.family);
      return families.indexOf(row?.role || row?.id);
    });
    const zones = groundZones(t, used, recipe, g.props);
    floor = zones;
    if (recipe.canopy) {
      jungle = await prepareJungle(g, recipe.canopy, habitatIDs, signal, first, recipe.grove, recipe.farCover);
      if (signal.aborted) {
        dispose();
        return;
      }
    }
    if(recipe.composition){
      floor=composeGround(t,used,recipe.composition,jungle?.cover,g.props,zones);
      weightsMap=new T.DataTexture(floor.bytes,floor.width*2,floor.height);weightsMap.name='Reviewed ground cover';weightsMap.minFilter=weightsMap.magFilter=T.LinearFilter;weightsMap.needsUpdate=true;
    }
    material = new T.ShaderMaterial({
      glslVersion: stock.glslVersion,
      vertexShader: stock.vertexShader,
      fragmentShader: fragment(),
      defines: { BIOME_RECIPE: 1, ...(weightsMap?{GROUND_COMPOSITION:1}:{}) },
      uniforms: {
        ...U,
        ...(weightsMap?{canopyMap:{value:weightsMap},groundMixA:{value:new T.Vector4(...floor.slots.slice(0,4))},groundMixB:{value:new T.Vector4(...floor.slots.slice(4),1)}}:{}),
        map: { value: data.maps[0] },
        bump: { value: data.maps[1] },
        soilColor: { value: data.maps[0] },
        soilSurface: { value: data.maps[1] },
        matSpecular: { value: U.matSpecular.value.map((v, s) => data.scanMean[ids[s]] ?? v) }
      }
    });
    if(recipe.outskirts){outskirts=await prepareOutskirts(g,t,material,recipe.outskirts,jungle?.scenicCrown,signal,recipe.composition?.deposition);if(signal.aborted){dispose();return;}}
    ground.material = material;
    try {
      patch = reliefPatch(ground, t, data.height, ids, floor.sample ? floor : null);
    } finally {
      ground.material = stock;
    }
    // Warm both materials before binding. On a cold launch this happens behind the
    // loading screen; a live settings change can still draw the previous material.
    if (renderer.compileAsync) {
      const warm = new T.Scene();
      for (const m of [stock, material]) warm.add(new T.Mesh(ground.geometry, m));
      await renderer.compileAsync(warm, g.camera, shaderScene(g.scene));
      if (signal.aborted) {
        dispose();
        return;
      }
      if (renderer.isWebGLRenderer) {
        const gl = renderer.getContext(),
          pg = renderer.properties.get(material).currentProgram;
        if (!pg || !gl.getProgramParameter(pg.program, gl.LINK_STATUS)) throw Error('Jungle material did not link');
      }
    }
    palette = stockPalette.slice();
    used.forEach((i, s) => {
      palette[i] = data.palette[ids[s]];
    });
    mean = [0, 0, 0];
    let count = 0;
    for (let y = 0; y < t.height; y++)
      for (let x = 0; x < t.width; x++) {
        const i=y*t.size+x,c=soilAt(i,t.layerIndex[i]);
        if (c) {
          for (let k = 0; k < 3; k++) mean[k] += c[k];
          count++;
        }
      }
    mean = mean.map(c => c / Math.max(count, 1));
    Object.assign(status, {
      slots: used.length,
      replaced: ids.filter(i => i >= 0).length,
      width: data.maps[0].image.width,
      job:recipe.job,
      outskirts:outskirts?.receipt,
      grove: jungle?.groveStats,
      canopy: jungle?.stats
    });
  }
  signal.addEventListener('abort', dispose, { once: true });
  return landscapeBinding({
    status, signal, load, discard: dispose,
    enabled: () => !!gfx[recipe.option],
    update(g, on) {
      swap(on);
      patch.update(g.view, on);
      jungle?.update(on, patch);
      status.reliefTriangles = patch.triangles;
      status.reliefRange = patch.triangles ? patch.heightRange : 0;
    }
  });
}
