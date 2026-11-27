// An isolated, lit copy of a native material for the UI's WebGL context. Never
// mutate a battlefield shader/texture or bind a shadow target from another GL.
export function previewMaterial(src, owned, depth) {
  const m = src.clone();
  for (const [key, u] of Object.entries(src.uniforms)) {
    const copy = m.uniforms[key];
    if (!copy?.value?.isTexture) continue;
    const keep = owned.get(u.value) || u.value;
    if (copy.value !== keep && copy.value !== u.value) copy.value.dispose?.();
    copy.value = keep;
  }
  const u = m.uniforms;
  if (u.shadowMap) u.shadowMap.value = depth;
  if (u.hullShadowMap) u.hullShadowMap.value = depth;
  u.hullShadowParams?.value.set(0,0,0);
  for (const key of ['shadowOn', 'fowSide', 'boltN']) if (u[key]) u[key].value = 0;
  u.fogRange?.value.set(0, 0);
  u.sunDir?.value.set(-0.6, -0.5, 0.8).normalize();
  u.sunColor?.value.setRGB(0.93, 0.91, 0.85);
  u.fillDir?.value.set(0.8, 0.5, 0.4).normalize();
  u.fillColor?.value.setRGB(0.34, 0.43, 0.56);
  u.ambient?.value.setRGB(0.46, 0.47, 0.5);
  return m;
}
