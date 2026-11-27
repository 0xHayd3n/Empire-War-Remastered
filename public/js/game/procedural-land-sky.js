import { BackSide, BoxGeometry, Mesh, Scene, ShaderMaterial, Vector4 } from 'three';
import { skyAtmosphereShader } from '../land-atmosphere.js';

// One closed cube per visited outdoor environment. Its position follows the draw's eye
// (including reflected/cube cameras); all shading is in direction space, never cube UVs.
export function proceduralLandSky(context, weather, sunDir, drift) {
  const sky = new Scene(),
    flow = new Vector4(0, 0, context.seed * 193, +context.rings),
    uniforms = { ...weather.uniforms, skyFlow: { value: flow }, sunDir },
    geometry = new BoxGeometry(800, 800, 800),
    material = new ShaderMaterial({
      uniforms,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec3 skyRay; void main(){skyRay=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec4 wxZenith,wxHorizon,wxOptics,skyFlow,wxFormation,wxPhenomena; uniform vec3 sunDir; varying vec3 skyRay;
        ${skyAtmosphereShader(false)}
        void main(){gl_FragColor=vec4(landAtmosphere(normalize(skyRay)),1.);}`
    });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'Procedural land sky';
  mesh.frustumCulled = false;
  sky.add(mesh);
  // Sample an absolute battle clock: pauses, toggling Original and revisiting an
  // environment never advance or restart the clouds. Preserve an explicitly still layer.
  const gx = Number(drift?.[0] ?? 12) || 0,
    gy = Number(drift?.[1] ?? 3) || 0;
  return {
    sky,
    update(time) {
      flow.x = gx * time * 0.00038;
      flow.y = gy * time * 0.00038;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      sky.clear();
    }
  };
}
