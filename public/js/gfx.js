import { fetchText } from './vfs.js';
import { parseXML } from './xml.js';
import { env } from './gpu/env.js';

import { hdrDefaults } from './hdr.js';
import { battlePrefs } from './battlerealism.js';
import { imageDefaults } from './imagesampling.js';
import { endorPreview, yavinPreview, tatooinePreview, hothPreview, geonosisPreview, nabooPreview, utapauPreview, landPreview, endorGraphics } from './endor-preview.js';
import { originalLook, strength } from './battlelook.js';

const KEY = 'swr-gfx';
const OWN = {
  ...hdrDefaults,
  ...originalLook,
  ...imageDefaults,
  battleRealism: 'custom',
  spacePresentation: 'inherit',
  destroyerDetail: 'stock',
  destroyerSurface: 'stock',
  hullDamageMarks: true,
  keepInfantryBodies: true,
  closeHullShadows: false,
  closeHullEdges: false,
  hullBlastLight: true,
  sceneLight: false,
  planetAir: 0,
  orbitalLighting: 'map',
  terrainLayers: 0,
  endorForestFloor: false,
  endorLandscape: false,
  yavinLandscape: false,
  tatooineLandscape: false,
  hothLandscape: false,
  geonosisLandscape: false,
  nabooLandscape: false,
  utapauLandscape: false,
  endorWeather: true,
  immersiveWeather: 'all',
  canopyFade: .70,
  endorShade: .85, endorMist: .32, landHighlightProtect: 0, landWaterClarity: 1,
  groundDaylight: false,
  cloudReceivers:false, litPuffs:false, mapReflections:false, leafLight:false, waterOptics:false, localSoil:false,
  rainSurfaces: false,
  aerialDepth: false, sharedWind: false, steadyDetail: false,
  shadows: true,
  bloom: true,
  bloomGain: 1,
  gradeTint: true,
  gradeSaturation: true,
  gradeContrast: true,
  gradeVignette: true,
  heat: true,
  heatGain: 1,
  modelLod: true, // ALO colour models, independent of map, content pack and graphics preset.
  fleetCoverage: false,
  flare: true,
  soft: true,
  scale: 1,
  aa: true,
  supersample: 1,
  particle: 1,
  mesh: 1,
  texMip: 0,
  shader: 3,
  shadow: 3,
  shadowRange: 8,
  gamma: 0.5,
  level: -1
};

function read() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
    // Existing scale + sharpness preferences referred to the original bilinear/bicubic blend.
    if (kept && 'battleScale' in kept && !kept.upscaleMethod) kept.upscaleMethod = 'bicubic';
    if (kept) return kept;
    const old = localStorage.getItem('swr-shadows');
    return old === null ? {} : { shadows: old === '1' };
  } catch {
    return {};
  }
}

export const gfx = Object.assign({}, OWN, read());
export const gfxDefaults = OWN;
let launcherOrigin = '';
try {
  if (window.parent !== window && document.referrer) {
    const parentURL = new URL(document.referrer);
    if (parentURL.hostname === '127.0.0.1' && parentURL.protocol === 'http:') launcherOrigin = parentURL.origin;
    const mode = new URL(location.href).searchParams.get('universal-realism');
    if (launcherOrigin && ['custom','on','off'].includes(mode)) gfx.battleRealism = mode;
  }
} catch {}
if(endorPreview) Object.assign(gfx,endorGraphics(endorPreview,OWN));
if(landPreview) Object.assign(gfx,endorGraphics('ultra',OWN),{immersiveWeather:landPreview==='original'?'off':OWN.immersiveWeather,endorLandscape:false,yavinLandscape:yavinPreview==='ultra',tatooineLandscape:tatooinePreview==='ultra',hothLandscape:hothPreview==='ultra',geonosisLandscape:geonosisPreview==='ultra',nabooLandscape:nabooPreview==='ultra',utapauLandscape:utapauPreview==='ultra',supersample:1});
export function setBattleRealism(mode) {
  if (!['on','off','custom'].includes(mode)) return;
  gfx.battleRealism = mode;
  storeGfx();
  if (launcherOrigin) {
    window.parent.postMessage({kind:'universal-battle-realism',mode}, launcherOrigin);
    // Do not restore a stale launch parameter if only the inner frame reloads.
    const url = new URL(location.href);
    url.searchParams.set('universal-realism', mode);
    history.replaceState(history.state, '', url);
  }
}
// Shared by live planet draws only. Cached portraits keep the original archive treatment.
export const livePlanetAir = {
  get value() {
    return strength(battlePrefs(gfx).planetAir);
  }
};
env.soft = gfx.soft !== false;

export function storeGfx() {
  try {
    if(!endorPreview&&!landPreview)localStorage.setItem(KEY, JSON.stringify(gfx));
  } catch {}
  env.soft = gfx.soft !== false;
  applyGamma();
}

export function shadowSize() {
  return [512, 1024, 2048, 4096][Math.max(0, Math.min(3, gfx.shadow | 0))];
}

export const SHADOW_RANGE_MAX = 8;
export function shadowReach() {
  return Math.max(1, Math.min(SHADOW_RANGE_MAX, +gfx.shadowRange || OWN.shadowRange));
}

export const SUPERSAMPLE_STEPS = [1, 1.5, 2];
const SUPERSAMPLE_PIXEL_BUDGET = 3840 * 2160;

export function supersampling() {
  if (gfx.aa === false) return 1;
  return Math.max(1, Math.min(2, +gfx.supersample || 1));
}

export function pixelRatio() {
  const screenRatio = Math.min(devicePixelRatio, 2) * Math.max(0.25, Math.min(1, +gfx.scale || 1));
  const screenPixels = Math.max(1, innerWidth * innerHeight * screenRatio * screenRatio);
  const affordable = Math.sqrt(SUPERSAMPLE_PIXEL_BUDGET / screenPixels);
  return screenRatio * Math.max(1, Math.min(supersampling(), affordable));
}

const canvases = new Set();
export const isGameCanvas = canvas => canvases.has(canvas);
export function markHDROutput(canvas, state) {
  if (!canvas.dataset || canvas.dataset.hdrOutput === state) return;
  canvas.dataset.hdrOutput = state;
  applyGamma();
  canvas.dispatchEvent(new Event('hdroutputchange', { bubbles: true }));
}
export function gammaOn(canvas) {
  canvases.add(canvas);
  applyGamma();
}
function applyGamma() {
  const g = Math.max(0, Math.min(1, +gfx.gamma));
  const off = !(Math.abs(g - 0.5) > 0.02);
  let f = document.getElementById('gfxGammaFilter');
  if (!off && !f) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.dataset.page = '';
    svg.innerHTML =
      '<filter id="gfxGammaFilter" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="gamma"/><feFuncG type="gamma"/><feFuncB type="gamma"/></feComponentTransfer></filter>';
    document.body.appendChild(svg);
    f = document.getElementById('gfxGammaFilter');
  }
  if (f) for (const fn of f.querySelectorAll('feFuncR, feFuncG, feFuncB')) fn.setAttribute('exponent', String(Math.pow(1.6, 1 - 2 * g)));
  for (const c of canvases) c.style.filter = off || c.dataset.hdrOutput === 'extended' ? '' : 'url(#gfxGammaFilter)';
}

let levels = null;
export async function presets() {
  if (levels) return levels;
  levels = [];
  const xml = await fetchText('Data/XML/GraphicDetails.xml').catch(() => null);
  if (!xml) return levels;
  const root = parseXML(xml);
  const all = [];
  root.walk
    ? root.walk(n => all.push(n))
    : (function go(n) {
        all.push(n);
        for (const c of n.children || []) go(c);
      })(root);
  const byName = new Map(),
    configs = [];
  for (const n of all) {
    const tag = (n.tag || '').toLowerCase(),
      name = n.attrs && (n.attrs.name || n.attrs.Name);
    if (tag === 'graphicdetaillevel' && name) byName.set(name.toUpperCase(), n);
    else if (tag === 'hardwareconfiguration') configs.push(n);
  }
  const val = (n, k) => {
    const c = (n.children || []).find(x => (x.tag || '').toLowerCase() === k.toLowerCase());
    return c ? String(c.text || '').trim() : null;
  };
  const get = (n, k, seen = new Set()) => {
    for (; n && !seen.has(n); n = byName.get(String(val(n, 'Based_On') || '').toUpperCase())) {
      seen.add(n);
      const v = val(n, k);
      if (v !== null && v !== '') return v;
    }
    return null;
  };
  let best = null;
  for (const c of configs) {
    const names = String(val(c, 'GraphicDetailSettingName') || '')
      .split(/\s+/)
      .filter(Boolean);
    if (!names.length) continue;
    const d = +val(c, 'DefaultGraphicDetailLevel') || 0;
    if (!best || d > best.d) best = { names, d };
  }
  const names = best ? best.names : [...byName.keys()].slice(0, 4);
  const yes = v => /^(yes|true|1)$/i.test(v || ''),
    num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  for (const nm of names) {
    const n = byName.get(nm.toUpperCase());
    if (!n) continue;
    levels.push({
      texMip: num(get(n, 'TextureMipLevel'), 0),
      shader: num(get(n, 'ShaderDetailLevel'), 3),
      shadow: num(get(n, 'ShadowDetail'), 2),
      shadows: yes(get(n, 'ShadowVolumes')),
      bloom: yes(get(n, 'Bloom')),
      heat: yes(get(n, 'HeatDistortions')),
      particle: num(get(n, 'ParticleDetail'), 1),
      mesh: num(get(n, 'MeshDetail'), 1),
      aa: num(get(n, 'ScreenAALevel'), 0) > 0
    });
  }
  return levels;
}
