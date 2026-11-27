import * as THREE from 'three';
import { fetchBinary } from '../vfs.js';
import { parseDDS } from '../dds.js';
import { mapSourceDigest } from '../ted.js';
import { digest } from '../texture-showcase/recipes.js';
import { gfx } from '../gfx.js';
import { edition } from '../edition.js';
import { reviewedForest, soilMip } from '../forestfloor.js';
import { soilMaps } from '../soilmap-manifest.js';

// Dedicated ordinary 2D samplers, not 512px array slices. Don't allocate the rest of a 4K terrain atlas.
export function endorFloor(map, layer, slot, uniforms, renderer, signal) {
  const maxSize = renderer?.capabilities?.maxTextureSize;
  const bc = renderer?.device?.features.has('texture-compression-bc') || renderer?.extensions?.has('WEBGL_compressed_texture_s3tc');
  if (!maxSize || !bc || !signal) return null;
  let state = 'idle';
  async function texture(file, hash, first) {
    const res = await fetch(new URL('../../art/forest-ground-04/' + file, import.meta.url), { signal });
    if (!res.ok) throw Error('Missing ' + file);
    const bytes = await res.arrayBuffer();
    if ((await digest(bytes)) !== hash) throw Error('Changed ' + file);
    const d = parseDDS(bytes);
    if (d.width !== 4096 || d.height !== 4096 || d.format !== THREE.RGBA_S3TC_DXT5_Format || d.mipmaps.length !== 13)
      throw Error('Invalid 4K BC3 mip chain');
    const mips = d.mipmaps.slice(first);
    // Don't keep a full-size backing buffer for a lower-resolution selection.
    if (first) for (const m of mips) m.data = m.data.slice();
    const tex = new THREE.CompressedTexture(mips, mips[0].width, mips[0].height, d.format);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  async function load() {
    const [mapHash, ...hashes] = await Promise.all([
      mapSourceDigest(map),
      ...[layer.texture, layer.bump].map(async name => {
        const bytes = await fetchBinary('Data/Art/Textures/' + name);
        return bytes && digest(bytes);
      })
    ]);
    if (!reviewedForest(edition(), mapHash, hashes) || signal.aborted) return false;
    const first = soilMip(gfx.texMip, maxSize);
    const maps = await Promise.all(soilMaps.map(([file, hash]) => texture(file, hash, first)));
    if (signal.aborted) {
      for (const tex of maps) tex.dispose();
      return false;
    }
    [uniforms.soilColor.value, uniforms.soilSurface.value] = maps;
    return true;
  }
  signal.addEventListener(
    'abort',
    () => {
      uniforms.forestSlot.value = 0;
      for (const u of [uniforms.soilColor, uniforms.soilSurface]) {
        u.value?.dispose();
        u.value = null;
      }
    },
    { once: true }
  );
  return on => {
    if (on && state === 'idle') {
      state = 'loading';
      load()
        .then(ok => {
          state = ok ? 'ready' : 'unmatched';
        })
        .catch(e => {
          state = 'unavailable';
          if (!signal.aborted) console.warn('Endor scanned earth: using original dirt.', e.message);
        });
    }
    uniforms.forestSlot.value = on && state === 'ready' && !signal.aborted ? slot + 1 : 0;
  };
}
