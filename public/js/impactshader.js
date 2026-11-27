export const impactVertex = `varying vec2 markUV;void main(){markUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
export function impactFragment(wg) {
  const V = wg ? 'vec3f' : 'vec3',
    C = wg ? 'vec4f' : 'vec4',
    F = wg ? 'let' : 'float',
    uv = wg ? 'i.uv' : 'markUV',
    stage = wg ? 'D.damageStage' : 'damageStage',
    ret = wg ? 'return ' : 'gl_FragColor=',
    end = wg ? ';' : ';return;';
  return (
    (wg ? '@fragment fn fs(i: Out)->@location(0) vec4f {' : 'varying vec2 markUV;uniform vec2 damageStage; void main(){') +
    `
 ${F} d=length(${uv});if(d>1.0){discard;}
 if(${stage}.x>1.5){
   ${F} ribs=0.5+0.5*cos(34.0*d);${F} rim=smoothstep(0.71,0.94,d);
   ${ret}${C}(${V}(0.045,0.050,0.058)+${V}(0.08,0.075,0.07)*ribs*rim,1.0-smoothstep(.93,1.0,d))${end}
 }
 ${F} t=${stage}.y;
 if(${stage}.x>0.5){
   ${F} wave=1.0-smoothstep(.035,.15,abs(d-(.14+1.8*t)));
   ${F} core=(1.0-smoothstep(.0,.38,d))*exp(-9.0*t);
   ${ret}${C}(${V}(.28,.73,1.0),(.78*wave+.54*core)*(1.0-smoothstep(.20,.46,t)))${end}
 }
 ${F} irregular=.07*sin(9.0*${uv}.x+3.0*${uv}.y)+.04*sin(13.0*${uv}.y-5.0*${uv}.x);
 ${F} shape=d+irregular;${F} soot=1.0-smoothstep(.45,.95,shape);
 ${F} hot=exp(-3.5*t)*(1.0-smoothstep(.05,.57,shape));
 ${ret}${C}(mix(${V}(.055,.042,.036),${V}(1.0,.46,.10),hot),.84*soot);
 }`
  );
}
