// Temperate parkland. Warm, shallow shoulders lose turf sooner than sheltered hollows;
// the cut bed carries washed sediment and the actual tree roots have a shaded understory.
import { depositField } from './ground-deposition.js';
export function meadowCover(t,c,slots,props,blur,ramp){
  const {width:w,height:h,size:n,heights:H}=t,N=w*h,mask=()=>new Float32Array(N),bank=mask(),wear=mask(),thin=mask(),trees=mask();
  const beds=new Set(c.bedHints),paths=new Set(c.pathHints),dry=new Set(c.thinHints),crowns=new Set(c.treeModels);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=t.layerIndex[y*n+x],k=y*w+x;bank[k]=+beds.has(s);wear[k]=+paths.has(s);thin[k]=+dry.has(s);}
  for(const p of props){if(!crowns.has(p.modelFile.toUpperCase()))continue;const x=p.x/20,y=p.y/20;for(let j=Math.max(0,Math.floor(y-4));j<=Math.min(h-1,y+4);j++)for(let i=Math.max(0,Math.floor(x-4));i<=Math.min(w-1,x+4);i++)trees[j*w+i]=Math.max(trees[j*w+i],1-ramp(.6,3.8,Math.hypot(i-x,j-y)));}
  const river=blur(bank,w,h,2),road=blur(wear,w,h,2),shoulder=blur(thin,w,h,4),drain=depositField(c.deposition),bytes=new Uint8Array(8*N),dominant=new Uint8Array(N);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*n+x,k=y*w+x,dx=(H[y*n+Math.min(w-1,x+1)]-H[y*n+Math.max(0,x-1)])/40,dy=(H[Math.min(h-1,y+1)*n+x]-H[Math.max(0,y-1)*n+x])/40,grade=Math.hypot(dx,dy),
      crest=H[i]-.25*(H[y*n+Math.min(w-1,x+4)]+H[y*n+Math.max(0,x-4)]+H[Math.min(h-1,y+4)*n+x]+H[Math.max(0,y-4)*n+x]),
      face=.97*ramp(.27,1.04,grade),bed=(1-face)*.94*ramp(.035,.57,river[k]),
      soil=(1-face-bed)*(.03+.80*ramp(.07,.62,road[k])),shade=(1-face-bed-soil)*.75*trees[k],turf=1-face-bed-soil-shade,
      worn=Math.min(.86,.095+.55*drain(20*x,20*y)+.17*shoulder[k]+.14*ramp(1,18,crest)),axis=ramp(-.32,.32,Math.abs(dx)-Math.abs(dy));
    const q=[turf*(1-worn),turf*worn,soil,bed,face*axis,face*(1-axis),shade],offset=8*y*w+4*x,at=j=>offset+(j<4?j:4*w+j-4);let sum=0,m=0;
    for(let j=0;j<7;j++){sum+=bytes[at(j)]=Math.round(255*q[j]);if(q[j]>q[m])m=j;}bytes[at(m)]+=255-sum;m=0;for(let j=1;j<7;j++)if(bytes[at(j)]>bytes[at(m)])m=j;dominant[k]=slots[m];
  }return [bytes,dominant];
}
