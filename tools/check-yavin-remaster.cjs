// Mounted FoC Yavin; freeze only for the A/B/rollback, never hide the HUD or stage troops.
const { chromium } = require('playwright-core'),
  { PNG } = require('pngjs'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { observeReveal, readReveal, checkReveal } = require('./remaster/first-battlefield.cjs');
const planet=process.env.REMASTER_MAP||'yavin',desert=planet==='tatooine',polar=planet==='hoth',mesa=planet==='geonosis',meadow=planet==='naboo',shelf=planet==='utapau';
if(!['yavin','tatooine','hoth','geonosis','naboo','utapau'].includes(planet))throw Error('Unsupported reviewed land map');
const focus=process.env.REMASTER_CHECK||'',rimOnly=process.env.YAVIN_OUTSKIRTS_ONLY==='1'||focus==='outskirts';
if(focus&&!['foliage','ground','outskirts','climate','look'].includes(focus))throw Error('Unknown review focus');
const gl = process.env.LOOK_BACKEND === 'webgl',
  fail = process.env.YAVIN_FAIL === '1',
  low = process.env.YAVIN_LOW === '1',
  original = process.env.YAVIN_ORIGINAL === '1',
  rain = process.env.YAVIN_RAIN === '1', clearPhase=focus==='climate' && process.env.REMASTER_WEATHER==='clear';
// Quick look: one mounted battle, a named camera subset, the same renderer core as the release
// pass, HUD on. It writes only an OS-temp folder and a partial report the release board refuses,
// so it can never be filed as a composed-landscape result.
const look=focus==='look',lookTag=(process.env.REMASTER_LOOK_TAG||'').trim().replace(/[^a-z0-9._-]+/gi,'-').slice(0,40),
  lookRequested=(process.env.REMASTER_LOOK_VIEWS||'').split(',').map(s=>s.trim()).filter(Boolean),
  LOOK_VIEWS={utapau:['squad','command','north-rim','landmark','grain-pan'],naboo:['squad','command','east-meadow','stone','grain-pan'],geonosis:['squad','command','eastern-wash','scarp','grain-pan'],hoth:['squad','command','rib-basin','rock-shelf','grain-pan'],
    tatooine:['squad','command','bone-basin','rock-shelf','grain-pan'],yavin:['squad','command','south-field','treeline','grain-pan']};
function requireLookMode(isLook,knobs){if(!isLook&&knobs)throw Error('REMASTER_LOOK_VIEWS/REMASTER_LOOK_TAG need REMASTER_CHECK=look');}
function requireLookSolo(isLook,diag){if(isLook&&diag)throw Error('REMASTER_CHECK=look draws its own off/on; drop YAVIN_FAIL/YAVIN_ORIGINAL');}
// The subset comes from the cameras this run already built, so there is still one set of definitions.
function lookCameras(cameras,planet,names=lookRequested.length?lookRequested:LOOK_VIEWS[planet]){
  if(!names?.length)throw Error('No default look cameras for '+planet+'; pass REMASTER_LOOK_VIEWS');
  if(new Set(names).size!==names.length)throw Error('Duplicate look camera: '+names.join(', '));
  return Object.fromEntries(names.map(n=>{if(!Object.hasOwn(cameras,n))throw Error(`Unknown look camera ${n}; ${planet} has ${Object.keys(cameras).join(', ')}`);return [n,cameras[n]];}));
}
requireLookMode(look,lookRequested.length>0||!!lookTag);
requireLookSolo(look,fail||original);
// No browser and no mounted battle: the look mode's misuse guards, the camera subset, and the
// release board's refusal of a partial-look report even with every required view listed.
async function selftest(){
  const t=Date.now(),
    cameras={squad:[],command:[],'eastern-wash':[],scarp:[],'grain-pan':[]};
  assert.throws(()=>requireLookMode(false,true),/REMASTER_CHECK=look/);
  requireLookMode(true,true);
  requireLookMode(false,false);
  assert.throws(()=>requireLookSolo(true,true),/drop YAVIN_FAIL/);
  requireLookSolo(true,false);
  requireLookSolo(false,true);
  assert.throws(()=>lookCameras(cameras,'geonosis',['squad','scarp','bogus']),/Unknown look camera bogus/);
  assert.throws(()=>lookCameras(cameras,'geonosis',['squad','squad']),/Duplicate look camera/);
  assert.throws(()=>lookCameras(cameras,'endor',undefined),/No default look cameras/);
  assert.deepEqual(Object.keys(lookCameras(cameras,'geonosis',['scarp','squad'])),['scarp','squad']);
  assert.deepEqual(Object.keys(lookCameras(cameras,'geonosis')),['squad','command','eastern-wash','scarp','grain-pan']);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'look-selftest-')),
    file=path.join(dir,'report.json'),
    job={id:fs.readdirSync(path.join(__dirname,'remaster','directions')).filter(f=>f.endsWith('.json'))[0].replace(/.json$/,'')};
  fs.writeFileSync(file,JSON.stringify({job:job.id,kind:'partial-look',stats:{active:true},views:{squad:{},command:{},'eastern-wash':{}}}));
  try{
    const { fitBoard }=await import('./remaster/fit.mjs');
    await assert.rejects(fitBoard(job,file,os.tmpdir()),/composed-landscape/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  console.log('look selftest ok · '+(Date.now()-t)+'ms');
}
(async () => {
  if(process.env.REMASTER_LOOK_SELFTEST==='1')return selftest();
  const t0=Date.now();
  let mountedAt=0;
  const baseOut = path.join(
    process.env.REMASTER_RUN_DIR || os.tmpdir(),
    `universal-${planet}-${clearPhase?'remaster':rimOnly?'outskirts':focus||'remaster'}${look&&lookTag?'-'+lookTag:''}`,
    (gl ? 'webgl' : 'webgpu') + (fail ? '-fallback' : low ? '-low' : original ? '-original' : rain ? '-rain' : ''), ...(clearPhase?['climate-clear']:[]) 
  );
  fs.mkdirSync(baseOut, { recursive: true });
  const out=look?fs.mkdtempSync(path.join(baseOut,'look-')):baseOut;
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
    p.setDefaultTimeout(70000);
    const errors = [];
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (/GPUValidationError|Error while (validating|parsing WGSL)|Shader Error|INVALID_OPERATION|Reviewed landscape:/.test(m.text())) {
        console.error(m.text().slice(0, 1900));
        if (!/Reviewed landscape:/.test(m.text()) || !fail) errors.push(m.text().slice(0, 900));
      }
    });
    await p.addInitScript(observeReveal);
    if (low) await p.addInitScript(() => {
      // The showcase fixes native 2K. Select the test tier before the map is built,
      // not by opting into the remaster after the original battlefield is visible.
      if (window !== parent) document.addEventListener('DOMContentLoaded', async () => {
        if (document.querySelector('meta[name="swr-universal"]')) (await import('/js/gfx.js')).gfx.texMip = 2;
      }, { once: true });
    });
    await p.addInitScript(gl => {
      if (gl) sessionStorage.setItem('swr-webgpu-dropped', '1');
      localStorage.setItem('swr.game', 'eaw');
    }, gl);
    if (fail)
      await p.route(shelf?'**/art/utapau-ground/deck-wear-surface.dds':meadow?'**/art/naboo-ground/*-surface.dds':mesa?'**/art/geonosis-ground/*-surface.dds':polar?'**/art/hoth-ground/wind-snow-color.dds':desert?'**/art/tatooine-ground/broken-ledge-surface.dds':process.env.YAVIN_BAD_FRINGE ? '**/art/yavin-fringe/jacaranda-horizon.png' : process.env.YAVIN_BAD_PROXY ? '**/art/yavin-groundcover/atlas.png' : process.env.YAVIN_BAD_TERRAIN ? '**/art/yavin-ground/*-surface.dds' : '**/art/yavin-jungle/jacaranda.png', r =>
        r.fulfill({ body: 'damaged' })
      );
    await p.goto('http://127.0.0.1:8590/#'+planet+'-' + (original ? 'original' : 'remaster'));
    const frame = p.frameLocator('#game'),
      body = frame.locator('body');
    await frame.locator('#loading.hidden').waitFor({ state: 'attached' });
    // Read the draw saved at uncover, independently of the later camera/ready waits.
    const firstBattlefield = await readReveal(body);
    checkReveal(firstBattlefield, { planet, mode: fail ? 'fallback' : original ? 'original' : 'remaster',
      backend: gl ? 'webgl' : 'webgpu', width: low ? 512 : 2048 });
    const report = await body.evaluate(
      async (_, { fail, original, gl, rain,desert,polar,mesa,meadow,shelf,planet,clearPhase }) => {
        const wait = () => new Promise(requestAnimationFrame),
          end = performance.now() + (gl ? 180000 : 85000);
        while (
          !(
            window.game?.world?.time > 0.7 &&
            game.ground &&
            game.extraFx?.pr &&
            !document.querySelector('.battle-plate') &&
            (original || ['unavailable', 'ready'].includes(game.ground.userData.reviewedLandscape?.state))
          )
        ) {
          if (performance.now() > end)
            throw Error('No ready '+planet+' battle: ' + JSON.stringify(window.game?.ground?.userData.reviewedLandscape));
          await wait();
        }
        const g = game,
          w = g.world,
          t = g.terrain,
          status = g.ground.userData.reviewedLandscape,
          { gfx } = await import('/js/gfx.js'),
          { digest } = await import('/js/texture-showcase/recipes.js');
        if (
          !status ||
          !!g.gpuOn === gl ||
          g.map.file.toUpperCase() !== `_MP_LAND_${planet.toUpperCase()}.TED` ||
          (await import('/js/edition.js')).edition() !== 'foc'
        )
          throw Error('Wrong mount/renderer');
        // Isolate the terrain swap. The default weather library would otherwise follow
        // the landscape switch and change the sky/light between these material controls.
        gfx.immersiveWeather = 'off';
        const guard = async () =>
          JSON.stringify([
            await digest(t.layerIndex.buffer),
            await digest(t.heights.buffer),
            await digest(t.passability.buffer),
            w.units.length,
            w.time,
            w.weather.name,
            w.weather.i,
            w.weather.left
          ]);
        if (rain) {
          const { rainfall } = await import('/js/groundrain.js');
          while (rainfall(w.weather) < 0.5 || g.groundRain.amount < 0.12) {
            if (performance.now() > end) throw Error('Authored rain not reached');
            await wait();
          }
        }
        const recipe=window.reviewRecipe=shelf?(await import('/js/utapau-recipe.js')).utapauRecipe:meadow?(await import('/js/naboo-recipe.js')).nabooRecipe:mesa?(await import('/js/geonosis-recipe.js')).geonosisRecipe:polar?(await import('/js/hoth-recipe.js')).hothRecipe:desert?(await import('/js/tatooine-recipe.js')).tatooineRecipe:(await import('/js/yavin-recipe.js')).yavinRecipe;
        const data = {
          kind: 'composed-landscape',
          job: recipe.job,
          weather: [w.weather.name, w.weather.i, g.groundRain.amount],
          map: g.map.file,
          backend: g.gpuOn ? 'webgpu' : 'webgl',
          waterMode: t.water?.mode ?? 0,
          waterSheet: !!g.water,
          sky: g.map.environment.name,
          textureMip: gfx.texMip,
          stats: { ...status },
          stored: [localStorage.getItem('swr.game'), localStorage.getItem('swr-gfx')],
          propModels: [...new Set(g.props.map(p => p.modelFile))].sort()
        };
        if (fail || original) return data;
        console.log('Mounted props: ' + data.propModels);
        if (!status.active) throw Error('Remaster not active: ' + status.reason);
        if(shelf){
          let omitted=0;for(let y=0;y<t.height-1;y++)for(let x=0;x<t.width-1;x++){
            const i=y*t.size+x,q=2*(y*(t.width-1)+x),hole=[i,i+1,i+t.size,i+t.size+1].every(k=>t.layers[t.layerIndex[k]]?.hole);
            if((t.paint.triAt[q]<0)!==hole||(t.paint.triAt[q+1]<0)!==hole)throw Error('Utapau sinkhole topology changed');if(hole)omitted++;
          }
          const sink=g.props.filter(p=>p.modelFile.toUpperCase()==='W_UTAPAU_HOLE.ALO');if(!omitted||sink.length!==1)throw Error('Missing authored sinkhole');data.aperture={omittedQuads:omitted,model:sink[0].modelFile,anchor:[sink[0].x,sink[0].y]};
        }
        // Asset startup can span a weather boundary. Observe the mounted scenario after loading,
        // immediately before freezing, with no writes to simulation time, phase, fog or dust.
        if(desert||polar){const limit=performance.now()+360000;while(!w.weather.phases.length || !(clearPhase?w.weather.name==='clear'&&w.weather.level===0:w.weather.name===(polar?'snow':'sandstorm')&&w.weather.level>=.8)){if(performance.now()>limit)throw Error('Authored weather not reached');await wait();}}
        g.modeSuspended = true;
        data.weather=[w.weather.name,w.weather.i,g.groundRain.amount];
        await wait();
        g.following = null;
        const a =
          w.units.find(u => u.side === g.me && u.foot && !u.dead && u.holder?.visible) ||
          w.units.find(u => u.side === g.me && !u.dead && u.holder?.visible);
        if (!a) throw Error('No deployed unit: '+JSON.stringify({time:w.time,side:g.me,units:w.units.length,alive:w.units.filter(u=>u.side===g.me&&!u.dead).length}));
        await (await import('/js/dds.js')).texturesReady();
        const now = g.last,
          start = await guard();
        const solids = g.props.filter(p => /temple|ruin|bunker|tower|outcrop|rock|wall|platform|hangar/i.test(p.modelFile));
        const locate = (slot, goal, clear = false) => {
          let d = Infinity,
            p;
          for (let y = 2; y < t.height - 2; y++)
            for (let x = 2; x < t.width - 2; x++) {
              const j = y * t.size + x;
              if (t.layerIndex[j] !== slot) continue;
              const q =
                Math.hypot(x * 20 - goal[0], y * 20 - goal[1]) +
                (clear
                  ? solids.reduce((cost, p) => Math.max(cost, Math.max(0, 250 - Math.hypot(x * 20 - p.x, y * 20 - p.y)) * 30), 0)
                  : 0) +
                [1, -1, t.size, -t.size].filter(k => t.layerIndex[j + k] !== slot).length * 32;
              if (q < d) {
                d = q;
                p = [20 * x, 20 * y];
              }
            }
          return p;
        };
        const temple = g.props.find(p => /massassi_temple/i.test(p.modelFile));
        const tree = g.props
          .filter(p => /Tree_Ever_0[01]_HI/i.test(p.modelFile))
          .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[3];
        data.temple = temple && [temple.x, temple.y];
        const grain=desert?locate(3,[a.x,a.y]):null;
        data.cameras = shelf?{squad:[5122,1412,128,.41,-1.5],command:[5122,1412,615,.96,-1.5],'north-rim':[1380,4760,605,.94,-1.5],landmark:[4600,1950,690,.49,-.32],stone:[2983,5200,280,.68,-1.42],'wild-rock':[4900,1030,245,.64,-1.4],grain:[5145,1368,66,.40,-1.5],'grain-pan':[5154,1371,66,.40,-1.5],bank:[1320,3740,315,.50,2.95]}:meadow?{squad:[1395,3627,128,.39,-1.5],command:[1395,3627,635,.94,-1.5],'east-meadow':[3840,3580,610,.94,-1.5],landmark:[2340,4300,605,.48,-1.55],stone:[2125,2772,350,.91,-1.36],'wild-rock':[865,3240,285,.66,-1.45],grain:[1420,3550,62,.36,-1.46],'grain-pan':[1429,3553,62,.36,-1.46],bank:[730,625,360,.62,-1.42]}:mesa?{squad:[865,4550,128,.39,-1.5],command:[865,4550,660,.94,-1.5],
          'eastern-wash':[4953,2900,630,.94,-1.35],landmark:[1279,4838,290,.38,-1.35],
          'vent-shelf':[4870,5370,280,.48,-1.35],scarp:[1431,3812,300,.44,-1.42],
          grain:[949,4412,66,.35,-1.48],'grain-pan':[958,4415,66,.35,-1.48]}:polar?{squad:[2845.26,2231.29,128,.39,-1.5],command:[2845.26,2231.29,660,.94,-1.5],
          'rib-basin':[1719,2775,610,.94,-1.25],landmark:[3849,3836,256,.41,-1.4],
          'rock-shelf':[...locate(3,[1760,2680]),214,.40,-1.0],treeline:[1750,3835,300,.48,-1.49],
          grain:[...locate(0,[2800,2150],true),62,.39,-1.47],'grain-pan':[...locate(0,[2800,2150],true).map((x,i)=>x+(i?3:9)),62,.39,-1.47],
          'working-yard':[854,491,190,.53,-1.45]}:desert?{squad:[755.4930475299399,1691.3690338294352,128,.39,-1.5],command:[755.4930475299399,1691.3690338294352,660,.94,-1.5],
          'bone-basin':[1728,424,580,.88,-1.24], 'rock-shelf':[...locate(24,[1850,1260]),225,.40,-.85],
          landmark:[1728,424,210,.35,-1.28],treeline:[a.x,3290,310,.51,-1.58],grain:[...grain,58,.35,-1.46], 'grain-pan':[grain[0]+8,grain[1]+3,58,.35,-1.46],
          'working-yard':[...locate(16,[1550,2000]),240,.68,-1.5]} : {
          squad: [a.x, a.y, 128, 0.39, -1.5],
          command: [a.x, a.y, 740, 0.98, -1.5],
          'south-field': [3400,930,680,.91,-1.43],
          jungle: [...locate(3, [2180, 2400]), 86, 0.32, -1.6],
          treeline: [tree.x - 35, tree.y - 32, 146, 0.29, -1.27],
          'playable-rim': [a.x, (g.map.playMax?.[1] ?? (t.height - 1) * 20) - 12, 330, 0.66, -Math.PI / 2],
          approach: [temple.x + 65, temple.y - 230, 530, 0.32, -1.38],
          grain: [...locate(37, [a.x, a.y]), 49, 0.24, -1.45],
          'grain-pan': [...locate(37, [a.x, a.y]).map((n, i) => n + (i ? 3 : 9)), 49, 0.24, -1.45],
          'wild-rock': [...locate(36, [a.x, a.y], true), 76, 0.7, -1.22],
          stone: [2500, 3420, 90, 0.55, -1.8],
          temple: temple ? [temple.x + 15, temple.y - 26, 345, 0.43, -1.4] : [2300, 1740, 230, 0.65, -1.22]
        };
        window.yavinDraw = async ({ c, on, warmFrames=32 }) => {
          gfx[recipe.option] = on;
          Object.assign(g.view, { x: c[0], y: c[1], dist: c[2], pitch: c[3], yaw: c[4] });
          const deadline = performance.now() + 60000;
          for (let i = 0; ; i++) {
            g.warming = true;
            g.modeSuspended = false;
            try {
              g.frame(now);
            } finally {
              g.warming = false;
              g.modeSuspended = true;
            }
            await wait();
            const pg = g.gpuOn ? null : g.renderer.properties.get(g.ground.material).currentProgram,
              ready = g.gpuOn || pg?.isReady();
            // Diffuse irradiance resolves before the filtered reflection used by props and troops.
            // A terrain-only readiness check can photograph the wrong sky on non-terrain pixels.
            const finish=g.landFinish,skyReady=finish?.sky===g.sky && finish.env===g.map.environment && finish.daylight && (!finish.finish||!!finish.texture) && g.skyAtlasState?.left===0;
            if (i >= warmFrames && ready && skyReady) {
              if (pg) {
                const ctx = g.renderer.getContext();
                if (!ctx.getProgramParameter(pg.program, ctx.LINK_STATUS)) throw Error(ctx.getProgramInfoLog(pg.program));
              }
              break;
            }
            if (performance.now() > deadline)
              throw Error('Draw warm-up timed out: ' + JSON.stringify([ready, g.skyAtlasState?.left, !!g.landFinish?.daylight]));
          }
          await g.gpu?.settle?.();
          if ((await guard()) !== start || status.active !== on) throw Error('Changed simulation or state');
          return [status.reliefTriangles, { ...status.grove }, { ...status.canopy }, status.reliefRange];
        };
        // GL compiles target-specific programs (HDR/post as well as default target) lazily. Warm
        // the actual world pass in each state, not just the offscreen compile target.
        for (const on of [false, true, false, true]) await yavinDraw({ c: data.cameras.squad, on });
        // Inspect the bound array slices, not just the recipe's list of intended replacements.
        const U = g.ground.material.uniforms,
          arrays = [U.soilColor.value, U.soilSurface.value],
          ids = new Map();
        const usesStockAtlas = U.map.value !== arrays[0] || U.bump.value !== arrays[1];
        if (usesStockAtlas) throw Error('Original atlas still participates in complete terrain');
        const bound = [];
        for (const [slot, s] of [...t.paint.slot].sort((a, b) => a[0] - b[0])) {
          const id = U.texU.value[s].w - 2,
            row = recipe.donors[id],
            regular = U.texV.value[s].w < 0;
          if (row?.id !== recipe.slots[slot]?.family || regular !== row.regular) throw Error('Unmapped drawn terrain ' + slot);
          if (!ids.has(id))
            ids.set(
              id,
              await Promise.all(
                arrays.map(tex => {
                  const a = tex.mipmaps[0].data,
                    n = a.byteLength / tex.image.depth;
                  return digest(a.slice(n * id, n * (id + 1)).buffer);
                })
              )
            );
          bound.push({ slot, asset: row.asset, colorHash: row.colorHash, surfaceHash: row.surfaceHash, regular, mipHashes: ids.get(id) });
        }
        data.terrainSources = { stamp: recipe.stamp, usesStockAtlas, masterSize: 2048, bound };
        return data;
      },
      { fail, original, gl, rain,desert,polar,mesa,meadow,shelf,planet,clearPhase }
    );
    if(look)mountedAt=Date.now()-t0;
    report.firstBattlefield = firstBattlefield;
    assert.deepEqual(report.stored, ['eaw', null]);
    if (fail) assert.equal(report.stats.state, 'unavailable');
    if (original || fail) assert(!report.stats.active);
    if (low) assert.equal(report.stats.width, 512);
    if (!original && !fail) {
      if(!focus||focus==='climate'){
        const dir=(await import('./remaster/direction.mjs')).requireDirection({id:report.job});
        if(dir.climate){report.climateAudit=await require('./remaster/mounted-climate.cjs')(body,p,out,report,dir.climate,PNG);}
        if(focus==='climate'){assert(report.climateAudit);assert.deepEqual(errors,[]);report.kind='partial-climate';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));return;}
      }
      if(!focus||rimOnly){report.outskirtsAudit=await require('./remaster/mounted-outskirts.cjs')(body,p,out,PNG);
      const dir=(await import('./remaster/direction.mjs')).requireDirection({id:report.job});
      (await import('./remaster/outskirts.mjs')).checkOutskirtsAudit(dir,report);
      if(rimOnly){assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(report.outskirtsAudit,out);return;}}
      await body.evaluate((_,c)=>yavinDraw({c,on:true}),report.cameras.squad);
      report.groundUse = await body.evaluate(require('./remaster/mounted-ground-zones.cjs'));
      const previousLayout=require('./remaster/mounted-composition.cjs'),{summarizeField}=await import('./remaster/composition-audit.mjs'),{composition}=await body.evaluate(()=>({composition:reviewRecipe.composition}));
      report.patchAudit=(await body.evaluate(previousLayout.readField)).map(summarizeField);
      if(focus!=='ground'&&!look)report.foliageAudit = polar||mesa?await body.evaluate(require('./remaster/mounted-barren.cjs')):(desert||meadow||shelf)?await require('./remaster/mounted-retained-plants.cjs')(body,p,out,PNG):await require('./remaster/mounted-foliage.cjs')(body,p,out,report,PNG);
      if(focus==='foliage'){console.log(report.foliageAudit);assert.deepEqual(errors,[]);return;}
      if(look)report.cameras=lookCameras(report.cameras,planet);
      report.views = {};
      for (const [v, c] of Object.entries(report.cameras)) {
        const frames = {};
        for (const state of ['warm', 'original', 'remaster', 'restored']) {
          const on = ['warm', 'remaster'].includes(state),
            stats = await body.evaluate((_, args) => yavinDraw(args), { c, on });
          if (state === 'warm') continue;
          frames[state] = PNG.sync.read(await p.screenshot({ path: path.join(out, `${v}-${state}.png`) }));
          if (on) {report.views[v] = { stats };
            if(composition.regions.some(r=>r.view===v)){await body.evaluate(previousLayout,true);try{await body.evaluate((_,args)=>yavinDraw(args),{c,on});frames.previous=PNG.sync.read(await p.screenshot({path:path.join(out,`${v}-previous.png`)}));}finally{await body.evaluate(previousLayout,false);}
              await body.evaluate((_,args)=>yavinDraw(args),{c,on});frames.replay=PNG.sync.read(await p.screenshot());}
          }
        }
        const diff = (a, b) => {
          let changed = 0;
          for (let y = 90; y < 550; y++)
            for (let x = 100; x < 1340; x++) {
              const i = 4 * (y * a.width + x);
              if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 12)
                changed++;
            }
          return changed;
        };
        if(frames.previous){const r=composition.regions.find(r=>r.view===v),a=report.patchAudit.find(a=>a.name===r.name);a.replay={changed:diff(frames.previous,frames.remaster),match:diff(frames.replay,frames.remaster)<=40};}
        Object.assign(report.views[v], {
          changed: diff(frames.original, frames.remaster),
          rollback: diff(frames.original, frames.restored)
        });
        if (v === ((meadow||shelf)?'bank':mesa?'scarp':'treeline')) {
          const { darkIsland } = require('./remaster/ground-evidence.cjs');
          report.edge = darkIsland(frames.remaster, [120, 260, 1200, 131]);
          report.edge.limit = 0.045;
          assert(report.edge.fraction < report.edge.limit, 'Black connected terrain band: ' + JSON.stringify(report.edge));
        }
        assert(report.views[v].rollback <= 40, JSON.stringify(report.views[v]));
      }
      if (look) {
        // Same mounted battle, same guard and same off/on/restored triple as the release pass;
        // only the camera list, the extra audits and the release-only assertions are left out.
        const views = Object.keys(report.views),
          hud = await body.evaluate(() => {
            const el = document.getElementById('hud');
            return {
              present: !!el,
              visible: !!el && !el.classList.contains('hidden') && el.getClientRects().length > 0,
              originalHud: document.body.classList.contains('original-hud')
            };
          });
        assert(hud.visible, 'HUD is not on screen: ' + JSON.stringify(hud));
        for (const v of views) {
          assert(report.views[v].changed > 250, `${v} barely changed off/on: ${report.views[v].changed}`);
          assert(report.views[v].rollback <= 40, `${v} restored control drifted: ${JSON.stringify(report.views[v])}`);
        }
        report.kind = 'partial-look';
        report.look = {
          source: lookRequested.length ? 'requested' : 'default',
          requested: lookRequested,
          tag: lookTag || null,
          views,
          hud,
          identity: { map: report.map, backend: report.backend, edition: 'foc' },
          edgeView: report.edge ? ((meadow||shelf)?'bank':mesa ? 'scarp' : 'treeline') : null,
          images: views.flatMap(v =>
            ['original', 'remaster', 'restored']
              .concat(composition?.regions.some(r => r.view === v) ? ['previous'] : [])
              .map(s => `${v}-${s}.png`)
          ),
          timings: { mountMs: mountedAt, viewsMs: Date.now() - t0 - mountedAt, totalMs: Date.now() - t0 }
        };
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        console.log(
          `partial-look · ${planet} · ${report.backend} · ${views.join(', ')} · ${(report.look.timings.totalMs / 1000).toFixed(1)}s total, ${(mountedAt / 1000).toFixed(1)}s to mounted`
        );
        console.log('images: ' + out);
        assert.deepEqual(errors, []);
        return;
      }
      const { auditDonors } = await import('./remaster/surface-audit.mjs'),
        activeRecipe=await body.evaluate(()=>({donors:reviewRecipe.donors}));
      const range = report.views.grain.stats[3],
        panRange = report.views['grain-pan'].stats[3];
      assert(range > 0.08 && panRange > 0.08, 'No measured close displacement');
      assert(!report.waterSheet && report.waterMode === 0, 'Misclassified water');
      report.surfaceAudit = {
        waterMode: report.waterMode,
        hasSheet: report.waterSheet,
        edgeView: (meadow||shelf)?'bank':mesa?'scarp':'treeline',
        surfaceViews: ['grain', 'grain-pan'],
        edge: report.edge,
        heightRange: [range, panRange],
        donors: auditDonors(activeRecipe.donors)
      };
      if(desert||polar||mesa||meadow||shelf){assert(report.views.squad.changed>250&&report.views.landmark.changed>250);assert.equal(report.stats.outskirts.crowns,0);}else{
      assert.equal(report.stats.canopy.targets, 1680);
      assert(report.views.treeline.stats[2].near > 0);
      assert(report.views.jungle.stats[2].broadleafHerbs > 0);
      assert.equal(report.views.command.stats[2].near, 0);
      assert(report.views.squad.changed > 250 && report.views.jungle.changed > 250);}
    }
    if (!focus && !fail && !original && !low && !rain) {
      await body.evaluate(() => game.menus.toggle());
      await frame.locator('[data-id="IDC_INGAME_OPTIONS"]:visible').click();
      const dialog = frame.getByRole('dialog', { name: 'Settings', exact: true });
      await dialog.getByRole('tab', { name: 'Graphics Quality' }).click();
      await p.setViewportSize({ width: 390, height: 844 });
      const box = dialog.getByRole('checkbox', { name: shelf?'Utapau heights':meadow?'Naboo meadows':mesa?'Geonosis badlands':polar?'Hoth snowfield':desert?'Tatooine badlands':'Yavin 4 jungle', exact: true });
      await box.focus();
      await box.press('Space');
      assert.equal(await body.evaluate(async (_,planet) => (await import('/js/gfx.js')).gfx[planet+'Landscape'],planet), true);
      assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
      assert.equal(await body.evaluate(() => localStorage.getItem('swr-gfx')), null);
    }
    if(focus)report.kind='partial-'+focus;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(report.stats, report.views, out);
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
