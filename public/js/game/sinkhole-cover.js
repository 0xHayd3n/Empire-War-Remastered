import {depositField} from './ground-deposition.js';

// On the windward shelf gravel is exposed; little hollows and the lee of the lip collect
// fines. The sink itself is NOT a land surface: this only supplies weights to existing quads.
export function sinkholeCover(t,c,slots,blur,ramp){
  const {size:n,width:w,height:h,heights:H}=t,N=w*h,lag=new Float32Array(N),wash=new Float32Array(N),
    gravels=new Set(c.gravelHints),runs=new Set(c.runHints),field=depositField(c.deposition);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=t.layerIndex[y*n+x];lag[y*w+x]=+gravels.has(s);wash[y*w+x]=+runs.has(s);}
  const G=blur(lag,w,h,3),W=blur(wash,w,h,3),bytes=new Uint8Array(8*N),dominant=new Uint8Array(N);
  const z=(x,y)=>H[Math.max(0,Math.min(h-1,y))*n+Math.max(0,Math.min(w-1,x))];
  const q=new Float64Array(7);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=y*w+x,dx=(z(x+1,y)-z(x-1,y))/40,dy=(z(x,y+1)-z(x,y-1))/40,slope=Math.hypot(dx,dy),
      hollow=ramp(-8,14,(z(x-4,y)+z(x+4,y)+z(x,y-4)+z(x,y+4))*.25-z(x,y)),
      exposed=1-hollow,face=.96*ramp(.24,1.0,slope),tongue=field(x*20,y*20),
      coarse=(1-face)*(.045+.26*G[k]+.23*ramp(.12,.6,slope)*hollow),
      channel=(1-face-coarse)*.42*W[k]*(1-ramp(.15,.55,slope)),
      plain=1-face-coarse-channel,skin=.09+.59*tongue+.17*exposed+.06*G[k],
      lean=ramp(.16,.67,Math.abs(dx))*Math.abs(dx)/(slope||1);
    q[0]=plain*(1-skin);q[1]=plain*skin;q[2]=coarse;q[3]=channel;q[4]=face*(1-lean);q[5]=dx<0?face*lean:0;q[6]=dx>=0?face*lean:0;
    const offset=8*y*w+4*x,at=i=>offset+(i<4?i:4*w+i-4);let total=0,best=0;
    for(let i=0;i<7;i++){total+=bytes[at(i)]=Math.round(q[i]*255);if(q[i]>q[best])best=i;}
    bytes[at(best)]+=255-total;
    // Relief and the distant draw must pick the same winner after byte rounding,
    // including the first channel in a tie.
    best=0;for(let i=1;i<7;i++)if(bytes[at(i)]>bytes[at(best)])best=i;
    dominant[k]=slots[best];
  }return [bytes,dominant];
}
