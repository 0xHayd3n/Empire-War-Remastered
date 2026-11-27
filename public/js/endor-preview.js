// Fixed, local Universal showcase profiles. A link describes graphics only; never import a
// caller-supplied setup/asset URL. It doesn't save a preset into the player's preferences.
import {battlePrefs} from './battlerealism.js';
function presentation(key, allowed = ['ultra', 'original']){
  try{
    if(window===window.parent || (document.querySelector('meta[name="swr-pack-revision"]')?.content.split(':')[0]||'stock')!=='stock')return null;
    const host=document.querySelector('meta[name="swr-universal"]')?.content;
    if(!host || new URL(document.referrer).origin!==host)return null;
    const p=new URLSearchParams(location.search).get(key);
    return allowed.includes(p) ? p : null;
  }catch{return null;}
}
export const wreckBattle = presentation('wreck-battle', ['armor', 'infantry', 'combined', 'offensive']);
export const endorPresentation=()=>presentation('endor-presentation');
export const endorPreview=endorPresentation();
export const yavinPreview=!endorPreview && presentation('yavin-presentation');
export const tatooinePreview=!endorPreview && !yavinPreview && presentation('tatooine-presentation');
export const hothPreview=!endorPreview && !yavinPreview && !tatooinePreview && presentation('hoth-presentation');
export const geonosisPreview=!endorPreview && !yavinPreview && !tatooinePreview && !hothPreview && presentation('geonosis-presentation');
export const nabooPreview=!endorPreview && !yavinPreview && !tatooinePreview && !hothPreview && !geonosisPreview && presentation('naboo-presentation');
export const utapauPreview=!endorPreview && !yavinPreview && !tatooinePreview && !hothPreview && !geonosisPreview && !nabooPreview && presentation('utapau-presentation');
export const landPreview=yavinPreview || tatooinePreview || hothPreview || geonosisPreview || nabooPreview || utapauPreview;
export function endorGraphics(mode,defaults){
  if(!['ultra','original'].includes(mode))return null;
  const ultra=mode==='ultra';
  return {...defaults,...battlePrefs({battleRealism:ultra?'on':'off'}),battleRealism:ultra?'custom':'off',level:-1,
    texMip:0,shader:3,shadow:3,shadowRange:8,shadows:true,mesh:1,particle:1,aa:true,scale:1,battleScale:1,
    supersample:ultra?2:1,textureCubic:ultra,nativeSharpen:ultra,upscaleBlend:ultra?.65:0,postAA:'auto',hdrMode:ultra?'auto':'off',
    immersiveWeather:ultra?defaults.immersiveWeather:'off',canopyFade:ultra?defaults.canopyFade:0,endorLandscape:ultra,endorForestFloor:false,terrainLayers:ultra?1:0,landHighlightProtect:ultra?.9:0,landWaterClarity:ultra?.36:1,
    surfaceRelief:+ultra,environmentLight:+ultra,materialFinish:+ultra,contactShade:+ultra,lensStreaks:+ultra,
    bloom:true,heat:true,soft:true,flare:true,bloomGain:1,heatGain:1,gamma:.5};
}
