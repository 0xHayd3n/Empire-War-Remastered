import {menuMotion} from './menumotion.js';
import { db } from '../gamedata.js';
import { onLanguageChange } from '../language.js';
import { flightDeck } from './flightdeck.js';
import { playTabs } from './playtabs.js';
import { mountSocial, watchBell } from './socialpanel.js';

const single = 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES',
  multi = 'IDC_MAIN_MENU_MULTIPLAYER';
const multiplayerDoors = [
  ['PLAY_MATCHMAKING', 'Matchmaking', 'fleet-command', 'fleet', 'Choose a Social or Ranked playlist and find an opponent.'],
  ['PLAY_CUSTOM', 'Custom games', 'lan', 'relay', 'Host a game, browse rooms or join by code.']
];
// [action, native label fallback, screenshot, briefing illustration, description, optional save family]
const solo = [
  ['IDC_CUSTOM_CAMPAIGN_BUTTON', 'Galactic Conquest', 'conquest', 'chart', 'Command fleets and worlds across the galaxy.', 'conquest'],
  ['IDC_NEW_CAMPAIGN_BUTTON', 'Campaign', 'story', 'chronicle', 'Play a story campaign.', 'story'],
  ['IDC_SKIRMISH_GAMES_BUTTON', 'Skirmish', 'skirmish', 'surface', 'Set up a land or space battle.', 'skirmish'],
  ['IDC_INSTANT_BATTLE_BUTTON', 'Instant Battle', 'instant', 'fleet', 'Build two fleets and go straight to combat.', 'instant'],
  ['IDC_MAIN_MENU_TUTORIAL', 'Tutorial', 'tutorial', 'surface', 'Learn the controls in training missions.', 'tutorial'],
  ['IDC_LOAD_GAME_MAIN', 'Load Game', 'archive', 'relay', 'Browse all single-player saves.']
];
const online = [
  ['IDC_MULTIPLAYER_INTERNET_BUTTON', 'Internet', 'internet', 'fleet', 'Find or host an online multiplayer game.'],
  ['IDC_MULTIPLAYER_LAN_BUTTON', 'Local Network', 'lan', 'relay', 'Play with other commanders on your network.'],
  ['IDC_MAIN_OPTIONS_NETWORK', 'Network Options', 'network', 'chart', 'Unavailable in the current game client.']
];
const chrome = [
  'IDC_MENU_PETRO_LOGO',
  'IDC_MAIN_MENU_PLAY_DEMO',
  'IDC_STATIC_MAIN_MENU',
  'IDC_STATIC_OPTIONS',
  'IDC_STATIC_MULTIPLAYER',
  'IDC_HINT_LIST',
  'IDC_DEBUG_LOAD_SKIRMISH_MAP_BUTTON'
];
const utility = ['IDC_OPTIONS', 'IDC_MENU_CREDITS', 'IDC_MAIN_MENU_EXIT2'];
const icon = {
  launch: '<path d="m5 19 7-15 7 15-7-4zM8 21l4-2 4 2"/>',
  dismiss: '<path d="M4 12h13m-6-6 6 6-6 6m9-14v16"/>',
  back: '<path d="m11 5-7 7 7 7M5 12h15"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 10h18c0-2-3-3-3-10Z M10 21h4"/>',
  cog: '<path d="m9.5 3 .6-1h3.8l.6 2 1.6.9 2.1-.4 1.9 3.2-1.4 1.6v2l1.4 1.6-1.9 3.2-2.1-.4-1.6.9-.6 2h-3.8l-.6-2-1.6-.9-2.1.4-1.9-3.2 1.4-1.6v-2L3.9 7.7l1.9-3.2 2.1.4 1.6-.9Z" transform="translate(0 1.3)"/><circle cx="12" cy="12" r="3"/>'
};
function glyph(key) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${icon[key]}</svg>`;
}

export function titleMenu(def, audio, { singleDef, multiDef, instant, latest, findMatch, mapRotation } = {}) {
  const known = new Set([
    ...chrome,
    single,
    multi,
    ...utility,
    'IDC_BACK_BUTTON_MAIN',
    'IDC_OK_MAIN',
    ...solo.concat(online).map(r => r[0])
  ]);
  // Some overhauls add translation notices and music credits as passive labels. Preserve them;
  // unknown interactive controls still get the complete native dialog instead of being dropped.
  const passive = c => c.id === 'IDC_STATIC' && ['CTEXT', 'LTEXT', 'RTEXT'].includes(c.kind);
  if ([def, singleDef, multiDef].some(d => !d || d.controls.some(c => !known.has(c.id) && !passive(c)))) return null;
  if (![single, multi].every(id => def.controls.some(c => c.id === id))) return null;
  const controls = new Map([def, singleDef, multiDef].flatMap(d => d.controls.map(c => [c.id, c])));
  const allowed = id =>
    controls.has(id) ||
    (id === 'CONTINUE' && controls.has('IDC_CUSTOM_CAMPAIGN_BUTTON')) ||
    (id === 'IDC_INSTANT_BATTLE_BUTTON' && instant);
  const canMatch = !!findMatch && allowed('IDC_MULTIPLAYER_INTERNET_BUTTON');
  const veil = document.createElement('section');
  veil.className = 'dlg-veil title-menu';
  veil.setAttribute('aria-label', 'Main menu');
  veil.innerHTML = `<header class="home-rail"><div class="title-bar"><div class="title-tools dock-bell"></div><nav aria-label="Home navigation"></nav><div class="title-tools dock-cog"></div></div></header>
    <section class="home-body" aria-label="Home"><div class="home-feature"></div><div class="home-destinations" role="group" aria-label="Workshop and Army Painter"></div></section>
    <section class="mode-body" hidden><div class="mode-heading"><button type="button" class="mode-back" aria-label="Back" title="Back">${glyph('back')}</button><h1></h1></div><div class="play-browser" hidden></div><section class="flight-deck" aria-label="Matchmaking" hidden></section><div class="mode-grid"></div><div class="command-desk" hidden></div></section>
    <div class="title-notices" hidden></div>
    <dialog class="title-drawer" aria-labelledby="drawer-heading"><button type="button" class="drawer-close" aria-label="Close sidebar" title="Close sidebar">${glyph('dismiss')}</button><small>Command interface</small><h2 id="drawer-heading"></h2><div class="drawer-items"></div></dialog>`;
  const $ = sel => veil.querySelector(sel),
    nav = $('nav'),
    body = $('.mode-body'),
    grid = $('.mode-grid'),
    back = $('.mode-back'),
    drawer = $('dialog');
  let flight = null;
  let section = 'home',
    playEntry = 'TITLE_PLAY',
    lane = 'solo',
    homeScroll = 0,
    source,
    active,
    busy = false,
    generation = 0;
  const actions = new Map();
  const text = (id, fallback) => {
    const key = controls.get(id)?.text;
    return (key?.startsWith('TEXT_') ? db.t(key) : key) || fallback;
  };
  const bind = (b, id) => {
    b.type = 'button';
    b.dataset.id = id;
    return b;
  };
  const button = (parent, id, label) => {
    const b = bind(document.createElement('button'), id);
    b.textContent = label;
    parent.append(b);
    return b;
  };
  const find = id => [...veil.querySelectorAll('[data-id]')].find(b => b.dataset.id === id);
  const focus = () => {
    const fallback = section === 'home' ? find('TITLE_PLAY') : veil.hasAttribute('data-immersive') ? find('FLIGHT_PLAYLIST') : back;
    (active?.isConnected && active.checkVisibility() && !active.disabled ? active : fallback)?.focus({ preventScroll: true });
  };
  // One short content-only transition per section change. The scene, nav and any matchmaking takeover stay still,
  // nothing is cloned, and the next navigation cancels whatever is left of the previous run.
  let motion;
  const calm = () => {
    const run = motion;
    motion = null;
    run?.cancel();
  };
  const settle = (from, to) => {
    calm();
    if (from === to || typeof body.animate !== 'function' || !$('.flight-deck').hidden) return;
    if (menuMotion.matches) return;
    const depth = { home: 0, play: 1, workshop: 1, customize: 1, custom: 2, multi: 2 },
      forward = (depth[to] ?? 0) >= (depth[from] ?? 0),
      run = (to === 'home' ? $('.home-body') : body).animate(
        [
          { opacity: 0, transform: `translateY(${forward ? 12 : -12}px)` },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 160, easing: 'cubic-bezier(.22, .7, .3, 1)' }
      );
    motion = run;
    run.onfinish = run.oncancel = () => {
      if (motion === run) motion = null;
    };
  };
  // Intent only: fetch the desk module graphs (no execution, no desk work) when a nav target is pointed at or focused.
  const desks = { TITLE_WORKSHOP: './titleworkshop.js', TITLE_CUSTOMIZE: './titlecustomize.js' },
    warmed = new Set();
  const prefetch = e => {
    const id = e.currentTarget.dataset.id,
      href = desks[id];
    if (!href || warmed.has(id) || navigator.connection?.saveData || document.head.querySelector(`link[data-title-desk="${id}"]`)) return;
    warmed.add(id);
    const link = document.createElement('link');
    link.dataset.titleDesk = id;
    link.rel = 'modulepreload';
    link.href = new URL(href, import.meta.url).href;
    document.head.append(link);
  };
  let stopSocial;
  const items = $('.drawer-items');
  function closeDrawer() {
    stopSocial?.();
    stopSocial = null;
    if (drawer.open) drawer.close();
    drawer.removeAttribute('data-closing');
    items.inert = false;
    source?.setAttribute('aria-expanded', 'false');
  }
  function dismiss() {
    if (!drawer.open || drawer.hasAttribute('data-closing')) return;
    drawer.setAttribute('data-closing', '');
    items.inert = true;
    // Keep the actual modal (and its inert background) until the exit slide completes.
    // With reduced motion or no transition support this closes synchronously.
    const slide = drawer.getAnimations?.().find(a => a.transitionProperty === 'transform');
    if (!slide) return closeDrawer();
    const finish = () => { if (drawer.hasAttribute('data-closing')) closeDrawer(); };
    slide.finished.then(finish, finish);
  }
  function sidebar(kind, b) {
    if (drawer.open) return;
    source = b;
    active = b;
    source.setAttribute('aria-expanded', 'true');
    const social = kind === 'bell';
    $('#drawer-heading').textContent = social ? 'Social feed' : 'System menu';
    items.replaceChildren();
    if (social) {
      stopSocial = mountSocial(items);
    } else
      for (const [id, label] of [
        [utility[0], 'Settings'],
        [utility[1], text(utility[1], 'Credits')],
        [utility[2], text(utility[2], 'Exit Game')]
      ])
        if (allowed(id)) button(items, id, label);
    drawer.showModal();
    $('.drawer-close').focus();
  }
  $('.drawer-close').onclick = dismiss;
  drawer.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });
  drawer.addEventListener('close', () => { if (!drawer.open) closeDrawer(); });
  function artwork(card, key, illustration) {
    card.dataset.art = key;
    card.style.setProperty('--illustration', `url("art/briefings.svg#${illustration}")`);
    if (!globalThis.SWR_BASE && ['localhost', '127.0.0.1'].includes(location.hostname))
      card.style.setProperty('--tile-photo', `url("/api/title-art/${key}.jpg")`);
  }
  function feature(ticket) {
    if (!allowed('CONTINUE')) return;
    const card = $('.home-feature');
    artwork(card, 'resume', 'chronicle');
    card.innerHTML = `<div class="feature-copy"><small>Galactic Conquest</small><h2>Continue Campaign</h2>
      <p id="checkpoint-status" role="status">Checking campaign saves…</p><div class="feature-actions"></div></div>`;
    const status = card.querySelector('p'),
      actions = card.querySelector('.feature-actions');
    const enter = button(actions, 'CONTINUE', 'Resume campaign');
    enter.setAttribute('aria-label', 'Continue Campaign');
    enter.setAttribute('aria-describedby', status.id);
    enter.disabled = true;
    const browse = button(actions, 'BROWSE_MODES', 'Explore modes  ›');
    const choose = button(actions, 'CHOOSE_CAMPAIGN', 'Choose campaign…');
    choose.hidden = true;
    Promise.resolve()
      .then(latest)
      .then(row => {
        if (ticket !== generation) return;
        enter.disabled = !row;
        if (row && document.activeElement === browse) find('TITLE_PLAY').focus({ preventScroll: true });
        browse.hidden = !!row;
        choose.hidden = !row && !document.querySelector('meta[name="swr-universal"]');
        status.textContent = row ? row.name || 'Resume your latest checkpoint.' : 'No Galactic Conquest checkpoint yet.';
      })
      .catch(() => {
        if (ticket === generation) status.textContent = 'Campaign saves unavailable.';
      });
  }
  function goBack() {
    if (flight?.back()) return;
    if (section === 'multi' || section === 'custom') {
      lane = 'online';
      return show('play', !canMatch ? multi : section === 'custom' ? 'PLAY_CUSTOM' : 'PLAY_MATCHMAKING');
    }
    show('home', section === 'play' ? playEntry : 'TITLE_' + section.toUpperCase());
  }
  function show(which, focusId, confirmed = false) {
    const guard = $('.command-desk').firstChild?.leaveDraft;
    if (!confirmed && section === 'customize' && guard) return guard(() => show(which, focusId, true));
    const from = section;
    if (from === 'home') {
      homeScroll = veil.scrollTop;
      if (which === 'play') lane = 'solo';
    }
    flight?.dispose();
    flight = null;
    veil.removeAttribute('data-immersive');
    const deck = $('.flight-deck');
    deck.replaceChildren();
    deck.hidden = which !== 'multi' || !canMatch;

    section = which;
    const home = which === 'home',
      play = which === 'play',
      ticket = ++generation;
    const desk = $('.command-desk'),
      workbench = which === 'workshop' || which === 'customize';
    // Give each async renderer a detached root when the player navigates away.
    desk.replaceChildren();
    desk.hidden = !workbench;
    grid.hidden = home || play || workbench;
    const browser = $('.play-browser');
    browser.replaceChildren();
    browser.hidden = !play;
    body.hidden = home;
    $('.home-rail').hidden = !home;
    $('.home-body').hidden = !home;
    $('.home-feature').replaceChildren();
    veil.scrollTop = 0;
    veil.dataset.section = which;
    grid.replaceChildren();
    showNotices(home ? def : which === 'custom' || which === 'multi' ? multiDef : null);
    if (home) {
      feature(ticket);
      veil.scrollTop = homeScroll;
      if (focusId) {
        active = find(focusId);
        focus();
      }
      return settle(from, which);
    }
    $('.mode-heading h1').textContent = play ? textPlay() : workbench ? (which === 'workshop' ? 'Workshop' : 'Army Painter') : 'Custom games';
    const backId = which === 'multi' || which === 'custom' ? 'IDC_OK_MAIN' : 'TITLE_BACK';
    bind(back, backId);
    back.title = back.ariaLabel = text('IDC_BACK_BUTTON_MAIN', 'Back');
    if (workbench) {
      const page = document.createElement('div');
      desk.append(page);
      page.textContent = 'Opening…';
      // A swap can resolve an import after its page was detached: mount only while this render is still current.
      const mount = fn => {
        if (ticket === generation && page.isConnected) return fn(page);
      };
      (which === 'workshop'
        ? import('./titleworkshop.js').then(m => mount(m.workshopDesk))
        : import('./titlecustomize.js').then(m => mount(m.customizeDesk))
      ).catch(() => {
        if (ticket === generation && page.isConnected) page.textContent = 'This library could not be opened. Try again or return Home.';
      });
      active = back;
      focus();
      return settle(from, which);
    }
    if (play) {
      const tabs = [
        { key: 'solo', action: single, label: text(single, 'Single Player') },
        { key: 'online', action: multi, label: text(multi, 'Multiplayer') }
      ];
      playTabs(browser, tabs, lane, (panel, selected) => {
        lane = selected;
        const isSolo = lane === 'solo';
        renderTiles(panel, isSolo ? solo : canMatch ? multiplayerDoors : online);
        showNotices(isSolo ? singleDef : multiDef);
      });
    } else {
      renderTiles(grid, online);
      if (!deck.hidden) flight = flightDeck(deck, findMatch, grid, { mapRotation, goBack, immersive: on => veil.toggleAttribute('data-immersive', on) });
    }
    active = find(focusId) || back;
    focus();
    settle(from, which);
  }
  function showNotices(definition) {
    const notices = $('.title-notices');
    notices.replaceChildren();
    for (const c of definition?.controls.filter(passive) || []) {
      const msg = db.t(c.text) || (!/^(TEXT_|SET_YOUR_GAME_LANGUAGE)/.test(c.text) ? c.text : '');
      if (!msg?.trim()) continue;
      const p = document.createElement('p');
      p.textContent = msg;
      notices.append(p);
    }
    notices.hidden = !notices.childElementCount;
  }
  function renderTiles(parent, rows) {
    for (const [id, label, key, illustration, copy, family] of rows) {
      if (rows !== multiplayerDoors && !allowed(id)) continue;
      const card = document.createElement('article');
      card.className = 'mode-tile';
      artwork(card, key, illustration);
      const enter = bind(document.createElement('button'), id);
      enter.className = 'tile-enter';
      const name = document.createElement('strong'),
        desc = document.createElement('span');
      const caption = text(id, label);
      name.textContent = key === 'network' && /^options$/i.test(caption) ? 'Network Options' : caption;
      desc.textContent = copy;
      enter.append(name, desc);
      card.append(enter);
      parent.append(card);
      // Stable accessible names; descriptive copy remains separately available.
      desc.id = 'tile-desc-' + key;
      enter.setAttribute('aria-label', name.textContent);
      enter.setAttribute('aria-describedby', desc.id);
      if (family && allowed('IDC_LOAD_GAME_MAIN')) {
        const l = button(card, 'load-' + family, 'Load');
        l.className = 'tile-load';
        l.setAttribute('aria-label', 'Load ' + name.textContent + ' save');
      }
      if (key === 'network') enter.disabled = true;
    }
  }
  const textPlay = () => db.t('TEXT_BUTTON_PLAY') || 'Play';
  const playButton = button(nav, 'TITLE_PLAY', '');
  playButton.innerHTML = `<span>${glyph('launch')}<b class="play-label"></b></span>`;
  for (const [label, tag, copy, photo, scene] of [
    ['Workshop', 'Mod exchange', 'Browse mods and build playsets.', 'story', 'relay'],
    ['Army Painter', 'Faction markings', 'Paint a livery for your armies and fleets.', 'archive', 'fleet']
  ]) {
    const id = label === 'Army Painter' ? 'TITLE_CUSTOMIZE' : 'TITLE_WORKSHOP';
    const b = button($('.home-destinations'), id, '');
    b.className = 'home-destination';
    artwork(b, photo, scene);
    b.setAttribute('aria-label', label);
    const descId = 'destination-' + id.toLowerCase();
    b.setAttribute('aria-describedby', descId);
    b.innerHTML = `<span class="destination-copy"><small>${tag}</small><strong>${label}</strong><span id="${descId}">${copy}</span></span><i aria-hidden="true">›</i>`;
    b.addEventListener('pointerenter', prefetch);
    b.addEventListener('focus', prefetch);
  }
  for (const [key, label] of [
    ['bell', 'Notifications'],
    ['cog', 'System menu']
  ]) {
    const b = button($('.dock-' + key), key, '');
    b.innerHTML = glyph(key);
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
  }
  $('.title-bar').onkeydown = e => {
    const all = [...$('.title-bar').querySelectorAll('button')],
      i = all.indexOf(e.target);
    if (i < 0) return;
    const j = { ArrowRight: (i + 1) % all.length, ArrowLeft: (i + all.length - 1) % all.length, Home: 0, End: all.length - 1 }[e.key];
    if (j !== undefined) {
      e.preventDefault();
      all[j].focus();
    }
  };
  veil.addEventListener('keydown', e => {
    if ((e.key === 'Escape' || (e.key === 'Backspace' && veil.hasAttribute('data-immersive') && !e.target.closest('input,textarea,[contenteditable=true]'))) && !e.defaultPrevented && !drawer.open && section !== 'home') {
      e.preventDefault();
      goBack();
    }
  });
  veil.addEventListener('pointerover', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled && !b.contains(e.relatedTarget)) audio.play('GUI_Highlight_Mouse_Over');
  });
  veil.addEventListener('click', async e => {
    const b = e.target.closest('[data-id]');
    if (!b || b.disabled || busy || (drawer.open && (!drawer.contains(b) || drawer.hasAttribute('data-closing')))) return;
    const id = b.dataset.id;
    audio.play('GUI_Button_Press_2_SFX');
    if (id.startsWith('FLIGHT_')) return;
    if (b === back) return goBack();
    if (id === single || id === multi) return; // The Play tablist owns these buttons.
    flight?.cancel();
    if (id === 'bell' || id === 'cog') return sidebar(id, b);
    active = drawer.open ? source : b;
    if (drawer.open) closeDrawer(); // Hand a native action focus immediately; never stack it behind the sidebar.
    if (id === 'TITLE_WORKSHOP' || id === 'TITLE_CUSTOMIZE') return show(id.slice(6).toLowerCase());
    if (id === 'PLAY_MATCHMAKING') return show('multi', 'FLIGHT_PLAYLIST');
    if (id === 'PLAY_CUSTOM') return show('custom', 'IDC_OK_MAIN');
    if (id === 'TITLE_PLAY' || id === 'BROWSE_MODES') {
      playEntry = id;
      return show('play', 'TITLE_BACK');
    }
    busy = true;
    try {
      await actions.get(id)?.();
    } finally {
      busy = false;
    }
  });
  const repaint = () => {
    playButton.querySelector('.play-label').textContent = textPlay();
    show(section);
  };
  const unsub = onLanguageChange(repaint);
  repaint();
  document.body.append(veil);
  const stopBell = watchBell(find('bell'), drawer);
  return {
    veil,
    ctl: find,
    focus,
    show,
    on: (id, fn) => actions.set(id, fn),
    close() {
      flight?.dispose();
      calm();
      generation++;
      closeDrawer();
      stopBell();
      unsub();
      veil.remove();
    }
  };
}
