import * as THREE from 'three';
import { db } from '../gamedata.js';
import { fetchBinary, fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';
import { loadTexture } from '../dds.js';
import { gfx } from '../gfx.js';
import { strength } from '../battlelook.js';
import { spatialFragment } from '../spatialupscale.js';
import { battleScale, imagePostNeeded, cubicShader, nativeSharpen, upscaleMethod, postVertex as VERT } from '../imagesampling.js';
import { closeEdgeDensity, CLOSE_RESOLVE } from '../closeedges.js';
import { fleetSampleRatio } from '../fleetcoverage.js';
import { battlePrefs } from '../battlerealism.js';
import { canMixLight, incidentTargetsGL } from './incidentgl.js';
import { displayEnergy, energyBloom } from '../sceneenergy.js';
import { contactGLSL } from './contactshade.js';

const BLOOM_CUTOFF = 0.9,
  BLOOM_STRENGTH = 1,
  BLOOM_SIZE = 0.25,
  BLOOM_PASSES = 4,
  SCENE_SAMPLES = 4;

const BRIGHT = `
uniform sampler2D map; uniform float cutoff; uniform float deepGlow; varying vec2 vUv;
vec3 energyBright(vec3 signal){${energyBloom(false)}}
void main() {
  vec3 signal = texture2D(map,vUv).rgb;
  if (deepGlow>1.5) {gl_FragColor=vec4(energyBright(signal),1.0);return;}
  vec3 c = clamp(signal, 0.0, 1.0), c2 = c * c;
  vec3 bright = dot(c, vec3(0.299, 0.587, 0.114)) > cutoff ? c : c * c2 * c2;
  if (deepGlow > 0.5) bright = c * smoothstep(0.68,0.99,max(c.r,max(c.g,c.b)));
  gl_FragColor = vec4(bright, 1.0);
}`;

const BLUR = `
uniform sampler2D map; uniform vec2 offset; varying vec2 vUv;
void main() {
  vec2 o = offset, p = vec2(offset.x, -offset.y);
  gl_FragColor = vec4((texture2D(map, vUv + o).rgb + texture2D(map, vUv - o).rgb + texture2D(map, vUv + p).rgb + texture2D(map, vUv - p).rgb) * 0.25, 1.0);
}`;

// Sample symmetrically at quarter resolution. The 0.018 screen-width radius is resolution independent.
const STREAK = `uniform sampler2D map; varying vec2 vUv;
vec3 hot(vec2 uv) {
  vec3 c = texture2D(map,uv).rgb;
  return c * smoothstep(0.50,0.92,max(max(c.r,c.g),c.b));
}
void main() {
  vec3 sum = 0.16*hot(vUv);
  for (int i=1; i<=6; i++) {
    float k = float(i)/6.0;
    vec2 d = vec2(k*k*0.018,0.0);
    sum += (hot(vUv-d)+hot(vUv+d)) * (0.13-0.085*k);
  }
  gl_FragColor = vec4(sum,1.0);
}`;

const UPSCALE = `uniform sampler2D map; uniform float upscaleBlend; varying vec2 vUv;
${cubicShader('glsl')}
void main() {
  vec3 rgb=texture2D(map,vUv).rgb;
  if (upscaleBlend>0.0) rgb=mix(rgb,cubicRGB(vUv,vec2(textureSize(map,0))),upscaleBlend);
  gl_FragColor=vec4(rgb,1.0);
}`;

const COMBINE = `
uniform sampler2D scene, glow, heat, streak;
uniform float glare, edges, displayLight;
${displayEnergy(false)}
uniform vec2 texel;
uniform float bloom, haze; varying vec2 vUv;
#ifdef CONTACT_SHADE
${contactGLSL}
#endif
vec3 smoothEdges(vec2 uv) {
  vec3 nw = texture2D(scene, uv + vec2(-1.0, -1.0) * texel).rgb, ne = texture2D(scene, uv + vec2(1.0, -1.0) * texel).rgb;
  vec3 sw = texture2D(scene, uv + vec2(-1.0, 1.0) * texel).rgb, se = texture2D(scene, uv + vec2(1.0, 1.0) * texel).rgb;
  vec3 m = texture2D(scene, uv).rgb;
  const vec3 L = vec3(0.299, 0.587, 0.114);
  float lnw = dot(nw, L), lne = dot(ne, L), lsw = dot(sw, L), lse = dot(se, L), lm = dot(m, L);
  float lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float reduce = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * texel;
  vec3 a = 0.5 * (texture2D(scene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(scene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(scene, uv - dir * 0.5).rgb + texture2D(scene, uv + dir * 0.5).rgb);
  float lb = dot(b, L);
  return (lb < lo || lb > hi) ? a : b;
}
void main() {
  vec2 uv = vUv;
  if (haze > 0.0) { vec2 push = texture2D(heat, vUv).rg - 0.5; uv += push * step(0.006, max(abs(push.x), abs(push.y))) * haze; }
  vec3 c = edges > 0.5 ? smoothEdges(uv) : texture2D(scene,uv).rgb;
  #ifdef CONTACT_SHADE
  // Preserve bright/emissive details and keep the glare/bloom passes unoccluded.
  c *= mix(contactVisibility(uv),1.0,smoothstep(0.65,1.0,max(max(c.r,c.g),c.b)));
  #endif
  if (displayLight>0.0) c+=texture2D(glow,vUv).rgb * bloom * 0.15;
  else if (bloom > 0.0) { vec3 g = clamp(texture2D(glow, vUv).rgb * bloom, 0.0, 1.0); c = clamp(c, 0.0, 1.0); c += g * (1.0 - c); }
  if (glare > 0.0) c += texture2D(streak, vUv).rgb * glare * vec3(0.72,0.87,1.0);
  if(displayLight>0.0) c=orbitEncode(displayLight>1.5 ? c : orbitShoulder(c));
  gl_FragColor = vec4(c, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.r = renderer;
    this.bloom = false;
    this.heat = false;
    this.glare = 0;
    this.contact = 0;
    this.contactMats = [];
    this.battleImage = true;
    this.flare = false;
    this.targets = null;
    this.heatScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = (frag, uniforms) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mBright = mat(BRIGHT, { map: { value: null }, cutoff: { value: BLOOM_CUTOFF }, deepGlow: { value: 0 } });
    this.mBlur = mat(BLUR, { map: { value: null }, offset: { value: new THREE.Vector2() } });
    this.mStreak = mat(STREAK, { map: { value: null } });
    this.filters = new Map();
    this.closeNear = false;
    this.closeDensity = 1;
    this.fleetBattle = false;
    this.fleetDensity = 1;
    this.mClose = mat(CLOSE_RESOLVE,{map:{value:null},sourceSpan:{value:new THREE.Vector2()}});
    this.mUpscale = mat(UPSCALE, { map: { value: null }, upscaleBlend: { value: 0 } });
    this.mCombine = mat(COMBINE, {
      edges: { value: 1 },
      displayLight: { value: 0 },
      glare: { value: 0 },
      streak: { value: null },
      texel: { value: new THREE.Vector2() },
      scene: { value: null },
      glow: { value: null },
      heat: { value: null },
      bloom: { value: 0 },
      haze: { value: 0 }
    });
    this.flares = null;
    this.flareLevel = 0;
    this.finish = null;
    this.strength = BLOOM_STRENGTH;
  }

  get baseActive() {
    return this.incident || this.bloom || this.heat || !!this.finish || strength(this.glare) > 0 || strength(this.contact) > 0 || (this.battleImage && imagePostNeeded(gfx));
  }

  get sceneDensity() { return Math.max(this.closeDensity, this.fleetDensity); }
  get active() { return this.baseActive || this.sceneDensity > 1; }

  dropTarget(t) {
    this.r.releaseTarget?.(t);
    t.dispose();
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    if (this.targets) {
      for (const t of Object.values(this.targets)) this.dropTarget(t);
      this.targets = null;
    }
  }

  ensureTargets() {
    const samples = gfx.aa !== false ? SCENE_SAMPLES : 0;
    const contact = strength(this.contact) > 0;
    const scale = this.battleImage ? battleScale(gfx) : 1;
    const needInput = scale < 1 || (this.battleImage && nativeSharpen(gfx));
    if (this.targets && (this.incident !== !!this.targets.scene.texture.userData.incidentScene || needInput !== !!this.targets.upInput || this.inputScale !== scale || this.targets.scene.samples !== samples || !!this.targets.scene.depthTexture !== contact)) this.resize(this.w, this.h);
    this.inputScale = scale;
    const pr = this.r.getPixelRatio() * scale,
      W = Math.max(2, Math.round(this.w * pr)),
      H = Math.max(2, Math.round(this.h * pr));
    const rt = (w, h, opts = {}) => {
      const t = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), { depthBuffer: false, ...opts });
      t.texture.colorSpace = THREE.NoColorSpace;
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
      return t;
    };
    if (!this.targets) {
    this.targets = {
      // the passes below only read the scene's colour; resolving its multisampled stencil as well is slow on
      // Direct3D (WebGL through ANGLE on Windows) and ran on every draw into this target
      scene: rt(W, H, { depthBuffer: true, stencilBuffer: true, samples, resolveStencilBuffer: false }),
      a1: rt(W >> 2, H >> 2),
      a2: rt(W >> 2, H >> 2),
      heat: rt(W >> 2, H >> 2)
    };
    if (this.incident) {
      for(const t of [this.targets.scene,this.targets.a1,this.targets.a2])t.texture.type=THREE.HalfFloatType;
      this.targets.scene.texture.userData.incidentScene=true;
    }
    if (contact) this.targets.scene.depthTexture = new THREE.DepthTexture(W, H, THREE.UnsignedInt248Type, undefined, undefined, undefined,
      THREE.NearestFilter, THREE.NearestFilter, undefined, THREE.DepthStencilFormat);
    if (this.finish) this.targets.mid = rt(W, H);
    if (needInput) this.targets.upInput = rt(W, H);
    // Heat stores displacement, not light. Only promote colour buffers on the extended-output path.
    for (const [name, t] of Object.entries(this.targets)) t.texture.userData.hdrColor = name !== 'heat';
    }
    const t=this.targets, density=this.sceneDensity;
    const sw=Math.max(W,Math.floor(W*density)), sh=Math.max(H,Math.floor(H*density));
    if (t.scene.width!==sw || t.scene.height!==sh) t.scene.setSize(sw,sh);
    if(density>1 && !t.resolved){t.resolved=rt(W,H,{type:t.scene.texture.type});t.resolved.texture.userData.hdrColor=true;}
    if(density===1 && t.resolved){this.dropTarget(t.resolved);delete t.resolved;this.mClose.uniforms.map.value=null;}
    return t;
  }

  begin() {
    const pr = this.r.getPixelRatio(), w = Math.round(this.w*pr), h = Math.round(this.h*pr);
    const limit = this.r.device?.limits.maxTextureDimension2D ?? this.r.capabilities?.maxTextureSize;
    const webgl = !!this.r.isWebGLRenderer || this.r.isMirror && !this.r.webgpu;
    const prefs = battlePrefs(gfx);
    this.incident=!!(this.spaceBattle && prefs.sceneLight && canMixLight(this.r));
    if (this.incident) incidentTargetsGL(this.r);
    else if(this.targets?.scene.texture.userData.incidentScene)this.resize(this.w,this.h);
    this.closeDensity = closeEdgeDensity(this.battleImage && this.closeNear, prefs, w, h, limit, webgl);
    this.fleetDensity = this.fleetBattle ? fleetSampleRatio(prefs, w, h, limit, webgl) : 1;
    if (!this.active) {
      if (this.targets?.upInput || this.targets?.resolved) this.resize(this.w, this.h);
      return false;
    }
    this.r.setRenderTarget(this.ensureTargets().scene);
    return true;
  }

  pass(material, target) {
    this.quad.material = material;
    this.r.setRenderTarget(target);
    this.r.render(this.quadScene, this.quadCam);
  }

  end(camera, bloomScale = 1, deepGlow = false) {
    const t = this.targets,
      r = this.r;
    const source=t.resolved || t.scene;
    if(t.resolved){
      this.mClose.uniforms.map.value=t.scene.texture;
      // Slightly wider, positive footprint for thin fleet silhouettes. Close-ups retain the exact one-pixel box.
      const width = this.fleetDensity > 1 && this.closeDensity <= 1 ? 1.25 : 1;
      this.mClose.uniforms.sourceSpan.value.set(width*t.scene.width/source.width,width*t.scene.height/source.height);
      // With no effects, resolve straight to the canvas; no extra copy or implicit FXAA.
      const effects=this.baseActive;
      this.pass(this.mClose,effects ? t.resolved : null);
      if(!effects)return;
    }
    if (this.heat) {
      r.getClearColor(_clear);
      const alpha = r.getClearAlpha();
      r.setRenderTarget(t.heat);
      r.setClearColor(_rest, 1);
      r.clear();
      r.render(this.heatScene, camera);
      r.setClearColor(_clear, alpha);
    }
    const glare = strength(this.glare);
    if (this.bloom || glare) {
      this.mBright.uniforms.deepGlow.value = this.incident ? 2 : deepGlow ? 1 : 0;
      this.mBright.uniforms.map.value = source.texture;
      this.pass(this.mBright, t.a1);
    }
    if (glare) {
      if (!t.streak) t.streak = t.a1.clone();
      this.mStreak.uniforms.map.value = t.a1.texture;
      this.pass(this.mStreak, t.streak);
    }
    if (this.bloom) {
      let src = t.a1,
        dst = t.a2;
      for (let i = 0; i < BLOOM_PASSES; i++) {
        this.mBlur.uniforms.map.value = src.texture;
        this.mBlur.uniforms.offset.value.set((BLOOM_SIZE * (2 * i + 1) * 0.5) / src.width, (BLOOM_SIZE * (2 * i + 1) * 0.5) / src.height);
        this.pass(this.mBlur, dst);
        [src, dst] = [dst, src];
      }
    }
    const u = this.mCombine.uniforms;
    u.edges.value = !this.battleImage || gfx.postAA === 'fxaa' || (gfx.postAA !== 'off' && gfx.aa !== false) ? 1 : 0;
    u.displayLight.value=this.incident ? (r.hdrPass ? 2 : 1) : 0;
    u.glare.value = glare;
    u.streak.value = glare ? t.streak.texture : null;
    u.scene.value = source.texture;
    u.glow.value = t.a1.texture;
    u.heat.value = t.heat.texture;
    u.texel.value.set(1 / source.width, 1 / source.height);
    u.bloom.value = this.bloom ? this.strength * gfx.bloomGain * bloomScale : 0;
    u.haze.value = this.heat ? 0.035 * gfx.heatGain : 0;
    let combine = this.mCombine;
    if (t.scene.depthTexture && camera.isPerspectiveCamera) {
      const ms = t.scene.samples > 1 ? 1 : 0;
      combine = this.contactMats[ms] ||= new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: COMBINE, defines: { CONTACT_SHADE: 1, CONTACT_MS: ms },
        uniforms: { ...u, contactDepth: { value: null }, contactSurface: { value: null }, terrainContactMask: { value: 0 }, contactMaxSpan: { value: 28 }, contactParams: { value: new THREE.Vector4() }, waterPlane: { value: new THREE.Vector4() } }, depthTest:false, depthWrite:false
      });
      combine.uniforms.contactDepth.value = t.scene.depthTexture;
      // Use the original scene's coverage, not the graded or downsampled output.
      combine.uniforms.contactSurface.value = t.scene.texture;
      // 0: no coverage mask; 1: reject terrain-on-terrain taps; 2: only terrain
      // receives object contact. A depth crease on a model is not a footprint.
      combine.uniforms.terrainContactMask.value = this.terrainContactMask ? (this.compactGroundContact ? 2 : 1) : 0;
      // Cast maps supply the long shadow. On a remastered surface the post pass should
      // only see immediate neighbours, not stamp the whole silhouette at each tap offset.
      combine.uniforms.contactMaxSpan.value = this.compactGroundContact ? Math.max(1, 2.5 * source.height / this.h) : 28;
      // The water sheets blend colour but leave the bed's depth. Reconstruct world Z relative
      // to the sheet from the camera ray (UV here is bottom-up on both renderers).
      const plane=combine.uniforms.waterPlane.value, m=camera.matrixWorld.elements, proj=camera.projectionMatrix.elements;
      if(Number.isFinite(this.waterLevel))plane.set(m[2]/proj[0], m[6]/proj[5], -m[10], m[14]-this.waterLevel);
      else plane.set(0,0,0,1e8);
      // Contact modulates the combined colour here, not just its ambient component.
      // Keep the compact crease subtle rather than drawing a black contour on lit rocks.
      const contactGain = strength(this.contact) * (this.compactGroundContact ? 0.4 : 1);
      combine.uniforms.contactParams.value.set(camera.near,camera.far,2/camera.projectionMatrix.elements[5],contactGain);
    }
    if (this.finish && t.mid) {
      this.pass(combine, t.mid);
      this.finish(t.mid, t.upInput || null);
    } else this.pass(combine, t.upInput || null);
    if (t.upInput) this.reconstruct(t);
  }

  reconstruct(t) {
    const method = this.inputScale === 1 ? 'native' : upscaleMethod(gfx), amount = strength(gfx.upscaleBlend);
    const filter = (name, source, target, paired = false) => {
      let material = this.filters.get(name);
      if (!material) {
        material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: spatialFragment(name),
          uniforms: { map: { value: null }, extended: { value: 0 }, paired: { value: 0 }, amount: { value: 0 } }, depthTest: false, depthWrite: false });
        this.filters.set(name,material);
      }
      material.uniforms.map.value = source.texture;
      material.uniforms.extended.value = this.r.hdrPass ? 1 : 0;
      material.uniforms.paired.value = paired ? 1 : 0;
      material.uniforms.amount.value = amount;
      this.pass(material,target);
    };
    // RCAS is a distinct, output-resolution pass. Don't allocate its input for EASU-only or the legacy filters.
    if (method === 'fsr1' && amount > 0) {
      this.r.getDrawingBufferSize(_output);
      if (!t.easu) t.easu = t.upInput.clone();
      t.easu.setSize(_output.x,_output.y);
      t.easu.texture.userData.hdrColor = true;
      // Keep the intermediate in FSR's bounded working signal; undo the HDR shoulder only after RCAS.
      filter('easu',t.upInput,t.easu,true);
      filter('rcas',t.easu,null,true);
    } else {
      if (t.easu) { t.easu.dispose(); delete t.easu; }
      if (method === 'fsr1') filter('easu',t.upInput,null);
      else if (method === 'native') filter('rcas',t.upInput,null);
      else if (method === 'lanczos' && amount > 0) filter('lanczos',t.upInput,null);
      else {
        this.mUpscale.uniforms.map.value = t.upInput.texture;
        this.mUpscale.uniforms.upscaleBlend.value = method === 'bicubic' ? amount : 0;
        this.pass(this.mUpscale,null);
      }
    }
  }

  async loadFlares() {
    if (this.flares !== null) return;
    this.flares = false;
    const [xml, art] = await Promise.all([fetchText('Data/XML/LensFlares.xml'), fetchBinary('Data/Art/Textures/LENSFLARE.DDS')]);
    if (!xml || !art) return;
    const def = parseXML(xml)
      .children.flatMap(n => n.children)
      .find(n => /lensflare/i.test(n.tag));
    if (!def) return;
    const tex = loadTexture('LENSFLARE.DDS', { repeat: false });
    const scene = new THREE.Scene(),
      geo = new THREE.PlaneGeometry(1, 1),
      sprites = [];
    for (const f of def.all('Flare')) {
      const n = Math.max(1, f.num('Num_Slots', 1)),
        c = f.val('Diffuse').split(',').map(parseFloat);
      const m = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: tex },
          cell: { value: new THREE.Vector3(f.num('Slot_X', 0), f.num('Slot_Y', 0), 1 / n) },
          tint: { value: new THREE.Color(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1) },
          level: { value: 0 }
        },
        vertexShader:
          'uniform vec3 cell; varying vec2 vUv; void main() { vUv = (cell.xy + vec2(uv.x, 1.0 - uv.y)) * cell.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'uniform sampler2D map; uniform vec3 tint; uniform float level; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * tint * t.a * level, 1.0); }',
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      scene.add(mesh);
      sprites.push({ mesh, fraction: f.num('Fraction', 0), radius: f.num('Radius', 1) });
    }
    this.flares = { scene, camera: new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1), sprites };
  }

  drawFlare(camera, sun, blocked, dt) {
    if (!this.flare) {
      this.flareLevel = 0;
      return;
    }
    if (this.flares === null) this.loadFlares();
    const fl = this.flares;
    if (!fl) return;
    const p = _v.copy(sun).project(camera);
    const inFront = p.z < 1 && p.z > -1;
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    const want = inFront && !blocked ? 1 - THREE.MathUtils.smoothstep(edge, 0.85, 1.15) : 0;
    this.flareLevel += (want - this.flareLevel) * Math.min(1, dt * 6);
    if (this.flareLevel < 0.01) return;
    const w = this.w,
      h = this.h,
      cam = fl.camera;
    cam.right = w;
    cam.top = h;
    cam.updateProjectionMatrix();
    const sx = (p.x * 0.5 + 0.5) * w,
      sy = (p.y * 0.5 + 0.5) * h,
      cx = w / 2,
      cy = h / 2,
      unit = h * 0.11;
    for (const s of fl.sprites) {
      s.mesh.position.set(sx + (cx - sx) * s.fraction, sy + (cy - sy) * s.fraction, 0);
      s.mesh.scale.set(s.radius * unit, s.radius * unit, 1);
      s.mesh.material.uniforms.level.value = this.flareLevel * (s.fraction === 0 ? 0.9 : 0.45);
    }
    this.r.setRenderTarget(null);
    this.r.render(fl.scene, cam);
  }
}
const _output = new THREE.Vector2();
const _v = new THREE.Vector3();
const _clear = new THREE.Color(),
  _rest = new THREE.Color().setRGB(0.5, 0.5, 0);
