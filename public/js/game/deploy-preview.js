// Render an isolated portrait of the selected unit, not a copy of a live soldier.
// Borrow the visible deployment screen's frame clock; no separate RAF in combat.
import * as THREE from 'three';
import { loadModel } from '../model.js';
import { LIVERY_PATTERNS } from '../livery.js';
import { standaloneFileTexture } from '../dds.js';
import { loadALA, animName } from '../ala.js';
import { previewMaterial } from './previewmaterial.js';
import {menuMotion} from './menumotion.js';
import { DeployMotion } from './deploy-motion.js';
import { fitPortrait, silhouetteBounds } from './deploy-framing.js';
import { previewAnimBases, previewFile, previewPaint } from './deploy-paint.js';
import { animOverride } from './land.js';

export class DeployPreview {
  constructor(host) {
    this.host = host;
    this.serial = 0;
    this.reducedMotion = menuMotion;
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host);
  }

  // Drop the rendered portrait and everything this preview owns for it. The GL
  // context and scene stay alive so a repaint does not lose the canvas.
  release() {
    this.inst?.root.removeFromParent();
    for (const m of this.materials || []) m.dispose();
    this.materials = [];
    for (const texture of this.ownedTextures?.values() || []) texture?.dispose();
    this.ownedTextures = null;
    this.inst = this.motion = this.bounds = this.shownUnit = null;
    this.spare = 0;
    this.host.classList.remove('rendered');
  }

  clear() {
    ++this.serial;
    this.unit = this.paint = this.file = null;
    this.release();
  }

  async show(unit, teamColor, icon, livery = null) {
    const paint = previewPaint(teamColor, livery),
      file = previewFile(unit);
    // A paint change is a repaint of the same portrait, not a new selection.
    if (this.unit === unit && this.paint === paint.key && this.file === file) return this.loading;
    this.unit = unit;
    this.paint = paint.key;
    this.file = file;
    return (this.loading = this.loadPortrait(unit, teamColor, icon, paint, file, ++this.serial));
  }

  // The commander catalog already resolved its winning ALO and optional exact idle ALA.
  // Never consult the battlefield's animation list for another profile's character.
  showStage(file, idle) {
    return this.loadPortrait(null, null, '', previewPaint(null, null), file, ++this.serial, {idle});
  }

  async loadPortrait(unit, teamColor, icon, paint, file, serial, stage=null) {
    this.host.style.setProperty('--unit-icon', icon ? `url("${icon}")` : 'none');
    if (!file) {
      this.unit = this.paint = this.file = null;
      this.release();
      return;
    }
    // Once this hull is painted, a color-picker drag updates only the
    // portrait's own uniforms, not the rig, GPU textures or the idle clock.
    const team = teamColor?.getHexString?.();
    if (this.inst && this.shownUnit === unit && this.shownPainted && paint.livery && team === this.shownTeam) {
      for (const m of this.materials)
        if (m.defines?.LIVERY) {
          paint.livery.colors.forEach((rgb, i) => m.uniforms['liveryColor' + i].value.set(...rgb, 1));
          m.uniforms.liveryParams.value.x = LIVERY_PATTERNS.indexOf(paint.livery.pattern);
        }
      this.draw();
      return;
    }
    try {
      const [inst, clips] = await Promise.all([
        loadModel(file, { teamColor, livery: paint.livery, fresh: true }),
        stage ? Promise.all([stage.idle ? Promise.resolve(loadALA(stage.idle)).catch(()=>null) : null]) : this.idleClips(previewAnimBases(file, animOverride(unit) || ''), !unit.str('Land_Model_Name'))
      ]);
      if (serial !== this.serial) return;
      if (!inst) {
        this.release();
        return;
      }
      this.initGL();
      const needed = new Set();
      inst.root.traverse(o => {
        for (const key of ['map', 'normalMap', 'glossMap']) {
          const t = o.material?.uniforms?.[key]?.value;
          if (t?.isTexture) needed.add(t);
        }
      });
      const owned = new Map(await Promise.all([...needed].map(async t => [t, await standaloneFileTexture(t)])));
      if (serial !== this.serial) {
        for (const t of owned.values()) t?.dispose();
        return;
      }
      // Share geometry, but keep the portrait's lighting and uploads isolated.
      // Palette uniforms are cloned too, so scrubbing colours cannot repaint a
      // soldier on the battlefield.
      const copies = new Map(),
        materials = [];
      inst.root.traverse(o => {
        if (!o.isMesh || !o.material.uniforms?.map) return;
        const src = o.material;
        let m = copies.get(src);
        if (!m) {
          m = previewMaterial(src, owned, this.noShadow);
          copies.set(src, m);
          materials.push(m);
        }
        o.material = m;
      });
      if (serial !== this.serial) {
        for (const m of materials) m.dispose();
        for (const t of owned.values()) t?.dispose();
        return;
      }
      // Swap in one step: a scrub keeps the previous portrait visible until the
      // new paint is ready, and stale loads never install or leak.
      this.release();
      this.materials = materials;
      this.ownedTextures = owned;
      this.shownTeam = team;
      this.shownPainted = !!paint.livery;
      this.shownUnit = unit;
      this.stageMode = !!stage;
      this.inst = inst;
      this.scene.add(inst.root);
      this.motion = new DeployMotion(inst, clips);
      this.motion.authored = !!this.motion.stand?.bound.length;
      this.draw();
    } catch {
      // Mods without model art and machines without a second GL context keep the native unit icon.
      if (serial === this.serial) {
        this.unit = this.paint = this.file = null;
        this.release();
      }
    }
  }

  initGL() {
    if (this.gl) return;
    this.gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setClearColor(0, 0);
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.host.appendChild(this.gl.domElement);
    this.camera = new THREE.OrthographicCamera();
    this.camera.up.set(0, 0, 1);
    this.scene = new THREE.Scene();
    // A battlefield render target cannot be sampled in this second GL context.
    this.noShadow = new THREE.DepthTexture(1, 1);
    this.noShadow.compareFunction = THREE.LessEqualCompare;
    this.noShadow.needsUpdate = true;
  }

  idleClips(bases, space = false) {
    return Promise.all(
      [0, 1, 2].map(async n => {
        for (const model of bases)
          for (const kind of space ? ['SPACE_IDLE', 'IDLE'] : ['IDLE']) {
            const clip = await Promise.resolve(loadALA(animName(model, kind, n))).catch(() => null);
            if (clip) return clip;
          }
        return null;
      })
    );
  }

  tick(dt) {
    if (!this.motion || !this.host.classList.contains('rendered') || this.reducedMotion.matches || document.hidden) return;
    this.spare += Math.min(0.15, Math.max(dt, 0));
    if (this.spare < 1 / 30) return;
    this.motion.step(this.spare);
    this.spare = 0;
    this.gl.render(this.scene, this.camera);
  }

  measure() {
    // ALO bind boxes include e.g. invisible alternates and a speeder's rest
    // rig. Measure the pixels from the actual posed, skinned model instead.
    // One small offscreen pass on selection, never in the animation loop.
    const { inst, camera: c, gl } = this,
      n = 192;
    const center = inst.box.getCenter(new THREE.Vector3()),
      size = inst.box.getSize(new THREE.Vector3());
    const direction = new THREE.Vector3(-0.43, -1, 0.16).normalize().applyAxisAngle(c.up, this.angle || 0);
    const previous = gl.getRenderTarget();
    this.probe ||= new THREE.WebGLRenderTarget(n, n);
    this.pixels ||= new Uint8Array(n * n * 4);
    let span = Math.max(1, size.length()) * 1.15;
    try {
      gl.setRenderTarget(this.probe);
      for (let attempt = 0; attempt < 3; attempt++, span *= 2) {
        c.position.copy(center).addScaledVector(direction, span * 2);
        c.lookAt(center);
        c.left = c.bottom = -span / 2;
        c.right = c.top = span / 2;
        c.near = 0.01;
        c.far = span * 4;
        c.updateProjectionMatrix();
        gl.render(this.scene, c);
        gl.readRenderTargetPixels(this.probe, 0, 0, n, n, this.pixels);
        const b = silhouetteBounds(this.pixels, n, span);
        if (b) {
          this.measuredPixels=true;
          if (!b.clipped) return b;
        }
      }
    } finally {
      gl.setRenderTarget(previous);
    }
    return { x: 0, y: 0, width: Math.max(1, Math.hypot(size.x, size.y)), height: Math.max(1, size.z) };
  }

  turn(radians) {
    this.angle = ((this.angle || 0) + radians) % (2 * Math.PI);
    this.bounds = null;
    this.draw();
  }

  draw() {
    const { inst, host, camera: c } = this;
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!inst || !w || !h || !host.isConnected) return;
    if (!this.bounds) { this.measuredPixels=false;this.bounds=this.measure(); }
    // An invisible/damaged model must not cover up the still in the lineup.
    if(this.stageMode&&!this.measuredPixels)return;
    Object.assign(c, fitPortrait(this.bounds, w / h));
    c.updateProjectionMatrix();
    this.gl.setSize(w, h, false);
    this.gl.render(this.scene, c);
    host.classList.add('rendered');
  }

  dispose() {
    this.observer.disconnect();
    this.clear();
    this.probe?.dispose();
    this.noShadow?.dispose();
    this.gl?.dispose();
    this.gl?.forceContextLoss();
  }
}
