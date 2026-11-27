import { families, PASS_WGSL, simple, texBinding, col3, vec4, num } from './programs.js';
import { airColumn } from '../planetshine.js';
import { planetVertex } from '../planetshader.js';

const planetCode = D =>
  PASS_WGSL +
  `
struct Draw { model: mat4x4f, modelView: mat4x4f }
struct Planet {
  sunDir: vec3f, atmospherePower: f32,
  sunColor: vec3f, cloudScroll: f32,
  fillDir: vec3f, time: f32,
  fillColor: vec3f, opacity: f32,
  fillDir2: vec3f, orbitalAir: f32,
  fillColor2: vec3f, cloudLayer: f32,
  ambient: vec3f, planetColumn: f32,
  emissive: vec3f, _d: f32,
  diffuse: vec3f, _e: f32,
  specular: vec3f, _f: f32,
  sunSpecular: vec3f, _g: f32,
  cityColor: vec3f, _h: f32,
  atmosphere: vec4f,
  lightScale: vec4f,
}
@group(1) @binding(0) var mapT: texture_2d<f32>;
@group(1) @binding(1) var mapS: sampler;
@group(1) @binding(2) var normalMapT: texture_2d<f32>;
@group(1) @binding(3) var normalMapS: sampler;
@group(1) @binding(4) var cloudMapT: texture_2d<f32>;
@group(1) @binding(5) var cloudMapS: sampler;
@group(1) @binding(6) var cloudNormalMapT: texture_2d<f32>;
@group(1) @binding(7) var cloudNormalMapS: sampler;
@group(1) @binding(8) var<uniform> U: Planet;
@group(2) @binding(0) var<uniform> D: Draw;
struct VIn { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) tangent: vec3f, @location(4) binormal: vec3f }
struct VOut {
  @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vCloudUv: vec2f,
  @location(2) vLight: vec3f, @location(3) vHalf: vec3f, @location(4) vFill: vec3f, @location(5) vSpecular: vec3f,
  @location(6) vRim: f32, @location(7) vNight: f32, @location(8) vAlpha: f32, @location(9) vFacing: f32,
}
fn fillLight(n: vec3f, d: vec3f, color: vec3f) -> vec3f {
  let sh = .282095*.282095*3.141593
    + .488603*.488603*2.094395*dot(n,d)
    + 1.092548*1.092548*.785398*(n.x*n.y*d.x*d.y+n.y*n.z*d.y*d.z+n.z*n.x*d.z*d.x)
    + .315392*.315392*.785398*(3.0*n.z*n.z-1.0)*(3.0*d.z*d.z-1.0)
    + .546274*.546274*.785398*(n.x*n.x-n.y*n.y)*(d.x*d.x-d.y*d.y);
  return color*sh;
}
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  let world = D.model*vec4f(i.position,1.0);
  let rotation = mat3x3f(D.model[0].xyz, D.model[1].xyz, D.model[2].xyz);
  var worldNormal = normalize(rotation*i.normal);
  let eye = normalize(P.cameraPosition-world.xyz);
  let inverseRotation = mat3x3f(cross(rotation[1],rotation[2]),cross(rotation[2],rotation[0]),cross(rotation[0],rotation[1]));
  let determinant = dot(rotation[0],inverseRotation[0]);
  o.vLight = vec3f(0.0); o.vHalf = vec3f(0.0); o.vSpecular = vec3f(0.0); o.vRim = 0.0; o.vNight = 0.0;
  ${
    D.PLANET_FIXED
      ? `
  worldNormal=normalize(inverseRotation*i.normal/determinant);
  o.vFill=clamp(U.emissive+U.diffuse*U.ambient+U.diffuse*U.lightScale.rgb*(
    U.sunColor*max(dot(worldNormal,U.sunDir),0.0)
    +U.fillColor*max(dot(worldNormal,U.fillDir),0.0)
    +U.fillColor2*max(dot(worldNormal,U.fillDir2),0.0)),vec3f(0.0),vec3f(1.0));
  o.vCloudUv=i.uv;`
      : `
  let objectLight = normalize(vec3f(dot(inverseRotation[0],U.sunDir),dot(inverseRotation[1],U.sunDir),dot(inverseRotation[2],U.sunDir))/determinant);
  let objectEye = normalize(vec3f(dot(inverseRotation[0],eye),dot(inverseRotation[1],eye),dot(inverseRotation[2],eye))/determinant);
  let halfDirection = normalize(objectEye+objectLight);
  o.vLight = normalize(vec3f(dot(objectLight,i.tangent),dot(objectLight,i.binormal),dot(objectLight,i.normal)));
  o.vHalf = normalize(vec3f(dot(halfDirection,i.tangent),dot(halfDirection,i.binormal),dot(halfDirection,i.normal)));
  o.vFill = clamp(U.emissive+U.diffuse*U.lightScale.rgb*(U.ambient*(3.5449052*.282095)+fillLight(worldNormal,U.fillDir,U.fillColor)+fillLight(worldNormal,U.fillDir2,U.fillColor2)),vec3f(0.0),vec3f(1.0));
  o.vSpecular=clamp(U.specular*U.sunSpecular*pow(max(dot(worldNormal,normalize(eye+U.sunDir)),0.0),16.0),vec3f(0.0),vec3f(1.0));
  o.vRim = 2.0*U.atmosphere.a*pow(1.0-dot(worldNormal,eye),U.atmospherePower);
  o.vNight = clamp(dot(i.normal,-32.0*objectLight),0.0,1.0);
  o.vCloudUv=i.uv+vec2f(U.time*U.cloudScroll,0.0);`
  }
  o.vFacing=dot(worldNormal,eye);
  o.vAlpha=clamp(U.lightScale.a*U.opacity,0.0,1.0);
  o.vUv=i.uv;
  o.pos=glDepth(P.proj*P.view*world);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let base=textureSample(mapT,mapS,v.vUv);
  let cloud=textureSample(cloudMapT,cloudMapS,v.vCloudUv);
  let normal=textureSample(normalMapT,normalMapS,v.vUv);
  let cloudNormalT=textureSample(cloudNormalMapT,cloudNormalMapS,v.vCloudUv);
  ${
    D.PLANET_FIXED
      ? `
  return vec4f(2.0*v.vFill*mix(base.rgb,cloud.rgb,cloud.a),v.vAlpha);`
      : `
  let decodedNormal=normal.rgb*2.0-1.0;
  var rim=v.vRim; var sunVis=1.0; var air=vec3f(0.0);
  let shell=U.planetColumn>0.0 && U.atmosphere.a>0.0 && max(U.atmosphere.r,max(U.atmosphere.g,U.atmosphere.b))>0.0;
  if (U.orbitalAir>0.0 || shell) {
    let day=smoothstep(-0.18,0.32,v.vLight.z); let edge=1.0-clamp(v.vFacing,0.0,1.0);
    rim*=mix(1.0,0.18+0.42*day,U.orbitalAir);
    air=U.orbitalAir*max(U.atmosphere.a,0.0)*U.atmosphere.rgb*U.sunColor*day*edge*edge*(0.55+2.35*edge*edge);
    air/=1.0+0.65*max(air.r,max(air.g,air.b));
    if (U.cloudLayer>0.0) {
      let offset=vec2f(0.0025,0.005)*v.vLight.xy/max(v.vLight.z,0.24);
      let blocker=textureSample(cloudMapT,cloudMapS,v.vCloudUv+offset).a;
      sunVis-=max(U.orbitalAir,select(0.0,1.0,shell))*0.60*blocker*smoothstep(0.0,0.18,v.vLight.z);
    }
  }
  if(shell) {rim=0.0;air=vec3f(0.0);}
  ${
    D.PLANET_DX8
      ? `
  let light=U.sunColor*U.diffuse*clamp(dot(decodedNormal,v.vLight),0.0,1.0)*mix(sunVis,1.0,cloud.a)+v.vFill;
  var rgb=2.0*light*(mix(base.rgb,cloud.rgb,cloud.a)+U.atmosphere.rgb*rim)
    +U.cityColor*(cloud.a*base.a*v.vNight)+normal.a*v.vSpecular;
  `
      : `
  let cloudNormal=cloudNormalT.rgb*2.0-1.0;
  let surface=2.0*(U.sunColor*U.diffuse*clamp(dot(decodedNormal,v.vLight),0.0,1.0)*sunVis+v.vFill)
    *(base.rgb+U.atmosphere.rgb*rim);
  let city=U.cityColor*base.a*v.vNight*(1.0-cloud.a);
  let gloss=U.specular*U.sunSpecular*pow(clamp(dot(decodedNormal,v.vHalf),0.0,1.0),16.0)*normal.a;
  let clouds=2.0*(cloud.rgb*clamp(dot(cloudNormal,v.vLight),0.0,1.0)*U.sunColor+v.vFill);
  var rgb=mix(surface+city+gloss,clouds,cloud.a);`
  }
  if(shell) {${airColumn(true)}}
  return vec4f(rgb+air,v.vAlpha);`
  }
}`;

const planetVariant = m => (m.defines && m.defines.PLANET_FIXED ? 'F' : m.defines && m.defines.PLANET_DX8 ? 'D' : 'S');

const planet = {
  name: 'planet',
  match: m => m.isShaderMaterial && m.vertexShader === planetVertex,
  key: m => 'planet|' + planetVariant(m),
  code: m => planetCode(m.defines || {}),
  attributes: () => ({
    vertex: [
      ['position', 3, 0],
      ['normal', 3, 1],
      ['uv', 2, 2],
      ['tangent', 3, 3],
      ['binormal', 3, 4]
    ],
    instance: []
  }),
  layout: [
    ...texBinding(0),
    ...texBinding(2),
    ...texBinding(4),
    ...texBinding(6),
    { binding: 8, visibility: 3, buffer: { type: 'uniform' } }
  ],
  textures: m => ['map', 'normalMap', 'cloudMap', 'cloudNormalMap'].map(k => m.uniforms[k] && m.uniforms[k].value),
  block: {
    size: 224,
    fill(m, f) {
      const U = m.uniforms;
      const c = (o, k) => col3(f, o, U[k] && U[k].value);
      c(0, 'sunDir');
      f[3] = num(U.atmospherePower);
      c(4, 'sunColor');
      f[7] = num(U.cloudScroll);
      c(8, 'fillDir');
      f[11] = num(U.time);
      c(12, 'fillColor');
      f[15] = num(U.opacity);
      c(16, 'fillDir2');
      f[19] = num(U.orbitalAir);
      c(20, 'fillColor2');
      f[23] = num(U.cloudLayer);
      c(24, 'ambient');
      f[27] = num(U.planetColumn);
      c(28, 'emissive');
      c(32, 'diffuse');
      c(36, 'specular');
      c(40, 'sunSpecular');
      c(44, 'cityColor');
      vec4(f, 48, U.atmosphere && U.atmosphere.value);
      vec4(f, 52, U.lightScale && U.lightScale.value);
    }
  },
  params() {}
};

const FLAT_FS = color => `
@fragment fn fs(v: VOut) -> @location(0) vec4f { return textureSample(mapT, mapS, v.vUv) * ${color}; }`;

const route = simple({
  name: 'route',
  match: m =>
    m.isShaderMaterial && !!m.uniforms && !!m.uniforms.across && !!m.uniforms.width && m.vertexShader.includes('attribute float side;'),
  params: [
    ['across', 'c3'],
    ['width', 'f'],
    ['color', 'c3'],
    ['opacity', 'f']
  ],
  textures: ['map'],
  vertex: () => [
    ['position', 3, 0],
    ['side', 1, 1],
    ['uv', 2, 2]
  ],
  code: () =>
    `
struct VIn { @location(0) position: vec3f, @location(1) side: f32, @location(2) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position + D.across * i.side * D.width * .5, 1.0)); return o; }` +
    FLAT_FS('vec4f(D.color, D.opacity)')
});

const routeQuads = simple({
  name: 'routeQuads',
  textures: ['map'],
  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.map && m.vertexShader.includes('attribute vec3 aAcross;'),
  vertex: () => [
    ['position', 3, 0],
    ['side', 1, 1],
    ['uv', 2, 2],
    ['aAcross', 3, 3],
    ['aWidth', 1, 4],
    ['aColor', 4, 5]
  ],
  code: () =>
    `
struct VIn { @location(0) position: vec3f, @location(1) side: f32, @location(2) uv: vec2f, @location(3) aAcross: vec3f, @location(4) aWidth: f32, @location(5) aColor: vec4f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vColor: vec4f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.vColor = i.aColor; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position + i.aAcross * i.side * i.aWidth * .5, 1.0)); return o; }` +
    FLAT_FS('v.vColor')
});

const colored = (name, n, test) =>
  simple({
    name,
    textures: ['map'],
    match: m =>
      m.isShaderMaterial && !!m.uniforms && !!m.uniforms.map && Object.keys(m.uniforms).length === 1 && m.vertexShader.startsWith(test),
    vertex: () => [
      ['position', 3, 0],
      ['uv', 2, 1],
      ['aColor', n, 2]
    ],
    code: () =>
      `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f, @location(2) aColor: ${n === 3 ? 'vec3f' : 'vec4f'} }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vColor: ${n === 3 ? 'vec3f' : 'vec4f'} }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.vColor = i.aColor; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0)); return o; }` +
      FLAT_FS(n === 3 ? 'vec4f(v.vColor, 1.0)' : 'v.vColor')
  });
const routeSparks = colored('routeSparks', 4, '\nattribute vec4 aColor;\nvarying vec2 vUv;');
const fleetLines = colored('fleetLines', 3, '\nattribute vec3 aColor;\nvarying vec2 vUv;');

families.push(planet, route, routeQuads, routeSparks, fleetLines);
