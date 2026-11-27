// Called inside check-yavin-remaster's frozen mounted battle. Inspect submitted instance matrices,
// not the recipe's placement totals. Masks affect this private diagnostic only.
const path = require('node:path');
module.exports = async function foliageSweep(body, page, out, report, PNG) {
  const setup = await body.evaluate(async () => {
    const g = game,
      group = g.scene.getObjectByName('Yavin broadleaf canopy'),
      arr = new WeakMap(),
      gl = g.gpuOn ? null : g.renderer.getContext();
    let unused = 0,
      written = 0;
    if (!group) throw Error('No mounted replacement canopy');
    const sub = gl?.bufferSubData,
      gpu = g.gpuOn ? g.gpu : null,
      framed = gpu?.framed;
    if (gpu)
      gpu.framed = function (key, src, n) {
        const m = arr.get(src);
        if (m) {
          written += 4 * n;
          unused += 4 * Math.max(0, n - m.count * 16);
        }
        return framed.apply(this, arguments);
      };
    if (gl)
      gl.bufferSubData = function (...a) {
        const m = arr.get(a[2]);
        if (m) {
          const end = (a[3] || 0) + (a[4] || a[2].length);
          written += (a[4] || a[2].length) * 4;
          unused += 4 * Math.max(0, end - m.count * 16);
        }
        return sub.apply(this, a);
      };
    window.foliageProbe = {
      read(role, c) {
        const ids = [],
          seen = new Set();
        let dup = 0,
          live = 0,
          capacity = 0,
          triangles = 0;
        for (const m of group.children) {
          if (!m.isInstancedMesh) continue;
          arr.set(m.instanceMatrix.array, m);
          const k = m.userData.foliage;
          if (!m.visible || k?.role !== role) continue;
          capacity += m.instanceMatrix.count;
          live += m.count;
          triangles += (m.count * m.geometry.index.count) / 3;
          for (let i = 0; i < m.count; i++) {
            const a = m.instanceMatrix.array,
              j = i * 16,
              x = a[j + 12],
              y = a[j + 13];
            if (Math.hypot(x - c[0], y - c[1]) > 115) continue;
            const key = [x, y, a[j], a[j + 1]].join('/');
            if (seen.has(key)) dup++;
            seen.add(key);
            ids.push(key);
          }
        }
        const status = g.ground.userData.reviewedLandscape.canopy;
        return {
          ids: ids.sort(),
          dup,
          live,
          capacity,
          triangles,
          plans: status.plans,
          streams: status.streams.filter(s => s.role === role)
        };
      },
      mask(role, off) {
        for (const m of group.children) if (m.userData.foliage?.role === role) m.layers.mask = off ? 0 : 1;
      },
      end() {
        if (gl) gl.bufferSubData = sub;
        if (gpu) gpu.framed = framed;
        return { unused, written };
      }
    };
    return { maximum: g.cam.steps.at(-1)[0], target: g.viewTilt(g.cam.steps.at(-1)[0]) };
  });
  const result = { maximum: setup.maximum, samples: [], controls: [], roles: ['fern', 'broadleaf', 'canopy'] };
  try {
    for (const [region, role, base] of [
      ['army', 'fern', report.cameras.squad],
      ['jungle', 'broadleaf', report.cameras.jungle],
      ['treeline', 'canopy', report.cameras.treeline]
    ]) {
      let reference = null;
      const distances = [128, 429, 431, 539, 541, 679, 681, 740, setup.maximum, 128];
      for (let step = 0; step < distances.length; step++) {
        const d = distances[step],
          pitch = await body.evaluate((_, d) => game.viewTilt(d), d),
          c = [base[0], base[1], d, pitch, base[4]];
        await body.evaluate((_, args) => yavinDraw(args), { c, on: true, warmFrames: 6 });
        const s = await body.evaluate((_, { role, c }) => foliageProbe.read(role, c), { role, c });
        if (!reference) reference = s.ids;
        const same = s.ids.length === reference.length && s.ids.every((id, i) => id === reference[i]);
        if (!same || !s.ids.length || s.dup)
          throw Error('Vanishing/duplicate roots: ' + JSON.stringify([region, d, s.ids.length, reference.length, s.dup]));
        result.samples.push({
          region,
          role,
          d,
          roots: s.ids.length,
          same,
          live: s.live,
          capacity: s.capacity,
          triangles: s.triangles,
          plans: s.plans,
          streams: s.streams
        });
        if (step === 0 || d === setup.maximum || (region === 'army' && d === 740)) {
          const stem = `foliage-${region}-${d}`,
            on = PNG.sync.read(await page.screenshot({ path: path.join(out, stem + '.png') }));
          await body.evaluate((_, r) => foliageProbe.mask(r, true), role);
          try {
            await body.evaluate((_, args) => yavinDraw(args), { c, on: true, warmFrames: 6 });
            const off = PNG.sync.read(await page.screenshot({ path: path.join(out, stem + '-off.png') }));
            let pixels = 0;
            for (let y = 100; y < 540; y++)
              for (let x = 260; x < 1180; x++) {
                const j = (y * on.width + x) * 4;
                if ([0, 1, 2].reduce((s, k) => s + Math.abs(on.data[j + k] - off.data[j + k]), 0) > 18) pixels++;
              }
            if (pixels < 25) throw Error('No visible ' + role + ' contribution at ' + d + ': ' + pixels);
            result.controls.push({ region, role, d, stem, pixels });
          } finally {
            await body.evaluate((_, r) => foliageProbe.mask(r, false), role);
          }
        }
      }
    }
  } finally {
    result.uploads = await body.evaluate(() => foliageProbe.end());
  }
  return result;
};
