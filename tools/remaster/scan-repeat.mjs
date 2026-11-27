// Offline repeat probe over the same filtered 128px color mip and chart transforms
// as the terrain. Not a pixel/FPS test. fit separately verifies the mounted donor hashes.
import fs from 'node:fs';
import { parseDDS } from '../../public/js/dds.js';
import { decodeDXT } from '../../public/js/ddsdecode.js';
import { tileFootprint } from '../../public/js/endor-tiles.js';
const lags=[[1,0],[0,1],[1,1],[2,0],[0,2]], avg=a=>a.reduce((s,n)=>s+n,0)/a.length;
function stats(a,b){const x=avg(a),y=avg(b);let xx=0,yy=0,xy=0;for(let i=0;i<a.length;i++){const p=a[i]-x,q=b[i]-y;xx+=p*p;yy+=q*q;xy+=p*q;}return {corr:xy/Math.sqrt(xx*yy),rms:Math.sqrt(xx/a.length)};}
export function scanRepeat(donor,id){
  const data=fs.readFileSync(new URL(`../../public/art/${donor.pack||'endor-terrain'}/${donor.id}-color.dds`,import.meta.url));
  const d=parseDDS(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)),m=d.mipmaps.find(m=>m.width===128),px=decodeDXT(m.data,128,128,5),lum=Float64Array.from({length:128*128},(_,i)=>.2126*px[4*i]+.7152*px[4*i+1]+.0722*px[4*i+2]);
  const mean=avg(lum),at=(x,y)=>lum[(x&127)+128*(y&127)];
  function raw(u,v){const x=u*128-.5,y=v*128-.5,i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j;return (1-b)*((1-a)*at(i,j)+a*at(i+1,j))+b*((1-a)*at(i,j+1)+a*at(i+1,j+1));}
  function organic(u,v){const p=tileFootprint(u,v,id);let l=0,w2=0;for(const [x,y,w]of p){l+=w*raw(x,y);w2+=w*w;}return mean+(l-mean)/Math.sqrt(w2);}
  const chart=donor.regular?raw:organic,base=[],positive=[],aligned=[],shifted=lags.map(()=>[]);
  for(let j=0;j<55;j++)for(let i=0;i<79;i++){const u=-8.17+.2671*i+.0243*j,v=4.33+.2817*j-.0312*i;base.push(chart(u,v));aligned.push(raw(u,v));positive.push(raw(u+1,v));lags.forEach(([x,y],k)=>shifted[k].push(chart(u+x,v+y)));}
  const control=stats(aligned,positive),corr=shifted.map(v=>stats(base,v).corr),grain=stats(base,base).rms/control.rms;
  if(!(control.corr>.99 && grain>.65 && grain<1.45 && corr.every(n=>Number.isFinite(n)&&(donor.regular?n>.99:Math.abs(n)<.32))))throw Error(`Periodic marks or lost grain: ${donor.id} ${JSON.stringify({corr,grain})}`);
  return {id:donor.id,aligned:donor.regular,corr,grain};
}
