// Passed to Playwright evaluate() inside the mounted game's frame. Read an actual model shader, not a JS gamma approximation.
module.exports = async function halfLight() {
  const T = await import('three'), { programSources, lighting } = await import('/js/model.js');
  const R = game.renderer.renderer, scene = new T.Scene(), cam = new T.OrthographicCamera(-1,1,1,-1,0.1,10);
  const target = new T.WebGLRenderTarget(8,8), pixels = new Uint8Array(4), keep = R.getRenderTarget();
  const code = (n) => { const t=new T.DataTexture(new Uint8Array([n,n,n,255]),1,1); t.needsUpdate=true; return t; };
  const white = code(255), grey = code(128), un = value => ({value}), rgb = n => un(new T.Color(n,n,n));
  const uniforms = { ...lighting, orbitalKey:un(2), orbitHDR:un(0), surfaceLook:un(new T.Vector2()), materialFinish:un(0),
    orbitPos:un(new T.Matrix3().multiplyScalar(0)), orbitNeg:un(new T.Matrix3().multiplyScalar(0)), orbitDir:un(new T.Vector3()), orbitRadiance:un(new T.Vector3()),
    sunDir:un(new T.Vector3(0,0,1)), sunColor:rgb(0.5 / 1.12), ambient:rgb(0), fillColor:rgb(0), fillColor2:rgb(0),
    sunSpecular:rgb(0), shadowTint:rgb(-1), shadowOn:un(0), fogRange:un(new T.Vector2()), map:un(white), normalMap:un(white),
    diffuse:rgb(1), emissive:rgb(0), specular:rgb(0), opacity:un(1), uvScroll:un(new T.Vector2()), tint:un(new T.Vector4(1,1,1,0)), boltN:un(0),
    boltAt:un(Array.from({length:16},()=>new T.Vector4())), boltTint:un(Array.from({length:16},()=>new T.Vector4())) };
  const mat=new T.ShaderMaterial({ uniforms,vertexShader:programSources.VERT,fragmentShader:programSources.FRAG,side:T.DoubleSide });
  const geo=new T.PlaneGeometry(2,2);
  for(const key of ['tangent','binormal']) geo.setAttribute(key,new T.Float32BufferAttribute(Array.from({length:4},()=>key==='tangent'?[1,0,0]:[0,1,0]).flat(),3));
  cam.position.z=2; cam.updateMatrixWorld(); scene.add(new T.Mesh(geo,mat));
  const result=[];
  try {
    // Same gray paint under direct sunlight, then turned away with only map fill.
    for(const [stage,tex,night] of [[1,white],[2,white],[2,grey],[3,grey],[4,grey],[3,grey,true],[4,grey,true]]) {
      uniforms.sunDir.value.z=night ? -1 : 1;
      uniforms.ambient.value.setRGB(night ? 0.25 : 0,night ? 0.25 : 0,night ? 0.25 : 0);
      uniforms.orbitalKey.value=stage; uniforms.map.value=tex;
      R.setRenderTarget(target); R.clear(); R.render(scene,cam); R.endFrame?.(); await R.settle?.();
      R.clear(); R.render(scene,cam); await R.readRenderTargetPixelsAsync(target,4,4,1,1,pixels);
      result.push([...pixels.subarray(0,3)]);
    }
  } finally { R.setRenderTarget(keep); target.dispose(); geo.dispose(); mat.dispose(); white.dispose(); grey.dispose(); }
  return result;
};
