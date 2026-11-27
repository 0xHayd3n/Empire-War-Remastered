import * as T from 'three';
import { decodeDXT } from '../ddsdecode.js';
// Use a small authored diffuse mip, weighted by painted layer coverage (never sample the
// viewport, team colors, normal maps, fog or units). Limit work even on incomplete mod DDSs.
export function soilColor(t, used, files, palette) {
  const rgb = [0, 0, 0],
    counts = new Map();
  let sum = 0;
  for (let y = 0; y < (t.height ?? t.size); y += 2)
    for (let x = 0; x < (t.width ?? t.size); x += 2) {
      const i = t.layerIndex[y * t.size + x];
      counts.set(i, (counts.get(i) || 0) + 1);
    }
  used.forEach((id, i) => {
    const weight = counts.get(id) || 0,
      L = t.layers[id],
      dds = files[i][0];
    if ((!weight && !palette) || L?.hole || !dds) return;
    const mip = dds.mipmaps?.find(m => m.width <= 16 && m.height <= 16);
    if (!mip) return;
    let px = mip.data;
    if (dds.compressed) {
      const k =
        dds.format === T.RGBA_S3TC_DXT1_Format
          ? 1
          : dds.format === T.RGBA_S3TC_DXT3_Format
            ? 3
            : dds.format === T.RGBA_S3TC_DXT5_Format
              ? 5
              : 0;
      if (!k) return;
      px = decodeDXT(px, mip.width, mip.height, k);
    }
    if (px?.length !== 4 * mip.width * mip.height) return;
    const mean=[0,0,0];
    for (let j=0;j<px.length;j+=4) for(let c=0;c<3;c++) mean[c]+=px[j+c];
    for(let c=0;c<3;c++){mean[c]=mean[c]*(L.diffuse?.[c]??1)/(255*mip.width*mip.height);rgb[c]+=weight*mean[c];}
    if(palette)palette[id]=mean;
    sum += weight;
  });
  return rgb.map(c => (sum ? Math.max(0.035, Math.min(0.9, c / sum)) : 0.32));
}
// Bins follow the terrain's world grid, not the viewport. Repaint just the touched bins after paving.
export function soilGrid(t,palette,fallback,cell,canopy=null,drawColor=null){
 const step=canopy?Math.max(1,Math.ceil(t.size/256)):Math.max(4,Math.ceil(t.size/64)), n=Math.ceil(t.size/step), data=new Uint8Array(4*n*n);
 const tex=new T.DataTexture(data,n,n);tex.minFilter=tex.magFilter=T.LinearFilter;
 const bin=(bx,by)=>{const sum=[0,0,0];let count=0;
  for(let y=by*step;y<Math.min((by+1)*step,t.height??t.size);y++)for(let x=bx*step;x<Math.min((bx+1)*step,t.width??t.size);x++){
   const i=y*t.size+x,raw=t.layerIndex[i],color=drawColor?.(i,raw)||palette[raw]||fallback;for(let c=0;c<3;c++)sum[c]+=color[c];count++;}
  const at=(by*n+bx)*4;for(let c=0;c<3;c++)data[at+c]=Math.round(255*Math.min(.95,Math.max(.025,count?sum[c]/count:fallback[c])));data[at+3]=255;
  if(canopy){const im=canopy.image,ix=Math.min(im.width-1,Math.floor((bx+.5)*step*im.width/((t.width??t.size)-1))),iy=Math.min(im.height-1,Math.floor((by+.5)*step*im.height/((t.height??t.size)-1)));
    data[at+3]=255-Math.round(.64*im.data[(iy*im.width+ix)*4+1]);}
 
 };
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)bin(x,y);tex.needsUpdate=true;
 return {tex,scale:1/(n*step*cell),refreshCover(){if(canopy){for(let y=0;y<n;y++)for(let x=0;x<n;x++)bin(x,y);tex.needsUpdate=true;}},pave(cells){const dirty=new Set();for(const i of cells)dirty.add(Math.floor(i/t.size/step)*n+Math.floor(i%t.size/step));for(const j of dirty)bin(j%n,Math.floor(j/n));if(dirty.size)tex.needsUpdate=true;}};
}
// Quantize world-space center (not camera-local center!) and width. A pan smaller than a
// texel cannot move a stationary caster's shadow continuously through the depth texture.
const origin = new T.Vector3();
export function snapGroundGrid(cam, size) {
  origin.set(0, 0, 0).applyMatrix4(cam.matrixWorldInverse);
  const axis = (lo, hi, o) => {
    const span = 2 ** (Math.ceil(8 * Math.log2(Math.max(1, hi - lo) * 1.02)) / 8),
      pitch = span / size,
      mid = o + pitch * Math.round(((lo + hi) * 0.5 - o) / pitch);
    return [mid - span * 0.5, mid + span * 0.5];
  };
  [cam.left, cam.right] = axis(cam.left, cam.right, origin.x);
  [cam.bottom, cam.top] = axis(cam.bottom, cam.top, origin.y);
  cam.updateProjectionMatrix();
}
export function nearGroundTarget(size) {
  const n = Math.min(1024, size),
    target = new T.WebGLRenderTarget(n, n, { depthBuffer: true, generateMipmaps: false });
  target.depthTexture = new T.DepthTexture(n, n, T.UnsignedIntType);
  target.depthTexture.compareFunction = T.LessEqualCompare;
  target.depthTexture.minFilter = target.depthTexture.magFilter = T.LinearFilter;
  return { target, cam: new T.OrthographicCamera(), matrix: new T.Matrix4(), params: new T.Vector3() };
}
export function nearGroundFit(layer, wide, cx, cy, z, bias, subjectDistance=Infinity) {
  const c = layer.cam;
  c.copy(wide, false);
  origin.set(cx, cy, z).applyMatrix4(c.matrixWorldInverse);
  const span = Math.max(64, Math.min(Math.min(wide.right - wide.left, wide.top - wide.bottom) * 0.34, subjectDistance*1.38));
  c.left = origin.x - span / 2;
  c.right = origin.x + span / 2;
  c.bottom = origin.y - span / 2;
  c.top = origin.y + span / 2;
  snapGroundGrid(c, layer.target.width);
  layer.matrix.copy(bias).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
  const pitch = (c.right - c.left) / layer.target.width;
  layer.params.set(pitch, pitch / (c.far - c.near), 1 / layer.target.width);
}
