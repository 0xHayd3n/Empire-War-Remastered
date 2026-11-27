// EASU and RCAS are ports of AMD FidelityFX Super Resolution 1, ffx_fsr1.h (FP32).
// Upstream: GPUOpen-Effects/FidelityFX-FSR @ a21ffb8f6c13233ba336352bdff293894c706575.
// Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// Coordinates are the existing post quad's UVs, NOT canvas position (the backends have different viewport conventions).
// Full source texture = viewport; UV * inputSize - .5 folds in FsrEasuCon's output pixel-center offset.
const easuTaps = [
  ['b', 0, -1],
  ['c', 1, -1],
  ['e', -1, 0],
  ['f', 0, 0],
  ['g', 1, 0],
  ['h', 2, 0],
  ['i', -1, 1],
  ['j', 0, 1],
  ['k', 1, 1],
  ['l', 2, 1],
  ['n', 0, 2],
  ['o', 1, 2]
];

export function spatialShader(lang, pass) {
  const wg = lang === 'wgsl';
  // The math below uses expressions common to GLSL and WGSL. Translate only type names and typed local declarations.
  const types = { float: 'f32', vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f', ivec2: 'vec2i' };
  const fn = (result, name, args, body) => {
    if (!wg) return `${result} ${name}(${args.join(',')}) {\n${body}\n}\n`;
    const params = args.map(arg => {
      const [t, n] = arg.split(' ');
      return `${n}:${types[t]}`;
    });
    body = body
      .replace(/\b(float|vec[234]|ivec2) (\w+)\s*=/g, (_, t, n) => `var ${n}:${types[t]} =`)
      .replace(/\b(float|vec[234]|ivec2)\(/g, (_, t) => types[t] + '(');
    return `fn ${name}(${params.join(',')})->${types[result]} {\n${body}\n}\n`;
  };
  const size = wg ? 'vec2i(textureDimensions(mapT,0))' : 'textureSize(map,0)',
    read = wg ? 'textureLoad(mapT,p,0).rgb' : 'texelFetch(map,p,0).rgb',
    hdr = wg ? 'D.extended' : 'extended',
    paired = wg ? 'D.paired' : 'paired',
    amount = wg ? 'D.amount' : 'amount';
  let code = fn('vec3', 'rawAt', ['ivec2 q', 'ivec2 sz'], `ivec2 p=clamp(q,ivec2(0),sz-ivec2(1)); return ${read};`);
  if (pass === 'lanczos') {
    // Separable 6x6 Lanczos-3. Precompute each 1-D weight once; bound ringing against the four nearest source pixels.
    code += fn(
      'float',
      'kernel3',
      ['float x'],
      `if (abs(x)<0.0001) { return 1.0; } float a=x*3.14159265359; return sin(a)*sin(a/3.0)*3.0/(a*a);`
    );
    const taps = Array.from({ length: 6 }, (_, i) => i - 2);
    code += fn(
      'vec3',
      'filterPixel',
      ['vec2 uv'],
      `
  ivec2 sz=${size}; vec2 pos=uv*vec2(sz)-0.5; ivec2 p=ivec2(floor(pos)); vec2 frac=fract(pos);
  ${taps.map((n, i) => `float wx${i}=kernel3(${n}.0-frac.x); float wy${i}=kernel3(${n}.0-frac.y);`).join('\n  ')}
  ${[0, 1].flatMap(y => [0, 1].map(x => `vec3 q${x}${y}=rawAt(p+ivec2(${x},${y}),sz);`)).join('\n  ')}
  vec3 total=vec3(0.0);
  ${taps.map((y, j) => `total+=wy${j}*(${taps.map((x, i) => `wx${i}*${(x === 0 || x === 1) && (y === 0 || y === 1) ? `q${x}${y}` : `rawAt(p+ivec2(${x},${y}),sz)`}`).join('+')});`).join('\n  ')}
  float norm=(${taps.map((_, i) => `wx${i}`).join('+')})*(${taps.map((_, i) => `wy${i}`).join('+')});
  vec3 reconstructed=clamp(total/norm,min(min(q00,q10),min(q01,q11)),max(max(q00,q10),max(q01,q11)));
  return mix(mix(mix(q00,q10,frac.x),mix(q01,q11,frac.x),frac.y),reconstructed,${amount});`
    );
  } else {
    // SDR scene is already display-like. Extended sRGB-like signal uses a reversible gamma-2 SRTM shoulder
    // (square -> divide linear RGB by 1+peak -> sqrt) around the bounded FSR kernels only.
    code += fn('float', 'peak3', ['vec3 v'], 'return max(v.r,max(v.g,v.b));');
    code += fn(
      'vec3',
      'signalAt',
      ['ivec2 p', 'ivec2 sz'],
      `vec3 v=rawAt(p,sz); if (${hdr}>0.5${pass === 'rcas' ? ` && ${paired}<0.5` : ''}) { v=max(v,vec3(0.0)); float m=peak3(v); return v/sqrt(1.0+m*m); } return v;`
    );
    code += fn(
      'vec3',
      'unpackSignal',
      ['vec3 v'],
      `if (${hdr}>0.5${pass === 'easu' ? ` && ${paired}<0.5` : ''}) { float m=peak3(v); return v/sqrt(max(1.0/32768.0,1.0-m*m)); } return v;`
    );
    if (pass === 'easu') {
      code += fn('float', 'luma2', ['vec3 v'], 'return v.g+0.5*(v.r+v.b);');
      code += fn(
        'vec3',
        'easuSet',
        ['float a', 'float b', 'float c', 'float d', 'float e'],
        `
  vec2 direction=vec2(d-b,e-a);
  vec2 span=max(abs(vec2(d-c,e-c)),abs(vec2(c-b,c-a)));
  vec2 strength=clamp(abs(direction)/max(span,vec2(0.000001)),vec2(0.0),vec2(1.0));
  return vec3(direction,dot(strength,strength));`
      );
      code += fn(
        'vec4',
        'easuTap',
        ['vec2 offset', 'vec2 direction', 'vec2 stretch', 'float lobe', 'float clipDist', 'vec3 color'],
        `
  vec2 v=vec2(dot(offset,direction),dot(offset,vec2(-direction.y,direction.x)))*stretch;
  float d=min(dot(v,v),clipDist); float base=0.4*d-1.0; float window=lobe*d-1.0;
  float w=(1.5625*base*base-0.5625)*window*window;
  return vec4(color*w,w);`
      );
      code += fn(
        'vec3',
        'filterPixel',
        ['vec2 uv'],
        `
  ivec2 sz=${size}; vec2 pos=uv*vec2(sz)-0.5; ivec2 p=ivec2(floor(pos)); vec2 frac=fract(pos);
  ${easuTaps.map(([n, x, y]) => `vec3 ${n}=signalAt(p+ivec2(${x},${y}),sz); float ${n}L=luma2(${n});`).join('\n  ')}
  vec3 grad=mix(mix(easuSet(bL,eL,fL,gL,jL),easuSet(cL,fL,gL,hL,kL),frac.x),
                mix(easuSet(fL,iL,jL,kL,nL),easuSet(gL,jL,kL,lL,oL),frac.x),frac.y);
  vec2 direction=vec2(1.0,0.0); float mag=dot(grad.xy,grad.xy);
  if (mag>=1.0/32768.0) { direction=grad.xy/sqrt(mag); }
  float edge=0.25*grad.z*grad.z;
  float stretch=1.0/max(abs(direction.x),abs(direction.y));
  vec2 axes=vec2(1.0+(stretch-1.0)*edge,1.0-0.5*edge);
  float lobe=0.5-0.29*edge; float clipDist=1.0/lobe; vec4 acc=vec4(0.0);
  ${easuTaps.map(([n, x, y]) => `acc+=easuTap(vec2(${x}.0,${y}.0)-frac,direction,axes,lobe,clipDist,${n});`).join('\n  ')}
  return unpackSignal(clamp(acc.rgb/max(acc.a,0.00001),min(min(f,g),min(j,k)),max(max(f,g),max(j,k))));`
      );
    } else if (pass === 'rcas') {
      code += fn(
        'vec3',
        'filterPixel',
        ['vec2 uv'],
        `
  ivec2 sz=${size}; ivec2 p=ivec2(floor(uv*vec2(sz)));
  vec3 b=signalAt(p+ivec2(0,-1),sz); vec3 d=signalAt(p+ivec2(-1,0),sz); vec3 e=signalAt(p,sz);
  vec3 f=signalAt(p+ivec2(1,0),sz); vec3 h=signalAt(p+ivec2(0,1),sz);
  vec3 lo=min(min(b,d),min(f,h)); vec3 hi=max(max(b,d),max(f,h));
  vec3 hitMin=min(lo,e)/max(4.0*hi,vec3(0.000001));
  vec3 hitMax=(1.0-max(hi,e))/min(4.0*lo-4.0,vec3(-0.000001));
  float lobe=clamp(peak3(max(-hitMin,hitMax)),-0.1875,0.0)*${amount};
  vec3 result=(e+lobe*(b+d+f+h))/(1.0+4.0*lobe);
  if (${hdr}>0.5) { result=clamp(result,vec3(0.0),vec3(peak3(max(e,hi)))); }
  return unpackSignal(result);`
      );
    } else throw Error('Unknown spatial filter: ' + pass);
  }
  return code;
}

export function spatialFragment(pass) {
  return `// spatial-pass:${pass}\nuniform sampler2D map; uniform float amount, extended, paired; varying vec2 vUv;\n${spatialShader('glsl', pass)}\nvoid main(){gl_FragColor=vec4(filterPixel(vUv),1.0);}`;
}
