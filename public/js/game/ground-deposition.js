// A stationary deposit field in world units. Sample at terrain/ring creation, not every
// fragment. Seed changes phase; measured lengths, prevailing direction and the material
// response belong to the reviewed site. No light, tint, camera or simulation input.
const mix=(a,b,t)=>a+(b-a)*t, smooth=t=>t*t*(3-2*t);
function at(i,j,seed){
  let h=Math.imul(i,0x1b873593)^Math.imul(j,0x85ebca6b)^seed;
  h=Math.imul(h^(h>>>16),0x7feb352d);
  h=Math.imul(h^(h>>>15),0x846ca68b);
  return ((h^(h>>>16))>>>0)/4294967296;
}
function noise(x,y,seed){
  const i=Math.floor(x),j=Math.floor(y),u=smooth(x-i),v=smooth(y-j);
  return mix(mix(at(i,j,seed),at(i+1,j,seed),u),mix(at(i,j+1,seed),at(i+1,j+1,seed),u),v);
}
export function depositField({seed,heading,length,width}){
  if(!Number.isSafeInteger(seed)||!Number.isFinite(heading)||!(length>=width && width>=40 && Number.isFinite(length)))throw Error('Invalid deposit direction or world scale');
  const c=Math.cos(heading),s=Math.sin(heading);
  return (x,y)=>{
    const u=(x*c+y*s)/length,v=(y*c-x*s)/width,
      // Warp across the nominal wind direction; do not lay straight bands from rim to rim.
      bend=1.8*(noise(u*.57,v*.31,seed^137)-.5),a=u+.45*bend,b=v+bend;
    const grain=.68*noise(a,b,seed)+.32*noise(2.07*a+.32*b,1.81*b-.57*a,seed^599);
    return smooth(Math.max(0,Math.min(1,(grain-.20)/.60)));
  };
}
