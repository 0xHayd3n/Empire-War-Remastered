// Mounted Endor Ultra. Count real mirror draws and unchanged geometry streams dirtied by a close pan.
const {chromium}=require('playwright-core'), assert=require('node:assert/strict');
const gl=process.env.LOOK_BACKEND==='webgl';
(async()=>{
  const b=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    const p=await b.newPage({viewport:{width:1080,height:640}}), errors=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(/Shader Error|INVALID_OPERATION|GPUValidationError|Error while (?:validating|parsing WGSL)/.test(m.text()))errors.push(m.text().slice(0,600));});
    if(gl)await p.addInitScript(()=>sessionStorage.setItem('swr-webgpu-dropped','1'));
    await p.goto('http://127.0.0.1:8590/#endor-ultra');
    const result=await p.frameLocator('#game').locator('body').evaluate(async()=>{
      const T=await import('three'), wait=()=>new Promise(requestAnimationFrame),end=performance.now()+90000;
      while(!window.game?.ground?.userData.endorLandscape?.active || !game.extraFx?.pr || game.world.time<1){if(performance.now()>end)throw Error('Endor not ready');await wait();}
      const g=game;g.modeSuspended=true;await wait();g.following=null;
      const env=g.map.environments.find(e=>e.name==='Noon_Clear');await g.applyEnvironment(env);g.world.setWeather(env.weather);
      g.forestSky.cover=g.forestSky.wet=g.groundRain.amount=0;
      const geo=g.water.children[0].geometry,p=geo.attributes.position, tri=[],point=new T.Vector3();
      // Independent check: every single drawn liquid triangle is outside the camera.
      for(let i=0;i<p.count;i+=3){const box=new T.Box3();for(let j=0;j<3;j++)box.expandByPoint(point.fromBufferAttribute(p,i+j));tri.push(box);}
      const fr=new T.Frustum(),pv=new T.Matrix4(), w=g.water.userData, mirror=w.mirror;
      let actual=0;w.mirror=function(r,c,draw){return mirror.call(this,r,c,eye=>{actual++;return draw(eye);});};
      const patch=g.ground.getObjectByName('Endor displaced ground').geometry, streams=[patch.index,patch.attributes.corner];
      const camera=g.camera,now=g.last, stats=[];
      // Count actual GL uploads on these dynamic streams only. The direct GPU
      // renderer already copies the live instance prefix to its frame arena.
      const foliage=new Map();for(const group of ['Endor map-wide old growth','Endor forest shadow casters'])
        for(const m of g.scene.getObjectByName(group).children){foliage.set(m.instanceMatrix.array,[m,16]);if(group.includes('old growth'))foliage.set(m.geometry.attributes.instanceTint.array,[m,4]);}
      let uploaded=0,unused=0;
      if(!g.gpuOn){const ctx=g.renderer.getContext(),sub=ctx.bufferSubData;ctx.bufferSubData=function(...a){const row=foliage.get(a[2]);if(row){const n=a[4]||a[2].length;uploaded+=4*n;unused+=4*Math.max(0,n-row[0].count*row[1]);}return sub.apply(this,a);};}
      for(const [label,x,y,dx,dy] of [['forest',1460,3120,5,3],['bank',1880,3260,4,3],['pond',300,1940,3,-4],['return',1500,3210,3,-5]]){
        let inland=0,wasted=0,wet=0,reflections=0,unchangedDirtyBytes=0,rebuilds=0;
        for(let i=0;i<28;i++){
          const versions=streams.map(a=>a.version),position=patch.attributes.position.version, drawn=actual;
          Object.assign(g.view,{x:x+dx*i,y:y+dy*i,dist:100,pitch:1.08,yaw:-1.5});
          g.modeSuspended=false;g.warming=true;try{g.frame(now);}finally{g.modeSuspended=true;g.warming=false;}
          fr.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
          if(tri.some(box=>fr.intersectsBox(box))){wet++;reflections+=actual-drawn;}else{inland++;wasted+=actual-drawn;}
          if(position!==patch.attributes.position.version)rebuilds++;
          streams.forEach((a,j)=>{if(a.version!==versions[j])unchangedDirtyBytes+=a.array.byteLength;});
          await wait();
        }
        stats.push({label,inland,wasted,wet,reflections,rebuilds,unchangedDirtyBytes});
      }
      // After the dry return leg, the first visible frame on each device needs its own image.
      const backend=g.gpuOn?'gpu':'gl', switched=[];
      if(g.gpuOn){
        try { for(const useGPU of [true,false,false,true]){
          g.gpuOn=useGPU;Object.assign(g.view,{x:300,y:1940,dist:100,pitch:1.08,yaw:-1.5});
          const before=actual;g.modeSuspended=false;g.warming=true;
          try{g.frame(now);}finally{g.modeSuspended=true;g.warming=false;}
          switched.push(actual-before);await wait();
        }} finally { g.gpuOn=true; }
      }
      await g.gpu?.settle?.();return {backend,stats,switched,uploaded,unused};
    });
    console.log(result);assert.deepEqual(errors,[]);assert.equal(result.backend,gl?'gl':'gpu');
    const s=result.stats;assert(s.some(v=>v.wet && v.reflections),'water coverage control missing');
    for(const i of [0,3])assert(s[i].inland===28 && s[i].wasted===0,'dry forest pan should not render the scene a second time for water');
    for(const i of [1,2])assert(s[i].wet===28 && s[i].reflections===14,'water in view should reflect every second frame');
    if(gl)assert(result.uploaded>0 && !result.unused,'WebGL uploads forest slots beyond the live instances');
    if(!gl)assert.deepEqual(result.switched,[1,1,0,1],'device-specific reflection freshness');
    assert(s.some(v=>v.rebuilds>=5) && s.every(v=>v.unchangedDirtyBytes===0),'pan must not invalidate fixed index and corner streams');
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
