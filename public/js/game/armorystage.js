import { armoryPreview, saveArmoryPreview } from './armorypreference.js';
import {menuMotion} from './menumotion.js';
import { fetchPart } from '../vfs.js';
import {usingRefit,readMaterialFile} from '../texture-showcase/store.js';
import { parkHull, takeHull, forgetHull } from './armoryparking.js';
let requestId = 0;

const MiB = 1024 * 1024,
  clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Each worker contains one hull's model/material caches. Never run a preview clock
// outside its visible stage; only a finished hull can be parked for a quick revisit.
class ArmoryStage extends HTMLElement {
  connectedCallback() {
    this.owner = this.closest('.title-menu');
    this.innerHTML = `<div class="stage-window" tabindex="0" role="group" aria-label="Unit inspection camera" aria-describedby="orbit-help">
      <canvas hidden role="img"></canvas><img class="stage-icon" hidden alt=""><span class="stage-reticle" aria-hidden="true"></span>
    </div><div class="stage-controls"><div class="stage-caption"><small>Inspection feed</small><span class="stage-status" role="status"></span></div>
      <div class="camera-tools"><select aria-label="Preview mode"><option value="live">Live model</option><option value="portrait">Portrait · low power</option></select>
      <button type="button" data-tool="out" aria-label="Zoom out">−</button><button type="button" data-tool="in" aria-label="Zoom in">+</button>
      <button type="button" data-tool="reset" aria-label="Reset camera">Reset</button><button type="button" data-tool="motion" hidden></button></div></div>
      <span id="orbit-help" class="camera-guide">Drag to orbit · Arrows to turn · + / − to zoom · Home to reset</span>`;
    this.surface = this.querySelector('.stage-window');
    this.canvas = this.querySelector('canvas');
    this.icon = this.querySelector('img');
    this.mode = this.querySelector('select');
    this.status = this.querySelector('.stage-status');
    this.motion = this.querySelector('[data-tool="motion"]');
    this.zoomButtons = [...this.querySelectorAll('[data-tool]:not([data-tool="motion"])')];
    this.reduce = menuMotion;
    this.mode.value = armoryPreview();
    this.mode.onchange = () => {
      saveArmoryPreview(this.mode.value);
      this.show(this.unit);
    };
    this.querySelector('.camera-tools').onclick = e => {
      const tool = e.target.dataset.tool;
      if (tool === 'reset') this.resetView();
      if (tool === 'in' || tool === 'out') this.scale(tool === 'in' ? 1.2 : 1 / 1.2);
      if (tool === 'motion') {
        this.play = !this.play;
        this.motionPreference = this.play;
        this.syncMotion();
        this.last = 0;
        this.wake();
      }
    };
    const v = this.surface;
    v.onkeydown = e => {
      if (!this.live) return;
      switch (e.key) {
        case 'ArrowRight':
          this.turn(0.16, 0);
          break;
        case 'ArrowLeft':
          this.turn(-0.16, 0);
          break;
        case 'ArrowUp':
          this.turn(0, 0.14);
          break;
        case 'ArrowDown':
          this.turn(0, -0.14);
          break;
        case '+':
        case '=':
          this.scale(1.2);
          break;
        case '-':
          this.scale(1 / 1.2);
          break;
        case 'Home':
          this.resetView();
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    v.onpointerdown = e => {
      if (!this.live || !e.isPrimary || e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      v.setPointerCapture(e.pointerId);
      v.dataset.drag = '';
      v.focus({ preventScroll: true });
    };
    v.onpointermove = e => {
      const d = this.drag;
      if (d?.id !== e.pointerId) return;
      this.turn((d.x - e.clientX) * 0.009, (e.clientY - d.y) * 0.008);
      d.x = e.clientX;
      d.y = e.clientY;
    };
    v.onlostpointercapture = v.onpointercancel = () => {
      this.drag = null;
      delete v.dataset.drag;
    };
    v.onwheel = e => {
      if (!this.live || document.activeElement !== v || e.ctrlKey) return;
      e.preventDefault();
      this.scale(Math.exp(-clamp(e.deltaY, -120, 120) * 0.002));
    };
    this.lifecycle = new AbortController();
    document.addEventListener('visibilitychange', () => this.visibility(), { signal: this.lifecycle.signal });
    this.reduce.addEventListener(
      'change',
      () => {
        if (this.reduce.matches) {
          this.play = false;
          this.motionPreference = false;
        }
        this.syncMotion();
        this.visibility();
      },
      { signal: this.lifecycle.signal }
    );
    this.observer = new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting;
      this.visibility();
    });
    this.observer.observe(v);
    this.resize = new ResizeObserver(() => this.wake());
    this.resize.observe(v);
    this.resetView();
  }
  disconnectedCallback() {
    this.observer?.disconnect();
    this.resize?.disconnect();
    this.lifecycle?.abort();
    this.release(true);
  }
  visible() {
    return this.isConnected && this.inView && !document.hidden;
  }
  release(park = false) {
    clearTimeout(this.delay);
    this.delay = 0;
    clearTimeout(this.deadline);
    cancelAnimationFrame(this.raf);
    if (this.worker && park && this.model && !this.canvas.hidden && this.mode.value === 'live')
      parkHull(this.owner, this.modelKey(), this.worker, this.model);
    else this.worker?.terminate();
    this.worker = null;
    this.model = null;
    this.raf = 0;
    this.sent = false;
    this.live = false;
    this.last = 0;
    this.dirty = false;
  }
  modelKey() {
    return JSON.stringify([this.unit.file, this.unit.color || '#ffffff']);
  }
  show(unit) {
    this.switching = !!this.unit;
    this.release();
    if (this.mode.value === 'portrait') forgetHull();
    this.unit = unit;
    this.failed = false;
    this.play = false;
    this.clip = '';
    this.drag = null;
    delete this.surface.dataset.drag;
    this.present(false);
    this.icon.hidden = !unit?.portrait;
    if (unit?.portrait) {
      this.icon.alt = `Command portrait of ${unit.label}`;
      this.icon.src = unit.portrait;
    } else this.icon.removeAttribute('src');
    this.canvas.setAttribute('aria-label', `Live mounted hull of ${unit?.hull || 'unit'}`);
    this.status.textContent = !unit
      ? 'No unit selected'
      : this.mode.value === 'portrait'
        ? 'Portrait mode · no 3D rendering'
        : !unit.file
          ? 'No mounted space model'
          : 'Preparing ' + unit.hull + '…';
    if (unit && !unit.portrait && (this.mode.value === 'portrait' || !unit.file)) this.status.textContent += ' · no command portrait';
    this.visibility();
  }
  present(ready) {
    this.canvas.hidden = !ready;
    this.surface.tabIndex = ready ? 0 : -1;
    this.surface.toggleAttribute('data-live', ready);
    this.zoomButtons.forEach(b => (b.disabled = !ready));
    this.motion.hidden = !ready || !this.clip;
    if (ready) this.icon.hidden = true;
  }
  fail() {
    this.release();
    this.failed = true;
    this.present(false);
    this.icon.hidden = !this.unit?.portrait;
    this.status.textContent = this.unit?.portrait ? 'Command portrait · live model unavailable' : 'No model or portrait available';
  }
  visibility() {
    if (!this.visible()) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      clearTimeout(this.delay);
      this.delay = 0;
      this.last = 0;
      return;
    }
    if (this.worker) return this.wake();
    if (!this.delay && this.unit?.file && !this.failed && this.mode.value === 'live')
      this.delay = setTimeout(
        () => {
          this.delay = 0;
          if (this.visible()) this.start();
        },
        this.switching ? 35 : 0
      );
  }
  start() {
    try {
      const hit = takeHull(this.owner, this.modelKey());
      const w = (this.worker =
        hit?.worker ||
        new Worker(new URL('./armorystageworker.js', import.meta.url), {
          type: 'module',
          name: 'Armory · ' + this.unit.hull
        }));
      let received = 0;
      this.deadline = setTimeout(() => {
        if (this.worker === w) this.fail();
      }, 25000);
      w.onerror = () => {
        if (this.worker === w) this.fail();
      };
      w.onmessage = async ({ data: q }) => {
        if (this.worker !== w) {
          q.bitmap?.close();
          return;
        }
        try {
          if (q.kind === 'asset') {
            // The page's VFS chooses the edition, mounted profile and loose overlays.
            // Range reads bound each preview asset; never detach cached page data.
            const path = String(q.path).replaceAll('\\', '/'),
              cap = 32 * MiB;
            const valid = /^data\/art\/(models|textures|shaders)\//i.test(path) && !path.split('/').includes('..');
            const label=usingRefit&&/^data\/art\/textures\/(SWR_SHIPYARD__[^/]+)$/i.exec(path);
            let bytes = valid && received < 96 * MiB ? (label?await readMaterialFile(label[1],file=>fetchPart('Data/Art/Textures/'+file,0,cap+1)):await fetchPart(path, 0, cap + 1)) : null;
            if (this.worker !== w) return;
            if (bytes) received += bytes.byteLength;
            if (bytes?.byteLength > cap || received > 96 * MiB) throw Error('Preview asset limit');
            w.postMessage({ kind: 'asset', id: q.id, bytes: bytes || null });
          } else if (q.kind === 'ready') {
            this.ready(q);
          } else if (q.kind === 'frame') {
            if (q.id !== this.drawId) {
              q.bitmap.close();
              return;
            }
            clearTimeout(this.deadline);
            this.sent = false;
            const { bitmap } = q;
            try {
              if (this.visible()) {
                if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
                  this.canvas.width = bitmap.width;
                  this.canvas.height = bitmap.height;
                }
                const ctx = this.canvas.getContext('2d');
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                ctx.drawImage(bitmap, 0, 0);
                if (this.canvas.hidden) {
                  this.present(true);
                  this.status.textContent = this.info;
                }
              }
            } finally {
              bitmap.close();
            }
            if (this.dirty || this.play) this.schedule();
          } else this.fail();
        } catch {
          if (this.worker === w) this.fail();
        }
      };
      if (hit) this.ready(hit.model);
      else w.postMessage({ kind: 'open', refit:usingRefit, file: this.unit.file, color: this.unit.color || '#ffffff' });
    } catch {
      this.fail();
    }
  }
  ready(model) {
    this.model = model;
    this.live = true;
    this.clip = model.clip;
    this.play = !!model.clip && (this.motionPreference ?? !this.reduce.matches);
    this.syncMotion();
    this.info = `${this.unit.hull} · ${model.meshes} mesh${model.meshes === 1 ? '' : 'es'} · ${model.textures} texture${model.textures === 1 ? '' : 's'}`;
    clearTimeout(this.deadline);
    this.wake();
  }
  syncMotion() {
    this.motion.textContent = this.play ? 'Pause idle' : 'Play idle';
    this.motion.title = this.clip || '';
    this.motion.setAttribute('aria-pressed', String(!!this.play));
  }
  resetView() {
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1;
    this.wake();
  }
  turn(dx, dy) {
    this.yaw = (this.yaw + dx) % (Math.PI * 2);
    this.pitch = clamp(this.pitch + dy, -1.83, 1.19);
    this.wake();
  }
  scale(f) {
    this.zoom = clamp(this.zoom * f, 0.55, 2.6);
    this.wake();
  }
  wake() {
    this.dirty = true;
    this.schedule();
  }
  schedule() {
    if (!this.live || this.sent || this.raf || !this.visible()) return;
    this.raf = requestAnimationFrame(t => {
      this.raf = 0;
      if (!this.visible() || !this.live) return;
      if (!this.dirty && (!this.play || t - this.last < 1000 / 24)) {
        if (this.play) this.schedule();
        return;
      }
      const box = this.surface.getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio || 1, 1.5, 1440 / Math.max(1, box.width), 800 / Math.max(1, box.height));
      const dt = this.play && this.last ? clamp((t - this.last) / 1000, 0, 0.1) : 0;
      this.dirty = false;
      this.sent = true;
      this.last = t;
      if (this.canvas.hidden) this.deadline = setTimeout(() => this.fail(), 15000);
      this.worker.postMessage({
        kind: 'draw',
        id: (this.drawId = ++requestId),
        w: Math.max(1, Math.round(box.width * ratio)),
        h: Math.max(1, Math.round(box.height * ratio)),
        yaw: this.yaw,
        pitch: this.pitch,
        zoom: this.zoom,
        dt
      });
    });
  }
}
customElements.define('armory-live-stage', ArmoryStage);
