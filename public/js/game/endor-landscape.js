import * as T from 'three';
import { gfx } from '../gfx.js';
import { fetchBinary } from '../vfs.js';
import { groundHashes } from '../endor-stock-ground.js';
import { plantHashes } from '../endor-stock-plants.js';
import { mapSourceDigest } from '../ted.js';
import { edition } from '../edition.js';
import { reviewedEndor } from '../forestfloor.js';
import { parseDDS } from '../dds.js';
import { decodeDXT } from '../ddsdecode.js';
import { digest } from '../texture-showcase/recipes.js';
import { soilGrid } from './groundday.js';
import { MOSS,DUFF,BED,forestFloorLayout,drawFloorSlots } from './endor-habitat.js';
import { reliefPatch } from './endor-relief.js';
import { landscapeBinding } from './landscape-binding.js';

// Chosen from the mounted tiles themselves, not a generic filename heuristic.
export const families = ['grass', 'moss', 'litter', 'soil', 'mud', 'rock', 'sand', 'concrete'];
const classes = {
  W_TEMPGRND08: 'grass',
  W_FOREST_GRASS00: 'grass',
  W_TEMPGRND10: 'grass',
  W_GRNDMOSS00: 'moss',
  W_GRNDMOSS02: 'moss',
  W_DIRTROCK00: 'moss',
  W_DIRT00: 'soil',
  W_SMOOTHDIRT00: 'soil',
  W_FOREST_DIRT01: 'litter',
  W_MUD00: 'mud',
  W_ENDRROCK01: 'rock',
  W_TEMPROCKGRN02: 'rock',
  W_TEMPERATE_SAND00: 'sand',
  W_CONCRETE01: 'concrete'
};
export function groundFamily(l) {
  return families.indexOf(classes[(l.texture || '').toUpperCase().replace(/\.(DDS|TGA)$/, '')]);
}
const amplitude = [1.3, 1.6, 1.6, 1.8, 1.1, 4.2, 0.85, 0.36];
const dir = new URL('../../art/endor-terrain/', import.meta.url);
export async function readPack(first, signal, selection=null) {
  const [natural, paving] = await Promise.all(
    ['materials.json', 'paving.json'].map(async file => {
      const res = await fetch(new URL(file, dir), { signal });
      if (!res.ok) throw Error('Missing Endor material index');
      return res.json();
    })
  );
  const library = [...natural, paving];
  if (library.length !== families.length || library.some((r, i) => r.id !== families[i] || !(r.tileMeters > 0)))
    throw Error('Incomplete Endor material set');
  const packs=new Map([['endor-terrain',library]]),dirs=new Map([['endor-terrain',dir]]);
  for(const name of new Set(selection?.map(r=>r.pack||'endor-terrain'))){
    if(packs.has(name))continue;
    if(!['yavin-jungle','yavin-ground','tatooine-ground','hoth-ground','geonosis-ground','naboo-ground','utapau-ground'].includes(name))throw Error('Unreviewed terrain pack');
    const url=new URL('../'+name+'/',dir),res=await fetch(new URL('materials.json',url),{signal});
    if(!res.ok)throw Error('Missing material index: '+name);packs.set(name,await res.json());dirs.set(name,url);
  }
  const rows=selection?selection.map(pin=>{const r=packs.get(pin.pack||'endor-terrain').find(r=>r.id===pin.id);if(!r||['asset','role','pack','colorHash','surfaceHash','tileMeters'].some(k=>r[k]!==pin[k]))throw Error('Changed donor '+pin.id);return {...r,regular:pin.regular};}):library;
  const height = [],
    palette = [], scanMean = [],
    chains = [[], []],
    width = 2048 >> first;
  const pages = (2048 >> first).toString(2).length;
  for (const dst of chains)
    for (let i = 0; i < pages; i++) {
      const w = width >> i;
      dst.push({ width: w, height: w, data: new Uint8Array(Math.max(1, w >> 2) ** 2 * 16 * rows.length) });
    }
  // At most two DDS inputs live alongside the output atlases. Every mip of every layer must authenticate before switching.
  for (const [i, row] of rows.entries())
    await Promise.all(
      ['color', 'surface'].map(async (kind, k) => {
        const r = await fetch(new URL(row.id + '-' + kind + '.dds', dirs.get(row.pack||'endor-terrain')), { signal });
        if (!r.ok) throw Error('Missing ' + row.id + ' ' + kind);
        const bytes = await r.arrayBuffer();
        if ((await digest(bytes)) !== row[kind + 'Hash']) throw Error('Changed ' + row.id + ' ' + kind);
        const d = parseDDS(bytes);
        if (d.width !== 2048 || d.height !== 2048 || d.mipmaps.length !== 12 || d.format !== T.RGBA_S3TC_DXT5_Format)
          throw Error('Incomplete 2K ' + row.id);
        d.mipmaps.slice(first).forEach((m, j) => chains[k][j].data.set(m.data, i * m.data.length));
        if (!k) {
          const m = d.mipmaps.find(x => x.width === 64),
            px = decodeDXT(m.data, 64, 64, 5),
            h = new Uint8Array(64 * 64);
          let mean = 0;
          // The overlap correction operates on sampled RGB, before lighting. A single
          // BC3 texel (the palette mip) is too quantized to centre the grain reliably.
          const rgb = new T.Vector3();
          for (let p = 0; p < h.length; p++) {
            mean += h[p] = px[p * 4 + 3];
            rgb.x += px[4*p]; rgb.y += px[4*p+1]; rgb.z += px[4*p+2];
          }
          scanMean[i] = rgb.multiplyScalar(1 / (255 * h.length));
          height[i] = { data: h, size: 64, mean: mean / (255 * h.length), amplitude: amplitude[families.indexOf(row.role||row.id)] };
          palette[i] = Array.from(decodeDXT(d.mipmaps.at(-1).data, 1, 1, 5).subarray(0, 3), c => c / 255);
        }
      })
    );
  const maps = chains.map(m => {
    const t = new T.CompressedArrayTexture(m, width, width, rows.length, T.RGBA_S3TC_DXT5_Format);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    t.colorSpace = T.NoColorSpace;
    t.needsUpdate = true;
    return t;
  });
  // Stones use the rock donor too. Share CPU mip backing with the array and cap the separate GPU material at 512.
  const rock=rows.findIndex(r=>r.id==='rock');
  const rockMaps=selection?[]:maps.map(tex=>{
    const mips=tex.mipmaps.filter(m=>m.width<=512).map(m=>{const stride=m.data.byteLength/rows.length;return {width:m.width,height:m.height,data:m.data.subarray(rock*stride,(rock+1)*stride)};});
    const m=new T.CompressedTexture(mips,mips[0].width,mips[0].height,T.RGBA_S3TC_DXT5_Format);m.wrapS=m.wrapT=T.RepeatWrapping;m.minFilter=T.LinearMipmapLinearFilter;m.magFilter=T.LinearFilter;m.needsUpdate=true;return m;
  });
  return {
    rows,
    maps, rockMaps,
    height,
    palette, scanMean,
    dispose() {
      for (const t of [...maps,...rockMaps]) t.dispose();
    }
  };
}
export function endorLandscape(ground, t, used, map, renderer, signal) {
  const u = ground.material.uniforms,
    stock = [u.map.value, u.bump.value], stockSpecular = u.matSpecular.value,
    stockSoil = ground.userData.soil,
    stockGrid = ground.userData.makeSoilGrid;
  const layers = used.map(i => groundFamily(t.layers[i])),
    params = used.map((_, k) => [u.texU.value[k].w, u.texV.value[k].w]);
  const specials=[[MOSS,1],[DUFF,2],[BED,4]],spare=specials.map(([s])=>[u.texU.value[s].clone(),u.texV.value[s].clone()]);
  let data,
    plants,
    grove,
    stands,
    rainField,
    patch,
    donorPalette, scanCentres,
    layoutRevision=-1,
    average,
    on = false;
  const status = (ground.userData.endorLandscape = {
    state: 'idle',
    active: false,
    slots: layers.length,
    assigned: layers.filter(i => i >= 0).length
  });
  function refreshLayout(){
    t.paint.floorLayout=on?forestFloorLayout(t,layers,stands.lightMap):null;
    status.floorHabitat=t.paint.floorLayout?.counts||null;
    drawFloorSlots(t);layoutRevision=t.paint.paintRevision||0;
  }
  function swap(desired) {
    if (desired === on) return;
    plants.set(desired);
    on = desired;
    status.active = on;
    [u.map.value, u.bump.value] = on ? data.maps : stock;
    // The scan shader uses measured roughness, not the stock specular tint. Reuse
    // those uniform slots for its RGB centres; restore the original array intact.
    if (on && !scanCentres) {
      scanCentres = stockSpecular.map((v,i) => data.scanMean[layers[i]] ?? v);
      for (const [slot,id] of specials) scanCentres[slot] = data.scanMean[id];
    }
    u.matSpecular.value = on ? scanCentres : stockSpecular;
    layers.forEach((idx, k) => {
      const L = t.layers[used[k]],
        p = on ? [idx, Math.max(0.55, Math.min(13, (L.tile || 215) / (10 * data.rows[idx].tileMeters)))] : params[k];
      u.texU.value[k].w = p[0];
      u.texV.value[k].w = p[1];
    });
    specials.forEach(([slot,id],i)=>{const U=u.texU.value[slot],V=u.texV.value[slot];if(on){const k=1/(data.rows[id].tileMeters*10);U.set(k,0,0,id);V.set(0,k,0,1);}else{U.copy(spare[i][0]);V.copy(spare[i][1]);}});
    refreshLayout();
    // 1 is the diagnostic linear-blend control, 2 the shipped height-aware blend.
    u.fullTerrain.value = on ? 2 : 0;
    u.canopyMap.value = on ? stands.lightMap : null;
    if (t.paint.soilGrid) {
      t.paint.soilGrid.tex.dispose();
      t.paint.soilGrid = null;
    }
    ground.userData.soil = on ? average : stockSoil;
    ground.userData.makeSoilGrid = on ? () => soilGrid(t, donorPalette, average, 20, stands.lightMap,(i,raw)=>data.palette[u.texU.value[t.paint.floorLayout.slotAt(i,t.paint.slot.get(raw)??0)].w]) : stockGrid;
  }
  async function load(g) {
    if(layers.length>MOSS)throw Error('No draw slots available for forest floor');
    if (layers.includes(-1)) throw Error('An unreviewed painted layer is present');
    if (!reviewedEndor(edition(), await mapSourceDigest(map))) throw Error('Not the reviewed stock Endor map');
    const cap = renderer?.capabilities?.maxTextureSize,
      bc = renderer?.device?.features.has('texture-compression-bc') || renderer?.extensions?.has('WEBGL_compressed_texture_s3tc');
    if (!bc || !cap) throw Error('This renderer cannot upload BC3 texture arrays');
    let first = Math.max(0, Math.min(2, gfx.texMip | 0));
    while (2048 >> first > cap && first < 11) first++;
    // Check the effective files used by loadDDS, including FoC's extensionless layer aliases.
    // Identity checks read bytes on opt-in; none of those bytes feed the replacement shader.
    const names = new Set(
      used
        .flatMap(i => [t.layers[i].texture, t.layers[i].bump])
        .filter(Boolean)
        .map(n => n.toUpperCase())
    );
    await Promise.all(
      [...names].map(async name => {
        const base = name.replace(/\.(TGA|DDS)$/, ''),
          file = base === name ? name + '.DDS' : name;
        const src = await fetchBinary('Data/Art/Textures/' + file);
        if (!groundHashes[base] || !src || (await digest(src)) !== groundHashes[base]) throw Error('Unreviewed ground file: ' + file);
      })
    );
    await Promise.all(
      Object.entries(plantHashes[edition()]).map(async ([file, hash]) => {
        const bytes = await fetchBinary('Data/Art/' + file, { keep: false });
        if (!bytes || (await digest(bytes)) !== hash) throw Error('Unreviewed vegetation: ' + file);
      })
    );
    if (signal.aborted) return;
    data = await readPack(first, signal);
    if (signal.aborted) {
      data.dispose();
      return;
    }
    const { prepareEndorPlants } = await import('./endor-plants.js');
    plants = await prepareEndorPlants(g);
    if (!plants.stats?.ok || plants.stats.unmatched || plants.stats.replaced !== plants.stats.targets)
      throw Error(plants.stats?.reason || 'Incomplete tree library');
    const { prepareGrove } = await import('./endor-grove.js');
    grove = await prepareGrove(g, t.layers.map(groundFamily), signal, first);
    const { thicket } = await import('./endor-thicket.js');
    stands = await thicket(g, t.layers.map(groundFamily), plants, signal, first,data.rockMaps);
    // Only the verified replacement materials consume this field. It is a per-material
    // sampler, not a change to the lighting or textures of the mounted models.
    for (const m of [...plants.materials, ...grove.materials, ...stands.materials]) {
      m.uniforms.glossMap = { value: stands.lightMap };
      m.defines.ENDOR_WOODLAND = 1;
      m.needsUpdate = true;
    }
    if (signal.aborted) {
      stands.dispose();
      grove.dispose();
      plants.dispose();
      data.dispose();
      return;
    }
    donorPalette = [];
    layers.forEach((i, k) => {
      donorPalette[used[k]] = data.palette[i];
    });
    average = [0, 0, 0];
    let count = 0;
    for (const i of t.layerIndex) {
      const rgb = donorPalette[i];
      if (rgb) {
        count++;
        for (let c = 0; c < 3; c++) average[c] += rgb[c];
      }
    }
    average = average.map(x => x / Math.max(1, count));
    const {throughfall}=await import('./endor-throughfall.js');
    if(signal.aborted)return;
    rainField=throughfall(g.scene);
    patch = reliefPatch(ground, t, data.height);
    status.width = data.maps[0].image.width;
    status.foliage = plants.stats;
    status.grove = grove.stats;
    status.stands = stands.stats;
  }
  function dispose() {
    rainField?.dispose();
    patch?.dispose();
    stands?.dispose();
    grove?.dispose();
    plants?.dispose();
    data?.dispose();
  }
  signal.addEventListener('abort', dispose, { once: true });
  return landscapeBinding({
    status, signal, load, discard: dispose,
    enabled: () => gfx.endorLandscape === true,
    warning: 'Endor full landscape: using original scenery.',
    changed: () => window.dispatchEvent(new Event('endor-landscape-status')),
    update(g, desired) {
      stands.update(desired); // First: live paving can change the habitat around the new footprint.
      swap(desired);
      if(on && layoutRevision!==(t.paint.paintRevision||0)){refreshLayout();t.paint.soilGrid?.refreshCover?.();}
      if (on) {
        plants.update?.();
      }
      patch.update(g.view, on);
      grove.update(on, patch,stands.lightMap);
      rainField.update(g,on && gfx.endorWeather!==false,gfx.particle);
      status.reliefTriangles = patch.triangles;
      status.heightRange = patch.heightRange;
    }
  });
}
