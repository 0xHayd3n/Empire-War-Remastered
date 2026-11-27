import {depositField} from './ground-deposition.js';

// A dry channel is a sediment sink, not water. The extensive tower-texture swatches
// on this TED are chiefly tilted projections on scarps, not industrial floor plans.
export function badlandCover(t,c,slots,blur,ramp){
  const {width:w,height:h,size:n,heights:H}=t, N=w*h, basin=new Float32Array(N), mineral=new Float32Array(N), shoulder=new Float32Array(N),
    channels=new Set(c.channelHints),salt=new Set(c.saltHints),stone=new Set(c.rockHints),deposit=depositField(c.deposition);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const raw=t.layerIndex[y*n+x],k=y*w+x;basin[k]=+channels.has(raw);mineral[k]=+salt.has(raw);shoulder[k]=+stone.has(raw);
  }
  const wash=blur(basin,w,h,3),salts=blur(mineral,w,h,3),fans=blur(shoulder,w,h,4),bytes=new Uint8Array(8*N),dominant=new Uint8Array(N),weights=new Float64Array(7);
  const z=(x,y)=>H[Math.max(0,Math.min(y,h-1))*n+Math.max(0,Math.min(x,w-1))];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=y*w+x, dx=(z(x+1,y)-z(x-1,y))/40,dy=(z(x,y+1)-z(x,y-1))/40,g=Math.hypot(dx,dy),
      bowl=ramp(0,16,(z(x-4,y)+z(x+4,y)+z(x,y-4)+z(x,y+4))*.25-z(x,y)),fleck=deposit(20*x,20*y),
      bed=ramp(.22,.96,g)*(.76+.24*fans[k]),
      // A continuous finer bed with interrupted tongues of coarser wash. At the
      // toe and in scoured runnels the rounded fragments can actually read from above.
      lag=.36*ramp(.31,.84,1-fleck)*(.22+.52*wash[k]+.26*bowl),
      gravel=(1-bed)*(.055+lag+.26*ramp(.07,.58,g)+.13*fans[k]),
      saltskin=(1-bed-gravel)*ramp(.16,.84,salts[k])*(1-ramp(.06,.23,g))*(.10+.21*bowl+.09*fleck),
      plain=1-bed-gravel-saltskin,crust=.12+.52*fleck+.14*wash[k]+.07*bowl,
      tilt=ramp(.16,.76,Math.abs(dx))*Math.abs(dx)/(g||1);
    weights[0]=plain*(1-crust);weights[1]=plain*crust;weights[2]=gravel;weights[3]=saltskin;
    weights[4]=bed*(1-tilt);weights[5]=dx<0?bed*tilt:0;weights[6]=dx>=0?bed*tilt:0;
    const off=8*y*w+4*x,addr=q=>off+(q<4?q:4*w+q-4);let sum=0,best=0;
    for(let q=0;q<7;q++){sum+=bytes[addr(q)]=Math.round(255*weights[q]);if(weights[q]>weights[best])best=q;}
    bytes[addr(best)]+=255-sum;best=0;for(let q=1;q<7;q++)if(bytes[addr(q)]>bytes[addr(best)])best=q;dominant[k]=slots[best];
  }
  return [bytes,dominant];
}
