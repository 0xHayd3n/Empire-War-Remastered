import { db } from '../gamedata.js';
import { MenuArtwork } from './menuartwork.js';
import { Menus } from './menus.js';
import { titleMenu } from './titlemenu.js';
import { recentCampaign, saveModes } from './modesaves.js';
import { whileLoading } from '../splash.js';
import { openCampaignMenu } from './campaignmenu.js';
import { openMainCampaignMenu, suggestTutorial, tutorialSuggested, markTutorialSuggested } from './storycampaignmenu.js';
import { TacticalMovies } from './tacticalmovies.js';
import { tutorialFinished } from './tutorialprofile.js';
import { loadDialogs } from './dialogs.js';

const PANEL = { cls: 'front', stretch: true };

export function titlePreviews(current) {
  const life = new AbortController();
  const ready = import('./universalsolowarm.js').then(({ soloWarmer }) => {
    if (life.signal.aborted) return;
    const warm = soloWarmer(current, life.signal);
    if (!navigator.connection?.saveData) for (const mode of ['conquest', 'story', 'skirmish']) void warm(mode);
    return warm;
  }).catch(() => undefined);
  return { ready, close: () => life.abort() };
}

export class FrontEnd {
  constructor(audio, { skirmish, instant, leave, start, multiplayer, playlist, mapRotation, universal, load }) {
    this.universal = universal;
    this.audio = audio;
    // Save, presence and leave guards use this marker for non-playable menu sessions.
    this.setup = { attract: true };
    this.menus = new Menus(this);
    this.skirmish = skirmish;
    this.instant = instant;
    this.leave = leave;
    this.load = load;
    this.start = start;
    this.openLobbies = multiplayer;
    this.playlist = playlist;
    this.mapRotation = mapRotation;
    this.events = new AbortController();
    this.onKey = e => {
      if (this.universal && document.querySelector('.era-panel[open], [data-universal-screen]')) return;
      if (e.target.closest?.('#armyPainter')) return;
      const top = this.menus.stack[this.menus.stack.length - 1];
      if (e.code === 'Escape' && !this.menus.listening && this.menus.stack.length > 1 && top.veil.style.display !== 'none') {
        e.stopPropagation();
        this.menus.pop();
      }
    };
  }

  async open() {
    const m = this.menus;
    if (!(await m.ready)) return false;
    const o = (this.overlay = document.createElement('div'));
    o.id = 'frontOverlay';
    document.body.appendChild(o);
    document.body.classList.add('front-end');
    if (!globalThis.SWR_BASE && ['localhost', '127.0.0.1'].includes(location.hostname)) {
      document.body.style.setProperty('--title-photo', 'url("/api/title-orbit.jpg")');
    }
    this.artwork = new MenuArtwork(o);
    const listen = { capture: true, signal: this.events.signal };
    addEventListener('keydown', this.onKey, listen);
    const unlock = () => this.audio.unlock();
    for (const event of ['pointerdown', 'keydown']) addEventListener(event, unlock, { ...listen, once: true });
    this.audio.menuOnly = true;
    this.menuMusic();
    return this.main();
  }
  menuMusic() {
    this.audio.setPlaylist(db.music.get('MAIN_MENU_MUSIC_EVENT')?.list('Files') || []);
  }
  message(text) {
    return this.menus.notify(text);
  }
  dispose() {
    this.campaignRequest?.abort();
    this.events.abort();
    this.previews?.close();
    cancelAnimationFrame(this.movieFrame);
    if (this.tacticalMovies) this.tacticalMovies.onFinish = null;
    this.menus.closeAll();
    document.body.classList.remove('front-end');
    document.body.style.removeProperty('--title-photo');
    this.artwork?.dispose();
    this.overlay?.remove();
  }

  async screen(id, hide = [], opts = {}) {
    void this.artwork.refresh(); // Keep localized artwork on the native submenus.
    const dlg = await this.menus.push(id, { ...PANEL, ...opts });
    if (!dlg) return null;
    for (const c of ['IDC_MENU_PETRO_LOGO', ...hide]) dlg.show(c, false);
    dlg.on('IDC_MENU_CREDITS', () => this.credits(dlg));
    return dlg;
  }

  credits(dlg) {
    if (this.rolling) return;
    const overlay = this.overlay,
      show = on => {
        dlg.veil.style.display = on ? '' : 'none';
        if (overlay) overlay.style.display = on ? '' : 'none';
      };
    this.audio.unlock();
    show(false);
    this.audio.stopMusic();
    const movies = (this.tacticalMovies ||= new TacticalMovies(this, { missing: new Map() }));
    movies.canvas.style.zIndex = '90';
    this.rolling = true;
    const back = () => {
      this.rolling = false;
      show(true);
      cancelAnimationFrame(this.movieFrame);
      this.menuMusic();
      dlg.focus?.();
    };
    movies.play('Credits', { loop: true, skippable: true });
    movies.onFinish = back;
    // Credits need a clock; an idle title screen does not.
    let last = performance.now();
    const tick = now => {
      movies.update(Math.min((now - last) / 1000, 0.1), false);
      last = now;
      if (movies.active) this.movieFrame = requestAnimationFrame(tick);
    };
    this.movieFrame = requestAnimationFrame(tick);
  }

  async main() {
    const defs = (await loadDialogs())?.dialogs;
    if (this.universal) this.previews ||= titlePreviews(this.universal.current);
    let dlg = this.title = titleMenu(defs?.get('IDD_MAIN_MENU_DIALOG'), this.audio, {
      mapRotation: this.mapRotation,
      findMatch: this.playlist && (async options => {
        this.audio.unlock();
        await this.playlist({...options, back: () => {
          dlg.veil.style.display = this.overlay.style.display = '';
          options.returned();
        }});
        if (options.signal.aborted || !dlg.veil.isConnected) return;
        dlg.veil.style.display = this.overlay.style.display = 'none';
      }),
      singleDef: defs?.get('IDD_SINGLE_PLAYER_GAMES_MENU_DIALOG'), multiDef: defs?.get('IDD_MULTIPLAYER_DIALOG'), instant: !!this.instant, latest: recentCampaign
    });
    if (dlg) {
      this.menus.stack.push(dlg);
      dlg.on('IDC_MENU_CREDITS', () => this.credits(dlg));
      dlg.on('IDC_CUSTOM_CAMPAIGN_BUTTON', () => this.universal ? this.pickEra('conquest', dlg) : this.campaign(dlg));
      dlg.on('IDC_NEW_CAMPAIGN_BUTTON', () => this.universal ? this.pickEra('story', dlg) : this.newCampaign(dlg));
      const show = on => { dlg.veil.style.display = this.overlay.style.display = on ? '' : 'none'; if (on) dlg.focus(); };
      dlg.on('IDC_SKIRMISH_GAMES_BUTTON', async () => {
        if (this.universal) return this.pickEra('skirmish', dlg);
        show(false); if (!await this.skirmish(() => show(true)).catch(() => false)) show(true);
      });
      dlg.on('IDC_INSTANT_BATTLE_BUTTON', () => this.universal ? this.pickEra('instant', dlg) : this.runInstant(show));
      for (const [id,kind] of [['IDC_MULTIPLAYER_INTERNET_BUTTON','internet'],['IDC_MULTIPLAYER_LAN_BUTTON','lan']]) dlg.on(id, () => { this.audio.unlock(); return this.openLobbies(kind); });
      for (const mode of saveModes) dlg.on('load-'+mode, () => this.universal ? this.pickEra('load-'+mode,dlg) : this.menus.load(mode));
      dlg.on('CHOOSE_CAMPAIGN', () => this.chooseCampaign());
      dlg.on('CONTINUE', async () => {
        const row = await recentCampaign();
        if (!row) return dlg.show('home');
        if (this.universal) return this.universal.resume(row.profile);
        if (row.id) await this.menus.loadChecked(row.id, this.load);
      });
    } else dlg = await this.screen('IDD_MAIN_MENU_DIALOG', ['IDC_MAIN_MENU_PLAY_DEMO']);
    if (!dlg) return false;
    dlg.on('IDC_MAIN_MENU_TUTORIAL', () => this.campaign(dlg, true));
    dlg.on('IDC_MAIN_MENU_MULTIPLAYER', () => this.multiplayer());
    dlg.on('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', () => this.single());
    dlg.on('IDC_LOAD_GAME_MAIN', () => this.universal ? this.pickEra('load', dlg) : this.menus.load());
    dlg.on('IDC_OPTIONS', () => this.options());
    dlg.on('IDC_MAIN_MENU_EXIT2', () => this.leave());
    return true;
  }

  async chooseCampaign() {
    return (await import('./campaignpicker.js')).chooseCampaign({load:id=>this.menus.loadChecked(id,this.load),back:()=>this.title?.focus()});
  }

  async pickEra(mode, dlg) {
    if (['conquest', 'story', 'skirmish', 'instant'].includes(mode)) {
      const button = dlg.ctl({ conquest:'IDC_CUSTOM_CAMPAIGN_BUTTON', story:'IDC_NEW_CAMPAIGN_BUTTON', skirmish:'IDC_SKIRMISH_GAMES_BUTTON', instant:'IDC_INSTANT_BATTLE_BUTTON' }[mode]);
      await (await this.previews?.ready)?.(mode);
      if (this.events.signal.aborted || !dlg.veil.isConnected || (button && !button.isConnected)) return;
    }
    const overlay = document.getElementById('frontOverlay');
    dlg.veil.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    return this.universal.pick(mode, () => {
      dlg.veil.style.display = '';
      if (overlay) overlay.style.display = '';
      dlg.focus?.();
    });
  }

  async single() {
    if (this.title) return this.title.show('play', 'IDC_CUSTOM_CAMPAIGN_BUTTON');
    if (this.universal) void import('./universalcampaign.js').then(m => m.campaignLibrary()).catch(() => {});
    const def = this.instant ? (await loadDialogs())?.dialogs.get('IDD_SINGLE_PLAYER_GAMES_MENU_DIALOG') : null,
      slot = def ? instantSlot(def) : null;
    const dlg = await this.screen(
      'IDD_SINGLE_PLAYER_GAMES_MENU_DIALOG',
      ['IDC_HINT_LIST', 'IDC_DEBUG_LOAD_SKIRMISH_MAP_BUTTON'],
      slot ? { extra: [{ kind: 'PUSHBUTTON', text: '', id: 'IDC_INSTANT_BATTLE_BUTTON', fontOf: 'IDC_SKIRMISH_GAMES_BUTTON', ...slot, style: '' }] } : {}
    );
    if (!dlg) return;
    dlg.on('IDC_NEW_CAMPAIGN_BUTTON', () => this.universal ? this.pickEra('story', dlg) : this.newCampaign(dlg));
    dlg.on('IDC_CUSTOM_CAMPAIGN_BUTTON', () => this.universal ? this.pickEra('conquest', dlg) : this.campaign(dlg));
    const show = on => {
      dlg.veil.style.display = on ? '' : 'none';
      const o = document.getElementById('frontOverlay');
      if (o) o.style.display = on ? '' : 'none';
    };
    dlg.on('IDC_SKIRMISH_GAMES_BUTTON', async () => {
      if (this.universal) return this.pickEra('skirmish', dlg);
      show(false);
      const ok = await this.skirmish(() => show(true)).catch(() => false);
      if (!ok) show(true);
    });
    dlg.on('IDC_BACK_BUTTON_MAIN', () => this.menus.pop());
    if (slot) {
      const own = dlg.ctl('IDC_INSTANT_BATTLE_BUTTON'),
        back = dlg.ctl('IDC_BACK_BUTTON_MAIN'),
        like = dlg.ctl('IDC_SKIRMISH_GAMES_BUTTON');
      const bg = dlg.el.querySelector('.dlg-bg');
      if (own && back && like && bg) {
        const bx = parseFloat(back.style.left),
          by = parseFloat(back.style.top),
          bw = parseFloat(back.style.width),
          bh = parseFloat(back.style.height),
          pad = 8,
          copy = document.createElement('div');
        copy.className = 'dlg-bg';
        Object.assign(copy.style, {
          position: 'absolute',
          left: bx - pad + 'px',
          top: slot.y - (by - parseFloat(own.style.top)) - pad + 'px',
          width: bw + 2 * pad + 'px',
          height: bh + 2 * pad + 'px',
          backgroundImage: bg.style.backgroundImage,
          backgroundSize: bg.style.width + ' ' + bg.style.height,
          backgroundPosition: `${pad - bx}px ${pad - by}px`,
          backgroundRepeat: 'no-repeat'
        });
        bg.after(copy);
        for (const k of ['left', 'width', 'height']) own.style[k] = back.style[k];
        for (const k of ['--up', '--over', '--down', '--off']) {
          const v = back.style.getPropertyValue(k);
          if (v) own.style.setProperty(k, v);
        }
        own.style.backgroundImage = back.style.backgroundImage;
        const top = own.style.top;
        own.style.top = back.style.top;
        back.style.top = top;
        copy.style.top = parseFloat(top) - pad + 'px';
      }
      dlg.setText('IDC_INSTANT_BATTLE_BUTTON', 'Instant Battle');
      dlg.on('IDC_INSTANT_BATTLE_BUTTON', () => this.universal ? this.pickEra('instant', dlg) : this.runInstant(show));
    } else if (this.instant) this.instantEntry(dlg, show);
  }

  async runInstant(show) {
    this.audio.unlock();
    show(false);
    const ok = await this.instant(() => show(true)).catch(e => {
      console.warn('instant battle', e);
      return false;
    });
    if (!ok) show(true);
  }

  instantEntry(dlg, show) {
    const box = id => dlg.def.controls.find(c => c.id === id);
    const skirmish = box('IDC_SKIRMISH_GAMES_BUTTON'),
      back = box('IDC_BACK_BUTTON_MAIN');
    if (!skirmish || !back) return;
    const ys = ['IDC_NEW_CAMPAIGN_BUTTON', 'IDC_CUSTOM_CAMPAIGN_BUTTON', 'IDC_SKIRMISH_GAMES_BUTTON']
      .map(box)
      .filter(Boolean)
      .map(c => c.y)
      .sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter(d => d > 0),
      gap = gaps.length ? Math.min(...gaps) : back.y - skirmish.y,
      fits = back.y - skirmish.y >= 2 * gap;
    let y = skirmish.y + gap;
    if (!fits) {
      y = skirmish.y;
      for (const id of ['IDC_STATIC_OPTIONS', 'IDC_NEW_CAMPAIGN_BUTTON', 'IDC_CUSTOM_CAMPAIGN_BUTTON', 'IDC_SKIRMISH_GAMES_BUTTON']) {
        const c = box(id),
          e = dlg.ctl(id);
        if (c && e) e.style.top = c.y - gap + 'px';
      }
    }
    this.menus.extra(dlg, 'IDC_SKIRMISH_GAMES_BUTTON', 'Instant Battle', skirmish.x, y, skirmish.w, () => this.universal ? this.pickEra('instant', dlg) : this.runInstant(show));
  }

  async multiplayer(custom = false) {
    if (this.title) {
      this.title.show(custom ? 'custom' : 'multi', custom ? 'IDC_OK_MAIN' : 'FLIGHT_PLAYLIST');
      return;
    }
    const dlg = await this.screen('IDD_MULTIPLAYER_DIALOG');
    if (!dlg) return;
    const go = kind => {
      this.audio.unlock();
      this.openLobbies(kind);
    };
    dlg.on('IDC_MULTIPLAYER_INTERNET_BUTTON', () => go('internet'));
    dlg.on('IDC_MULTIPLAYER_LAN_BUTTON', () => go('lan'));
    dlg.enable('IDC_MAIN_OPTIONS_NETWORK', false);
    dlg.on('IDC_OK_MAIN', () => this.menus.pop());
  }

  async options() {
    if (this.universal) return this.menus.options();
    const def = (await loadDialogs())?.dialogs.get('IDD_MAIN_OPTIONS_DIALOG'),
      okC = def && def.controls.find(c => c.id === 'IDC_OK_MAIN'),
      above = okC && def.controls.filter(c => /^IDC_MAIN_OPTIONS_/.test(c.id) && c.y < okC.y).sort((a, b) => b.y - a.y)[0],
      ok = okC || { x: 265, y: 706, w: 236, h: 21 },
      step = above ? ok.y - above.y : 36;
    const dlg = await this.screen('IDD_MAIN_OPTIONS_DIALOG', [], {
      extra: [{ kind: 'PUSHBUTTON', text: '', id: 'IDC_MAIN_OPTIONS_TWEAKS', x: ok.x, y: ok.y - step, w: ok.w, h: ok.h, style: '' }],
      adjust: c => (c.id !== 'IDC_OK_MAIN' && c.id !== 'IDC_MAIN_OPTIONS_TWEAKS' && c.id !== 'IDC_MENU_PETRO_LOGO' && c.y < ok.y ? { ...c, y: c.y - step } : null)
    });
    if (!dlg) return;
    if (this.title) dlg.setText('IDC_STATIC_OPTIONS', 'Settings');
    dlg.setText('IDC_MAIN_OPTIONS_TWEAKS', 'Tweaks');
    dlg.on('IDC_MAIN_OPTIONS_TWEAKS', () => this.menus.tweaks());
    dlg.on('IDC_MAIN_OPTIONS_KEYBOARD', () => this.menus.keyboard());
    dlg.enable('IDC_MAIN_OPTIONS_MODS', false);
    dlg.on('IDC_MAIN_OPTIONS_AUDIO', () => this.menus.audio());
    dlg.on('IDC_MAIN_OPTIONS_VIDEO', () => this.menus.video());
    dlg.on('IDC_MAIN_OPTIONS_GAMEPLAY', () => this.menus.gameplay());
    dlg.on('IDC_OK_MAIN', () => this.menus.pop());
  }

  async newCampaign(parent) {
    if (!tutorialSuggested()) {
      markTutorialSuggested();
      const answer = await suggestTutorial();
      if (answer === 'yes') return this.campaign(parent, true);
      if (answer !== 'no' && answer !== null) return;
    }
    return this.campaign(parent, false, true);
  }

  async campaign(parent, tutorial = false, story = false) {
    this.campaignRequest?.abort();
    const request = (this.campaignRequest = new AbortController());
    const { signal } = request;
    const title = story ? 'Story campaigns' : tutorial ? 'Training missions' : 'Galactic Conquest';
    const build = story ? openMainCampaignMenu : openCampaignMenu;
    const trigger = parent.ctl(story ? 'IDC_NEW_CAMPAIGN_BUTTON' : tutorial ? 'IDC_MAIN_MENU_TUTORIAL' : 'IDC_CUSTOM_CAMPAIGN_BUTTON');
    const overlay = document.getElementById('frontOverlay');
    const show = on => {
      parent.veil.style.display = on ? '' : 'none';
      if (overlay) overlay.style.display = on || tutorial ? '' : 'none';
    };
    show(false);
    const restore = () => {
      if (signal.aborted) return;
      show(true);
      if (trigger) { trigger.tabIndex = 0; trigger.focus({ preventScroll: true }); }
    };
    const ok = await whileLoading('conquest', title, () => build({
      signal, tutorial,
      isTutorialComplete: c => tutorialFinished(c.name),
      audio: this.audio,
      cancel: restore,
      start: setup => {
        this.audio.unlock();
        this.start(setup);
      }
    })).catch(e => {
      console.warn('Campaign menu', e);
      return false;
    });
    if (signal.aborted) return;
    if (!ok) {
      // Recovery must not depend on the unavailable game dialog resources.
      const dialog = document.getElementById('briefFailure');
      dialog.querySelector('p').textContent = `Could not open ${title}.`;
      dialog.returnValue = '';
      const close = () => { if (dialog.open) dialog.close(); };
      signal.addEventListener('abort', close, { once: true });
      dialog.addEventListener('close', () => {
        signal.removeEventListener('abort', close);
        if (signal.aborted) return;
        restore();
        if (dialog.returnValue === 'retry') this.campaign(parent, tutorial, story);
      }, { once: true });
      dialog.showModal();
    }
  }
}

function instantSlot(def) {
  const box = id => def.controls.find(c => c.id === id),
    skirmish = box('IDC_SKIRMISH_GAMES_BUTTON'),
    back = box('IDC_BACK_BUTTON_MAIN');
  if (!skirmish || !back || back.y <= skirmish.y) return null;
  const column = ['IDC_NEW_CAMPAIGN_BUTTON', 'IDC_CUSTOM_CAMPAIGN_BUTTON', 'IDC_SKIRMISH_GAMES_BUTTON', 'IDC_BACK_BUTTON_MAIN']
    .map(box)
    .filter(Boolean)
    .every(c => c.x === skirmish.x);
  if (column) return null;
  return { x: back.x, y: back.y + (back.y - skirmish.y), w: back.w, h: back.h };
}
