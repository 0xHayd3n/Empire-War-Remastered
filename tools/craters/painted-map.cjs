// Runs inside an isolated frame of the mounted Universal checkout. The harness
// pins the exact installed VFS order; the production terrain modules are unmodified.
module.exports = async function paintMap({file,digest,at}) {
  const T=await import('three'),{parseTED}=await import('/js/ted.js'),{buildTerrain,heightAt,paintFog}=await import('/js/game/terrain.js'),
    {LandScars}=await import('/js/game/land-scars.js'),{LandWorld}=await import('/js/game/land.js');
  const buf=await (await fetch(window.SWR_BASE+'asset/'+file.replaceAll('\\','/'))).arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==digest)throw Error('wrong winning map: '+hash);
  const R=window.auditGL ||= new T.WebGLRenderer({antialias:false,alpha:false});R.setSize(96,96,false);
  R.outputColorSpace=T.LinearSRGBColorSpace;
  const target=window.auditTarget ||= new T.WebGLRenderTarget(96,96),scene=new T.Scene(),map=parseTED(buf),t=map.terrain;
  const ground=await buildTerrain(t,map,R);scene.add(ground);const world=new LandWorld(map,scene,{}),scars=new LandScars(world,ground,scene,{mode:'land'});
  const own=ground.material.uniforms, ink=scars.pits;
  // Controlled clear-sky illumination. Particle/cloud streaming and the
  // authored weather clock aren't part of this material comparison.
  const white=window.auditWhite ||= new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;own.clouds.value=white;
  try{
    const [x,y]=at;
    paintFog(t,null,false);
    if(!scars.apply(x,y,{radius:17,depth:4},false)||!ink.hits)throw Error('render probe could not excavate site');
    const z=heightAt(t,x,y),eye=new T.OrthographicCamera(-12,12,12,-12,1,1000);eye.position.set(x,y,z+100);eye.lookAt(x,y,z);eye.updateMatrixWorld(true);
    const a=ink.geo.attributes.shade,keep=a.array.slice();
    const frame=()=>{R.setRenderTarget(target);R.setClearColor(0xff00ff);R.clear();R.render(scene,eye);const out=new Uint8Array(8*8*4);R.readRenderTargetPixels(target,44,44,8,8,out);let Y=0;for(let i=0;i<out.length;i+=4)Y+=(out[i]*.299+out[i+1]*.587+out[i+2]*.114)/64;return Y;};
    const burnt=frame();a.array.fill(2);a.clearUpdateRanges();a.needsUpdate=true;const base=frame();a.array.set(keep);a.needsUpdate=true;
    const gl=R.getContext(),error=gl.getError();
    if(error||!(base>0&&burnt+0.3<base&&burnt<=base*.8))throw Error(`no visible char: soot=${burnt} control=${base} gl=${error}`);
    return {base:+base.toFixed(2),burnt:+burnt.toFixed(2)};
  } finally{R.setRenderTarget(null);scars.dispose();ground.geometry.dispose();ground.material.dispose();own.map.value.dispose();own.bump.value.dispose();t.fog?.dispose();R.renderLists.dispose();}
};
