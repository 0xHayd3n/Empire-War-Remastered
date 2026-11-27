// One transparent scene, one GPU context, a bounded working set. The whole
// ordered roster is cyclic; only the short arc facing the player needs rigs.
import * as THREE from 'three';
import {menuMotion} from './menumotion.js';
import { commandFigure } from './commandfigure.js';
import { commandHologram } from './commandhologram.js';
import { crestLibrary } from './crestlibrary.js';
const wrap = (n, len) => ((n % len) + len) % len;
const delta = (n, len) => wrap(n + len / 2, len) - len / 2;
export class CommandRing {
  constructor(host, report) {
    this.host = host;
    this.report = report;
    this.cache = new Map();
    this.live = new Set();
    this.rows = [];
    this.loading = 0;
    this.stepTo = 0;
    this.phase = 0;
    this.motion = menuMotion;
    this.scene = new THREE.Scene();
    this.crests = crestLibrary();
    this.hologram = commandHologram(this.scene, () => this.invalidate(), this.crests);
    this.camera = new THREE.OrthographicCamera();
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0, -7, 1.6);
    this.camera.lookAt(0, 0, 0.58);
    this.camera.near = 0.01;
    this.camera.far = 25;
    this.gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setClearColor(0, 0);
    const ctx = this.gl.getContext();
    this.maxViewport = ctx.getParameter(ctx.MAX_VIEWPORT_DIMS);
    this.gl.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(this.gl.domElement);
    this.depth = new THREE.DepthTexture(1, 1);
    this.depth.compareFunction = THREE.LessEqualCompare;
    this.depth.needsUpdate = true;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.wake = ev => {
      if (this.motion.matches) this.phase = this.stepTo;
      if (ev?.type === 'change') {
        if (this.motion.matches) for (const rig of this.live) rig.blur();
        this.showing = null;
      }
      this.invalidate();
    };
    this.lost = () => {
      this.contextLost = true;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      if (this.active) this.report({ failed: true, contextLost: true }, 0, 0);
    };
    this.restored = () => {
      this.contextLost = false;
      this.invalidate();
    };
    this.gl.domElement.addEventListener('webglcontextlost', this.lost);
    this.gl.domElement.addEventListener('webglcontextrestored', this.restored);
    this.motion.addEventListener('change', this.wake);
    document.addEventListener('visibilitychange', this.wake);
  }
  resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    // Render only the arena; the static HD insignia above it is native SVG.
    const ratio = Math.min(devicePixelRatio, Math.sqrt((3840 * 2160) / (w * h)), this.maxViewport[0] / w, this.maxViewport[1] / h);
    if (this.width === w && this.height === h && this.gl.getPixelRatio() === ratio) return;
    this.width = w;
    this.height = h;
    this.aspect = w / h;
    this.hologram.resize(this.aspect);
    const c = this.camera,
      span = 1.23;
    c.left = (-span * this.aspect) / 2;
    c.right = -c.left;
    c.top = span / 2;
    c.bottom = -c.top;
    c.updateProjectionMatrix();
    if (this.gl.getPixelRatio() !== ratio) this.gl.setPixelRatio(ratio);
    this.gl.setSize(w, h, false);
    this.invalidate();
  }
  set(rows, index, jump = true) {
    const old = this.focus;
    this.rows = rows;
    this.focus = rows[index];
    if (this.focus) this.hologram.show(this.focus);
    clearTimeout(this.retry);
    this.retried = false;
    if (this.cache.get(this.focus?.key)?.failed) this.cache.delete(this.focus.key);
    if (old !== this.focus) this.cache.get(old?.key)?.rig?.blur();
    if (jump || !rows.length) this.phase = this.stepTo = index;
    else this.stepTo += delta(index - wrap(this.stepTo, rows.length), rows.length);
    if (this.motion.matches) this.phase = this.stepTo;
    this.index = index;
    this.active = true;
    this.showing = null;
    this.review();
    this.resize();
    this.invalidate();
  }
  review() {
    const { rows, index } = this,
      span = this.warmOnly ? 0 : Math.min(3, Math.floor(rows.length / 2));
    this.want = [];
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      if (!rows.length || Math.abs(d) > span) continue;
      const r = rows[wrap(index + d, rows.length)];
      if (!this.want.includes(r)) this.want.push(r);
    }
    for (const r of this.want) {
      const e = this.cache.get(r.key);
      if (e) e.used = performance.now();
    }
    this.pump();
  }
  pump() {
    if (this.dead || !this.active) return;
    // Start the focused model first; never flood the loader with an entire library.
    const first = this.cache.get(this.focus?.key);
    const limit = !first ? Math.min(3, this.loading + 1) : !first.done ? 1 : 2;
    for (const r of this.want) {
      if (this.loading >= limit) break;
      if (this.cache.has(r.key)) continue;
      const e = { used: performance.now() };
      this.cache.set(r.key, e);
      this.loading++;
      commandFigure(r, this.depth)
        .then(
          rig => {
            if (this.dead) {
              rig.dispose();
              return;
            }
            e.rig = rig;
          },
          () => {
            e.failed = true;
            if (!this.dead && this.active && r.key === this.focus?.key && !this.retried) {
              this.retried = true;
              this.retry = setTimeout(() => {
                if (this.dead || !this.active || r.key !== this.focus?.key || this.cache.get(r.key) !== e) return;
                this.cache.delete(r.key);
                this.pump();
                this.invalidate();
              }, 500);
            }
          }
        )
        .finally(() => {
          e.done = true;
          this.loading--;
          if (!this.dead) {
            this.pump();
            this.invalidate();
          }
        });
    }
    if (this.cache.size > 10) {
      const seen = new Set(this.want.map(r => r.key));
      for (const [key, e] of [...this.cache].sort((a, b) => a[1].used - b[1].used)) {
        if (this.cache.size <= 10) break;
        if (!e.done || seen.has(key) || this.live.has(e.rig)) continue;
        e.rig?.dispose();
        this.cache.delete(key);
      }
    }
  }
  warm(r) {
    if (this.active || !r) return;
    this.warmOnly = true;
    this.active = true;
    this.rows = [r];
    this.index = 0;
    this.focus = r;
    this.review();
    this.warmOnly = false;
    this.active = false;
  }
  invalidate() {
    if (!this.frame && this.active && !this.dead && !this.contextLost && !document.hidden)
      this.frame = requestAnimationFrame(t => this.draw(t));
  }
  paint() {
    this.gl.render(this.scene, this.camera);
  }
  draw(t) {
    this.frame = 0;
    // The context can already be lost before the DOM loss event is dispatched.
    // Don't ask Three to compile a newly browsed crest during that window.
    if (!this.active || this.dead || this.contextLost || document.hidden || !this.aspect || this.gl.getContext().isContextLost()) return;
    const dt = Math.min(0.08, Math.max(0, (t - (this.last || t)) / 1000));
    this.last = t;
    this.hologram.tick(dt, this.motion.matches);
    const entry = this.cache.get(this.focus?.key);
    // A filtered jump can replace the entire arc. Don't paint an empty scene
    // (or move the old arc out of view) while the new signed donor rig is in flight.
    if (!entry?.done && this.live.size) {
      for (const rig of this.live) if (!this.motion.matches) rig.tick(dt);
      this.paint(dt);
      this.report(null, this.live.size, 0);
      if (!this.motion.matches) this.invalidate();
      return;
    }
    const amount = this.motion.matches ? 1 : Math.max(0.035, dt / 0.26);
    const gap = this.stepTo - this.phase;
    this.phase = Math.abs(gap) < 0.006 || this.motion.matches ? this.stepTo : this.phase + gap * (1 - Math.exp(-dt * 15));
    const n = this.rows.length,
      slots = Math.min(7, n),
      want = new Set();
    for (const r of this.want) {
      const e = this.cache.get(r.key),
        rig = e?.rig;
      if (!rig) continue;
      const i = this.rows.indexOf(r);
      const d = delta(i - this.phase, n);
      if (Math.abs(d) > 3.52) continue;
      const angle = (d * Math.PI * 2) / slots,
        cos = Math.cos(angle),
        front = (cos + 1) / 2;
      // Physical depth, scale and light all describe the same circular movement.
      const scale = 0.56 + 0.5 * front ** 3,
        root = rig.root;
      root.position.set((Math.sin(angle) + (n === 2 ? 0.62 * (1 - front) : 0)) * this.aspect * 0.46, 0.95 * (1 - front), (1 - front) * 0.1);
      root.scale.setScalar(scale);
      root.rotation.z = -0.15 * Math.sin(angle);
      rig.light(0.46 + 0.54 * front ** 2);
      if (!this.live.has(rig)) {
        this.scene.add(root);
        rig.fade(0);
      }
      // A neighbor that was prewarmed still fades up as it rotates into focus.
      const opacity = 0.56 + 0.44 * front ** 2;
      if (rig.alpha !== opacity) rig.fade(rig.alpha + Math.sign(opacity - rig.alpha) * Math.min(amount, Math.abs(opacity - rig.alpha)));
      want.add(rig);
      if (r === this.focus && this.showing !== r) {
        this.showing = r;
        rig.focus(this.motion.matches);
      }
      if (!this.motion.matches) rig.tick(dt);
    }
    for (const rig of this.live) {
      if (want.has(rig)) continue;
      rig.fade(Math.max(0, rig.alpha - amount));
      if (rig.alpha > 0) {
        want.add(rig);
        rig.tick(dt);
      } else rig.root.removeFromParent();
    }
    this.live = want;
    this.paint(dt);
    this.report(entry, this.live.size, (entry?.rig?.root.position.x || 0) / this.camera.right, this.motion.matches);
    if (!this.motion.matches && (want.size || this.hologram.mesh.visible)) this.invalidate();
  }
  stop() {
    clearTimeout(this.retry);
    this.active = false;
    this.hologram.clear();
    this.gl.clear();
    cancelAnimationFrame(this.frame);
    this.last = this.frame = 0;
    this.showing = null;
    this.cache.get(this.focus?.key)?.rig?.blur();
    for (const rig of this.live) rig.root.removeFromParent();
    this.live.clear();
  }
  dispose() {
    this.stop();
    this.dead = true;
    this.observer.disconnect();
    this.motion.removeEventListener('change', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    for (const e of this.cache.values()) e.rig?.dispose();
    this.cache.clear();
    this.live.clear();
    this.gl.domElement.removeEventListener('webglcontextlost', this.lost);
    this.gl.domElement.removeEventListener('webglcontextrestored', this.restored);
    this.hologram.dispose();
    this.crests.dispose();
    this.depth.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.gl.domElement.remove();
  }
}
