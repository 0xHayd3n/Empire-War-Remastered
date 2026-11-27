// Short-lived local light sources. Presentation time, not the wall clock: pausing the battle
// freezes the light and particle together. Zoom affects selection, never world-space reach.
import { Frustum, Matrix4, Sphere } from 'three';

import { BLAST_SLOTS } from '../blastlight.js';
const MAX_EVENTS = 24;

export class BlastField {
  events = [];
  selected = [];
  frustum = new Frustum();
  clip = new Matrix4();
  sphere = new Sphere();

  emit(x, y, z, size, big) {
    if (![x, y, z, size].every(Number.isFinite) || size <= 0) return;
    const radius = Math.min(1700, Math.max(100, size * (big ? 6 : 4.5)));
    if (this.events.length >= MAX_EVENTS) this.events.shift();
    this.events.push({ x, y, z, radius, age: 0, life: Math.min(1.25, 0.32 + radius * 0.00054), score: 0 });
  }

  advance(dt) {
    let n = 0;
    for (const e of this.events) {
      e.age += dt;
      if (e.age < e.life) this.events[n++] = e;
    }
    this.events.length = n;
  }

  bind(uniforms, world, camera) {
    const out = this.selected;
    out.length = 0;
    this.frustum.setFromProjectionMatrix(this.clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const e of this.events) {
      this.sphere.center.set(e.x, e.y, e.z);
      this.sphere.radius = e.radius;
      if (!this.frustum.intersectsSphere(this.sphere) || world.viewFogged?.(e.x, e.y)) continue;
      const tail = 1 - e.age / e.life;
      e.power = tail * tail;
      e.score = (e.power * e.radius ** 2) / Math.max(1, camera.position.distanceToSquared(this.sphere.center));
      out.push(e);
    }
    out.sort((a, b) => b.score - a.score);
    uniforms.blastCount.value = Math.min(out.length, BLAST_SLOTS);
    for (let i = 0; i < uniforms.blastCount.value; i++) {
      const e = out[i],
        k = e.power;
      // Hot pale core fades to amber. RGB is incident linear light, not a screen tint.
      uniforms.blastSource.value[i].set(e.x, e.y, e.z, 1 / e.radius);
      uniforms.blastEnergy.value[i].set(3.2 * k, (0.85 + 1.36 * k) * k, (0.19 + 0.94 * k) * k, 0);
    }
  }
}
