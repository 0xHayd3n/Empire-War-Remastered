// Catalogues can suggest places; only inspection of individual frames qualifies them.
export function inspectPlaceViews(d){
  const views=d.views??[];if(views.length<10)throw Error('Need ten distinct inspected landscape/building views; broaden the location search, not the crops');
  const photos=new Set(),hashes=new Set();for(const v of views){const u=new URL(v.image);if(u.hostname==='lumiere-a.akamaihd.net'){u.search='';u.hash='';}if(photos.has(u.href)||hashes.has(v.sha256))throw Error('Duplicate photo or alternate CDN crop');photos.add(u.href);hashes.add(v.sha256);}
  const cues=new Set();for(const v of views){if(!['landscape','building','settlement-edge'].includes(v.subject)||!['none','incidental-native'].includes(v.people)||typeof v.settingCue!=='string'||v.settingCue.trim().length<18||cues.has(v.settingCue.trim().toLowerCase()))throw Error('Every counted frame must be principally a specific landform, building or settlement edge');cues.add(v.settingCue.trim().toLowerCase());if(v.people==='incidental-native'&&!(v.nativeContext?.trim().length>=18))throw Error('Identify the incidental inhabitants and how they explain the place');}
  if(!views.some(v=>v.subject==='landscape'))throw Error('Need a landscape, not just buildings');return views;
}
// Negative hints prune obvious narrative results before spending the download budget.
// A place-led film establishing shot can qualify; a portrait on sand cannot.
export function narrativeCaption(text){return /\b(?:duels?|lightsabers?|podrac(?:e|er|ing)|dogfight|close[- ]up|portrait|cockpit|battles? (?:darth|luke)|fights? (?:with|against)|anakin (?:races|fights|leaves)|obi-wan (?:fights|duels)|squadrons? rise|ceremony)\b/i.test(text);}
export const builtCue=/\b(?:buildings?|huts?|streets?|settlements?|ruins?|courtyards?|exteriors?|architecture|rooftops?|gateways?|homesteads?|hangars?|temples?|spaceports?|villages?|farmsteads?)\b/i;
