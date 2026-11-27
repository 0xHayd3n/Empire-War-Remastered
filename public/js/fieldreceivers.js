// The receiver fields only exist during a tactical world draw. receiverMap = cloud scroll xy,
// cloud tile (0 = disabled), inverse diffuse ground-grid span. receiverMode = smoke, foliage, probe, water.
// Probe: 0 off, 1 sky-only (space), negative inverse ground-grid span for a land reflection.
// Reflection and diffuse ground bounce can use the same texture without enabling each other.
// Smoke mode 2 means the four shared flash slots light only puffs (never opt hulls in as a side effect).
export const receiverSettings = [
  ['cloudReceivers', 'Cloud shadows on units', 'Cloud shadows cross terrain, units and buildings together.'],
  ['litPuffs', 'Sunlit smoke and dust', 'Sunlight shapes drifting puffs; nearby explosions light them briefly.'],
  ['mapReflections', 'Material reflections', 'Paint and polished fittings reflect the battlefield with different sharpness.'],
  ['leafLight', 'Canopy light and shade', 'Sunlight passes through leaves; nearby foliage casts patterned shade with Shadows enabled.'],
  ['waterOptics', 'Water depth and reflection', 'See the shallow bed from above and more reflected sky along the surface.'],
  ['localSoil', 'Local ground bounce', 'Lower surfaces pick up diffuse color from the ground below them.']
];
export function receiverShader(wg) {
  const p = wg ? 'P.' : '',
    v = wg ? 'vec3f' : 'vec3',
    f = wg ? 'let' : 'float',
    c = wg ? 'let' : 'vec3',
    u = wg ? 'vec2f' : 'vec2',
    uv = wg ? 'let' : 'vec2';
  const sig = (name, arg, ret) => (wg ? `fn ${name}(${arg}) -> ${ret}` : `${ret} ${name}(${arg})`);
  return `
${sig('cloudSun', wg ? 'at:vec3f' : 'vec3 at', 'f32').replace(/^f32 /, 'float ')} {
 if (${p}receiverMap.z<=0.0) {return 1.0;}
 ${uv} uv=(at.xy+${p}receiverMap.xy)/${p}receiverMap.z;
 return dot(${wg ? 'textureSampleLevel(fieldCloudT,fieldCloudS,uv,0.0)' : 'texture2D(fieldCloud,uv)'}.rgb,${v}(0.2126,0.7152,0.0722));
}
${sig('soilBounce', wg ? 'at:vec3f,n:vec3f' : 'vec3 at,vec3 n', v)} {
 if (${p}receiverMap.w<=0.0){return ${v}(0.0);}
 ${c} local=${wg ? 'textureSampleLevel(fieldSoilT,fieldClampS,at.xy*P.receiverMap.w,0.0)' : 'texture2D(fieldSoil,at.xy*receiverMap.w)'}.rgb;
 ${c} was=${wg ? 'select(vec3f(0.0),P.landGround.rgb,P.landGround.w>0.0)' : '(landGround.w>0.0?landGround.rgb:vec3(0.0))'};
 if(${p}landProbeOn>0.){return (local*local-was*was)*(0.5-0.5*clamp(n.z,-1.,1.))*(.72*${p}orbitPos[2]+.58*${p}sunColor*max(0.,${p}sunDir.z));}
 return (local-was)*(0.5-0.5*clamp(n.z,-1.0,1.0))*(${p}ambient*0.72+${p}sunColor*(0.58*max(0.0,${p}sunDir.z)));
}
${sig('shelteredSky',wg?'at:vec3f':'vec3 at',wg?'f32':'float')} {
 if(${p}landProbeOn<=0.0 || ${p}receiverMap.w<=0.0){return 1.0;}
 return ${wg?'textureSampleLevel(fieldSoilT,fieldClampS,at.xy*P.receiverMap.w,0.0)':'texture2D(fieldSoil,at.xy*receiverMap.w)'}.a;
}
${sig('materialSky', wg ? 'r:vec3f,g:f32' : 'vec3 r,float g', v)} {
 ${c} a=abs(r);${wg ? 'var face:f32;var F:vec3f;var U:vec3f;' : 'float face;vec3 F,U;'}
 if(a.x>=a.y && a.x>=a.z){face=${wg ? 'select(1.0,0.0,r.x>0.0)' : 'r.x>0.0?0.0:1.0'};F=${v}(sign(r.x),0.0,0.0);U=${v}(0.0,0.0,1.0);}
 else if(a.y>=a.z){face=${wg ? 'select(3.0,2.0,r.y>0.0)' : 'r.y>0.0?2.0:3.0'};F=${v}(0.0,sign(r.y),0.0);U=${v}(0.0,0.0,1.0);}
 else{face=${wg ? 'select(5.0,4.0,r.z>0.0)' : 'r.z>0.0?4.0:5.0'};F=${v}(0.0,0.0,sign(r.z));U=${v}(0.0,1.0,0.0);}
 ${uv} pos=clamp(0.5+0.5*${u}(dot(r,cross(F,U)),dot(r,U))/max(dot(r,F),0.0001),${u}(0.5/48.0),${u}(1.0-0.5/48.0));
 ${f} band=clamp(2.0*(1.0-g),0.0,2.0);${f} x=(face+pos.x)/6.0;
 ${c} lo=${wg ? 'textureSampleLevel(fieldSkyT,fieldClampS,vec2f(x,(pos.y+floor(band))/3.0),0.0)' : 'texture2D(fieldSky,vec2(x,(pos.y+floor(band))/3.0))'}.rgb;
 ${c} hi=${wg ? 'textureSampleLevel(fieldSkyT,fieldClampS,vec2f(x,(pos.y+ceil(band))/3.0),0.0)' : 'texture2D(fieldSky,vec2(x,(pos.y+ceil(band))/3.0))'}.rgb;
 return mix(lo,hi,fract(band));
}`;
}
// A broad local environment, not a mirror of nearby meshes. Sample the painted ground
// in the reflected bearing; keep the footprint bounded at the horizon. Rough finishes
// integrate a wider band of the two hemispheres. The grid's alpha is measured sky access.
export function materialEnvironmentShader(wg) {
  const p=wg?'P.':'', V=wg?'vec3f':'vec3', uv=wg?'let':'vec2', c=wg?'let':'vec3', f=wg?'let':'float';
  return `${wg?'fn materialEnvironment(at:vec3f,r:vec3f,g:f32)->vec3f':'vec3 materialEnvironment(vec3 at,vec3 r,float g)'} {
    ${c} sky=orbitDecode(materialSky(r,g));
    if (${p}receiverMode.z>=0.) { return sky; }
    ${uv} pos=(at.xy+r.xy*(24./max(.30,abs(r.z))))*(-${p}receiverMode.z);
    ${wg?'let':'vec4'} ground=${wg?'textureSampleLevel(fieldSoilT,fieldClampS,pos,0.)':'texture2D(fieldSoil,pos)'};
    ${f} open=ground.a;
    ${wg?'var':'vec3'} fill=${p}ambient+${p}fillColor*max(0.,${p}fillDir.z)+${p}fillColor2*max(0.,${p}fillDir2.z);
    if (${p}landGround.w>0.) { fill=groundFill(${V}(0.,0.,1.)); }
    ${c} lit=orbitDecode(ground.rgb)*open*(fill+${p}sunColor*max(0.,${p}sunDir.z)*open);
    ${f} width=mix(.60,.12,g);
    return mix(lit,sky*open,smoothstep(-width,width,r.z));
  }`;
}
// Input corner is in view coordinates AFTER sprite rotation, not atlas coordinates. The
// light modulates RGB only, preserving the authored opacity and the emitter's batch/blend mode.
export function puffShader(wg) {
  const v = wg ? 'vec3f' : 'vec3',
    p = wg ? 'P.' : '',
    f = wg ? 'let' : 'float',
    c = wg ? 'let' : 'vec3';
  return `
 if (${p}receiverMode.x>0.0 && ${wg ? 'i.slot' : 'slot'} < -1.5) {
  ${c} toward=normalize((${wg ? 'P.view' : 'viewMatrix'}*${wg ? 'vec4f' : 'vec4'}(${p}sunDir,0.0)).xyz);
  ${f} side=clamp(dot(corner/max(${wg ? 'i.center.w' : 'center.w'},0.01),toward.xy),-1.0,1.0);
  ${wg ? 'var k' : 'vec3 k'}=${v}(0.88)+clamp(${p}sunColor,${v}(0.0),${v}(1.4))*(0.12+0.30*side);
  for(${wg ? 'var b=0;b<4;b++' : 'int b=0;b<4;b++'}){if(${wg ? 'f32' : 'float'}(b)>=${p}blastCount){break;}
   ${f} fall=max(0.0,1.0-distance(at,${p}blastSource[b].xyz)*${p}blastSource[b].w);
   k+=${p}blastEnergy[b].rgb*fall*fall*0.75;
  }
  ${wg ? 'o.vTint=vec4f(i.tint.rgb*k,i.tint.a);' : 'vTint.rgb*=k;'}
 }`;
}
export function waterShader(wg) {
  const p = wg ? 'D.' : '',
    v = wg ? 'vec3f' : 'vec3',
    f = wg ? 'let' : 'float';
  return `
${wg ? 'fn viewWater(at:vec3f,depth:f32)->vec2f' : 'vec2 viewWater(vec3 at,float depth)'}{
 ${f} cosine=clamp(abs(normalize(${wg ? 'P.' : ''}cameraPosition-at).z),0.0,1.0);
 ${f} edge=1.0-cosine;
 ${f} fres=${p}waterBase.w*(0.065+0.935*edge*edge*edge*edge*edge);
 return ${wg ? 'vec2f' : 'vec2'}(fres,min(5.0,max(0.0,depth)/(35.0*max(0.27,cosine))));
}
${wg ? 'fn bedLight(opt:vec2f)->vec3f' : 'vec3 bedLight(vec2 opt)'}{
 return (1.0-opt.x)*exp(-opt.y*(${v}(0.28)+1.15*(${v}(1.0)-clamp(${p}waterBase.rgb,${v}(0.0),${v}(1.0)))));
}`;
}
