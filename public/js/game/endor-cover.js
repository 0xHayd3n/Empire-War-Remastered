// Static habitat/shelter only: G = sky occlusion overhead, B = root contact, A = litter.
// Direct sunlight comes from the depth maps; changing sky must not replant/re-upload this field.
export function forestCover(plan, n=512){
  const w=plan.width/n,h=plan.height/n, field=new Float32Array(n*n*4), pixels=new Uint8Array(n*n*4);
  function stamp(px,py,size,k,channel){
    const x=px/w-.5,y=py/h-.5,rx=size/w,ry=size/h;
    for(let j=Math.max(0,Math.ceil(y-ry));j<=Math.min(n-1,Math.floor(y+ry));j++)for(let i=Math.max(0,Math.ceil(x-rx));i<=Math.min(n-1,Math.floor(x+rx));i++){
      const q=1-((i-x)/rx)**2-((j-y)/ry)**2;if(q>0)field[(j*n+i)*4+channel]+=k*q*q*(3-2*q);
    }
  }
  for(const c of plan.chunks)for(const p of c.plants){
    const big=p.kind==='redwood',tree=big||p.kind==='hemlock';
    if(tree){const r=(big?43:14)*p.s;
      stamp(p.x,p.y,r*1.26,1.35,1);
    }
    if(p.kind==='brush'||p.kind==='bracken')stamp(p.x,p.y,(p.kind==='brush'?16:10)*p.s,.94,3);
    if(big||p.kind==='stone'||p.kind==='log')stamp(p.x,p.y,(big?18:12)*p.s,1.7,2);
  }
  for(let i=0;i<n*n;i++){for(let k=1;k<4;k++)pixels[i*4+k]=Math.round(255*(-Math.expm1(-field[i*4+k])));}
  return pixels;
}
