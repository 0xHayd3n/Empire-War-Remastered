// Retained ALOs have no remaster instance streams. Observe their actual main-camera
// draws instead of inventing proxy capacities or counting invisible prop containers.
const path=require('node:path');
module.exports=async function retained(body,page,out,PNG){
 const setup=await body.evaluate(async()=>{const g=game,recipe=window.reviewRecipe,groups=new Map(),cleanup=[],T=await import('three');
  for(const [role,names] of Object.entries(recipe.retainedPlants)){const list=g.props.filter(p=>names.includes(p.modelFile.toUpperCase()));if(!list.length)throw Error('Missing retained class '+role);groups.set(role,list);}
  const hits=new Set(),members=new Map();for(const rows of groups.values())for(const p of rows)p.grp.traverse(m=>{if(!m.isMesh)return;members.set(m,p);const prev=m.onBeforeRender;const probe=function(R,scene,camera,...rest){if(scene===g.scene&&camera===g.camera)hits.add(p);return prev.call(this,R,scene,camera,...rest);};m.onBeforeRender=probe;cleanup.push(()=>m.onBeforeRender=prev);});
  // Stock rigid props normally render from LandInstances. Identify their original
  // world matrices in the actual submitted pool, including sorted alpha batches.
  // Pools are created, resized and exchanged for different scenery LODs as the camera
  // moves. A snapshot taken at the old camera misses real roots in the next draw.
  const batches=g.batches,wrapped=new Set(),pools=new Map();
  if(batches){const collect=batches.collect;batches.collect=function(...args){const result=collect.apply(this,args);pools.clear();
    for(const [m,p] of members){const im=m._batch?.pool?.im;if(!m._taken||!im?.visible||!im.count)continue;
      if(!pools.has(im))pools.set(im,new Map());pools.get(im).set(Array.from(m.matrixWorld.elements,Math.fround).join('/'),p);
      if(wrapped.has(im))continue;wrapped.add(im);const prev=im.onBeforeRender;
      im.onBeforeRender=function(R,scene,camera,...args){const transforms=pools.get(im);if(transforms&&scene===g.scene&&camera===g.camera){const a=im.instanceMatrix.array;for(let i=0;i<im.count;i++){const p=transforms.get(a.subarray(16*i,16*i+16).join('/'));if(p)hits.add(p);}}return prev.call(this,R,scene,camera,...args);};cleanup.push(()=>im.onBeforeRender=prev);
    }return result;};cleanup.push(()=>batches.collect=collect);}
  const masks=new Map();window.retainMask=(role,on)=>{if(on){for(const [m,visible]of masks)m.visible=visible;masks.clear();return;}for(const p of groups.get(role))p.grp.traverse(m=>{if(m.isMesh){masks.set(m,m.visible);m.visible=false;}});};
  window.retainRead=(role,c)=>[...hits].filter(p=>groups.get(role).includes(p)&&Math.hypot(p.x-c[0],p.y-c[1])<35).map(p=>p.modelFile+'@'+p.x+'/'+p.y).sort();window.retainClear=()=>hits.clear();window.retainEnd=()=>{retainMask(null,true);cleanup.forEach(f=>f());};
  const centres={};for(const [role,rows]of groups){const viable=rows.filter(p=>p.x>700&&p.x<3040&&p.y>700&&p.y<3040).sort((a,b)=>Math.hypot(a.x-1200,a.y-1550)-Math.hypot(b.x-1200,b.y-1550));centres[role]=[viable[0].x,viable[0].y];}
  return {centres,maximum:g.cam.steps.at(-1)[0]};});
 const roles=Object.keys(setup.centres),a={mode:'retained-draws',roles,maximum:setup.maximum,samples:[],controls:[]};
 try{for(const role of roles){let ref;const xy=setup.centres[role];for(const d of [128,380,681,900,setup.maximum,128]){const c=[...xy,d,await body.evaluate((_,x)=>game.viewTilt(x),d),-1.5];await body.evaluate(()=>retainClear());await body.evaluate((_,c)=>yavinDraw({c,on:true,warmFrames:5}),c);const roots=await body.evaluate((_,a)=>retainRead(...a),[role,c]);if(!ref)ref=roots;if(!ref.length||JSON.stringify(ref)!==JSON.stringify(roots))throw Error('Retained foliage not drawn through zoom: '+JSON.stringify([role,d,ref,roots]));a.samples.push({role,d,roots:roots.length,same:true});if((d===128||d===setup.maximum)&&!a.controls.some(x=>x.role===role&&x.d===d)){const stem=`foliage-${role}-${d}`,on=PNG.sync.read(await page.screenshot({path:path.join(out,stem+'.png')}));await body.evaluate((_,role)=>retainMask(role,false),role);try{await body.evaluate((_,c)=>yavinDraw({c,on:true,warmFrames:3}),c);const off=PNG.sync.read(await page.screenshot({path:path.join(out,stem+'-off.png')}));let pixels=0;for(let y=Math.floor(.18*on.height);y<.66*on.height;y++)for(let x=Math.floor(.23*on.width);x<.77*on.width;x++){const i=4*(y*on.width+x);if([0,1,2].reduce((s,k)=>s+Math.abs(on.data[i+k]-off.data[i+k]),0)>18)pixels++;}a.controls.push({role,d,stem,pixels});}finally{await body.evaluate(()=>retainMask(null,true));}}}}
 return a;}finally{await body.evaluate(()=>retainEnd());}
};
