// Install a slow independent triangle-ray reference inside the frozen mounted check only.
// Classify sampled dorsal deck pixels using geometry, never the rendered shadow map.
module.exports = async function install() {
  const T = await import('three');
  window.inspectHullShadow = (sh, u, cam, sun, off, on, w, h) => {
    const meshes = Array.from(sh.meshes.values()),
      inv = u.obj.matrixWorld.clone().invert(),
      s = sun.clone().transformDirection(inv);
    const eye = new T.Raycaster(),
      light = new T.Raycaster(),
      uv = new T.Vector2(),
      n = new T.Vector3(),
      normalMat = new T.Matrix3();
    const samples = { clear: [], blocked: [] };
    for (let y = 10; y < h; y += 18)
      for (let x = 10; x < w; x += 18) {
        eye.setFromCamera(uv.set((2 * (x + 0.5)) / w - 1, 1 - (2 * (y + 0.5)) / h), cam);
        eye.ray.applyMatrix4(inv);
        const hit = eye.intersectObjects(meshes, false)[0];
        if (!hit) continue;
        n.copy(hit.face.normal).applyNormalMatrix(normalMat.getNormalMatrix(hit.object.matrixWorld));
        if (n.dot(eye.ray.direction) > 0) n.negate();
        if (n.z < 0.72 || n.dot(s) < 0.06) continue; // faced toward the camera AND receiving direct sunlight
        light.ray.origin.copy(hit.point).addScaledVector(n, 0.14);
        light.ray.direction.copy(s);
        light.near = 0.2;
        const obstruction = light.intersectObjects(meshes, false)[0];
        if (obstruction && obstruction.distance < 6) continue; // avoid ambiguous near-contact/filter footprints
        const i = (y * w + x) * 4,
          base = (off[i] + off[i + 1] + off[i + 2]) / 3,
          value = (on[i] + on[i + 1] + on[i + 2]) / 3;
        if (base < 30 || base > 230) continue;
        samples[obstruction ? 'blocked' : 'clear'].push(base - value);
      }
    return Object.fromEntries(
      Object.entries(samples).map(([key, a]) => {
        a.sort((a, b) => a - b);
        return [key, { n: a.length, medianDrop: a[Math.floor(a.length * 0.5)] ?? null, p90Drop: a[Math.floor(a.length * 0.9)] ?? null }];
      })
    );
  };
};
