import { battleLook, battleLooks, spacePresentation, strength } from '../battlelook.js';
import { receiverSettings } from '../fieldreceivers.js';
import { gfx, storeGfx, setBattleRealism } from '../gfx.js';
import { el, action } from './commandui.js';
import { orbitalPass } from './orbitalpass.js';
import { passSubject, playDestroyerPass, unitPassSubject } from './destroyer-pass.js';
import { group, select, check, slider, percent } from './settingsfields.js';

export function battleLookFields(page, game) {
  const master = group(page, 'All battles');
  const mode = select(master, 'Battle realism', [['custom','Use individual settings'], ['on','On · land and space'], ['off','Off · land and space']],
    ['on','off'].includes(gfx.battleRealism) ? gfx.battleRealism : 'custom', value => {
      setBattleRealism(value);
      showIndividual();
    });
  master.append(el('p', 'us-help', 'One choice for every land and space battle. On adds map lighting, material detail, shadows and steadier edges. Close-ups follow the unit in view. Extra samples can lower frame rate. Off keeps your individual settings saved.'));
  if (unitPassSubject(game)) action(master, 'Play unit flyby', () => playDestroyerPass(game, unitPassSubject(game)), 'us-secondary');
  const planetPass=orbitalPass(game);
  if(planetPass) {
    action(master,'Pan past the planet',()=>planetPass(),'us-secondary');
    action(master,'Preview explosion lighting',()=>planetPass(true),'us-secondary');
  }
  const box = group(page, 'Battlefield appearance');
  function draw() {
    box.replaceChildren(box.querySelector('legend'));
    const preset = select(
      box,
      'Battlefield look',
      [
        ['original', 'Original'],
        ['enhanced', 'Enhanced'],
        ['ultra', 'Ultra'],
        ['custom', 'Custom']
      ],
      battleLook(gfx),
      value => {
        Object.assign(gfx, battleLooks[value]);
        storeGfx();
        draw().focus({ preventScroll: true });
      }
    );
    preset.querySelector('[value="custom"]').disabled = true;
    for (const [key, label] of [
      ['surfaceRelief', 'Surface relief'],
      ['environmentLight', 'Environment lighting'],
      ['lensStreaks', 'Anamorphic glare'],
      ['contactShade', 'Contact shading'],
      ['materialFinish', 'Material highlights']
    ]) {
      slider(
        box,
        label,
        strength(gfx[key]),
        0,
        1,
        0.05,
        value => {
          gfx[key] = value;
          preset.value = battleLook(gfx);
          storeGfx();
        },
        percent
      );
    }
    box.append(
      el(
        'p',
        'us-help',
        'Ultra adds shadows in recesses and gloss-sensitive highlights. Set Contact shading to 0% for a lighter GPU workload, or choose Enhanced to keep the earlier look.'
      )
    );
    return preset;
  }
  draw();
  const space = group(page, 'Space battles');
  select(
    space,
    'Space battle look',
    [['inherit', 'Use battlefield settings'], ['cinematic', 'Cinematic'], ['linear', 'Cinematic · corrected color'], ['orbital', 'Cinematic · orbital lighting'], ['deep-space', 'Deep space']],
    spacePresentation(gfx),
    value => {
      gfx.spacePresentation = value;
      storeGfx();
    }
  );
  space.append(el('p', 'us-help', 'Corrected color lights hull paint in linear space. Orbital lighting adds reflected sky light. Deep space dims distant dust, leaves sunlit armor bright, and lets engines glow against darker hull shadows.'));
  check(space, 'Steady fleet edges', gfx.fleetCoverage === true, on => {
    gfx.fleetCoverage = on;
    storeGfx();
  }, 'Extra samples steady distant ships while panning. Uses more GPU time. Works with Standard anti-aliasing at native battle scale, when resolution allows.');
  check(space,'Linear battle lighting',gfx.sceneLight === true,on=>{gfx.sceneLight=on;storeGfx();},'Mix sunlight, engines and explosions before bloom and display. Uses a floating-point color buffer when supported.');
  check(space, 'Explosion light on hulls', gfx.hullBlastLight === true, on => {
    gfx.hullBlastLight = on;
    storeGfx();
  }, 'Nearby blasts light the armor facing them, then fade. Turn off to use the previous lighting.');
  check(space, 'Ship hull damage', gfx.hullDamageMarks === true, on => {
    gfx.hullDamageMarks = on; storeGfx();
  }, 'Penetrating hits dent or perforate supported rigid armor in space battles. The stock Star Destroyer also shows shield ripples, cooling strikes and disabled engine banks.');
  select(space, 'Star Destroyer surfaces', [['stock','Original'],['finish','Paint and alloy'],['orbit','Paint and alloy · orbital light']], gfx.destroyerSurface, value => {
    gfx.destroyerSurface = value; storeGfx();
  });
  space.append(el('p','us-help','Compare the stock Star Destroyer’s armor and engine collars as it turns. Orbital light adds the colors and reflections of this battlefield.'));
  select(space, 'Star Destroyer close-ups', [['stock','Stock hull'],['detail','Detailed hull'],['finish','Detailed hull + sky reflections']], gfx.destroyerDetail, value=>{
    gfx.destroyerDetail=value; storeGfx();
  });
  space.append(el('p','us-help','Adds raised armor, bridge windows and engine rims to the stock Star Destroyer at close range. Fleet views keep the stock hull. Close-up hull shadows also require Shadows to be on.'));
  check(space,'Close-up hull shadows',gfx.closeHullShadows === true,on=>{gfx.closeHullShadows=on;storeGfx();},'Casts the bridge and fittings onto the deck in direct sunlight. Requires a detailed hull and Shadows.');
  check(space,'Stable flyby edges',gfx.closeHullEdges===true,on=>{gfx.closeHullEdges=on;storeGfx();});
  space.append(el('p','us-help','Choose a detailed Star Destroyer hull and Standard anti-aliasing to steady its edges at close range. Uses extra samples at native resolution, up to the 4K pixel budget. May reduce frame rate.'));
  if(passSubject(game)) action(space,'Play Star Destroyer flyby',()=>playDestroyerPass(game),'us-secondary');
  const worlds = group(page, 'World environments');
  for(const [key,label,help] of receiverSettings) check(worlds,label,gfx[key]===true,on=>{gfx[key]=on;storeGfx();},help);
  check(worlds,'Aerial perspective',gfx.aerialDepth===true,on=>{gfx.aerialDepth=on;storeGfx();},'Distant low ground picks up more of the map’s haze than nearby units or high ridges.');
  check(worlds,'Shared battlefield wind',gfx.sharedWind===true,on=>{gfx.sharedWind=on;storeGfx();},'Smoke, dust and foliage follow the direction of the map’s moving cloud shadows.');
  check(worlds,'Steady surface detail',gfx.steadyDetail===true,on=>{gfx.steadyDetail=on;storeGfx();},'Filter subpixel terrain and armor textures during land and space battles without trailing moving units or bolts.');
  check(worlds,'Rain on terrain',gfx.rainSurfaces===true,on=>{gfx.rainSurfaces=on;storeGfx();},'Rain darkens soil and gives paving a soft sheen. Ground dries after the rain; damp ground releases less movement dust.');
  check(worlds,'Ground battlefield lighting',gfx.groundDaylight===true,on=>{gfx.groundDaylight=on;storeGfx();},'Sunlight casts shadows while the sky and terrain still light shaded surfaces. Turn Shadows on for finer shadows near the strategy camera.');
  select(worlds, 'Orbital lighting', [['map','Current environment'],['air','Sunlit atmosphere'],['bounce','Sunlit atmosphere + planet light']], gfx.orbitalLighting, value => {
    gfx.orbitalLighting=value; storeGfx();
  });
  worlds.append(el('p','us-help','Compare a modeled planet and the ships above it. Planet light reaches the plates facing the planet; painted backdrops do not cast it.'));
  for (const [key, label] of [
    ['planetAir', 'Orbital atmosphere'],
    ['terrainLayers', 'Terrain layering']
  ]) {
    slider(
      worlds,
      label,
      strength(gfx[key]),
      0,
      1,
      0.05,
      value => {
        gfx[key] = value;
        storeGfx();
      },
      percent
    );
  }
  function showIndividual() {
    for (const fields of [box, space, worlds]) fields.hidden = mode.value !== 'custom';
  }
  showIndividual();
  worlds.append(
    el(
      'p',
      'us-help',
      'Orbital atmosphere adjusts the existing haze in Current environment and on the galaxy map. Terrain layering brings out ground textures at different distances.'
    )
  );
}
