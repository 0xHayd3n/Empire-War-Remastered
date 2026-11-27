import * as THREE from 'three';
import {dayWater} from '../daywater.js';
import {orbitShader} from '../orbitcolor.js';
import { groundFillShader, nearGroundShader, terrainSurfaceShader } from '../landlight.js';
import { airShader, footprintShader, lowland } from '../battlefield.js';
import { wetSurface, wetLayerShader } from '../groundrain.js';
import { waterShader } from '../fieldreceivers.js';
import { soilColor, soilGrid } from './groundday.js';
import { profile } from '../texture-showcase/store.js';
import { forestAir, showerSky, ringShader } from '../endor-weather.js';
import { woodFunctions, woodGround, woodMist } from '../woodland-light.js';
import { forestSlot, forestShader, scanSamplers } from '../forestfloor.js';
import { liquidGeometry, slideShader } from './liquid-sheet.js';
import { BANK_HEIGHT } from './endor-habitat.js';
import { landscapeBlend, applyLandscapeBlend } from './endor-blend.js';
import { endorFloor } from './endorfloor.js';
import { endorLandscape } from './endor-landscape.js';
import { reviewedLandscape } from './reviewed-landscape.js';
import { yavinRecipe } from '../yavin-recipe.js';
import { tatooineRecipe } from '../tatooine-recipe.js';
import { hothRecipe } from '../hoth-recipe.js';
import { geonosisRecipe } from '../geonosis-recipe.js';
import { nabooRecipe } from '../naboo-recipe.js';
import { utapauRecipe } from '../utapau-recipe.js';
import { edition } from '../edition.js';
import { lighting } from '../model.js';
import { gfx } from '../gfx.js';
import { battlePrefs } from '../battlerealism.js';
import { cubicShader } from '../imagesampling.js';
import { strength } from '../battlelook.js';
import { loadDDS, loadTexture } from '../dds.js';

import { compositionShader } from './ground-composition.js';
import { CELL, reliefCutVertex, scorchedSoil } from './terrain-cell.js';
import { enableTerrainCulling } from './terrain-visibility.js';
export { CELL };
const TILE = 512;
const SLOTS = 64;

const VERT = `
  in vec4 layers; in vec2 corner; in float shade;
  uniform vec4 reliefPatch;
  out vec2 vCorner; out vec3 vNormal; out vec3 vWorld; out float vShade; flat out vec4 vLayers;
  void main() {
    vCorner = corner; vLayers = layers; vShade = shade;
    vNormal = normal; vWorld = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${reliefCutVertex(false)}
  }`;

const terrainFragment = mixed => `
  precision highp sampler2DArray;
  uniform sampler2DArray map, bump;
  uniform ${mixed?'sampler2DArray':'sampler2D'} soilColor, soilSurface;
  uniform vec4 texU[${SLOTS}], texV[${SLOTS}];
  uniform vec3 matDiffuse[${SLOTS}], matSpecular[${SLOTS}];
  uniform sampler2D fog, clouds; uniform float side, detail, terrainLayers, groundWet, waterLine; uniform vec3 cloudAt;
  uniform vec4 glowAt[8], glowTint[8], occAt[16];
  uniform vec3 sunDir, sunColor, fillDir, fillColor, fillDir2, fillColor2, ambient, fogTint; uniform vec2 fogRange;
  uniform highp sampler2DShadow shadowMap; uniform mat4 shadowMatrix; uniform float shadowOn, shadowTexel;
  uniform mat3 orbitPos,orbitNeg; uniform float landProbeOn; uniform vec3 wideShadow; uniform vec4 forestWeather;
  uniform vec4 landGround,receiverMap; uniform mat4 hullShadowMatrix; uniform vec3 hullShadowParams; uniform highp sampler2DShadow hullShadowMap;
  ${orbitShader('glsl')}
  ${groundFillShader(false)}
  uniform float forestSlot, fullTerrain, terrainContactMask;
  bool remasteredReceiver(){ return ${mixed?'true':'fullTerrain>.5'}; }
  float sunlit(vec3 wp,vec3 normal) {
    if (shadowOn < 0.5) return 1.0;
    vec3 p = (shadowMatrix * vec4(wp+(wideShadow.x>0.0?normal*.48*wideShadow.x:vec3(0.,0.,1.5)),1.0)).xyz;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float d = p.z - (wideShadow.x>0.0?.44*wideShadow.y:.0015), o = shadowTexel * 1.3, s = texture(shadowMap, vec3(p.xy, d));
    s += texture(shadowMap, vec3(p.xy + vec2(-o, -o), d)) + texture(shadowMap, vec3(p.xy + vec2(o, -o), d)) + texture(shadowMap, vec3(p.xy + vec2(-o, o), d)) + texture(shadowMap, vec3(p.xy + vec2(o, o), d));
    vec2 e = min(p.xy, 1.0 - p.xy);
    return mix(1.0, (landGround.w>0.0 || remasteredReceiver()) ? s/5.0 : mix(0.5, 1.0, s / 5.0), smoothstep(0.0, 0.05, min(e.x, e.y)));
  }
  ${nearGroundShader(false, true)}
  in vec2 vCorner; in vec3 vNormal; in vec3 vWorld; in float vShade; flat in vec4 vLayers;
  out vec4 outColor;
  vec3 n, toEye, dPx, dPy, soft, direct, terrainSky;
  ${terrainSurfaceShader(false)}
  float nearK;
  uniform sampler2D canopyMap;
  uniform vec4 landStyle;
  ${woodFunctions(false)}
  ${scanSamplers(false,mixed)}
  ${landscapeBlend(false,mixed)}
  uniform float textureCubic;
  ${cubicShader('glsl', true)}
  uniform vec4 fieldLook;
  ${airShader(false)}
  ${footprintShader(false)}
  vec3 layer(float slot) {
    int i = int(slot + 0.5);
    vec3 U = texU[i].xyz, V = texV[i].xyz;
    vec3 at = vec3(dot(U, vWorld), dot(V, vWorld), slot);
    vec2 gx = vec2(dot(U, dPx), dot(V, dPx)), gy = vec2(dot(U, dPy), dot(V, dPy));
    ${forestShader(false,mixed)}
    if(fieldLook.z>0.0){float k=detailWidth(gx,gy,vec2(textureSize(map,0).xy));gx*=k;gy*=k;}
    vec4 t = textureGrad(map, at, gx, gy);
    if (textureCubic > 0.0) {
      vec2 size = vec2(textureSize(map,0).xy);
      float span = max(length(gx*size),length(gy*size));
      if (span < 1.0) t.rgb=mix(t.rgb,cubicRGB(at.xy,size,slot),1.0-smoothstep(0.55,1.0,span));
    }
    vec3 b = textureGrad(bump, at, gx, gy).xyz * 2.0 - 1.0;
    const vec3 Y = vec3(0.299, 0.587, 0.114);
    float mean = 0.0;
    if (terrainLayers > 0.0 || nearK > 0.0) mean = dot(textureLod(map,at,9.0).rgb,Y);
    if (terrainLayers > 0.0) {
      // Broad variation from this layer's own atlas slice; keep paths, alpha and paint boundaries in place.
      vec2 macro = at.xy * 0.29 + vec2(0.37,0.71);
      float field = dot(textureGrad(map,vec3(macro,slot),gx*0.29,gy*0.29).rgb,Y);
      t.rgb *= mix(1.0,clamp((field+0.06)/(mean+0.06),0.57,1.48),terrainLayers*0.77);
    }
    if (nearK > 0.0) {
      vec3 fine = vec3(at.xy * 7.0, slot);
      vec3 tf = textureGrad(map, fine, gx * 7.0, gy * 7.0).rgb;
      t.rgb *= mix(1.0, clamp(dot(tf, Y) / max(mean, 0.04), 0.55, 1.6), nearK);
      vec3 bd = textureGrad(bump, fine, gx * 7.0, gy * 7.0).xyz * 2.0 - 1.0;
      b = normalize(b + vec3(bd.xy, 0.0) * nearK * 0.8);
    }
    mat3 frame = terrainFrame(n,U,V);
    vec3 sn = normalize(frame*vec3(b.xy,max(.01,b.z)));
    float shine = clamp(dot(sn, normalize(toEye+sunDir)), 0.0, 1.0); shine *= shine; shine *= shine; shine *= shine; shine *= shine;
    vec3 paint=landProbeOn>0.0?orbitDecode(t.rgb):t.rgb;
    vec3 result=paint * (direct * clamp(dot(sn, sunDir), 0.0, 1.0) + terrainFill(sn)) * matDiffuse[i] + t.a * shine * 0.5 * direct * matSpecular[i];
    ${wetLayerShader(false)}
    return ${mixed?'landProbeOn>0.0?max(result,vec3(0.)):orbitDecode(max(result,vec3(0.)))':'landProbeOn>0.0?orbitEncode(max(result,vec3(0.0))):result'};
  }
  ${mixed?'uniform vec4 groundMixA,groundMixB;'+compositionShader(false):''}
  void main() {
    n = normalize(vNormal); toEye = normalize(cameraPosition - vWorld);
    dPx = dFdx(vWorld); dPy = dFdy(vWorld);
    float dist = distance(cameraPosition,vWorld);
    nearK = max(detail * (1.0 - smoothstep(25.0,260.0,dist)),terrainLayers * 0.85 * (1.0 - smoothstep(160.0,1200.0,dist)));
    soft = ambient + fillColor * max(dot(n, fillDir), 0.0) + fillColor2 * max(dot(n, fillDir2), 0.0);
    float vis=groundSun(vWorld,n); vec3 cl=texture(clouds,(vWorld.xy+cloudAt.xy)/cloudAt.z).rgb;
    direct=sunColor;
    terrainSky=vec3(1.);
    if(landGround.w>0.0 || remasteredReceiver()){direct*=cl*vis;}else if(receiverMap.z>0.0)direct*=cl;
    ${woodGround(false)}
    // Baked darkness is local sky shelter, not a black overlay on sun, fog, waterbed or emitters.
    float shelter=fullTerrain>.5?1.:mix(.55,1.,clamp(vShade,0.,1.));terrainSky*=shelter;soft*=shelter;
    ${mixed?'vec4 keep=1.-step(vec4(2.),vec4(texU[int(vLayers.x)].w,texU[int(vLayers.y)].w,texU[int(vLayers.z)].w,texU[int(vLayers.w)].w));':''}
    vec3 c;
    float bank=fullTerrain>.5 ? 1.-smoothstep(0.,${BANK_HEIGHT},vWorld.z-waterLine) : 0.;
#ifdef GROUND_COMPOSITION
    c=composed(vLayers,vCorner);
#else
    if(bank>=1.)c=layer(63.);
    else if (vLayers.x == vLayers.y && vLayers.x == vLayers.z && vLayers.x == vLayers.w) c = layer(vLayers.x);
    else {
      vec4 w = vec4((1.0 - vCorner.x) * (1.0 - vCorner.y), vCorner.x * (1.0 - vCorner.y), (1.0 - vCorner.x) * vCorner.y, vCorner.x * vCorner.y);
      ${mixed?'w=mix(w,forestWeights(vCorner),1.-dot(w,keep));':'if(fullTerrain>1.5) w=forestWeights(vCorner);'}
      if (vLayers.y == vLayers.x) { w.x += w.y; w.y = 0.0; }
      if (vLayers.z == vLayers.x) { w.x += w.z; w.z = 0.0; } else if (vLayers.z == vLayers.y) { w.y += w.z; w.z = 0.0; }
      if (vLayers.w == vLayers.x) { w.x += w.w; w.w = 0.0; } else if (vLayers.w == vLayers.y) { w.y += w.w; w.w = 0.0; } else if (vLayers.w == vLayers.z) { w.z += w.w; w.w = 0.0; }
      ${applyLandscapeBlend(false,mixed)}
      c = vec3(0.0);
      if (w.x > 0.) c += layer(vLayers.x) * w.x;
      if (w.y > 0.) c += layer(vLayers.y) * w.y;
      if (w.z > 0.) c += layer(vLayers.z) * w.z;
      if (w.w > 0.) c += layer(vLayers.w) * w.w;
    }
    if(bank>0. && bank<1.)c=mix(c,layer(63.),bank);
#endif
    ${mixed?'c=orbitEncode(c);':'if(fullTerrain>.5)c=orbitEncode(c);'}
    if(landGround.w<0.5 && !remasteredReceiver()){if(receiverMap.z>0.0)c*=vis;else c*=cl*vis;}
    ${scorchedSoil(false)}
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      vec4 G = glowAt[i];
      if (G.w <= 0.0) continue;
      float d = distance(vWorld, G.xyz) / G.w;
      if (d < 1.0) glow += glowTint[i].rgb * glowTint[i].a * (1.0 - d) * (1.0 - d);
    }
    float occ = 1.0;
    for (int i = 0; i < 16; i++) {
      vec4 O = occAt[i];
      if (O.z <= 0.0) continue;
      float d = distance(vWorld.xy, O.xy) / O.z;
      if (d < 1.0) occ *= 1.0 - O.w * (1.0 - d) * (1.0 - d);
    }
    c = c * occ + glow * (vec3(0.35) + c);
    if(fullTerrain>.5){${woodMist(false,'c','vWorld')}${forestAir(false,false,'vWorld','c')}}
    if(fieldLook.x>0.0)c=mix(c,fogTint,airDepth(vWorld));
    float seen = texture(fog, vWorld.xy / side).r;
    float clear = fogRange.y > 0.0 ? clamp((fogRange.y - distance(cameraPosition, vWorld)) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0) : 1.0;
    outColor = vec4(mix(fogTint, c * mix(0.3, 1.0, seen), clear), 1.0-terrainContactMask);
  }`;

function texturePlanes(L) {
  const k = 1 / (L.tile > 0 ? L.tile : 215),
    s = Math.sin(L.tilt || 0),
    c = Math.cos(L.tilt || 0),
    S = Math.sin(L.turn || 0),
    C = Math.cos(L.turn || 0);
  return [
    [k * C, -k * S, 0, 0],
    [k * c * S, k * c * C, -k * s, 0]
  ];
}

const BLOCK = 16;
const blocksOf = w => Math.max(1, w >> 2) ** 2;
function flatBlocks(w, [r, g, b, a]) {
  const out = new Uint8Array(blocksOf(w) * BLOCK),
    c = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  for (let o = 0; o < out.length; o += BLOCK) {
    out[o] = out[o + 1] = a;
    out[o + 8] = out[o + 10] = c & 255;
    out[o + 9] = out[o + 11] = c >> 8;
  }
  return out;
}
function dxt1To5(src) {
  const n = src.length / 8,
    out = new Uint8Array(n * BLOCK);
  for (let i = 0; i < n; i++) {
    out[i * BLOCK] = out[i * BLOCK + 1] = 255;
    out.set(src.subarray(i * 8, i * 8 + 8), i * BLOCK + 8);
  }
  return out;
}
function doubled(src, w) {
  const ob = Math.max(1, w >> 2),
    W = w * 2,
    nb = Math.max(1, W >> 2),
    out = new Uint8Array(nb * nb * BLOCK);
  const ai = new Uint8Array(16),
    ci = new Uint8Array(16);
  for (let by = 0; by < nb; by++)
    for (let bx = 0; bx < nb; bx++) {
      const from = (Math.min(ob - 1, by >> 1) * ob + Math.min(ob - 1, bx >> 1)) * BLOCK,
        to = (by * nb + bx) * BLOCK;
      let bits = 0,
        have = 0,
        p = from + 2;
      for (let i = 0; i < 16; i++) {
        while (have < 3) {
          bits |= src[p++] << have;
          have += 8;
        }
        ai[i] = bits & 7;
        bits >>= 3;
        have -= 3;
      }
      for (let i = 0; i < 16; i++) ci[i] = (src[from + 12 + (i >> 2)] >> ((i & 3) * 2)) & 3;
      out[to] = src[from];
      out[to + 1] = src[from + 1];
      for (let k = 8; k < 12; k++) out[to + k] = src[from + k];
      const ox = W >= 8 ? (bx & 1) * 2 : 0,
        oy = W >= 8 ? (by & 1) * 2 : 0;
      bits = 0;
      have = 0;
      p = to + 2;
      for (let i = 0; i < 16; i++) {
        const j = (oy + ((i >> 2) >> 1)) * 4 + ox + ((i & 3) >> 1);
        bits |= ai[j] << have;
        have += 3;
        while (have >= 8) {
          out[p++] = bits & 255;
          bits >>= 8;
          have -= 8;
        }
        out[to + 12 + (i >> 2)] |= ci[j] << ((i & 3) * 2);
      }
    }
  return out;
}
function layerChain(dds, flat) {
  const levels = Math.log2(TILE) + 1;
  let chain = null,
    w = 0;
  const dxt1 = dds && dds.format === THREE.RGBA_S3TC_DXT1_Format,
    dxt5 = dds && dds.format === THREE.RGBA_S3TC_DXT5_Format;
  if (dds && dds.compressed && dds.width === dds.height && (dds.width & (dds.width - 1)) === 0 && (dxt1 || dxt5)) {
    chain = dds.mipmaps.map(m => (dxt1 ? dxt1To5(m.data) : m.data));
    w = dds.width;
    while (w > TILE && chain.length > 1) {
      chain.shift();
      w >>= 1;
    }
    while (w < TILE) {
      chain.unshift(doubled(chain[0], w));
      w *= 2;
    }
    if (w !== TILE) chain = null;
  }
  if (!chain) return Array.from({ length: levels }, (_, k) => flatBlocks(TILE >> k, flat));
  for (let k = chain.length; k < levels; k++) chain.push(flatBlocks(TILE >> k, flat));
  return chain.slice(0, levels).map((d, k) => (d.length === blocksOf(TILE >> k) * BLOCK ? d : flatBlocks(TILE >> k, flat)));
}
function arrayTexture(chains) {
  const depth = Math.max(1, chains.length),
    mips = [];
  for (let k = 0; k <= Math.log2(TILE); k++) {
    const w = Math.max(1, TILE >> k),
      each = blocksOf(w) * BLOCK,
      data = new Uint8Array(each * depth);
    chains.forEach((c, i) => data.set(c[k], i * each));
    mips.push({ data, width: w, height: w });
  }
  const tex = new THREE.CompressedArrayTexture(mips, TILE, TILE, depth, THREE.RGBA_S3TC_DXT5_Format);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function heightAt(t, x, y, renderedTriangles = false, surface = t.craterSurface) {
  const n = t.size,
    gx = Math.min((t.width ?? n) - 1.001, Math.max(0, x / CELL)),
    gy = Math.min((t.height ?? n) - 1.001, Math.max(0, y / CELL));
  const ix = gx | 0,
    iy = gy | 0,
    fx = gx - ix,
    fy = gy - iy,
    h = t.heights;
  const a = h[iy * n + ix],
    b = h[iy * n + ix + 1],
    c = h[(iy + 1) * n + ix],
    d = h[(iy + 1) * n + ix + 1];
  // Only new solo battles install a gameplay surface. Resolve building pads
  // AFTER the soil so a hit below a raised platform never lowers its top.
  const offset = surface?.offsetAt(x,y) || 0;
  const v = (renderedTriangles || offset !== 0 ? (fx >= fy ? a + fx*(b-a) + fy*(d-b) : a + fy*(c-a) + fx*(d-c))
    : (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) + offset,
    L = t.padTop;
  if (L && x >= 0 && y >= 0) {
    const i = (x / L.cell) | 0,
      j = (y / L.cell) | 0;
    if (i < L.w && j < L.w) {
      const top = L.a[j * L.w + i];
      if (top > v) return top;
    }
  }
  return v;
}

export function fogTexture(t) {
  if (t.fog) return t.fog;
  const m = Math.ceil(t.size / 2),
    data = new Uint8Array(m * m).fill(255);
  const tex = new THREE.DataTexture(data, m, m, THREE.RedFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  t.fog = tex;
  t.fogSeen = new Uint8Array(m * m);
  return tex;
}
export function paintFog(t, eyes, remember = true, dt = 0, regrow = 6) {
  const tex = fogTexture(t),
    d = tex.image.data,
    m = tex.image.width,
    seen = t.fogSeen,
    cell = CELL * 2;
  const light = (t.fogLight ||= new Float32Array(d.length));
  if (!eyes) {
    d.fill(255);
    light.fill(1);
    if (remember) seen.fill(1);
    tex.needsUpdate = true;
    return;
  }
  const fall = regrow > 0 ? dt / regrow : 1;
  for (let i = 0; i < light.length; i++) if (light[i] > 0) light[i] = Math.max(0, light[i] - fall);
  for (const [x, y, r] of eyes) {
    const cx = x / cell,
      cy = y / cell,
      cr = r / cell,
      r2 = cr * cr;
    for (let j = Math.max(0, Math.floor(cy - cr)); j <= Math.min(m - 1, Math.ceil(cy + cr)); j++)
      for (let i = Math.max(0, Math.floor(cx - cr)); i <= Math.min(m - 1, Math.ceil(cx + cr)); i++)
        if ((i - cx) ** 2 + (j - cy) ** 2 <= r2) {
          light[j * m + i] = 1;
          seen[j * m + i] = 1;
        }
  }
  for (let i = 0; i < d.length; i++) d[i] = seen[i] ? 150 + Math.round(105 * light[i]) : 0;
  tex.needsUpdate = true;
}

function quadLayers(t, slot, quad) {
  const any = quad.find(i => slot.has(t.layerIndex[i]));
  return quad.map(i => {const j=slot.has(t.layerIndex[i])?i:any,raw=slot.get(t.layerIndex[j])??0;return t.paint?.floorLayout && j!==undefined?t.paint.floorLayout.slotAt(j,raw):raw;});
}

// Shared by the renderer and the installed-map geometry qualification pass.
// Keep the actual cell topology, including omitted TED holes, in one place.
export function terrainGeometry(t) {
  const n = t.size, width = t.width ?? n, height = t.height ?? n,
    h = t.heights;
  const normals = new Float32Array(n * n * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const l = h[y * n + Math.max(0, x - 1)],
        r = h[y * n + Math.min(width - 1, x + 1)],
        d = h[Math.max(0, y - 1) * n + x],
        u = h[Math.min(height - 1, y + 1) * n + x];
      // On the perimeter the clamped samples are only one cell apart.
      const nx = (l - r) / (CELL * (x > 0 && x < width - 1 ? 2 : 1)),
        ny = (d - u) / (CELL * (y > 0 && y < height - 1 ? 2 : 1)),
        len = Math.hypot(nx, ny, 1),
        o = (y * n + x) * 3;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = 1 / len;
    }
  const used = [...new Set([...t.layerIndex, ...(t.extraLayers || [])])]
    .filter(i => t.layers[i] && t.layers[i].texture)
    .sort((a, b) => a - b);
  const bare = i => !!t.layers[t.layerIndex[i]]?.hole;
  const slot = new Map(used.map((i, k) => [i, k]));
  const tris = (width - 1) * (height - 1) * 2;
  const pos = new Float32Array(tris * 9),
    nor = new Float32Array(tris * 9),
    lay = new Float32Array(tris * 12),
    cor = new Float32Array(tris * 6),
    sh = new Float32Array(tris * 3);
  let v = 0;
  const triAt = new Int32Array(tris).fill(-1);
  const put = (ids, quad) => {
    const L = quadLayers(t, slot, quad),
      x0 = quad[0] % n,
      y0 = (quad[0] / n) | 0;
    ids.forEach(i => {
      const x = i % n,
        y = (i / n) | 0,
        o = v * 3;
      pos[o] = x * CELL;
      pos[o + 1] = y * CELL;
      pos[o + 2] = h[i];
      nor[o] = normals[i * 3];
      nor[o + 1] = normals[i * 3 + 1];
      nor[o + 2] = normals[i * 3 + 2];
      lay.set(L, v * 4);
      cor[v * 2] = x - x0;
      cor[v * 2 + 1] = y - y0;
      sh[v] = Math.min(1, t.shade[i] / 254);
      v++;
    });
  };
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const a = y * n + x,
        b = a + 1,
        c = a + n,
        d = c + 1;
      const q = (y * (width - 1) + x) * 2;
      if ([a, b, c, d].every(bare)) continue;
      triAt[q] = v;
      put([a, b, d], [a, b, c, d]);
      triAt[q + 1] = v;
      put([a, d, c], [a, b, c, d]);
    }
  const geo = new THREE.BufferGeometry();
  geo.setDrawRange(0, v);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('layers', new THREE.BufferAttribute(lay, 4));
  geo.setAttribute('corner', new THREE.BufferAttribute(cor, 2));
  geo.setAttribute('shade', new THREE.BufferAttribute(sh, 1));
  geo.computeBoundingSphere();
  return {geo, triAt, slot, used};
}

export async function buildTerrain(t, map, render, signal) {
  const {geo, triAt, slot, used} = terrainGeometry(t), n=t.size;
  const texU = [],
    texV = [],
    matDiffuse = [],
    matSpecular = [];
  for (let k = 0; k < SLOTS; k++) {
    const L = t.layers[used[k]] || {},
      [U, V] = texturePlanes(L);
    // UV planes use xyz; pack absorption and film response in the available w lanes.
    [U[3], V[3]] = wetSurface(L);
    texU.push(new THREE.Vector4(...U));
    texV.push(new THREE.Vector4(...V));
    matDiffuse.push(new THREE.Vector3(...(L.diffuse || [1, 1, 1])));
    matSpecular.push(new THREE.Vector3(...(L.specular || [1, 1, 1])));
  }
  const files = await Promise.all(
    used.map(i => Promise.all([loadDDS(t.layers[i].texture), t.layers[i].bump ? loadDDS(t.layers[i].bump) : null]))
  );
  const tex = arrayTexture(files.map(f => layerChain(f[0], [128, 128, 128, 0])));
  const bumpLayers = files.map(f => layerChain(f[1], [128, 128, 255, 255]));
  const soilSlot = forestSlot(profile, map?.file, used.map(i => t.layers[i]));
  const bump = arrayTexture(bumpLayers);
  const soil = { forestSlot: { value: 0 }, soilColor: { value: null }, soilSurface: { value: null } };
  const updateForest = soilSlot >= 0 && endorFloor(map, t.layers[used[soilSlot]], soilSlot, soil, render, signal);
  const C = t.clouds || {},
    cloudAt = new THREE.Vector3(0, 0, C.tile > 0 ? C.tile : 500);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: terrainFragment(false),
    uniforms: {
      map: { value: tex },
      bump: { value: bump },
      ...soil,
      fullTerrain: {value:0}, terrainContactMask: {value:0}, landStyle:lighting.landStyle, forestWeather:lighting.forestWeather, canopyMap:{value:null}, reliefPatch:{value:new THREE.Vector4()},
      texU: { value: texU },
      texV: { value: texV },
      matDiffuse: { value: matDiffuse },
      matSpecular: { value: matSpecular },
      clouds: { value: loadTexture(C.texture || '') },
      cloudAt: { value: cloudAt },
      fog: { value: fogTexture(t) },
      side: { value: (n - 1) * CELL },
      detail: { value: 0 },
      textureCubic: lighting.textureCubic,
      groundWet: { value: 0 },
      waterLine: { value: t.water?.mode ? t.water.level : -1e20 },
      terrainLayers: {
        get value() {
          return strength(battlePrefs(gfx).terrainLayers);
        }
      },
      glowAt: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      glowTint: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      occAt: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
      sunDir: lighting.sunDir,
      sunColor: lighting.sunColor,
      fillDir: lighting.fillDir,
      fillColor: lighting.fillColor,
      fillDir2: lighting.fillDir2,
      fillColor2: lighting.fillColor2,
      ambient: lighting.ambient,
      fogTint: lighting.fogTint,
      fogRange: lighting.fogRange,
      shadowMap: lighting.shadowMap,
      shadowMatrix: lighting.shadowMatrix,
      fieldLook: lighting.fieldLook,
      landGround: lighting.landGround, receiverMap:lighting.receiverMap,
      landProbeOn:lighting.landProbeOn, orbitPos:lighting.orbitPos, orbitNeg:lighting.orbitNeg, wideShadow:lighting.wideShadow,
      hullShadowMatrix: lighting.hullShadowMatrix,
      hullShadowParams: lighting.hullShadowParams,
      hullShadowMap: lighting.hullShadowMap,
      shadowOn: lighting.shadowOn,
      shadowTexel: lighting.shadowTexel
    }
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  if (!render?.isMirror) enableTerrainCulling(mesh,t,triAt);
  const drift = C.drift || [0, 0, 0];
  mesh.userData.tick = dt => {
    if (updateForest) updateForest(gfx.endorForestFloor === true && !gfx.endorLandscape);
    cloudAt.x += drift[0] * dt;
    cloudAt.y += drift[1] * dt;
  };
  const palette=[];
  mesh.userData.soil=soilColor(t,used,files,palette);
  mesh.userData.makeSoilGrid=()=>soilGrid(t,palette,mesh.userData.soil,CELL);
  mesh.userData.lowland=lowland(t);
  mesh.userData.stockDaylight=profile==='stock';
  t.paint = { slot, triAt, geo };
  if (profile==='stock' && map?.file?.toUpperCase()==='_MP_LAND_ENDOR.TED' && signal)
    mesh.userData.landscape=endorLandscape(mesh,t,used,map,render,signal);
  else if(signal && profile==='stock'){
    const key=map?.sourcePath?.toUpperCase().replaceAll('\\','/');
    const recipe=[yavinRecipe,tatooineRecipe,hothRecipe,geonosisRecipe,nabooRecipe,utapauRecipe].find(r=>edition()===r.edition&&key===r.path);
    if(recipe){t.paint.trackConstruction=true;mesh.userData.landscape=reviewedLandscape(mesh,t,used,map,render,signal,recipe,palette,()=>terrainFragment(true));}
  }
  return mesh;
}

export function paveTerrain(t, cells, layer) {
  const P = t.paint;
  if (!P || !P.slot.has(layer)) return;
  const n = t.size, width = t.width ?? n, height = t.height ?? n,
    lay = P.geo.getAttribute('layers'),
    quads = new Set();
  for (const i of cells) {
    if (!P.slot.has(t.layerIndex[i])) continue;
    t.layerIndex[i] = layer;
    // Draw-only receipt for the cells the engine actually paved, not a proximity guess.
    if (P.trackConstruction) (P.construction ||= new Uint8Array(t.layerIndex.length))[i]=layer+1;
    const x = i % n,
      y = (i / n) | 0;
    for (let dy = -1; dy <= 0; dy++)
      for (let dx = -1; dx <= 0; dx++)
        if (x + dx >= 0 && y + dy >= 0 && x + dx < width - 1 && y + dy < height - 1) quads.add((y + dy) * (width - 1) + x + dx);
  }
  for (const q of quads) {
    const x = q % (width - 1),
      y = (q / (width - 1)) | 0,
      a = y * n + x,
      L = quadLayers(t, P.slot, [a, a + 1, a + n, a + n + 1]);
    for (let k = 0; k < 2; k++) {
      const v0 = P.triAt[q * 2 + k];
      if (v0 >= 0) for (let j = 0; j < 3; j++) lay.setXYZW(v0 + j, L[0], L[1], L[2], L[3]);
    }
  }
  if(quads.size)P.paintRevision=(P.paintRevision||0)+1;
  P.soilGrid?.pave(cells);
  lay.needsUpdate = true;
}

const WATER_VERT = `
  attribute float depth;
  uniform mat4 mirror;
  varying vec3 vWorld; varying vec4 vMirror; varying float vDepth;
  void main() { vWorld = position; vDepth = depth; vMirror = mirror * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HAZE = `
  uniform vec4 fieldLook;
  ${airShader(false)}
  uniform vec3 fogTint; uniform vec2 fogRange;
  float haze(vec3 at) { return (1.0-airDepth(at))*(fogRange.y > 0.0 ? clamp((fogRange.y - distance(cameraPosition, at)) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0) : 1.0); }`;
const SHORE = `
  uniform vec2 shore;
  float shoreAlpha(float depth) { return clamp(shore.y + (1.0 - shore.y) * clamp(depth * shore.x, 0.0, 1.0), 0.0, 1.0); }`;
const SLIDE = slideShader(false);

const OPTICS=`uniform vec4 receiverMode,waterBase,forestWeather,landGround; uniform float landProbeOn; uniform mat3 orbitPos; uniform vec3 sunColor,sunDir; ${waterShader(false)} ${dayWater(false)}`;
const WATER_UNDER = `
  ${OPTICS}
  uniform vec3 under;
  varying float vDepth; varying vec3 vWorld;
  ${SHORE} ${HAZE}
  void main() { float a=shoreAlpha(vDepth)*haze(vWorld);vec3 bed=under;
    if(receiverMode.w>0.){bed=mix(under,bedLight(viewWater(vWorld,vDepth)),receiverMode.w);
      if(landProbeOn>0.)bed=mix(under,pow(lakeT(vWorld,vDepth)*(1.-lakeF(vWorld)),vec3(1./2.2)),smoothstep(0.,.32,receiverMode.w));}
    gl_FragColor=vec4(vec3(1.-a)+a*bed,1.); }`;
const WATER_OVER = `
  ${OPTICS}
  ${ringShader(false)}
  uniform sampler2D bump, reflection, fog; uniform vec3 over; uniform vec4 ripple; uniform float bend, side;
  varying vec3 vWorld; varying vec4 vMirror; varying float vDepth;
  ${SHORE} ${SLIDE} ${HAZE}
  void main() {
    vec2 d = (texture2D(bump, slide(ripple, -0.7853982)).xy - 0.5) * 2.0 + (texture2D(bump, slide(ripple, 0.7853982)).xy - 0.5) * 2.0;
    vec2 ring=vec2(0.);if(forestWeather.y>0.){ring=forestWeather.y*showerRing(vWorld.xy,time);d+=.6*ring;}
    vec3 r = texture2D(reflection, clamp((vMirror.xy + d * bend * 200.0) / vMirror.w, 0.002, 0.998)).rgb;
    float seen = mix(0.3, 1.0, texture2D(fog, vWorld.xy / side).r);
    vec3 surface=r*over;
    if(receiverMode.w>0.0){vec2 opt=viewWater(vWorld,vDepth);surface=mix(surface,r*opt.x+waterBase.rgb*(1.0-exp(-opt.y))*0.10*(1.0-opt.x),receiverMode.w);}
    if(landProbeOn>0. && receiverMode.w>0.)surface=mix(r*over,lakeLd(vWorld,vDepth,r),smoothstep(0.,.32,receiverMode.w));
    surface+=vec3(.10,.13,.14)*max(0.,dot(ring,vec2(.62,.79)));
    gl_FragColor = vec4(surface * shoreAlpha(vDepth) * seen * haze(vWorld), 1.0);
  }`;
const LAVA_FRAG = `
  uniform sampler2D base, crust, bump, fog; uniform vec4 flow, lie; uniform vec3 sunDir, sunColor, ambient, glint; uniform float side;
  varying vec3 vWorld;
  ${SLIDE} ${HAZE}
  void main() {
    vec2 at = slide(lie, 0.0);
    vec4 c = texture2D(crust, at); vec3 n = texture2D(bump, at).xyz * 2.0 - 1.0;
    vec3 h = normalize(normalize(cameraPosition - vWorld) + sunDir);
    float s = clamp(dot(n, h), 0.0, 1.0);
    vec3 lit = c.rgb * (sunColor * clamp(dot(n, sunDir), 0.0, 1.0) + ambient) + glint * sunColor * 0.5 * s * s * s * s * s;
    float seen = mix(0.3, 1.0, texture2D(fog, vWorld.xy / side).r);
    gl_FragColor = vec4(mix(fogTint, mix(texture2D(base, slide(flow, 0.0)).rgb, lit, c.a) * seen, haze(vWorld)), 1.0);
  }`;
const ICE_FRAG = `
  uniform sampler2D base, bump, reflection, fog; uniform vec4 flow, lie; uniform vec3 sunDir, sunColor, ambient, tint; uniform float bend, side;
  varying vec3 vWorld; varying vec4 vMirror;
  ${SLIDE} ${HAZE}
  void main() {
    vec3 n = texture2D(bump, slide(lie, 0.0)).xyz * 2.0 - 1.0;
    vec4 c = texture2D(base, slide(flow, 0.0));
    vec3 lit = c.rgb * (sunColor * tint * clamp(dot(n, sunDir), 0.0, 1.0) + ambient);
    vec3 r = texture2D(reflection, clamp(vMirror.xy / vMirror.w + n.xy * bend, 0.002, 0.998)).rgb;
    float seen = mix(0.3, 1.0, texture2D(fog, vWorld.xy / side).r);
    gl_FragColor = vec4(mix(fogTint, mix(lit, r, c.a) * seen, haze(vWorld)), 1.0);
  }`;

const keptProjection = new THREE.Matrix4(),
  keptInverse = new THREE.Matrix4();
export function drawSky(renderer, sky, eye) {
  const P = eye.userData.plain;
  if (!P) return renderer.render(sky, eye);
  keptProjection.copy(eye.projectionMatrix);
  keptInverse.copy(eye.projectionMatrixInverse);
  eye.projectionMatrix.copy(P);
  eye.projectionMatrixInverse.copy(P).invert();
  try {
    renderer.render(sky, eye);
  } finally {
    eye.projectionMatrix.copy(keptProjection);
    eye.projectionMatrixInverse.copy(keptInverse);
  }
}

function mirrorOf(level) {
  const target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
  target.texture.colorSpace = THREE.NoColorSpace;
  const eye = new THREE.PerspectiveCamera(),
    matrix = new THREE.Matrix4();
  const at = new THREE.Vector3(0, 0, level),
    up = new THREE.Vector3(0, 0, 1),
    camAt = new THREE.Vector3(),
    view = new THREE.Vector3(),
    look = new THREE.Vector3(),
    aim = new THREE.Vector3();
  const turn = new THREE.Matrix4(),
    plane = new THREE.Plane(),
    clip = new THREE.Vector4(),
    q = new THREE.Vector4(),
    size = new THREE.Vector2();
  return {
    target,
    matrix,
    render(renderer, camera, draw) {
      camAt.setFromMatrixPosition(camera.matrixWorld);
      renderer.getDrawingBufferSize(size);
      const w = Math.max(4, size.x >> 1),
        h = Math.max(4, size.y >> 1);
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      view.subVectors(at, camAt).reflect(up).negate().add(at);
      turn.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(turn).add(camAt);
      aim.subVectors(at, look).reflect(up).negate().add(at);
      eye.position.copy(view);
      eye.up.set(0, 1, 0).applyMatrix4(turn).reflect(up);
      eye.lookAt(aim);
      eye.far = camera.far;
      eye.updateMatrixWorld();
      eye.projectionMatrix.copy(camera.projectionMatrix);
      eye.userData.plain = camera.projectionMatrix;
      matrix
        .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(eye.projectionMatrix)
        .multiply(eye.matrixWorldInverse);
      plane.setFromNormalAndCoplanarPoint(up, at).applyMatrix4(eye.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = eye.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      p[2] = clip.x;
      p[6] = clip.y;
      p[10] = clip.z + 1 - 0.003;
      p[14] = clip.w;
      eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
      const was = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        renderer.state.buffers.depth.setMask(true);
        renderer.clear();
        draw(eye);
      } finally {
        renderer.setRenderTarget(was);
      }
    }
  };
}

export function buildWater(t) {
  const w = t.water;
  if (!w || !w.mode) return null;
  const level = w.level, side = (t.size - 1) * CELL;
  const regions = w.mode === 2 ? null : [], geo = liquidGeometry(t, CELL, regions);
  if (!geo) return null;
  const file = name => (name ? (/\.\w+$/.test(name) ? name : name + '.tga') : '');
  const layer = i => {
    const r = w.ripples[i] || { tile: 150, turn: 0, speed: 0.05, heading: 0 };
    return new THREE.Vector4(r.tile > 0 ? r.tile : 150, r.turn, r.speed, r.heading);
  };
  const time = { value: 0 },
    fog = { value: fogTexture(t) },
    sideU = { value: side },
    fogTint = lighting.fogTint,
    fogRange = lighting.fogRange;
  const shore = { value: new THREE.Vector2(w.fade > 0 ? 1 / w.fade : 0.1, w.least) };
  const light = { sunDir: lighting.sunDir, sunColor: lighting.sunColor, ambient: lighting.ambient };
  const group = new THREE.Group();
  const add = (fragmentShader, uniforms, more = {}) => {
    const m = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: WATER_VERT,
        fragmentShader,
        uniforms: { time, fog, side: sideU, shore, fogTint, fogRange, fieldLook:lighting.fieldLook, ...uniforms },
        ...more
      })
    );
    m.renderOrder = 1 + group.children.length * 0.1;
    group.add(m);
    return m;
  };
  let glass = null;
  if (w.mode === 1) {
    const k = Math.min(1, Math.max(0, w.reflect));
    glass = mirrorOf(level);
    const optical={...light,landProbeOn:lighting.landProbeOn,orbitPos:lighting.orbitPos,forestWeather:lighting.forestWeather,landGround:lighting.landGround,waterBase:{value:new THREE.Vector4(...w.tint,k)},receiverMode:lighting.receiverMode};
    add(
      WATER_UNDER,
      { ...optical, under: { value: new THREE.Vector3(...w.tint).multiplyScalar(1 - k) } },
      { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor }
    );
    add(
      WATER_OVER,
      {
        ...optical, forestWeather:lighting.forestWeather, over: { value: new THREE.Vector3(...w.tint).multiplyScalar(k) },
        bump: { value: loadTexture(file(w.textures[0])) },
        ripple: { value: layer(0) },
        bend: { value: w.bend * 0.02 },
        reflection: { value: glass.target.texture },
        mirror: { value: glass.matrix }
      },
      { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }
    );
  } else if (w.mode === 2) {
    add(LAVA_FRAG, {
      ...light,
      base: { value: loadTexture(file(w.textures[0])) },
      crust: { value: loadTexture(file(w.textures[1])) },
      bump: { value: loadTexture(file(w.textures[2])) },
      flow: { value: layer(0) },
      lie: { value: layer(1) },
      glint: { value: new THREE.Vector3(...w.glint) },
      mirror: { value: new THREE.Matrix4() }
    });
  } else {
    glass = mirrorOf(level);
    add(ICE_FRAG, {
      ...light,
      base: { value: loadTexture(file(w.textures[0])) },
      bump: { value: loadTexture(file(w.textures[1])) },
      flow: { value: layer(0) },
      lie: { value: layer(1) },
      tint: { value: new THREE.Vector3(...w.tint) },
      bend: { value: w.bend * 0.02 },
      reflection: { value: glass.target.texture },
      mirror: { value: glass.matrix }
    });
  }
  const frustum = new THREE.Frustum(),
    pv = new THREE.Matrix4();
  // Usually the last visible region is still on screen. This is only a culling
  // aid; both optical layers continue to share the original single sheet.
  let lastRegion = 0;
  function inView() {
    if (!frustum.intersectsBox(geo.boundingBox)) return false;
    if (regions.length === 1 || frustum.intersectsBox(regions[lastRegion])) return true;
    for (let i = 0; i < regions.length; i++) {
      if (i !== lastRegion && frustum.intersectsBox(regions[i])) { lastRegion = i; return true; }
    }
    return false;
  }
  let reusableBy = null;
  group.userData.tick = dt => {
    time.value += dt;
  };
  group.userData.mirror = (renderer, camera, draw) => {
    if (!glass) return;
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (!group.visible || camera.matrixWorld.elements[14] <= level || !inView()) {
      reusableBy = null;
      return;
    }
    if (reusableBy === renderer) { reusableBy = null; return; }
    reusableBy = null;
    group.visible = false;
    try {
      glass.render(renderer, camera, draw);
      reusableBy = renderer; // The target's pixels are local to the device that drew them.
    } finally {
      group.visible = true;
    }
  };
  return group;
}

const SKY_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
  uniform sampler2D map, clouds; uniform float cloudScale, cloudRate, time; uniform vec4 forestWeather;
  varying vec2 vUv;
  void main() {
    vec3 base = texture2D(map, vUv).rgb;
    vec4 c = texture2D(clouds, vUv * cloudScale + vec2(time * cloudRate, 0.0));
    vec3 sky=base+c.rgb*c.a*.35;
    gl_FragColor = vec4(${showerSky(false)},1.0);
  }`;

export function skyMaterial(params) {
  const time = { value: 0 };
  const m = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      forestWeather:lighting.forestWeather,
      map: { value: loadTexture(params.BaseTexture || '') },
      clouds: { value: loadTexture(params.CloudTexture || params.BaseTexture || '') },
      cloudScale: { value: params.CloudScale ?? 1 },
      cloudRate: { value: params.CloudScrollRate ?? 0 },
      time
    }
  });
  m.userData.tick = dt => {
    time.value += dt;
  };
  return m;
}
