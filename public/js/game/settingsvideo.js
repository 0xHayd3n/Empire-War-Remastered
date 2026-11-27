import { gfx, presets, storeGfx, supersampling, SUPERSAMPLE_STEPS, SHADOW_RANGE_MAX, shadowReach } from '../gfx.js';
import { fullscreen, enterFullscreen, exitFullscreen, fullscreenCapture, setFullscreenCapture } from '../pointertrap.js';
import { windowSizes, pickWindowSize } from '../windowsize.js';
import { extraFxOn, EXTRA_FX_TIP } from './extrafx.js';
import { preferredArmoryPreview, saveArmoryPreview } from './armorypreference.js';
import { battlefrontFields } from './settingsbattlefront.js';
import { hdrFields } from './settingshdr.js';
import { cinematicOptions } from './settingsview.js';
import { battleScale, upscaleMethod } from '../imagesampling.js';
import { battleLookFields } from './settingsbattlelook.js';
import { texturePackFields } from './settingstextures.js';
import { profile } from '../texture-showcase/store.js';
import { el, option } from './commandui.js';
import { setInput } from './menus.js';
import { categories, group, select, check, slider, percent } from './settingsfields.js';

export async function videoTab(panel, game, signal) {
  const apply = () => {
    storeGfx();
    window.applyGraphics?.(game.renderer);
  };
  const { pages } = categories(panel, 'Video', ['General', 'Graphics Quality', 'HDR', 'Details']);
  const display = group(pages.General, 'Display');
  pages.General.classList.add('us-columns');
  pages['Graphics Quality'].classList.add('us-columns');
  battlefrontFields(pages.General, game, 'video', 'Battlefront camera');
  hdrFields(pages.HDR, game, signal);
  const mode = check(display, 'Windowed mode', !fullscreen(), windowed => {
    if (windowed) exitFullscreen();
    else enterFullscreen();
    mode.checked = !fullscreen(); // Trust the platform, including a denied request.
  });
  check(
    display,
    'Capture the mouse',
    fullscreenCapture(),
    setFullscreenCapture,
    'Keep the pointer inside the game in fullscreen or the desktop app. Esc or Alt+Tab releases it.'
  );
  let sizes,
    request = 0;
  const resolution = select(display, 'Resolution', [], '', async value => {
    if (sizes && !fullscreen()) {
      await pickWindowSize(...value.split('x').map(Number));
      window.applyGraphics?.(game.renderer);
    } else {
      gfx.scale = Number(value);
      apply();
    }
  });
  async function resolutions() {
    const ticket = ++request;
    mode.checked = !fullscreen();
    const list = !fullscreen() && (await windowSizes());
    if (signal.aborted || ticket !== request) return;
    sizes = list;
    resolution.replaceChildren();
    if (sizes) {
      for (const [w, h] of sizes.list) option(resolution, `${w}x${h}`, `${w} × ${h}`);
      resolution.value = sizes.now.join('x');
    } else {
      const dpr = Math.min(devicePixelRatio, 2),
        scales = [1, 0.85, 0.75, 0.66, 0.5];
      for (const k of scales)
        option(resolution, k, `${Math.round(innerWidth * dpr * k)} × ${Math.round(innerHeight * dpr * k)} · ${percent(k)}`);
      resolution.value = scales.reduce((a, b) => (Math.abs(a - gfx.scale) < Math.abs(b - gfx.scale) ? a : b));
    }
  }
  void resolutions();
  document.addEventListener('fullscreenchange', resolutions, { signal });
  window.addEventListener('resize', resolutions, { signal });
  slider(
    display,
    'Gamma (SDR)',
    gfx.gamma,
    0,
    1,
    0.01,
    v => {
      gfx.gamma = v;
      apply();
    },
    percent
  );
  const levels = await presets();
  if (signal.aborted) return;
  const quality = group(pages['Graphics Quality'], 'Graphics quality');
  const preset = select(
    quality,
    'Detail preset',
    [['-1', 'Custom'], ...levels.map((_, i) => [i, `${i + 1} of ${levels.length}`])],
    gfx.level,
    v => {
      if (levels[v]) {
        Object.assign(gfx, levels[v], { level: Number(v) });
        apply();
        draw();
      }
    }
  );
  const land = group(pages['Graphics Quality'], 'Land battle lighting');
  const tune = (k, v) => { gfx[k]=v; storeGfx(); };
  slider(land,'Foreground foliage fade',gfx.canopyFade,0,1,.05,v=>tune('canopyFade',v),percent,'See units through nearby trees and foliage around the centre of the tactical view. Set to 0% to turn it off.');
  check(land, 'Keep fallen infantry', gfx.keepInfantryBodies === true, on => {
    gfx.keepInfantryBodies = on; storeGfx();
  }, 'Keep up to 128 settled bodies until the current land battle ends. Turn off to clear them.');
  slider(land,'Unit highlight protection',gfx.landHighlightProtect,0,1,.05,v=>tune('landHighlightProtect',v),percent);
  slider(land,'Shallow water clarity',gfx.landWaterClarity,0,1,.05,v=>tune('landWaterClarity',v),percent,'With Water depth and reflection enabled: lower to see the map’s reflected sky, raise to see more of the lakebed.');
  select(land, 'Immersive weather', [['all', 'All outdoor land maps'], ['remasters', 'Remastered maps'], ['stock', 'Stock land maps'], ['off', 'Original sky']], gfx.immersiveWeather, v => tune('immersiveWeather', v));
  if (profile === 'stock') {
    const weather=check(land,'Endor forest weather',gfx.endorWeather!==false,v=>tune('endorWeather',v),'Follow the map’s forecast: overcast light, damp foliage, rain rings and light in the mist. Does not change the weather schedule.');
    const shade=slider(land,'Endor canopy shade',gfx.endorShade,0,1,.05,v=>tune('endorShade',v),percent);
    const mist=slider(land,'Endor distant haze',gfx.endorMist,0,1,.05,v=>tune('endorMist',v),percent);
    check(quality,'Utapau heights',gfx.utapauLandscape===true,v=>tune('utapauLandscape',v),'Utapau Heights: worn rim platforms, gravel terraces and exposed stone around the sinkhole.');
    check(quality,'Naboo meadows',gfx.nabooLandscape===true,v=>tune('nabooLandscape',v),'Naboo Incursion: grassy terraces, cut gravel beds and paved Theed courts.');
    check(quality,'Geonosis badlands',gfx.geonosisLandscape===true,v=>tune('geonosisLandscape',v),'Marooned on Geonosis: dry wash beds, gravel fans and weathered scarps.');
    check(quality,'Hoth snowfield',gfx.hothLandscape===true,v=>tune('hothLandscape',v),'Assault on Hoth: wind-packed snow, exposed rock faces and distant glacial ridges.');
    check(quality,'Tatooine badlands',gfx.tatooineLandscape===true,v=>tune('tatooineLandscape',v),'Clash on Tatooine: wind-scoured sand, exposed rock and distant ridges. Keeps the authored desert scrub and working yards.');
    check(quality,'Yavin 4 jungle',gfx.yavinLandscape===true,v=>tune('yavinLandscape',v),'Forces of Corruption: broadleaf canopy, jungle understory and forest soil. Keeps the Massassi temples and paved approaches.');
    const full = check(quality, 'Endor full landscape', gfx.endorLandscape === true, on => {
      gfx.endorLandscape = on;
      syncLandscape();
      storeGfx();
    }, 'Replace all painted ground and forest scenery on stock Endor. Adds displaced ground nearby and three-dimensional plants.');
    const earth = check(quality, 'Endor scanned earth', gfx.endorForestFloor === true, on => {
      gfx.endorForestFloor = on;
      storeGfx();
    }, 'Replace bare dirt on stock Endor with scanned soil and stones. Grass stays original. High texture detail uses 4K maps (43 MiB).');
    const explanation=el('p','us-help',''); quality.append(explanation);
    function syncLandscape(){
      weather.disabled=shade.disabled=mist.disabled=!full.checked;
      earth.disabled=full.checked;explanation.hidden=!full.checked;
      const state=game.ground?.userData.endorLandscape?.state;
      explanation.textContent=state==='unavailable'?'The full material set is unavailable in this battle. Original scenery is in use.':state==='loading'?'Loading the Endor materials and plants. Original scenery stays visible until they are ready.':'Full landscape replaces ground and foliage together on stock Endor. Turn it off for the separate bare-earth option.';
    }
    syncLandscape();window.addEventListener('endor-landscape-status',syncLandscape,{signal});
  }
  preset.options[0].disabled = true;
  preset.disabled = !levels.length;
  battleLookFields(pages['Graphics Quality'], game);
  const aa = group(pages['Graphics Quality'], 'Image quality');
  texturePackFields(pages['Graphics Quality'], signal);
  const advanced = group(pages.Details, 'Rendering details');
  cinematicOptions(pages.Details);
  const preview = group(pages.Details, 'Unit Armory');
  select(
    preview,
    'Preview on opening',
    [
      ['live', 'Live model'],
      ['portrait', 'Portrait · low power']
    ],
    preferredArmoryPreview(),
    saveArmoryPreview
  );
  preview.append(el('p', 'us-help', 'Data Saver opens the portrait regardless of this preference.'));
  function update(changes) {
    Object.assign(gfx, changes, { level: -1 });
    preset.value = '-1';
    apply();
  }
  function draw() {
    advanced.replaceChildren(advanced.querySelector('legend'));
    aa.replaceChildren(aa.querySelector('legend'));
    select(
      aa,
      'Anti-aliasing',
      [['0', 'Off'], ...SUPERSAMPLE_STEPS.map(k => [k, k === 1 ? 'Standard' : `${k}× supersampling`])],
      gfx.aa === false ? 0 : supersampling(),
      v => update({ aa: +v > 0, supersample: +v || 1 })
    );
    // These battle-only filters read preferences every draw; no renderer restart or asset reload.
    const saveImage = (key, value) => {
      gfx[key] = value;
      storeGfx();
    };
    select(
      aa,
      'Post-process AA',
      [
        ['auto', 'Automatic'],
        ['off', 'Off'],
        ['fxaa', 'FXAA']
      ],
      gfx.postAA,
      value => saveImage('postAA', value)
    );
    select(
      aa,
      'Texture magnification',
      [
        ['original', 'Original'],
        ['cubic', 'Bicubic']
      ],
      gfx.textureCubic ? 'cubic' : 'original',
      value => saveImage('textureCubic', value === 'cubic')
    );
    const scale = select(
      aa,
      'Battle upscaling',
      [
        [1, 'Off · native'],
        ['native', 'Native + sharpening · 100%'],
        [0.9, 'Ultra quality · 90%'],
        [0.77, 'Quality · 77%'],
        [0.67, 'Balanced · 67%'],
        [0.5, 'Performance · 50%']
      ],
      gfx.nativeSharpen && battleScale(gfx) === 1 ? 'native' : battleScale(gfx),
      value => {
        gfx.nativeSharpen = value === 'native';
        saveImage('battleScale', gfx.nativeSharpen ? 1 : Number(value));
        syncImage();
      }
    );
    const method = select(
      aa,
      'Upscaling method',
      [
        ['fsr1', 'AMD FSR 1 · edge-adaptive'],
        ['lanczos', 'Lanczos 3'],
        ['bicubic', 'Bicubic'],
        ['bilinear', 'Bilinear']
      ],
      upscaleMethod(gfx),
      value => {
        saveImage('upscaleMethod', value);
        syncImage();
      }
    );
    const reconstruction = slider(
      aa,
      'Upscale sharpness',
      gfx.upscaleBlend,
      0,
      1,
      0.05,
      value => saveImage('upscaleBlend', value),
      percent
    );
    const help = el('p', 'us-help', '');
    aa.append(help);
    function syncImage() {
      const native = scale.value === 'native',
        off = scale.value === '1';
      method.disabled = off || native;
      reconstruction.disabled = off || (!native && method.value === 'bilinear');
      help.textContent = off
        ? 'For high-quality upscaling, try Ultra quality at 90% with AMD FSR 1. Native + sharpening keeps every rendered pixel.'
        : native
          ? 'Sharpens the full-resolution battle without scaling. Use Anti-aliasing to smooth edges; sharpening alone is not AA.'
          : method.value === 'fsr1'
            ? 'FSR 1 follows edges when upscaling the battle. Sharpness controls a second pass; 0% keeps the edge reconstruction without sharpening.'
            : method.value === 'bilinear'
              ? 'Fast, soft scaling. The battle renders at the selected percentage; the HUD stays at output resolution.'
              : 'Sharpness blends from bilinear to the selected filter. Try a lower value if fine details shimmer in motion.';
    }
    syncImage();
    slider(advanced, 'Bloom intensity', gfx.bloomGain, 0, 2, 0.05, v => update({ bloomGain: v }), percent);
    slider(advanced, 'Heat distortion strength', gfx.heatGain, 0, 2, 0.05, v => update({ heatGain: v }), percent);
    slider(advanced, 'Particle detail', gfx.particle, 0, 1, 0.05, v => update({ particle: v }), percent);
    slider(
      advanced,
      'Texture detail',
      2 - gfx.texMip,
      0,
      2,
      1,
      v => update({ texMip: 2 - v }),
      v => ['Low', 'Medium', 'High'][v]
    );
    for (const [label, key] of [
      ['Shader detail', 'shader'],
      ['Shadow detail', 'shadow']
    ])
      slider(
        advanced,
        label,
        gfx[key],
        0,
        3,
        1,
        v => update({ [key]: v }),
        v => ['Low', 'Medium', 'High', 'Highest'][v]
      );
    slider(
      advanced,
      'Shadow distance',
      shadowReach(),
      1,
      SHADOW_RANGE_MAX,
      0.5,
      v => update({ shadowRange: v }),
      v => `${v}×`
    );
    for (const [key, label] of [
      ['shadows', 'Soft shadows'],
      ['bloom', 'Bloom'],
      ['heat', 'Heat distortions'],
      ['flare', 'Lens flare'],
      ['soft', 'Soft particles']
    ])
      check(advanced, label, gfx[key] !== false, v => update({ [key]: v }));
    check(
      advanced,
      'Distance detail for models',
      gfx.modelLod !== false,
      v => update({ modelLod: v }),
      'Use fewer polygons for small, distant models on land, in space and on the galactic map. Close models keep their original detail.'
    );
    check(advanced, 'Cinematic lighting', extraFxOn(), on => setInput('optExtraFx', on), EXTRA_FX_TIP);
    const grade = group(advanced, 'Cinematic and Battlefront colour grading');
    for (const [k, label] of [
      ['gradeTint', 'Sunlight tint'],
      ['gradeSaturation', 'Boost saturation'],
      ['gradeContrast', 'Boost contrast'],
      ['gradeVignette', 'Darken screen edges']
    ])
      check(grade, label, gfx[k], on => update({ [k]: on }));
  }
  draw();
}
