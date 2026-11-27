// Triangular stochastic texturing. Each vertex of a continuous triangular cover owns
// an offset + quarter turn of the same physical scan, never a tinted substitute. Adjacent
// triangles share their edge vertices. The CPU relief and both shader languages use the
// same integer seed, weights, transforms and tile scale. No camera, frame or RNG input.
const frac = x => x - Math.floor(x),
  U = 1 / 1024;
function tileHash(x, y, id) {
  let a = Math.imul(x, 1597334677) ^ Math.imul(y, 3812015801) ^ Math.imul(id + 1, 2798796415);
  a = Math.imul(a ^ (a >>> 16), 2246822519);
  return a ^ (a >>> 13);
}
// End support at the equilateral triangle's altitude. Only three donors can
// contribute; each shared donor keeps its weight AND slope across the edge.
function scanWeight(x, y) {
  const r = Math.max(0, 0.75 - (x * x + x * y + y * y));
  return r * r * r;
}
export function tileFootprint(u, v, id) {
  const x = (u - 0.57735027 * v) * 0.93,
    y = v * 1.15470054 * 0.93,
    i = Math.floor(x),
    j = Math.floor(y),
    a = frac(x),
    b = frac(y),
    hi = a + b > 1;
  const w = [hi ? scanWeight(a - 1, b - 1) : scanWeight(a, b), scanWeight(a - 1, b), scanWeight(a, b - 1)],
    sum = w[0] + w[1] + w[2];
  return [
    [i + (hi ? 1 : 0), j + (hi ? 1 : 0)],
    [i + 1, j],
    [i, j + 1]
  ].map(([x, y], k) => {
    const h = tileHash(x, y, id),
      r = h >>> 30;
    return [turnU(r, u, v) + ((h >>> 10) & 1023) * U, turnV(r, u, v) + (h & 1023) * U, w[k] / sum];
  });
}
const turnU = (r, u, v) => (r === 0 ? u : r === 1 ? -v : r === 2 ? -u : v);
const turnV = (r, u, v) => (r === 0 ? v : r === 1 ? u : r === 2 ? -v : -u);
function weightedHeight(sample, h, u, v, id, i, j, weight) {
  const bits = tileHash(i, j, id),
    r = bits >>> 30;
  return weight * sample(h, turnU(r, u, v) + ((bits >>> 10) & 1023) * U, turnV(r, u, v) + (bits & 1023) * U);
}
export function scatteredHeight(sample, h, u, v, id, regular = id === 7) {
  if (regular) return sample(h, u, v);
  // Numerical equivalent of tileFootprint, but the inner relief loop needs a
  // scalar, not nine short-lived arrays per sample. Keep W/sum before scaling.
  const x = (u - 0.57735027 * v) * 0.93,
    y = v * 1.15470054 * 0.93,
    i = Math.floor(x),
    j = Math.floor(y),
    a = x - i,
    b = y - j,
    high = +(a + b > 1),
    wa = scanWeight(a - high, b - high),
    wb = scanWeight(a - 1, b),
    wc = scanWeight(a, b - 1),
    sum = wa + wb + wc;
  return (
    (wa ? weightedHeight(sample, h, u, v, id, i + high, j + high, wa / sum) : 0) +
    (wb ? weightedHeight(sample, h, u, v, id, i + 1, j, wb / sum) : 0) +
    (wc ? weightedHeight(sample, h, u, v, id, i, j + 1, wc / sum) : 0)
  );
}
export function tileShader(wg, reviewed = false) {
  const F = wg ? 'f32' : 'float',
    I = wg ? 'i32' : 'int',
    V = wg ? 'vec2f' : 'vec2',
    C = wg ? 'vec3f' : 'vec3',
    Q = wg ? 'vec4f' : 'vec4',
    i2 = wg ? 'vec2i' : 'ivec2',
    d = t => (wg ? 'let' : t),
    a = t => (wg ? 'var' : t),
    fn = (name, res, args) =>
      wg ? `fn ${name}(${args.map(([t, n]) => n + ':' + t).join(',')})->${res}` : `${res} ${name}(${args.map(e => e.join(' ')).join(',')})`;
  const pair = (n, t) => [t, n],
    uv = pair('uv', V),
    sx = pair('sx', V),
    sy = pair('sy', V),
    id = pair('id', I),
    tr = pair('t', Q),
    p = pair('p', 'ScanPatch');
  const s = [
    wg ? 'struct ScanPatch {a:vec4f,b:vec4f,c:vec4f,w:vec3f}' : 'struct ScanPatch {vec4 a,b,c; vec3 w;};',
    `${fn('turnScan', V, [uv, pair('cs', V)])}{return ${V}(cs.x*uv.x-cs.y*uv.y,cs.y*uv.x+cs.x*uv.y);}`,
    `${fn('tileSeed', Q, [pair('g', i2), id])}{${a('uint')} h=(${wg ? 'u32' : 'uint'}(g.x)*1597334677u)^(${wg ? 'u32' : 'uint'}(g.y)*3812015801u)^(${wg ? 'u32' : 'uint'}(id+1)*2798796415u);h=(h^(h>>16u))*2246822519u;h=h^(h>>13u);${d('uint')} r=h>>30u;
 ${a(V)} cs=${V}(1.,0.);if(r==1u){cs=${V}(0.,1.);}else if(r==2u){cs=${V}(-1.,0.);}else if(r==3u){cs=${V}(0.,-1.);}return ${Q}(cs,${F}((h>>10u)&1023u)/1024.,${F}(h&1023u)/1024.);}`,
    `${fn('scanWeight', F, [pair('d', V)])}{${d(F)} r=max(0.,.75-(d.x*d.x+d.x*d.y+d.y*d.y));return r*r*r;}`,
    `${fn('scanPatch', 'ScanPatch', [uv, id])}{if(id<0${reviewed ? '' : ' || id==7'}){return ScanPatch(${Q}(1.,0.,0.,0.),${Q}(1.,0.,0.,0.),${Q}(1.,0.,0.,0.),${C}(1.,0.,0.));}
 ${d(V)} grid=${V}(uv.x-.57735027*uv.y,uv.y*1.15470054)*.93;${d(i2)} g=${i2}(floor(grid));${d(V)} f=fract(grid);${a(i2)} g0=g;if(f.x+f.y>1.){g0=g+${i2}(1);}
 ${d(C)} w=${C}(scanWeight(f-${V}(g0-g)),scanWeight(f-${V}(1.,0.)),scanWeight(f-${V}(0.,1.)));return ScanPatch(tileSeed(g0,id),tileSeed(g+${i2}(1,0),id),tileSeed(g+${i2}(0,1),id),w/dot(w,${C}(1.)));}`
  ];
  for (const name of ['Color', 'Surface']) {
    const sample = name === 'Surface',
      f = `at${name}`;
    s.push(
      `${fn(f, Q, [uv, sx, sy, id, tr])}{${d(Q)} v=scan${name}(turnScan(uv,t.xy)+t.zw,turnScan(sx,t.xy),turnScan(sy,t.xy),id);return ${sample ? `${Q}(.5+.5*turnScan(v.xy*2.-1.,${V}(t.x,-t.y)),v.zw)` : 'v'};}`,
      `${fn('patch' + name, Q, [uv, sx, sy, id, p])}{${a(Q)} s=${Q}(0.);${['a', 'b', 'c'].map((k, i) => `if(p.w.${'xyz'[i]}>0.){s+=p.w.${'xyz'[i]}*${f}(uv,sx,sy,id,p.${k});}`).join('')}return s;}`
    );
  }
  return s.join('\n');
}
