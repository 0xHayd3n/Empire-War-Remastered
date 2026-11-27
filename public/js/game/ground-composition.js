// Continuous, draw-only ground cover. Authoring hints are averaged over a neighborhood;
// they never directly assign natural material to a cell. Positive built permissions stay separate.
import { sinkholeCover } from './sinkhole-cover.js';
import { meadowCover } from './meadow-cover.js';
import { badlandCover } from './badland-cover.js';
import { depositField } from './ground-deposition.js';
const sat = x => Math.max(0, Math.min(1, x));
function ramp(a, b, x) {
  const u = sat((x - a) / (b - a));
  return u * u * (3 - 2 * u);
}
function blur(src, w, h, r) {
  const dst = new Float32Array(w * h),
    tmp = new Float32Array(w * h),
    kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-2 * ((i - r) / r) ** 2)),
    sum = kernel.reduce((a, b) => a + b);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[y * w + Math.max(0, Math.min(w - 1, x + k))] * kernel[k + r];
      tmp[y * w + x] = s / sum;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x] * kernel[k + r];
      dst[y * w + x] = s / sum;
    }
  return dst;
}
// Two RGBA strips in one texture, with the TED's padded stride removed. Channel order:
// green cover, worn soil, sandy grit, fallen leaves, rooted earth, damp soil, fractured rock.
export function composeGround(t, used, review, cover, props, zones) {
  const { width: w, height: h, size: n } = t,
    N = w * h,
    c = review,
    slots = c.channels.map(i => used.indexOf(i));
  if (slots.length !== 7 || slots.some(s => s < 0 || zones.built.has(s))) throw Error('Incomplete natural composition palette');
  if(c.kind==='sinkhole-shelf')return coverLayout(t,zones,slots,...sinkholeCover(t,c,slots,blur,ramp));
  if(c.kind==='terraced-meadow')return coverLayout(t,zones,slots,...meadowCover(t,c,slots,props,blur,ramp));
  if(c.kind==='eroded-badlands')return coverLayout(t,zones,slots,...badlandCover(t,c,slots,blur,ramp));
  if(c.kind==='arid-basin')return aridBasin(t,c,slots,props,zones);
  if(c.kind==='glacial-basin')return glacialBasin(t,c,slots,zones);
  const seed = () => new Float32Array(N),
    lane = seed(),
    shelf = seed(),
    hollow = seed(),
    grove = seed(),
    outcrop = seed();
  if (!cover || cover.length < t.layerIndex.length || !Number.isFinite(c.rockRadius) || c.rockRadius <= 0)
    throw Error('Missing composition inputs');
  const rockSlots = new Set(c.rockHints),
    laneSlots = new Set(c.laneHints),
    dampSlots = new Set(c.dampHints),
    rocks = new Set(c.outcrops);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x,
        i = y * n + x,
        s = t.layerIndex[i];
      lane[k] = +laneSlots.has(s);
      shelf[k] = +rockSlots.has(s);
      hollow[k] = +dampSlots.has(s);
      grove[k] = cover[i];
    }
  for (const p of props) {
    if (!rocks.has(p.modelFile.toUpperCase())) continue;
    const x = p.x / 20,
      y = p.y / 20,
      R = c.rockRadius / 20;
    for (let j = Math.max(0, Math.floor(y - R)); j <= Math.min(h - 1, y + R); j++)
      for (let i = Math.max(0, Math.floor(x - R)); i <= Math.min(w - 1, x + R); i++)
        outcrop[j * w + i] = Math.max(outcrop[j * w + i], 1 - ramp(0.14, 1, Math.hypot(i - x, j - y) / R));
  }
  const route = blur(lane, w, h, 4),
    stone = blur(shelf, w, h, 5),
    wet = blur(hollow, w, h, 5),
    canopy = blur(grove, w, h, 4),
    near = blur(grove, w, h, 1);
  const bytes = new Uint8Array(N * 8),
    dominant = new Uint8Array(N),
    weights = new Float64Array(7);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x,
        X = x * 20,
        Y = y * 20,
        H = t.heights;
      const slope =
        Math.hypot(
          H[y * n + Math.min(w - 1, x + 1)] - H[y * n + Math.max(0, x - 1)],
          H[Math.min(h - 1, y + 1) * n + x] - H[Math.max(0, y - 1) * n + x]
        ) / 40;
      let clearing = 0;
      for (const [cx, cy, rx, ry] of c.clearings)
        clearing = Math.max(clearing, 1 - ramp(0.42, 1, Math.hypot((X - cx) / rx, (Y - cy) / ry)));
      const shelter = ramp(0.04, 0.56, 0.8 * canopy[k] + 0.2 * near[k]);
      const travel = Math.max(0.56 * clearing, ramp(0.08, 0.53, route[k])) * (1 - 0.78 * shelter);
      // Compact a connected tread through the muster ground, not an oval stamp underneath each army.
      let tread = 0;
      for (const line of c.tracks) {
        for (let s = 1; s < line.length; s++) {
          const [ax, ay] = line[s - 1],
            [bx, by] = line[s],
            dx = bx - ax,
            dy = by - ay,
            k = sat(((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy));
          tread = Math.max(tread, 1 - ramp(12, 86, Math.hypot(X - ax - k * dx, Y - ay - k * dy)));
        }
      }
      const traffic = Math.max(travel, tread * (1 - 0.65 * shelter));
      const exposure =
        Math.max(0.95 * outcrop[k], ramp(0.26, 1.05, slope) * (0.55 + 0.45 * stone[k]), ramp(0.45, 0.88, stone[k]) * 0.62) *
        (1 - 0.48 * travel);
      const moisture = ramp(0.12, 0.67, wet[k]) * (1 - 0.65 * travel) * (1 - 0.5 * exposure);
      weights[0] = 1;
      weights[1] = weights[2] = weights[3] = weights[4] = weights[5] = weights[6] = 0;
      function deposit(channel, amount) {
        for (let q = 0; q < 7; q++) weights[q] *= 1 - amount;
        weights[channel] += amount;
      }
      deposit(4, shelter * 0.72);
      deposit(3, shelter * (0.38 + 0.2 * ramp(0.35, 0.85, near[k])));
      deposit(5, moisture * 0.78);
      deposit(1, traffic * 0.78);
      deposit(2, traffic * (0.12 + 0.22 * ramp(0.24, 0.8, route[k]) + 0.39 * tread));
      deposit(6, exposure);
      let sum = 0,
        high = 0;
      for (let q = 0; q < 7; q++) {
        weights[q] = Math.max(0, weights[q] - 0.025) ** 1.65;
        sum += weights[q];
        if (weights[q] > weights[high]) high = q;
      }
      let packed = 0;
      const off = y * w * 8 + x * 4;
      for (let q = 0; q < 7; q++) {
        const b = Math.round((255 * weights[q]) / sum);
        bytes[off + (q < 4 ? q : w * 4 + q - 4)] = b;
        packed += b;
      }
      bytes[off + (high < 4 ? high : w * 4 + high - 4)] += 255 - packed;
      let peak = -1;
      for (let q = 0; q < 7; q++) {
        const b = bytes[off + (q < 4 ? q : w * 4 + q - 4)];
        if (b > peak) {
          dominant[k] = slots[q];
          peak = b;
        }
      }
    }
  return coverLayout(t,zones,slots,bytes,dominant,cover);
}
function coverLayout(t,zones,slots,bytes,dominant,cover){
  const {width:w,height:h,size:n}=t;
  function slotAt(i, raw) {
    return zones.authorized(i, raw) ? raw : dominant[Math.floor(i / n) * w + (i % n)];
  }
  function corner(k, q) {
    return bytes[4 * (Math.floor(k / w) * 2 * w + (k % w)) + (q < 4 ? q : 4 * w + q - 4)] / 255;
  }
  // CPU relief samples the same quantized, bilinearly filtered cover as the two GPU paths.
  function sample(x, y, output) {
    const X = Math.min(w - 1, Math.max(0, x / 20)),
      Y = Math.min(h - 1, Math.max(0, y / 20)),
      ix = Math.min(w - 2, Math.floor(X)),
      iy = Math.min(h - 2, Math.floor(Y)),
      k = iy * w + ix,
      u = X - ix,
      v = Y - iy;
    for (let q = 0; q < 7; q++)
      output[q] = (corner(k, q) * (1 - u) + corner(k + 1, q) * u) * (1 - v) + (corner(k + w, q) * (1 - u) + corner(k + w + 1, q) * u) * v;
    return output;
  }
  return { ...zones, slotAt, slots, bytes, width: w, height: h, sample, corner, coverAt: i => cover?.[i] || 0 };
}

// Hoth: a mostly continuous snow mass. Only a steep face can shed its mantle;
// a legacy grey pixel is not a new island of rock. Lower sheltered surfaces retain firn.
function glacialBasin(t,c,slots,zones){
  const {width:w,height:h,size:n,heights:H}=t,N=w*h;
  const hints=new Float32Array(N),wear=new Float32Array(N),faces=new Set(c.rockHints),packed=new Set(c.packedHints);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const raw=t.layerIndex[y*n+x];hints[y*w+x]=+faces.has(raw);wear[y*w+x]=+packed.has(raw);}
  const deposit=depositField(c.deposition),near=blur(hints,w,h,4),travel=blur(wear,w,h,3),bytes=new Uint8Array(8*N),dominant=new Uint8Array(N);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=y*w+x,i=y*n+x,dx=H[y*n+Math.min(w-1,x+1)]-H[y*n+Math.max(0,x-1)],dy=H[Math.min(h-1,y+1)*n+x]-H[Math.max(0,y-1)*n+x],grade=Math.hypot(dx,dy)/40;
    const wide=(H[y*n+Math.min(w-1,x+4)]+H[y*n+Math.max(0,x-4)]+H[Math.min(h-1,y+4)*n+x]+H[Math.max(0,y-4)*n+x])*.25;
    const trough=ramp(0,16,wide-H[i]),face=ramp(.26,1.18,grade)*(.64+.36*near[k]);let yard=0;
    for(const [cx,cy,rx,ry] of c.yards)yard=Math.max(yard,1-ramp(.25,1,Math.hypot((x*20-cx)/rx,(y*20-cy)/ry)));
    const scour=deposit(x*20,y*20), firm=(1-face)*Math.min(.90,.035+.51*scour+.18*trough+.21*travel[k]+.46*yard),rubble=face*(1-.82*ramp(.34,.94,grade));
    const weights=[1-face-firm,firm,rubble,face-rubble],off=8*y*w+4*x;let sum=0,best=0;
    for(let j=0;j<4;j++){sum+=bytes[off+j]=Math.round(255*weights[j]);if(weights[j]>weights[best])best=j;}
    bytes[off+best]+=255-sum;best=0;for(let j=1;j<4;j++)if(bytes[off+j]>bytes[off+best])best=j;dominant[k]=slots[best];
  }
  return coverLayout(t,zones,slots,bytes,dominant);
}

// Windblown sand accumulates in the lee of rocky shelves. The earlier paint says
// where wind and stone occur in aggregate, not which family owns each individual vertex.
function aridBasin(t,c,slots,props,zones){
  const {width:w,height:h,size:n}=t,N=w*h,raw=new Float32Array(N),ripple=new Float32Array(N),cliff=new Float32Array(N),yard=new Float32Array(N),rockSlots=new Set(c.rockHints),sandSlots=new Set(c.looseHints),packedSlots=new Set(c.packedHints),rocks=new Set(c.outcrops),H=t.heights;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x,s=t.layerIndex[y*n+x];raw[k]=+rockSlots.has(s);ripple[k]=+sandSlots.has(s);yard[k]=+packedSlots.has(s);}
  for(const p of props){if(!rocks.has(p.modelFile?.toUpperCase()))continue;const X=p.x/20,Y=p.y/20,R=c.rockRadius/20;for(let j=Math.max(0,Math.floor(Y-R));j<=Math.min(h-1,Y+R);j++)for(let i=Math.max(0,Math.floor(X-R));i<=Math.min(w-1,X+R);i++)cliff[j*w+i]=Math.max(cliff[j*w+i],1-ramp(.12,1,Math.hypot(i-X,j-Y)/R));}
  const deposit=depositField(c.deposition),shelf=blur(raw,w,h,5),sand=blur(ripple,w,h,5),packed=blur(yard,w,h,3),bytes=new Uint8Array(8*N),dominant=new Uint8Array(N),weights=new Float64Array(7);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=y*w+x,i=y*n+x,slope=Math.hypot(H[y*n+Math.min(w-1,x+1)]-H[y*n+Math.max(0,x-1)],H[Math.min(h-1,y+1)*n+x]-H[Math.max(0,y-1)*n+x])/40,
      // A rock model or a legacy rocky paint swatch is not a bare shelf. Loose fines
      // collect at its foot; only a rising face sheds the continuous sandy mantle.
      lee=deposit(x*20,y*20),
      face=ramp(.24,.84,slope), bed=face*(.57+.43*Math.max(shelf[k],cliff[k])),
      grit=Math.min(.44,(.055+.24*shelf[k]+.14*cliff[k])*(1-.48*sand[k])*(1.25-.56*lee)),
      yardShare=.68*ramp(.09,.65,packed[k]), drift=.26+.59*lee+.10*sand[k];
    weights[4]=bed*(.60+.30*face);weights[2]=bed-weights[4];
    weights[1]=(1-bed)*yardShare;weights[3]=(1-bed-weights[1])*grit;
    const loose=1-bed-weights[1]-weights[3];weights[0]=loose*drift;weights[5]=loose-weights[0];
    const off=8*y*w+4*x,addr=q=>off+(q<4?q:4*w+q-4);let total=0,major=0;
    for(let q=0;q<6;q++){total+=bytes[addr(q)]=Math.round(255*weights[q]);if(weights[q]>weights[major])major=q;}
    bytes[addr(major)]+=255-total;major=0;for(let q=1;q<6;q++)if(bytes[addr(q)]>bytes[addr(major)])major=q;dominant[k]=slots[major];
  }return coverLayout(t,zones,slots,bytes,dominant);
}

// Shared shader source; reuse the reviewed terrain's otherwise idle canopy binding (no new sampler).
export function compositionShader(wg) {
  const t = wg ? 'T.' : '',
    V = wg ? 'vec2f' : 'vec2',
    I = wg ? 'i32' : 'int',
    A = t + 'groundMixA',
    B = t + 'groundMixB';
  const at = wg ? 'textureSampleLevel(canopyT,canopyS,uv,0.)' : 'textureLod(canopyMap,uv,0.)';
  const loop = wg ? 'var i=0' : 'int i=0',
    mut = wg ? 'var' : 'float',
    mut4 = wg ? 'var' : 'vec4',
    mutI = wg ? 'var' : 'int';
  return `${wg ? 'fn composed(L:vec4f,q:vec2f)->vec3f' : 'vec3 composed(vec4 L,vec2 q)'}{
 ${wg ? 'let' : 'vec2'} size=${V}(${wg ? 'textureDimensions(canopyT,0)' : 'textureSize(canopyMap,0)'});${wg ? 'var' : 'vec2'} uv=(clamp(vWorld.xy/20.,${V}(0.),size*${V}(.5,1.)-${V}(1.))+.5)/size;
 ${mut4} a=${at};uv.x+=.5;${mut4} b=${at};
 // Scenic-only material: first sample the exact clamped edge field, then let native forest
 // cover and exposed rock on the hillside replace it. Never project a strip of TED paint to infinity.
 if(${B}.w>1.5){${wg?'let':'vec2'} outside=max(max(-vWorld.xy,vWorld.xy-(size*${V}(.5,1.)-1.)*20.),${V}(0.));
 ${wg?'let':'float'} distanceOut=length(outside);${wg?'let':'float'} k=smoothstep(0.,360.,distanceOut);
 ${wg?'let':'float'} rock=.72*smoothstep(.08,.52,1.-n.z);${wg?'let':'float'} duff=.22+.14*sin(vWorld.x*.008+sin(vWorld.y*.004));
 if(${B}.w>5.5){${wg?'let':'float'} face=.85*smoothstep(.05,.31,1.-n.z);${wg?'let':'float'} dry=.12+.55*q.x;a=mix(a,${wg?'vec4f':'vec4'}((1.-face)*(1.-dry),(1.-face)*dry,0.,0.),k);b=mix(b,${wg?'vec4f':'vec4'}(face*.5,face*.5,0.,0.),k);}else if(${B}.w>4.5){${wg?'let':'float'} bed=smoothstep(.026,.24,1.-n.z);${wg?'let':'float'} grit=.09*(1.-bed);${wg?'let':'float'} crust=.16+.53*q.x;${wg?'let':'float'} lean=bed*smoothstep(.12,.63,abs(n.x));a=mix(a,${wg?'vec4f':'vec4'}((1.-bed-grit)*(1.-crust),(1.-bed-grit)*crust,grit,0.),k);b=mix(b,${wg?'vec4f':'vec4'}(bed-lean,lean*step(0.,n.x),lean*(1.-step(0.,n.x)),0.),k);}else if(${B}.w>3.5){${wg?'let':'float'} face=smoothstep(.040,.24,1.-n.z);a=mix(a,${wg?'vec4f':'vec4'}((.965-.51*q.x)*(1.-face),(.035+.51*q.x)*(1.-face),face*.23,face*.77),k);b*=1.-k;}else if(${B}.w>2.5){${wg?'let':'float'} ledge=smoothstep(.035,.24,1.-n.z);a=mix(a,${wg?'vec4f':'vec4'}((1.-ledge)*(.24+.54*q.x),0.,ledge*.20,(1.-ledge)*.14),k);b=mix(b,${wg?'vec4f':'vec4'}(ledge*.80,(1.-ledge)*(.62-.54*q.x),0.,0.),k);}else{a=mix(a,${wg?'vec4f':'vec4'}((1.-rock)*(.78-duff),0.,0.,(1.-rock)*duff),k);b=mix(b,${wg?'vec4f':'vec4'}((1.-rock)*.22,0.,rock,0.),k);}}

 ${wg ? 'var' : 'vec3'} result=${wg ? 'vec3f' : 'vec3'}(0.); ${mut} built=0.;
 ${mut4} corners=${wg ? 'vec4f' : 'vec4'}((1.-q.x)*(1.-q.y),q.x*(1.-q.y),(1.-q.x)*q.y,q.x*q.y);
 ${mutI} count=11;${mutI} first=0;
 if(${B}.w==0.){corners=forestWeights(q);for(${loop};i<4;i++){for(${wg ? 'var j=0' : 'int j=0'};j<i;j++){if(L[j]==L[i]){corners[j]+=corners[i];corners[i]=0.;break;}}}
 for(${loop};i<4;i++){if(corners[i]>0. && corners[i]<1.){corners[i]*=forestRank(L[i]);}}corners=max(corners-.004,${wg ? 'vec4f' : 'vec4'}(0.));corners/=dot(corners,${wg ? 'vec4f' : 'vec4'}(1.));count=4;
 }else{
 for(${loop};i<4;i++){if(${t}texV[${I}(L[i])].w>=0.){corners[i]=0.;}built+=corners[i];}
 if(built>=.99999){count=4;}else{if(built==0.){first=4;}${mut} total=0.;for(${loop};i<7;i++){${mut} share=a[i%4];${mut} slot=${A}[i%4];if(i>=4){share=b[i-4];slot=${B}[i-4];}if(share>0. && share<1.){share*=forestRank(slot);}if(i<4){a[i]=share;}else{b[i-4]=share;}total+=share;}
 a*=(1.-built)/total;b*=(1.-built)/total;}}
 for(${wg ? 'var i=first' : 'int i=first'};i<count;i++){${mut} share=corners[i%4];${mut} slot=L[i%4];if(i>=8){share=b[i-8];slot=${B}[i-8];}else if(i>=4){share=a[i-4];slot=${A}[i-4];}if(share>0.){result+=share*layer(slot);}}
 return result;}`;
}
