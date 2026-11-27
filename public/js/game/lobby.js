import { db, factionColor } from '../gamedata.js';
import { openDialog } from './dialogs.js';
import { Menus } from './menus.js';
import { loadMapPreview } from '../ted.js';
import { startMarks } from './mapstarts.js';
import { PALETTE, slotWindow } from './slotrows.js';
import { leaveTo } from '../leaveguard.js';
import { isDynamic, seedBar, dockSeedBar } from './dynamicmap.js';
import { skirmishSetup, MAX_TEAMS, SPECTATOR_TEAM } from './skirmishsetup.js';
import { showSkirmishBriefing } from './skirmishbriefing.js';
export { SPECTATOR_TEAM };

const T = (id, fallback) => db.t(id) || fallback;
const POP_MAX = 10000,
  POP_STEP = 50;
const shooterPref = on => {
  globalThis.shooterMode = on;
  try {
    localStorage.setItem('swr-shooter', on ? '1' : '0');
  } catch {}
  const box = document.getElementById('optShooter');
  if (box) box.checked = on;
};

import { painterEntry } from './painter-entry.js';

export async function openLobby(args) {
  const model = skirmishSetup(args);
  if (!args.profiles) return openStaging(model, { ...args, cancel: args.cancel || (() => leaveTo('./')) });
  return showSkirmishBriefing(model, {
    ...args,
    cancel: args.cancel || (() => leaveTo('./')),
    editor: callbacks => openStaging(model, { ...args, ...callbacks })
  });
}

async function openStaging(model, { factions, start, audio, cancel, profiles }) {
  const dlg = await openDialog('IDD_SKIRMISH_STAGING_DIALOG', { modal: false });
  if (!dlg) return false;
  try {
    return bindStaging(dlg, model, { factions, start, audio, cancel, matchOnly: !!profiles });
  } catch (error) {
    dlg.close();
    throw error;
  }
}

function bindStaging(dlg, model, { factions, start, audio, cancel, matchOnly }) {
  const { st, slots, official, customMaps, mapRows, pick, teamsUsed, resolveMaps, syncTeams, remember } = model;
  painterEntry(dlg.veil, () => model.seatFaction(slots.find(s => s.kind === 'you')));
  const fLabel = f => T(db.faction(f).str('Text_ID'), f);
  let note = null;
  const mapOpts = () => ({ teams: Math.max(2, teamsUsed().length) });
  const viewKey = m => (isDynamic(m) ? `${m}|${mapOpts().teams}` : m);

  dlg.setText('IDC_SCENARIO_DESCRIPTION_TEXT_BOX', '');
  const type = dlg.def.controls.find(c => c.id === 'IDC_GAME_TYPE_LIST'),
    mapList = dlg.def.controls.find(c => c.id === 'IDC_STAGING_MAP_LIST');
  if (type && mapList) {
    const resize = (box, w0, h0, w1, h1) => {
      box.style.width = w1 + 'px';
      box.style.height = h1 + 'px';
      box.style.overflow = 'hidden';
      for (const part of box.children) {
        const x = parseFloat(part.style.left),
          y = parseFloat(part.style.top),
          w = parseFloat(part.style.width),
          h = parseFloat(part.style.height);
        if (x > w0 / 2) part.style.left = x - (w0 - w1) + 'px';
        else if (w > w0 / 2) part.style.width = w - (w0 - w1) + 'px';
        if (y > h0 / 2) part.style.top = y - (h0 - h1) + 'px';
        else if (h > h0 / 2) part.style.height = h - (h0 - h1) + 'px';
      }
    };
    resize(dlg.ctl('IDC_GAME_TYPE_LIST'), type.w, type.h, mapList.w, Math.min(type.h, mapList.y - 4 - type.y));
    for (const id of ['IDC_SELECT_OFFICIAL_MAPS', 'IDC_SELECT_CUSTOM_MAPS']) {
      const c = dlg.def.controls.find(x => x.id === id);
      if (c && c.x + c.w > mapList.x - 8) dlg.ctl(id).style.width = mapList.x - 8 - c.x + 'px';
    }
  }
  const previews = new Map();
  const starts = startMarks(dlg, team => `${T('TEXT_TEAM', 'Team')} ${team + 1}`);
  const markStarts = () => {
    const m = st.mapFile,
      used = teamsUsed();
    return starts.show(m, viewKey(m), mapOpts(), team => model.teamFaction(isDynamic(m) ? (used[team] ?? team) : team));
  };
  const preview = async m => {
    const key = viewKey(m);
    seeds.update();
    if (!previews.has(key))
      previews.set(
        key,
        loadMapPreview(m, mapOpts())
          .then(cv => (cv ? cv.toDataURL() : ''))
          .catch(e => (console.warn('map preview', e), ''))
      );
    const url = await previews.get(key);
    if (viewKey(st.mapFile) === key) {
      dlg.setImage('IDC_IMAGE', url);
      markStarts();
    }
  };
  let shown = null;
  const freshPreview = () => {
    if (st.mapFile && shown !== viewKey(st.mapFile)) {
      shown = viewKey(st.mapFile);
      preview(st.mapFile);
    }
  };
  const seeds = seedBar({
    get: () => st.mapFile,
    set: next => {
      pick(next);
      fillMaps();
    },
    sound: () => audio?.play?.('GUI_Button_Press_2_SFX'),
    compact: true
  });
  dockSeedBar(dlg, seeds);
  const forceDynamic = () => {
    if (!model.forceDynamic()) return false;
    if (note) note.textContent = 'Battles with more than two teams are played on a Dynamic Map.';
    return true;
  };
  const fillMaps = () => {
    const list = resolveMaps();
    dlg.enable('IDC_SELECT_OFFICIAL_MAPS', !!official[st.mode].length);
    if (!st.mapFile) {
      starts.clear();
      dlg.setImage('IDC_IMAGE', '');
    }
    dlg
      .list('IDC_STAGING_MAP_LIST', mapRows(list), row => {
        pick(row.key);
        if (forceDynamic()) {
          queueMicrotask(fillMaps);
          return;
        }
        if (note && !isDynamic(row.key)) note.textContent = '';
        freshPreview();
      })
      .select(st.mapFile);
    shown = null;
    freshPreview();
    const picked = dlg.ctl('IDC_STAGING_MAP_LIST').querySelector('.sel');
    if (picked) picked.scrollIntoView({ block: 'nearest' });
  };
  const kinds = [{ key: 'space', label: T('TEXT_GAME_TYPE_TEAM_SPACE', 'Space') }];
  if (official.land.length || customMaps.land.length) kinds.push({ key: 'land', label: T('TEXT_GAME_TYPE_TEAM_LAND', 'Land') });
  dlg
    .list('IDC_GAME_TYPE_LIST', kinds, row => {
      if (st.mode !== row.key) {
        st.mode = row.key;
        fillMaps();
        refresh();
      }
    })
    .select(st.mode);
  fillMaps();
  const showCustom = on => {
    if (st.custom !== on) {
      st.custom = on;
      fillMaps();
    }
  };
  dlg.on('IDC_SELECT_OFFICIAL_MAPS', () => showCustom(false));
  dlg.on('IDC_SELECT_CUSTOM_MAPS', () => showCustom(true));

  const who = [
    ['closed', T('TEXT_CLOSED', 'Closed')],
    ['easy', T('TEXT_EASY_AI_PLAYER', 'Easy AI')],
    ['medium', T('TEXT_MEDIUM_AI_PLAYER', 'Medium AI')],
    ['hard', T('TEXT_HARD_AI_PLAYER', 'Hard AI')]
  ];
  const colours = (r, s) => {
    const own = factionColor(model.seatFaction(s));
    const custom = /^#[0-9a-f]{6}$/i.test(s.color) && s.color;
    const list = [...new Set([own, custom, ...PALETTE].filter(Boolean).map(c => c.toLowerCase()))];
    dlg.combo(
      `IDC_PLAYER_COLOR_${r}`,
      list.map(c => ({ value: c, label: c, color: c })),
      list.includes(String(s.color).toLowerCase()) ? String(s.color).toLowerCase() : list[0],
      v => {
        s.color = v;
        s.auto = false;
      }
    );
  };
  const row = r => {
    const s = slots[win.off + r];
    for (const k of ['NAME', 'FACTION', 'COLOR', 'TEAM']) dlg.show(`IDC_PLAYER_${k}_${r}`, !!s);
    if (!s) return;
    const watching = s.team === SPECTATOR_TEAM;
    const teamOptions = [
      ...(s.kind === 'you' ? [{ value: SPECTATOR_TEAM, label: T('TEXT_SPECTATOR', 'Spectator') }] : []),
      ...[...Array(st.mode === 'space' ? MAX_TEAMS : 2).keys()].map(t => ({ value: t, label: `${T('TEXT_TEAM', 'Team')} ${t + 1}` }))
    ];
    if (s.kind === 'you') dlg.combo(`IDC_PLAYER_NAME_${r}`, [{ value: 'you', label: T('TEXT_PLAYER', 'Player') }], 'you', () => {});
    else
      dlg.combo(
        `IDC_PLAYER_NAME_${r}`,
        who.map(([value, label]) => ({ value, label })),
        s.kind,
        v => {
          s.kind = v;
          refresh();
        }
      );
    if (!watching) {
      dlg.combo(
        `IDC_PLAYER_FACTION_${r}`,
        [...new Set([...factions,model.seatFaction(s)])].map(f => ({value:f,label:factions.includes(f)?fLabel(f):model.profileOf(s)?.facts[model.sourceOf(s).faction]?.label || model.sourceOf(s).faction})),
        model.seatFaction(s),
        v => {
          if (factions.includes(v)) { delete s.rosterPick; s.skirmishFaction = v; }
          refresh();
        }
      );
      colours(r, s);
    }
    dlg.combo(`IDC_PLAYER_TEAM_${r}`, teamOptions, s.team, v => {
      s.team = +v;
      refresh();
    });
    const open = s.kind !== 'closed';
    dlg.enable(`IDC_PLAYER_NAME_${r}`, true);
    for (const k of ['FACTION', 'COLOR', 'TEAM']) dlg.enable(`IDC_PLAYER_${k}_${r}`, open);
    for (const k of ['FACTION', 'COLOR']) dlg.show(`IDC_PLAYER_${k}_${r}`, !watching);
  };
  const rows = () => {
    for (let r = 0; r < win.rows; r++) row(r);
  };
  const refresh = () => {
    syncTeams();
    rows();
    win.update();
    if (forceDynamic()) fillMaps();
    else if (isDynamic(st.mapFile)) freshPreview();
    markStarts();
  };
  const win = slotWindow(dlg, {
    count: () => slots.length,
    draw: rows,
    like: 'IDC_SELECT_OPTIONS',
    add: () => {
      const i = slots.length;
      slots.push({ kind: 'closed', team: i % 2, color: PALETTE[i % PALETTE.length], auto: true });
      refresh();
    }
  });
  refresh();

  const menus = new Menus({
    over: true,
    paused: false,
    audio,
    message: text => {
      note.textContent = text;
    }
  });
  note = document.createElement('div');
  note.className = 'dlg-txt';
  note.style.cssText = 'position:absolute;left:230px;top:362px;width:480px;text-align:center;color:#ff6a5a;font-size:11px';
  dlg.el.appendChild(note);
  const startBtn = dlg.def.controls.find(c => c.id === 'IDC_SKIRMISH_START_GAME_BUTTON'),
    opt = dlg.def.controls.find(c => c.id === 'IDC_SELECT_OPTIONS');
  menus.extra(
    dlg,
    'IDC_SELECT_OPTIONS',
    T('TEXT_BUTTON_LOAD_GAME', 'Load Game'),
    opt.x + opt.w + 12,
    opt.y,
    startBtn.x - opt.x - opt.w - 24,
    () => menus.load()
  );

  dlg.on('IDC_SELECT_OPTIONS', async () => {
    if (await advancedOptions(st, matchOnly)) remember();
  });
  dlg.on('IDC_CANCEL_BUTTON', () => {
    remember();
    dlg.close();
    cancel();
  });
  dlg.on('IDC_SKIRMISH_START_GAME_BUTTON', () => {
    if (teamsUsed().length < 2) {
      note.textContent = 'At least two teams need a player.';
      return;
    }
    if (forceDynamic()) {
      fillMaps();
      return;
    }
    const setup = model.setup();
    if (!setup) {note.textContent=model.rosterError() || 'Choose a supported battlefield.';return;}
    remember();
    dlg.close();
    start(setup);
  });
  return true;
}

export async function advancedOptions(st, matchOnly = false) {
  const dlg = await openDialog('IDD_INTERNET_STAGING_DIALOG_ADVANCED_SKIRMISH_OPTIONS');
  if (!dlg) return;
  if (typeof st.shooter !== 'boolean') st.shooter = !!globalThis.shooterMode;
  const was = { ...st };
  const LO = 2000,
    HI = 15000,
    toV = c => (c - LO) / (HI - LO),
    toC = v => Math.round((LO + v * (HI - LO)) / 500) * 500;
  const show = () => {
    dlg.slider('IDC_SKIRMISH_CREDITS_SLIDER', toV(st.credits), v => {
      st.credits = toC(v);
      dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', st.credits.toLocaleString());
    });
    dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', st.credits.toLocaleString());
    fog.classList.toggle('on', !!st.fog);
    dlg.slider(
      'IDC_POP_CAP_SLIDER',
      Math.min(POP_MAX, st.popCap) / POP_MAX,
      v => {
        st.popCap = Math.round((v * POP_MAX) / POP_STEP) * POP_STEP;
        popText();
      },
      POP_MAX / POP_STEP + 1
    );
    popText();
  };
  for (const id of ['IDC_ALLOW_HEROES', 'IDC_ALLOW_STARTING_UNIT_PURCHASE', 'IDC_ALLOW_SUPER_WEAPONS']) dlg.enable(id, false);
  dlg.check('IDC_PRE_BUILT_BASE', st.preBuilt, v => {
    st.preBuilt = v;
  });
  dlg.check('IDC_ALLOW_HEROES', true, () => {});
  dlg.setText('IDC_WIN_CONDITION_TEXT', T('TEXT_POP_CAP', 'Unit Max'));
  const box = id => {
    const s = dlg.ctl(id)?.style;
    return s && { x: parseFloat(s.left), y: parseFloat(s.top), h: parseFloat(s.height) };
  };
  const combo = box('IDC_WIN_CONDITION_COMBO'),
    credits = box('IDC_SKIRMISH_CREDITS_SLIDER'),
    creditsText = box('IDC_SKIRMISH_CREDITS_VALUE');
  if (combo && credits && creditsText) {
    const y = combo.y + (combo.h - credits.h) / 2;
    dlg.show('IDC_WIN_CONDITION_COMBO', false);
    dlg.clone('IDC_SKIRMISH_CREDITS_SLIDER', 'IDC_POP_CAP_SLIDER', combo.x, y);
    dlg.clone('IDC_SKIRMISH_CREDITS_VALUE', 'IDC_POP_CAP_VALUE', creditsText.x, y + creditsText.y - credits.y);
  }
  const popText = () => dlg.setText('IDC_POP_CAP_VALUE', st.popCap ? st.popCap.toLocaleString() : T('TEXT_DEFAULT', 'Default'));
  const like = dlg.def.controls.find(c => c.id === 'IDC_ALLOW_HEROES');
  const fog = dlg.ctl('IDC_ALLOW_HEROES').cloneNode(true);
  fog.classList.remove('off', 'on');
  fog.style.left = like.x + 300 + 'px';
  fog.style.width = '220px';
  fog.lastChild.textContent = 'Fog of War';
  fog.onclick = () => {
    st.fog = !st.fog;
    fog.classList.toggle('on', st.fog);
  };
  dlg.el.appendChild(fog);
  const gun = fog.cloneNode(true);
  gun.style.top = parseFloat(fog.style.top || like.y) + 30 + 'px';
  gun.lastChild.textContent = 'Battlefront mode (land)';
  gun.classList.toggle('on', !!st.shooter);
  gun.onclick = () => {
    st.shooter = !st.shooter;
    gun.classList.toggle('on', st.shooter);
  };
  dlg.el.appendChild(gun);
  show();
  return new Promise(done => {
    dlg.on('IDC_BUTTON_ACCEPT', () => {
      if (!matchOnly) shooterPref(!!st.shooter);
      else if (st.shooter !== was.shooter) st.boardShooterChanged = true;
      dlg.close();
      done(true);
    });
    dlg.on('IDC_CANCEL_BUTTON', () => {
      Object.assign(st, was);
      dlg.close();
      done(false);
    });
    dlg.on('IDC_DEFAULTS_BUTTON', () => {
      st.credits = 6000;
      st.popCap = 0;
      st.fog = true;
      st.shooter = false;
      gun.classList.toggle('on', false);
      show();
    });
  });
}
