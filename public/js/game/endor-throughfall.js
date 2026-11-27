// The archive's rain volume is centred 500 units ahead. At squad height the trunks can
// occlude that entire volume. Draw only the missing near field, in world space: rain in
// gaps, fewer and heavier drips under crowns. No screen texture, particle RNG or entity.
import * as T from 'three';
import { randomAt } from './endor-grove.js';
import { heightAt } from './terrain.js';
const grid = 9,
  radius = 10,
  max = (2 * radius + 1) ** 2;
export function throughfall(scene) {
  const geo = new T.BufferGeometry(),
    positions = new T.BufferAttribute(new Float32Array(max * 12), 3),
    ix = new Uint16Array(max * 6);
  for (let i = 0; i < max; i++) ix.set([4 * i, 4 * i + 1, 4 * i + 2, 4 * i, 4 * i + 2, 4 * i + 3], 6 * i);
  positions.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', positions);
  geo.setIndex(new T.BufferAttribute(ix, 1));
  const mat = new T.MeshBasicMaterial({ color: new T.Color(0.71, 0.79, 0.83), transparent: true, depthWrite: false, side: T.DoubleSide });
  mat.forceSinglePass = true;
  const mesh = new T.Mesh(geo, mat);
  mesh.name = 'Endor near rain';
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  scene.add(mesh);
  return {
    update(g, on, detail) {
      mesh.visible = false;
      const { rain, wet } = g.forestSky,
        t = g.terrain,
        cover = g.ground.material.uniforms.canopyMap.value?.image;
      if (!on || !cover || !(detail > 0) || g.view.dist >= 330 || Math.max(rain, wet * 0.16) < 0.012) return;
      g.camera.updateMatrixWorld();
      const eye = g.camera.position,
        rx = Math.floor(eye.x / grid),
        ry = Math.floor(eye.y / grid),
        xMax = ((t.width ?? t.size) - 1) * 20,
        yMax = ((t.height ?? t.size) - 1) * 20,
        matrix = g.camera.matrixWorld.elements,
        fog = t.fog?.image,
        time = g.world.time,
        water = t.water?.mode === 1 ? t.water.level : -Infinity,
        wind = g.fx.breeze;
      let count = 0;
      for (let j = ry - radius; j <= ry + radius; j++)
        for (let i = rx - radius; i <= rx + radius; i++) {
          const x = (i + randomAt(i, j, 13)) * grid,
            y = (j + randomAt(i, j, 17)) * grid;
          if (x < 0 || x >= xMax || y < 0 || y >= yMax) continue;
          const dx = x - eye.x,
            dy = y - eye.y,
            r = Math.hypot(dx, dy);
          if (r < 11 || r > 90) continue;
          if (fog && fog.data[Math.floor(y / 40) * fog.width + Math.floor(x / 40)] < 200) continue;
          const c = cover.data[(Math.floor((y / yMax) * cover.height) * cover.width + Math.floor((x / xMax) * cover.width)) * 4 + 1] / 255;
          const drip = c > 0.44,
            flux = drip ? (rain * 0.49 + wet * 0.16) * c : rain * (1 - c);
          if (randomAt(i, j, 23) > flux * detail) continue;
          const base = Math.max(water, heightAt(t, x, y)),
            h = drip ? 43 : 84,
            speed = drip ? 1.6 : 1.22;
          const cycle = time * speed + randomAt(i, j, 33),
            phase = cycle - Math.floor(cycle),
            z = base + h * (1 - phase * (drip ? phase : 1));
          if (z <= base + 0.8 || Math.abs(z - eye.z) > 85) continue;
          const length = Math.min(z - base, drip ? 1 + 2 * phase : 3.6),
            width = (drip ? 0.11 : 0.068) * Math.min(1, (r - 11) / 5, (90 - r) / 10),
            sx = matrix[0] * width,
            sy = matrix[1] * width,
            sz = matrix[2] * width,
            bx = drip ? 0 : (wind?.[0] || 0) * 0.04,
            by = drip ? 0 : (wind?.[1] || 0) * 0.04,
            k = 4 * count++;
          positions.setXYZ(k, x + bx, y + by, z);
          positions.setXYZ(k + 1, x + sx, y + sy, z - length * 0.68 + sz);
          positions.setXYZ(k + 2, x, y, z - length);
          positions.setXYZ(k + 3, x - sx, y - sy, z - length * 0.68 - sz);
        }
      geo.setDrawRange(0, count * 6);
      positions.needsUpdate = true;
      mesh.visible = count > 0;
      mat.opacity = 0.33 * Math.min(1, (330 - g.view.dist) / 120);
    },
    dispose() {
      mesh.removeFromParent();
      mat.dispose();
      geo.dispose();
    }
  };
}
