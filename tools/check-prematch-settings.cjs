// Check the settings in the live map, not just the title controls or localStorage.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const profile = process.env.TEST_PROFILE || '1125571106'; // Thrawn's Revenge or stock
  const b = await chromium.launch({channel:'chrome'});
  try {
    const p = await b.newPage({viewport:{width:1280,height:720}});
    p.setDefaultTimeout(85000);
    // A mod already has local choices. Editing sound and shadows in stock must not
    // replace the rest of its graphics/audio records, even on their first stock write.
    if (profile !== 'stock') await p.addInitScript(() => {
      if (location.port !== '8592' || localStorage.getItem('swr-gfx')) return;
      localStorage.setItem('swr-gfx',JSON.stringify({bloom:false,shadows:true}));
      localStorage.setItem('swr-volume',JSON.stringify({voice:.17}));
    });
    await p.goto('http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'), settings = f.getByRole('dialog',{name:'Settings',exact:true}),
      tab = name => settings.getByRole('tab',{name,exact:true}).click(),
      back = () => settings.getByRole('button',{name:'Back',exact:true}).click(),
      open = async () => {await f.getByRole('button',{name:'System menu'}).click();await f.getByRole('button',{name:'Settings',exact:true}).click();};
    const shadows = settings.getByRole('checkbox',{name:'Soft shadows',exact:true}), music = settings.getByRole('slider',{name:'Music',exact:true});
    await open(); await tab('Details'); await shadows.uncheck();
    await tab('Audio'); await music.fill('0.23');
    await tab('Controls'); await settings.getByLabel('Reverse strategy camera wheel').check(); await back();
    await open(); await tab('Audio'); assert.equal(await music.inputValue(),'0.23'); await tab('Video'); await tab('Details'); assert.equal(await shadows.isChecked(),false); await back();
    await p.reload();
    for(const id of ['TITLE_PLAY','IDC_INSTANT_BATTLE_BUTTON']) await f.locator(`.title-menu [data-id="${id}"]`).click();
    const board = f.locator('.op-setup'); await board.getByRole('searchbox').fill('Kuat');
    await board.locator(`[data-world="Kuat"][data-domain="space"][data-source="${profile}"]`).first().click();
    await f.locator(`.op-setup[data-profile="${profile}"] .op-go:enabled`).click();
    await f.locator('#loading.hidden').waitFor({state:'attached'});
    const live = await f.locator('body').evaluate(async () => {
      const until = Date.now()+90000;
      while (!(window.game?.world?.time>1)) {if (Date.now()>until) throw Error('No live battle'); await new Promise(r=>setTimeout(r,100));}
      const {gfx} = await import('/js/gfx.js'), {viewOptions} = await import('/js/game/viewpreferences.js');
      return {music:game.audio.musicVolume, shadows:gfx.shadows, renderedShadows:game.renderer.shadowsOn,
        invert:viewOptions.invertWheel, modKept:location.port==='8592' ? !gfx.bloom && game.audio.voiceVolume===.17 : true};
    });
    assert.deepEqual(live,{music:.23,shadows:false,renderedShadows:false,invert:true,modKept:true}, 'Pre-match settings must reach the battle');
    console.log(`PASS: title → Back → reopen → ${profile} Kuat battle`,live);
  } finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
