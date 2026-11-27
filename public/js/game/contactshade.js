// Opposite sample pairs at two radii. No frame-varying noise, history or offscreen geometry.
const taps = v =>
  [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.56, 0.56],
    [-0.56, -0.56],
    [0.56, -0.56],
    [-0.56, 0.56],
    [0.27, 0.12],
    [-0.27, -0.12],
    [-0.12, 0.27],
    [0.12, -0.27]
  ]
    .map(([x, y]) => `tap(uv, ${v}(${x.toFixed(2)}, ${y.toFixed(2)})*span, z, slope, radius, ground)`)
    .join(' + ');

// Linear view distance, never differences in nonlinear hardware Z. Estimate the local plane from
// the nearer-in-depth neighbour on each axis, so a tilted flat plate doesn't shadow itself.
export const contactGLSL = `
uniform sampler2D contactDepth, contactSurface;
uniform float terrainContactMask, contactMaxSpan;
uniform vec4 waterPlane;
uniform vec4 contactParams; // near, far, world height at unit distance, strength
float distanceAt(vec2 uv) {
  float d = texture2D(contactDepth,uv).r;
  return contactParams.x*contactParams.y / (contactParams.y*(1.0-d) + contactParams.x*d);
}
float closer(float a, float b) { return abs(a)<abs(b) ? a : b; }
float tap(vec2 uv,vec2 stepPx,float z,vec2 slope,float radius,bool ground) {
  vec2 px = round(stepPx); float dz = z-distanceAt(uv+px*texel);
  float rise = dz + dot(slope,px);
  float shade=smoothstep(0.015,0.22,rise/radius)*(1.0-smoothstep(0.65,1.4,abs(dz)/radius));
  if(ground && shade>0.)shade*=textureLod(contactSurface,uv+px*texel,0.).a;
  return shade;
}
float contactVisibility(vec2 uv) {
  float z=distanceAt(uv); if(z>=contactParams.y*0.995) return 1.0;
  if(waterPlane.w + z*(dot(waterPlane.xy,2.0*uv-1.0)+waterPlane.z)<0.35) return 1.0;
  bool ground=terrainContactMask>0. && textureLod(contactSurface,uv,0.).a<0.5;
  if(terrainContactMask>1.5 && !ground) return 1.0;
  vec2 slope=vec2(closer(distanceAt(uv+vec2(texel.x,0.0))-z,z-distanceAt(uv-vec2(texel.x,0.0))),
                  closer(distanceAt(uv+vec2(0.0,texel.y))-z,z-distanceAt(uv-vec2(0.0,texel.y))));
  float unit=max(z*contactParams.z*texel.y,0.0001);
  float span=clamp(min(z*0.024,42.0)/unit,1.0,contactMaxSpan), radius=span*unit;
  float shade=(${taps('vec2')})/12.0;
  // A footprint crease is only a couple of world units wide. Once the pixel
  // footprint is larger than that, don't trace the ground side of a distant ledge.
  float resolved=terrainContactMask>1.5 ? 1.0-smoothstep(0.9,2.25,radius) : 1.0;
  return 1.0-min(0.72,shade*1.8)*contactParams.w*resolved;
}`;
export const contactWGSL = `
fn distanceAt(uv:vec2f) -> f32 {
  let dim=vec2i(textureDimensions(contactDepthT));
  let d=textureLoad(contactDepthT,clamp(vec2i(uv*vec2f(dim)),vec2i(0),dim-1),0);
  return D.contactParams.x*D.contactParams.y / (D.contactParams.y*(1.0-d)+D.contactParams.x*d);
}
fn closer(a:f32,b:f32)->f32 { return select(b,a,abs(a)<abs(b)); }
fn tap(uv:vec2f, stepPx:vec2f, z:f32, slope:vec2f, radius:f32, ground:bool)->f32 {
  let px=round(stepPx); let dz=z-distanceAt(uv+px*D.texel);
  let rise=dz+dot(slope,px);
  let shade=smoothstep(0.015,0.22,rise/radius)*(1.0-smoothstep(0.65,1.4,abs(dz)/radius));
  if(ground && shade>0.){return shade*textureSampleLevel(contactSurfaceT,contactSurfaceS,uv+px*D.texel,0.).a;}
  return shade;
}
fn contactVisibility(uv:vec2f)->f32 {
  let z=distanceAt(uv); if(z>=D.contactParams.y*0.995) { return 1.0; }
  if(D.waterPlane.w + z*(dot(D.waterPlane.xy,2.0*uv-1.0)+D.waterPlane.z)<0.35){return 1.0;}
  let ground=D.terrainContactMask>0. && textureSampleLevel(contactSurfaceT,contactSurfaceS,uv,0.).a<0.5;
  if(D.terrainContactMask>1.5 && !ground){return 1.0;}
  let tx=vec2f(D.texel.x,0.0); let ty=vec2f(0.0,D.texel.y);
  let slope=vec2f(closer(distanceAt(uv+tx)-z,z-distanceAt(uv-tx)),closer(distanceAt(uv+ty)-z,z-distanceAt(uv-ty)));
  let unit=max(z*D.contactParams.z*D.texel.y,0.0001);
  let span=clamp(min(z*0.024,42.0)/unit,1.0,D.contactMaxSpan); let radius=span*unit;
  let shade=(${taps('vec2f')})/12.0;
  let resolved=select(1.0,1.0-smoothstep(0.9,2.25,radius),D.terrainContactMask>1.5);
  return 1.0-min(0.72,shade*1.8)*D.contactParams.w*resolved;
}`;
