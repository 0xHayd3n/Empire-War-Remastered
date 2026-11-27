import { db, factionColor } from '../gamedata.js';
import { alternateShade } from './commandgroups.js';
import { iconUrl } from '../icons.js';
import { loadMap, mapTitle, mapHeader, loadMapPreview } from '../ted.js';
import { PALETTE } from './slotrows.js';
import { DYNAMIC_SIZES, isDynamic, dynamicSize, resizeDynamic, seedBar, dynamicTurn } from './dynamicmap.js';
import {
  INSTANT_MAX_TEAMS,
  INSTANT_BUDGET,
  INSTANT_BUDGET_MIN,
  INSTANT_BUDGET_MAX,
  CLASS_GROUPS,
  instantRoster,
  armyCost,
  canAdd,
  randomArmy,
  entryPoints
} from './instantbattle.js';
import { SPECTATOR_TEAM } from './skirmishsetup.js';
import { operationSetup, field, action } from './operationsetup.js';
import { sidebarTabs } from './universalsidebartabs.js';
import { battlefieldAtlas } from './operationatlas.js';
import { groundForces } from './planetbattle.js';
import { soloLibrary } from './solooperationlibrary.js';
import { instantForces, packArmy, unpackArmy } from './instantforces.js';
import { guestRefs } from './tacticalroster.js';
import { paintCrest } from './spectator.js';
import { activeLivery } from './liveries.js';
import { readyPaint, launchPaint } from './liverytransport.js';
import { showPainter } from './painter-entry.js';
import { presetKey, readPresets, readCards, planCard, checkFleet } from './fleetpresets.js';
import { armoryStyle } from './armorystyle.js';
import { stagingInvite } from './staginginvite.js';

import {INSTANT_DRAFT, readBattleDraft, saveBattleDraft} from './battledrafts.js';
const AI_KINDS = [
  ['easy', 'Easy AI'],
  ['medium', 'Medium AI'],
  ['hard', 'Hard AI']
];
const OPEN = ['open', 'Open'];
const FILTERS = [{ key: 'all', label: 'All' }, ...CLASS_GROUPS, { key: 'hero', label: 'Heroes' }];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const money = n => '$' + Math.round(n).toLocaleString();
const clampBudget = n => Math.max(INSTANT_BUDGET_MIN, Math.min(INSTANT_BUDGET_MAX, Math.round(+n || 0)));
const sound = name => window.game?.audio?.play(name);
const isAI = k => AI_KINDS.some(a => a[0] === k);
const watching = p => p.team === SPECTATOR_TEAM;
const SPECTATOR_COLOR = '#c3ab02';


export async function openInstantBattle({ maps, landMaps = [], factions, audio, cancel, start, profiles, mp = null }) {
  if (!maps.length || !factions.length) return false;
  const net = mp?.session || null,
    host = !mp || mp.host,
    myId = () => (net ? net.id : null);
  let editing = false, atlas, battle;
  const backToMap = () => editing ? setEditor(false) : close(false);
  const board = !mp && profiles && operationSetup({ title: 'Instant Battle', library: 'Planets', back: backToMap, launch, profiles });
  const sources = board && instantForces((await soloLibrary()).profiles,board.operation.current,factions);
  const nativeLabel = f => db.t(db.faction(f)?.str('Text_ID')) || f;
  const fLabel = (f, domain='space') => sources?.get?.(domain,f)?.label || nativeLabel(f);
  const options = d => sources ? sources.options(d) : factions.map(f=>[f,nativeLabel(f)]);
  const transferred=board?.operation?.selection?.draft;
  const saved = transferred?.kind==='instant' ? transferred : readBattleDraft(INSTANT_DRAFT);
  const key = mp ? null : await presetKey();
  let libraryWarning = '';
  const warn = message => {
    libraryWarning = message;
  };
  const blueprints = key ? readPresets(key, warn) : [],
    cards = key ? readCards(key, warn) : [];
  const st = {
    mapFile: maps.includes(saved.mapFile) || isDynamic(saved.mapFile) ? saved.mapFile : maps.find(m => /KUAT/i.test(m)) || maps[0],
    fog: typeof saved.fog === 'boolean' ? saved.fog : false,
    budget: Number.isFinite(saved.budget) ? clampBudget(saved.budget) : INSTANT_BUDGET,
    turn: Number.isFinite(saved.turn) ? saved.turn : Math.random() * Math.PI * 2
  };
  const view = { filter: 'all', sel: 0 };
  const fresh = (kind, team, faction, extra = {}) => ({
    kind,
    team,
    faction,
    budget: st.budget,
    army: [],
    color: null,
    ...extra
  });
  const rosterOf = p => sources && p.faction.startsWith('UXF_') ? sources.roster(p.faction) : instantRoster(p.faction);
  const mine = p => (net ? p.kind === 'human' && p.peer === myId() : p.kind === 'you');
  const canEdit = p => (!net ? true : host ? mine(p) || p.kind !== 'human' : mine(p));
  const prune = p => {
    const roster = rosterOf(p),
      names = new Set(roster.map(r => r.name)),
      seen = new Set();
    p.army = p.army.filter(n => typeof n === 'string' && names.has(n));
    p.army = p.army.filter(n => {
      if (!roster.find(x => x.name === n)?.hero) return true;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    while (armyCost(roster, p.army) > p.budget) p.army.pop();
  };

  let players = [];
  const foes = () => {
    const me = factions.find(f => /^EMPIRE$/i.test(f)) || factions[0];
    return [me, factions.find(f => /^REBEL$/i.test(f) && f !== me) || factions.find(f => f !== me) || me];
  };
  if (mp && !host) {
    st.mapFile = mp.initial.st.mapFile;
    Object.assign(st, mp.initial.st);
    players = mp.initial.players;
  } else if (mp?.resume) {
    Object.assign(st, mp.resume.st);
    players = mp.resume.players.map(p =>
      p.kind === 'human' && p.peer !== 0 ? { ...p, kind: 'open', peer: undefined, was: p.name, name: '', ready: false } : p
    );
  } else if (mp) {
    const [me, foe] = foes();
    players = [fresh('human', 0, me, { peer: 0, name: mp.name, ready: true }), fresh('open', 1, foe, { ready: false })];
    players[0].army = randomArmy(instantRoster(me), st.budget);
  } else {
    if (Array.isArray(saved.players) && saved.players.length && saved.players[0]?.kind === 'you')
      players = saved.players.map((p, i) => ({
        kind: i === 0 ? 'you' : isAI(p.kind) ? p.kind : 'medium',
        team: i === 0 && p.team === SPECTATOR_TEAM ? SPECTATOR_TEAM : Math.max(0, Math.min(INSTANT_MAX_TEAMS - 1, p.team | 0)),
        faction: sources && p.source ? sources.resolve('space',p.source) || 'Unavailable' : factions.includes(p.faction) ? p.faction : factions[0],
        ...(sources && p.source ? {source:p.source} : {}),
        budget: clampBudget(p.budget ?? st.budget),
        army: transferred?.kind==='instant' && p.counts ? unpackArmy(p.counts) : Array.isArray(p.army) ? p.army.filter(n => typeof n === 'string') : [],
        color: typeof p.color === 'string' ? p.color : null
      }));
    if (players.length < 2) {
      const [me, foe] = foes();
      players = [fresh('you', 0, me), fresh('medium', 1, foe)];
      for (const p of players) p.army = randomArmy(instantRoster(p.faction), p.budget);
    }
  }
  // Resolve only the selected immutable kits. Do not install definitions while editing.
  if (sources) await Promise.all(players.filter(p=>p.source).map(async p=>{
    try {await sources.load('space',p.faction); if (p.army.some(n=>!rosterOf(p).some(r=>r.name===n))) {p.army=[];p.notice='This field uses different products. Outfit this fleet again.';}}
    catch(e){p.problem=e.message;}
  }));
  const mixed=()=>!!sources && players.some(p=>sources.guest('space',p.faction));
  const setTeam = (p, team) => {
    p.team = team;
    if (watching(p) || mixed()) return;
    const mate = players.find(q => q !== p && q.team === p.team);
    if (mate && mate.faction !== p.faction) {
      p.faction = mate.faction;
      p.source = mate.source;
      prune(p);
    }
  };
  const unify = (from, faction) => {
    for (const p of players)
      if (!watching(from) && p.team === from.team && p.faction !== faction) {
        p.faction = faction;
        p.source = from.source;
        prune(p);
      }
    from.faction = faction;
    prune(from);
  };
  if (host && !mixed())
    for (const p of players) {
      const mate = players.find(q => q.team === p.team);
      if (mate !== p && !watching(p) && !p.problem && !mate.problem) {p.faction = mate.faction; p.source = mate.source;}
      prune(p);
    }
  view.sel = Math.max(0, players.findIndex(mine));

  const rgb = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
  const near = (a, b) => {
    const x = rgb(a),
      y = rgb(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 90;
  };
  const colors = () => {
    const used = players.filter(q => q.color).map(q => q.color.toLowerCase());
    const free = c => !used.some(u => near(u, c));
    return players.map(p => {
      if (watching(p)) return SPECTATOR_COLOR;
      if (p.color) return p.color;
      const own = factionColor(p.faction);
      // Similar shades can be intentional for different Universal rosters.
      // Keep each exact base unless another participant already has it.
      const available = db.universalProfile ? c => !used.includes(c) : free;
      const c = (
        (own && available(own) && own) || (db.universalProfile && alternateShade(own, available)) ||
        PALETTE.find(free) || PALETTE.find(x => !used.includes(x)) || PALETTE[0]
      ).toLowerCase();
      used.push(c);
      return c;
    });
  };
  const colorOf = (p, i) => colors()[i];
  const draft = (travel=false) => ({
      mapFile: st.mapFile,
      fog: st.fog,
      budget: st.budget,
      turn: st.turn,
      groundSources: groundPicks.map(p=>p.source||(travel?sources?.get('land',p.faction)?.ref:null)),
      groundCompanies: groundPicks.map(p=>p.company || null),
      players: players.map(({ kind, team, faction, budget, army, color, source }) => ({ kind, team, faction, budget, color, source:source||(travel?sources?.get('space',faction)?.ref:undefined), ...(travel?{counts:packArmy(army)}:{army}) }))
    });
  const remember = () => { if (!mp) saveBattleDraft(INSTANT_DRAFT,draft()); };

  const humans = () => players.filter(p => p.kind === 'human');
  const listing = () => {
    if (!net || !host || mp.kind === 'lan') return;
    net.setListing({
      name: mp.gameName,
      host: mp.name,
      map: st.mapFile,
      mode: 'instant',
      locked: !!mp.password,
      players: humans().length,
      slots: players.filter(p => p.kind === 'human' || p.kind === 'open').length,
      version: mp.version,
      mod: mp.data
    });
  };
  const publish = () => {
    if (!net || !host) return;
    net.broadcast({ k: 'state', ib: { st: { ...st }, players } });
    listing();
  };
  const unreadyAll = () => {
    for (const p of players) if (p.kind === 'human' && p.peer !== 0) p.ready = false;
  };
  const changed = (p = null, shared = false) => {
    if (net && host) {
      if (shared) unreadyAll();
      else if (p && p.kind === 'human' && p.peer !== 0) p.ready = false;
      publish();
    } else if (net && p && mine(p)) {
      p.ready = false;
      net.send(0, { k: 'fleet', fleet: { faction: p.faction, team: p.team, color: p.color, army: p.army } });
    }
    draw();
  };

  const groundPicks = foes().map((f,i)=>{const source=sources&&saved.groundSources?.[i];return source?{faction:sources.resolve('land',source)||'Unavailable',source,company:typeof saved.groundCompanies?.[i]==='string'?saved.groundCompanies[i]:''}:{faction:f};});
  if(sources)await Promise.all(groundPicks.filter(p=>p.source).map(async p=>{try{await sources.load('land',p.faction)}catch(e){p.problem=e.message;}}));
  const groundArmy = p => sources?.guest?.('land',p.faction) ? sources.ground(p.faction,p.company) : groundForces(p.faction);
  const blocked = list => list.find(p=>p.pending || p.problem);
  async function choose(p,domain,value) {
    const c=sources.get(domain,value); if(!c)return;
    const token={};Object.assign(p,{pending:token,source:c.ref,faction:value,problem:'',notice:''});
    // Native-only editing keeps the existing prune-on-change behavior.
    const startingKit = domain === 'space' && !c.home;
    if(startingKit)p.army=[];
    if(domain==='land')p.company='';
    draw();
    try {await sources.load(domain,value); if(p.pending!==token||ended)return;
      if(domain==='space'){
        if(!mixed())unify(p,value);
        if(startingKit){
          let left=p.budget;
          p.army=[];
          for(const r of [...rosterOf(p)].sort((a,b)=>a.cost-b.cost)){
            if(r.cost>left || p.army.length===2)break;
            p.army.push(r.name);left-=r.cost;
          }
        } else {
          prune(p);
          // Switching suppliers can invalidate every old product. Start the
          // newly chosen native fleet within budget, just like a fresh seat.
          if (!p.army.length) p.army = randomArmy(rosterOf(p), p.budget);
        }
      }
    }catch(e){if(p.pending===token)p.problem=e.message;}
    finally{if(p.pending===token&&!ended){p.pending=null;changed(p);}}
  }
  if(board){board.operation.travel=()=>({...draft(true),kind:'instant'});
    board.operation.beforeTravel=()=>![...players,...groundPicks].some(p=>p.pending);}
  const root = board ? board.root : el('div');
  root.id = 'instantBattle';
  const panel = el('div', 'ib-panel');
  root.appendChild(panel);

  const button = (label, fn, cls = '') => {
    const b = el('button', 'ib-btn ' + cls, label);
    b.type = 'button';
    b.addEventListener('mouseenter', () => sound('GUI_Highlight_Mouse_Over'));
    b.onclick = e => {
      e.stopPropagation();
      if (b.disabled) return;
      sound('GUI_Button_Press_2_SFX');
      fn(e);
    };
    return b;
  };
  const select = (options, value, fn, cls = '') => {
    const s = el('select', 'ib-select ' + cls);
    for (const [v, text] of options) {
      const o = el('option', '', text);
      o.value = v;
      s.appendChild(o);
    }
    s.value = value;
    s.onclick = e => e.stopPropagation();
    s.onchange = () => {
      sound('GUI_Button_Press_2_SFX');
      fn(s.value);
    };
    return s;
  };

  const head = el('div', 'ib-head');
  const titleBox = el('div', 'ib-title');
  titleBox.append(
    el('h1', '', net ? 'Instant Battle · Multiplayer' : board ? 'Fleet outfitting' : 'Instant Battle'),
    el(
      'p',
      '',
      net
        ? mp.gameName || 'Pick your fleet and wait for the host to start.'
        : 'Pick your fleets, choose the field and fight to the last ship.'
    )
  );
  const budgetBox = el('label', 'ib-budget');
  budgetBox.append(el('span', '', 'Starting budget'));
  const budgetIn = el('input', 'ib-num');
  budgetIn.type = 'number';
  budgetIn.min = INSTANT_BUDGET_MIN;
  budgetIn.max = INSTANT_BUDGET_MAX;
  budgetIn.step = 500;
  budgetIn.value = st.budget;
  const applyAll = button('Apply to all', () => {
    st.budget = clampBudget(budgetIn.value);
    budgetIn.value = st.budget;
    for (const p of players) {
      p.budget = st.budget;
      prune(p);
    }
    changed(null, true);
  });
  budgetIn.onchange = () => {
    st.budget = clampBudget(budgetIn.value);
    budgetIn.value = st.budget;
  };
  budgetBox.append(budgetIn, applyAll);
  head.append(titleBox, budgetBox);
  if (net && host) st.invitable = !mp.password;
  const invite = net && stagingInvite(head, net, mp.kind, () => st.invitable && players.some(p => p.kind === 'open'), text => say('', text));

  const body = el('div', 'ib-body');
  const fleetsCol = el('section', 'ib-col ib-fleets');
  const armyCol = el('section', 'ib-col ib-army');
  const mapCol = el('section', 'ib-col ib-map');
  body.append(fleetsCol, armyCol, mapCol);

  const foot = el('div', 'ib-foot');
  const error = el('div', 'ib-error');
  error.setAttribute('role', 'status');
  const back = button(board ? 'Battlefield' : 'Back', backToMap, 'ib-wide');
  const go = button(host ? 'Start Battle' : 'Ready', () => (host ? launch() : toggleReady()), 'ib-wide ib-go');
  foot.append(back, error, go);
  panel.append(head, body, foot);

  const fleetsHead = el('div', 'ib-colhead');
  fleetsHead.append(el('h2', '', 'Fleets'));
  const fleetTools = el('div', 'ib-tools');
  const addBtn = button('Add AI', () => {
    const taken = new Set(players.map(p => p.team));
    let team = 0;
    while (taken.has(team) && team < INSTANT_MAX_TEAMS - 1) team++;
    const others = factions.filter(f => !players.some(p => p.faction === f));
    const mate = players.find(p => p.team === team);
    const p = fresh('medium', team, mate ? mate.faction : others[0] || factions[players.length % factions.length]);
    p.army = randomArmy(rosterOf(p), p.budget);
    players.push(p);
    view.sel = players.length - 1;
    changed(null, true);
  });
  const rollAll = button('Randomize All', () => {
    for (const p of players) if (canEdit(p) && p.kind !== 'open' && !watching(p)) p.army = randomArmy(rosterOf(p), p.budget);
    changed(null, false);
  });
  const painter = button('Army Painter', async () => {
    const me = players.find(mine);
    if (!me) return;
    if (net && !host && me.ready) toggleReady();
    await showPainter(root, me.faction);
  });
  fleetTools.append(addBtn, rollAll, painter);
  fleetsHead.append(fleetTools);
  const fleetList = el('div', 'ib-list ib-fleetlist');
  const teamNote = el('div', 'ib-note');
  fleetsCol.append(fleetsHead, fleetList, teamNote);

  const chat = el('div', 'ib-chat');
  const chatLog = el('div', 'ib-chatlog');
  const chatIn = el('input', 'ib-num ib-chatin');
  chatIn.placeholder = 'Say something…';
  chatIn.maxLength = 200;
  chat.append(chatLog, chatIn);
  if (net) fleetsCol.append(chat);
  const say = (who, text, link = null) => {
    const line = el('div', 'ib-chatline' + (link ? ' link' : ''));
    if (who) line.append(el('b', '', who + ': '));
    line.append(document.createTextNode(text));
    if (link)
      line.onclick = () => {
        const done = ok => say('', ok ? 'Copied: ' + link : 'Copy it by hand: ' + link);
        if (navigator.clipboard?.writeText)
          navigator.clipboard.writeText(link).then(
            () => done(true),
            () => done(false)
          );
        else done(false);
      };
    chatLog.appendChild(line);
    while (chatLog.childElementCount > 100) chatLog.firstChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  };
  chatIn.onkeydown = e => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const text = chatIn.value.trim();
    chatIn.value = '';
    if (!text) return;
    if (host) {
      say(mp.name, text);
      net.broadcast({ k: 'chat', name: mp.name, text });
    } else net.send(0, { k: 'chat', text });
  };

  const armyHead = el('div', 'ib-colhead');
  const armyTitle = el('h2');
  const armyTools = el('div', 'ib-tools');
  const rollOne = button('Random', () => {
    const p = players[view.sel];
    p.army = randomArmy(rosterOf(p), p.budget);
    changed(p);
  });
  const clearOne = button('Clear', () => {
    const p = players[view.sel];
    p.army = [];
    changed(p);
  });
  armyTools.append(rollOne, clearOne);
  armyHead.append(armyTitle, armyTools);
  const meter = el('div', 'ib-meter');
  const meterFill = el('div', 'ib-meter-fill');
  const meterText = el('div', 'ib-meter-text');
  meter.append(meterFill, meterText);
  const chips = el('div', 'ib-chips');
  const catalog = el('div', 'ib-list ib-catalog');
  const orders = el('div', 'ib-saved-orders'),
    orderFeedback = el('div', 'ib-preset-message');
  orderFeedback.setAttribute('role', 'status');
  armyCol.append(armyHead, meter);
  if (blueprints.length || cards.length || libraryWarning) {
    armoryStyle();
    armyCol.append(orders, orderFeedback);
  }
  armyCol.append(chips, catalog);

  const mapHead = el('div', 'ib-colhead');
  mapHead.append(el('h2', '', 'Battlefield'));
  const preview = el('div', 'ib-preview');
  const previewImg = el('div', 'ib-preview-img');
  const previewMarks = el('div', 'ib-preview-marks');
  preview.append(previewImg, previewMarks);
  const mapName = el('div', 'ib-mapname');
  const mapOpts = el('div', 'ib-tools ib-mapopts');
  const fogBtn = button('', () => {
    st.fog = !st.fog;
    drawOpts();
    changed(null, true);
  });
  const spinBtn = button('Shuffle Entry', () => {
    if (isDynamic(st.mapFile)) {
      const k = Math.max(2, teamsUsed().length);
      st.turn = entryTurn() + ((1 + Math.floor(Math.random() * (k - 1))) * Math.PI * 2) / k;
    } else st.turn = Math.random() * Math.PI * 2;
    changed(null, true);
  });
  mapOpts.append(fogBtn, spinBtn);
  const dynOpts = el('div', 'ib-tools ib-mapopts ib-dynopts');
  const sizeBtns = DYNAMIC_SIZES.map(s =>
    button(s.label, () => {
      if (!isDynamic(st.mapFile) || dynamicSize(st.mapFile).key === s.key) return;
      st.mapFile = resizeDynamic(s.key);
      changed(null, true);
    })
  );
  const seeds = seedBar({
    get: () => st.mapFile,
    set: next => {
      st.mapFile = next;
      changed(null, true);
    },
    readonly: () => !host,
    sound: () => sound('GUI_Button_Press_2_SFX')
  });
  dynOpts.append(...sizeBtns);
  const mapList = el('div', 'ib-list ib-maplist');
  let editFleets, summary, ground, battlefield, tabs;
  const companyFields=[];
  mapCol.append(mapHead, preview, mapName, mapOpts, dynOpts, seeds.el, mapList);
  if (board) {
    panel.classList.add('ib-editor');
    panel.hidden = true;
    tabs=sidebarTabs('instant','Instant Battle setup',['Battlefield','Forces'],i=>tabs.select(i));
    tabs.panels[0].classList.add('op-battlefields');
    tabs.panels[0].append(board.list.parentElement);
    tabs.panels[1].append(board.detail);
    board.body.append(tabs.bar,...tabs.panels);
    battlefield = el('strong', 'op-instant-field');
    board.foot.prepend(battlefield);
    ground = el('div', 'op-fields');
    for (const [i,p] of groundPicks.entries()) {
      ground.append(field(i ? 'Opponent' : 'Your faction', options('land'), p.faction, v=>choose(p,'land',v)));
      const label=i ? 'Opponent company' : 'Your company';
      const wrap=field(label, [], '', v=>{p.company=v;changed();});
      wrap.querySelector('select').setAttribute('aria-label',label);
      companyFields.push(wrap);ground.append(wrap);
    }
    summary = el('p', 'op-description');
    editFleets = action('Edit fleets', () => setEditor(true));
    board.detail.append(ground, summary, editFleets);
  }
  function setEditor(open) {
    if (!board) return;
    editing = open;
    panel.hidden = !open;
    board.panel.hidden = open;
    if (open) draw();
    if (!open) atlas?.refresh();
    (open ? back : editFleets).focus({ preventScroll: true });
  }
  const drawOpts = () => {
    fogBtn.textContent = st.fog ? 'Fog of War: On' : 'Fog of War: Off';
    fogBtn.classList.toggle('on', st.fog);
    const dyn = isDynamic(st.mapFile);
    dynOpts.classList.toggle('hidden', !dyn);
    seeds.update();
    sizeBtns.forEach((b, i) => b.classList.toggle('on', dyn && dynamicSize(st.mapFile).key === DYNAMIC_SIZES[i].key));
  };

  const filled = () => players.filter(p => p.kind !== 'open' && !watching(p));
  const entryTurn = () => (isDynamic(st.mapFile) ? dynamicTurn(st.mapFile, teamsUsed().length, st.turn) : st.turn);
  const teamsUsed = () => [...new Set(filled().map(p => p.team))].sort((a, b) => a - b);
  const nameOf = (p, i) =>
    watching(p)
      ? p.kind === 'you' || mine(p)
        ? 'You'
        : p.name || 'Player'
      : p.kind === 'you'
        ? 'Your fleet'
        : p.kind === 'human'
          ? mine(p)
            ? 'Your fleet'
            : `${p.name}'s fleet`
          : p.kind === 'open'
            ? 'Open slot'
            : `${AI_KINDS.find(k => k[0] === p.kind)[1]} ${i}`;

  const fleetRows = [];
  const typing = e => document.activeElement === e;
  const fleetRow = i => {
    const P = () => players[i];
    const p = P(),
      edit = canEdit(p);
    const row = el(
      'div',
      'ib-fleet' +
        (i === view.sel ? ' sel' : '') +
        (p.kind === 'open' ? ' open' : '') +
        (mine(p) ? ' mine' : '') +
        (watching(p) ? ' watch' : '')
    );
    row.style.setProperty('--pc', colorOf(p, i));
    row.onclick = () => {
      if (view.sel !== i) {
        view.sel = i;
        sound('GUI_Button_Press_2_SFX');
        draw();
      }
    };
    const top = el('div', 'ib-fleet-top');
    const crest = el('div', 'ib-crest');
    if (!watching(p)) paintCrest(crest, p.faction);
    let who;
    if (p.kind === 'you') who = el('div', 'ib-who', 'You');
    else if (p.kind === 'human') {
      who = el('div', 'ib-who' + (mine(p) ? '' : ' other'), p.name || 'Player');
      if (p.peer === 0) who.title = 'Host';
    } else if (host)
      who = select(net ? [OPEN, ...AI_KINDS] : AI_KINDS, p.kind, v => {
        const q = P();
        q.kind = v;
        if (v === 'open') q.army = [];
        else if (!q.army.length) q.army = randomArmy(rosterOf(q), q.budget);
        changed(null, true);
      });
    else who = el('div', 'ib-who other', p.kind === 'open' ? 'Open' : AI_KINDS.find(k => k[0] === p.kind)[1]);
    const fac = select(
      options('space'),
      p.faction,
      v => {
        const q = P();
        if(sources){choose(q,'space',v);return;}
        unify(q, v);
        changed(
          q,
          players.some(o => o !== q && o.team === q.team)
        );
      }
    );
    const team = select(
      [
        ...(p.kind === 'you' || p.kind === 'human' ? [[SPECTATOR_TEAM, 'Spectator']] : []),
        ...Array.from({ length: INSTANT_MAX_TEAMS }, (_, t) => [t, `Team ${t + 1}`])
      ],
      p.team,
      v => {
        const q = P();
        const was = watching(q);
        setTeam(q, +v);
        changed(q, was !== watching(q));
      },
      'ib-team'
    );
    fac.setAttribute('aria-label',`Fleet ${i+1} faction`);
    fac.disabled = team.disabled = !edit;
    const color = el('input', 'ib-color');
    color.type = 'color';
    color.value = colorOf(p, i);
    color.title = 'Fleet colour';
    color.disabled = !edit;
    color.onclick = e => e.stopPropagation();
    color.oninput = () => {
      P().color = color.value;
      row.style.setProperty('--pc', color.value);
    };
    color.onchange = () => changed(P());
    if (watching(p)) top.append(crest, who, team);
    else top.append(crest, who, fac, team, color);
    const bottom = el('div', 'ib-fleet-bottom');
    const refs = { row };
    if (p.kind === 'open') {
      bottom.append(el('div', 'ib-sum', 'Waiting for a player to join'));
    } else if (watching(p)) {
      bottom.append(el('div', 'ib-sum', 'Spectating · no fleet of their own'));
      if (net) {
        refs.ready = el('div', 'ib-ready');
        bottom.append(refs.ready);
      }
    } else {
      const bar = el('div', 'ib-bar');
      refs.fill = el('div', 'ib-bar-fill');
      bar.append(refs.fill);
      refs.sum = el('div', 'ib-sum');
      bottom.append(bar, refs.sum);
      if (net && p.kind === 'human') {
        refs.ready = el('div', 'ib-ready');
        bottom.append(refs.ready);
      }
    }
    const bud = el('input', 'ib-num ib-small');
    refs.bud = bud;
    bud.type = 'number';
    bud.min = INSTANT_BUDGET_MIN;
    bud.max = INSTANT_BUDGET_MAX;
    bud.step = 500;
    bud.value = p.budget;
    bud.title = 'Budget for this fleet';
    bud.disabled = !host;
    bud.onclick = e => e.stopPropagation();
    bud.onchange = () => {
      const q = P();
      q.budget = clampBudget(bud.value);
      bud.value = q.budget;
      prune(q);
      changed(q, q.kind === 'human' && !mine(q));
    };
    const dice = button(
      '🎲',
      () => {
        const q = P();
        q.army = randomArmy(rosterOf(q), q.budget);
        changed(q);
      },
      'ib-icon'
    );
    dice.title = 'Random fleet within the budget';
    dice.disabled = !edit || p.kind === 'open' || watching(p);
    const del = button(
      '✕',
      () => {
        const q = P();
        if (net && q.kind === 'human') net.kick(q.peer);
        else {
          players.splice(i, 1);
          view.sel = Math.max(0, Math.min(view.sel, players.length - 1));
          changed(null, true);
        }
      },
      'ib-icon'
    );
    del.title = p.kind === 'human' ? 'Remove this player from the game' : 'Remove';
    if (p.kind === 'you' || !host || mine(p)) del.style.visibility = 'hidden';
    if (watching(p)) bottom.append(del);
    else if (p.kind !== 'open') bottom.append(bud, dice, del);
    else bottom.append(del);
    row.append(top, bottom);
    return refs;
  };
  const fillRow = (refs, p) => {
    if (watching(p)) {
      if (refs.ready) {
        const ok = p.peer === 0 || p.ready;
        refs.ready.className = 'ib-ready' + (ok ? ' on' : '');
        refs.ready.textContent = p.peer === 0 ? 'Host' : ok ? 'Ready' : 'Not ready';
      }
      return;
    }
    if (p.kind !== 'open') {
      const spent = armyCost(rosterOf(p), p.army);
      refs.fill.style.width = Math.min(100, (100 * spent) / Math.max(1, p.budget)) + '%';
      refs.sum.textContent = `${p.army.length} ${p.army.length === 1 ? 'unit' : 'units'} · ${money(spent)} / ${money(p.budget)}`;
      if (refs.ready) {
        const ok = p.peer === 0 || p.ready;
        refs.ready.className = 'ib-ready' + (ok ? ' on' : '');
        refs.ready.textContent = p.peer === 0 ? 'Host' : ok ? 'Ready' : 'Not ready';
      }
    }
    if (!typing(refs.bud)) refs.bud.value = p.budget;
  };
  const drawFleets = () => {
    players.forEach((p, i) => {
      const key = JSON.stringify([p.kind, p.peer, p.name, i === view.sel, mine(p), canEdit(p), host, p.faction, p.team, colorOf(p, i)]);
      let f = fleetRows[i];
      if (!f || f.key !== key) {
        const refs = fleetRow(i);
        refs.key = key;
        if (f) f.row.replaceWith(refs.row);
        else fleetList.appendChild(refs.row);
        fleetRows[i] = f = refs;
      }
      fillRow(f, p);
    });
    while (fleetRows.length > players.length) fleetRows.pop().row.remove();
    addBtn.disabled = !host;
    rollAll.disabled = !players.some(p => canEdit(p) && p.kind !== 'open' && !watching(p));
    const used = teamsUsed(),
      watchers = players.filter(watching).length;
    teamNote.textContent =
      (used.length < 2
        ? 'Put at least two teams on the field.'
        : `${filled().length} ${filled().length === 1 ? 'fleet' : 'fleets'} on ${used.length} teams · ${mixed()?'each fleet keeps its faction':'players on one team share a faction'}`) +
      (watchers ? ` · ${watchers} ${watchers === 1 ? 'spectator' : 'spectators'}` : '');
    teamNote.classList.toggle('bad', used.length < 2);
  };

  let armyKey = null;
  const drawArmy = () => {
    view.sel = Math.max(0, Math.min(view.sel, players.length - 1));
    const p = players[view.sel],
      i = view.sel,
      roster = rosterOf(p),
      spent = armyCost(roster, p.army),
      edit = canEdit(p) && p.kind !== 'open';
    const key = JSON.stringify([i, view.filter, p.kind, p.peer, p.team, p.faction, p.army, p.budget, edit, colorOf(p, i), nameOf(p, i)]);
    if (key === armyKey) return;
    armyKey = key;
    armyCol.style.setProperty('--pc', colorOf(p, i));
    armyCol.classList.toggle('watch', watching(p));
    orders.replaceChildren();
    orderFeedback.textContent = libraryWarning;
    if (watching(p)) {
      armyTitle.textContent = `${nameOf(p, i)} — Spectator`;
      rollOne.disabled = clearOne.disabled = true;
      meterFill.style.width = '0%';
      meterText.textContent = 'No fleet · no budget';
      chips.replaceChildren();
      const info = el('div', 'ib-watch');
      info.append(
        el('div', 'ib-watch-head', 'Spectator seat'),
        el(
          'p',
          '',
          'This seat brings no ships. It watches the whole battle with the spectator overlay: follow any team, see its credits and combat power, read the battle log, and turn the fog of war on or off.'
        ),
        el('p', '', 'Pick a team number instead to fight with a fleet of your own.')
      );
      catalog.replaceChildren(info);
      return;
    }
    armyTitle.textContent = `${nameOf(p, i)} — ${fLabel(p.faction)}`;
    rollOne.disabled = clearOne.disabled = !edit;
    meterFill.style.width = Math.min(100, (100 * spent) / Math.max(1, p.budget)) + '%';
    meterText.textContent = `${money(spent)} of ${money(p.budget)} · ${money(p.budget - spent)} left`;
    chips.replaceChildren();
    if (!mp && edit) {
      // Blueprint = replace. Card = append to the current fleet. Validate the
      // entire proposed result both on selection and on commit; no partial add.
      const drawOrder = (list, isCard) => {
        if (!list.length) return;
        const heading = isCard ? 'Flight card' : 'Fleet preset',
          row = el('div', 'ib-tools'),
          label = el('label', 'ib-preset', heading + ' ');
        const choose = el('select', 'ib-select');
        choose.setAttribute('aria-label', heading);
        choose.add(new Option(isCard ? 'Choose a card…' : 'Choose a preset…', ''));
        const by = new Map(roster.map(r => [r.name, r.label]));
        for (const b of list) choose.add(new Option(isCard ? by.get(b.lead) || b.lead : b.name, isCard ? b.lead : b.id));
        const chosen = () => list.find(b => (isCard ? b.lead : b.id) === choose.value);
        const plan = b => (isCard ? planCard(b, p.faction, roster, p.army, p.budget) : checkFleet(b, p.faction, roster, p.budget));
        const apply = button(isCard ? 'Add flight card' : 'Apply preset', () => {
          const b = chosen(),
            result = plan(b);
          if (result.error) {
            orderFeedback.textContent = result.error;
            return;
          }
          p.army = isCard ? [...p.army, ...result.units] : [...b.units];
          changed(p);
          orderFeedback.textContent = isCard
            ? `Added ${result.units.length} units from the flight card.`
            : `Applied ${b.name} to ${nameOf(p, i)}.`;
          orders.querySelector(`[aria-label="${heading}"]`)?.focus({ preventScroll: true });
        });
        apply.disabled = true;
        choose.onchange = () => {
          const b = chosen(),
            result = b && plan(b);
          apply.disabled = !b || !!result.error;
          orderFeedback.textContent =
            result?.error ||
            (!b
              ? ''
              : isCard
                ? `Append ${b.copies} × ${by.get(b.lead)}${b.wing ? ` + ${b.wing} × ${by.get(b.support)}` : ''} · fleet total ${money(result.cost)}`
                : `Replace this fleet with ${b.units.length} units · ${money(result.cost)}`);
        };
        label.append(choose);
        row.append(label, apply);
        orders.append(row);
      };
      drawOrder(
        blueprints.filter(b => b.faction === p.faction),
        false
      );
      drawOrder(
        cards.filter(c => c.faction === p.faction),
        true
      );
    }
    for (const f of FILTERS) {
      const has = f.key === 'all' || roster.some(r => (f.key === 'hero' ? r.hero : !r.hero && f.of?.(r.cls)));
      if (!has) continue;
      const c = button(
        f.label,
        () => {
          view.filter = f.key;
          drawArmy();
        },
        'ib-chip' + (view.filter === f.key ? ' on' : '')
      );
      chips.appendChild(c);
    }
    const shown = roster.filter(r =>
      view.filter === 'all' ? true : view.filter === 'hero' ? r.hero : !r.hero && FILTERS.find(f => f.key === view.filter)?.of?.(r.cls)
    );
    const scroll = catalog.scrollTop;
    catalog.replaceChildren();
    if (!roster.length) catalog.appendChild(el('div', 'ib-empty', 'This faction has no space units to choose from.'));
    let group = null;
    for (const r of shown) {
      const g = r.hero ? 'Heroes' : CLASS_GROUPS.find(c => c.of(r.cls))?.label || 'Other';
      if (view.filter === 'all' && g !== group) {
        group = g;
        catalog.appendChild(el('div', 'ib-group', g));
      }
      const n = p.army.filter(x => x === r.name).length;
      const row = el('div', 'ib-unit' + (n ? ' has' : ''));
      const ic = el('div', 'ib-unit-icon');
      const url = iconUrl(r.icon);
      if (url) ic.style.backgroundImage = `url(${url})`;
      const info = el('div', 'ib-unit-info');
      info.append(
        el('div', 'ib-unit-name', r.label),
        el('div', 'ib-unit-meta', `${money(r.cost)}${r.pop ? ` · pop ${r.pop}` : ''}${r.hero ? ' · unique' : ''}`)
      );
      const count = el('div', 'ib-count', n ? String(n) : '');
      const remove = (e = null) => {
        let gone = 0;
        for (let k = e?.shiftKey ? 5 : 1; k > 0; k--) {
          const at = p.army.lastIndexOf(r.name);
          if (at < 0) break;
          p.army.splice(at, 1);
          gone++;
        }
        if (gone) changed(p);
        return gone > 0;
      };
      const minus = button('−', remove, 'ib-icon');
      minus.disabled = !edit || !n;
      const plus = button('+', e => add(r, e?.shiftKey ? 5 : 1), 'ib-icon');
      plus.disabled = !edit || !canAdd(roster, p.army, p.budget, r);
      row.title = !edit
        ? 'Only this fleet’s owner can change it'
        : plus.disabled
          ? r.hero && n
            ? 'Heroes are unique'
            : 'Not enough budget left'
          : 'Click to add · right-click to remove · hold Shift for 5 at a time';
      row.onclick = e => {
        if (!plus.disabled) {
          sound('GUI_Button_Press_2_SFX');
          add(r, e.shiftKey ? 5 : 1);
        }
      };
      row.oncontextmenu = e => {
        e.preventDefault();
        if (edit && remove(e)) sound('GUI_Button_Press_2_SFX');
      };
      row.append(ic, info, minus, count, plus);
      catalog.appendChild(row);
    }
    catalog.scrollTop = scroll;
    function add(r, times = 1) {
      let put = 0;
      for (; put < times && canAdd(roster, p.army, p.budget, r); put++) p.army.push(r.name);
      if (!put) return;
      const order = new Map(roster.map((x, k) => [x.name, k]));
      p.army.sort((a, b) => order.get(a) - order.get(b));
      changed(p);
    }
  };

  const bounds = new Map();
  const previews = new Map();
  const boundsOf = m => {
    if (!bounds.has(m))
      bounds.set(
        m,
        loadMap(m)
          .then(map => ({ min: { x: map.min[0], y: map.min[1] }, max: { x: map.max[0], y: map.max[1] } }))
          .catch(() => null)
      );
    return bounds.get(m);
  };
  const drawMarks = async () => {
    const m = st.mapFile,
      b = await boundsOf(m);
    if (m !== st.mapFile) return;
    previewMarks.replaceChildren();
    if (!b) return;
    const used = teamsUsed(),
      pts = entryPoints(b.min, b.max, used.length, entryTurn());
    const W = b.max.x - b.min.x,
      H = b.max.y - b.min.y;
    used.forEach((team, k) => {
      const at = pts[k],
        i = players.findIndex(p => p.team === team && p.kind !== 'open'),
        p = players[i];
      const mk = el('div', 'ib-mark');
      mk.style.left = `clamp(15px, ${((at.x - b.min.x) / W) * 100}%, calc(100% - 15px))`;
      mk.style.top = `clamp(15px, ${(1 - (at.y - b.min.y) / H) * 100}%, calc(100% - 15px))`;
      mk.style.setProperty('--pc', colorOf(p, i));
      mk.style.setProperty('--rot', -at.facing + 'rad');
      const arrow = el('div', 'ib-mark-arrow');
      const label = el('div', 'ib-mark-label', String(team + 1));
      mk.title = `Team ${team + 1} — ${fLabel(p.faction)}`;
      mk.append(arrow, label);
      previewMarks.appendChild(mk);
    });
  };
  let shownMap = null;
  const viewKey = () => (isDynamic(st.mapFile) ? `${st.mapFile}|${teamsUsed().length}` : st.mapFile);
  const drawPreview = async () => {
    const m = st.mapFile,
      key = viewKey();
    shownMap = key;
    mapName.textContent = mapTitle(m);
    previewImg.style.backgroundImage = '';
    previewImg.classList.add('none');
    previewMarks.replaceChildren();
    const n = mapHeader(m)?.players;
    if (isDynamic(m)) mapName.appendChild(el('span', '', ' · generated for every fleet'));
    else if (n) mapName.appendChild(el('span', '', ` · ${n} player map`));
    if (!previews.has(key))
      previews.set(
        key,
        loadMapPreview(m, { teams: Math.max(2, teamsUsed().length), instant: true })
          .then(cv => (cv ? cv.toDataURL() : ''))
          .catch(e => (console.warn('map preview', e), ''))
      );
    const url = await previews.get(key);
    if (key !== viewKey()) return;
    previewImg.style.backgroundImage = url ? `url(${url})` : '';
    previewImg.classList.toggle('none', !url);
    drawMarks();
  };
  const drawMaps = () => {
    mapList.replaceChildren();
    const available = battle?.domain === 'space' && battle.authored && battle.file && !maps.includes(battle.file) ? [...maps,battle.file] : maps;
    const rows = available
      .filter(m => !isDynamic(m))
      .map(m => ({ m, name: mapTitle(m) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (maps.some(isDynamic)) rows.unshift({ m: null, name: 'Dynamic Map' });
    for (const { m, name } of rows) {
      const on = m ? m === st.mapFile : isDynamic(st.mapFile);
      const r = el('div', 'ib-maprow' + (m ? '' : ' ib-dynamic') + (on ? ' sel' : ''), name);
      if (!m) r.appendChild(el('span', 'ib-maptag', 'Generated'));
      if (!host) r.classList.add('locked');
      r.onclick = () => {
        const next = m || (isDynamic(st.mapFile) ? st.mapFile : resizeDynamic('medium'));
        if (!host || st.mapFile === next) return;
        st.mapFile = next;
        sound('GUI_Button_Press_2_SFX');
        for (const x of mapList.children) {
          x.classList.toggle('sel', x === r);
        }
        drawOpts();
        drawPreview();
        changed(null, true);
      };
      mapList.appendChild(r);
    }
    requestAnimationFrame(() => {
      const sel = mapList.querySelector('.sel');
      if (sel) mapList.scrollTop = sel.offsetTop - mapList.clientHeight / 2;
    });
  };

  const drawHost = () => {
    for (const b of [applyAll, fogBtn, spinBtn, ...sizeBtns]) b.disabled = !host;
    seeds.update();
    budgetIn.disabled = !host;
    if (!typing(budgetIn)) budgetIn.value = st.budget;
    if (!host) {
      const me = players.find(mine);
      go.textContent = me?.ready ? 'Not Ready' : 'Ready';
      go.classList.toggle('on', !!me?.ready);
    }
  };
  const draw = () => {
    invite?.update();
    error.textContent = '';
    if (!board || editing) { drawOpts(); drawHost(); drawFleets(); drawArmy(); }
    if (board) {
      const me = players.find(mine);
      summary.textContent = `${filled().length} fleets · ${teamsUsed().length} teams · ${filled().reduce((n,p) => n + p.army.length, 0)} units`;
      const land = battle?.domain === 'land';
      const armies = land && groundPicks.map(groundArmy);
      ground.hidden = !land;
      for (const [i,p] of groundPicks.entries()) {
        const wrap=companyFields[i], sel=wrap.querySelector('select');
        const roster=land && !p.pending && sources?.groundRoster(p.faction);
        wrap.hidden=!roster?.length;
        if(!wrap.hidden && wrap.dataset.faction!==p.faction){
          sel.replaceChildren(new Option('Default companies',''),...roster.map(r=>new Option(r.label,r.name)));
          wrap.dataset.faction=p.faction;
        }
        if(!wrap.hidden)sel.value=p.company || '';
      }
      editFleets.hidden = land;
      if (land) summary.textContent = armies.map((a,i)=>`${fLabel(groundPicks[i].faction,'land')}: ${a.length} ${a.length===1?'company':'companies'}`).join(' · ') + '. Eliminate the opposing force.';
      battlefield.textContent = battle?.file ? `${battle.world.name} · ${land ? 'Land' : 'Space'} · ${battle.title}` : '';
      battlefield.title=battle?.file ? `${battle.mod} · ${battle.file}` : '';
      battlefield.hidden=!battle?.file;
      board.go.disabled = !battle?.file || (land && armies.some(a=>!a.length));
      board.status.textContent = battle?.loading ? 'Reading battlefield…' : !battle?.file ? (battle?.world ? 'This battlefield is unavailable.' : 'Choose a battlefield to start.') : board.go.disabled ? 'No ground companies for this faction.' : land || !me ? '' : watching(me) ? 'Spectating' : `${fLabel(me.faction)} · Team ${me.team + 1}`;
    }
    if(board){
      const list=battle?.domain==='land'?groundPicks:filled(),stop=blocked(list),msg=stop?.problem || (stop?.pending?'Reading selected faction…':'');
      if(msg){board.go.disabled=true;board.status.textContent=error.textContent=msg;}
      else if(editing){error.textContent=players[view.sel]?.notice||'';}
      go.disabled=!!msg;
    }
    if (board && !editing) { remember(); return; }
    if (shownMap !== viewKey()) {
      if (!shownMap || shownMap.split('|')[0] !== st.mapFile) drawMaps();
      drawPreview();
    } else drawMarks();
    remember();
  };

  let done,
    ended = false,
    beat = 0;
  const offs = [];
  const finished = new Promise(r => (done = r));
  const onKey = e => {
    if (e.target.closest?.('#armyPainter')) return;
    if (e.code === 'Escape' && document.activeElement !== chatIn && !document.activeElement?.classList.contains('dyn-seed-input')) {
      e.stopPropagation();
      close(false);
    }
  };
  function close(started, why = null) {
    if (ended) return;
    ended = true;
    atlas?.close();
    invite?.close();
    removeEventListener('keydown', onKey, true);
    clearInterval(beat);
    for (const off of offs) off();
    remember();
    root.remove();
    if (net && !started) {
      if (host) net.setListing(null);
      net.close();
      if (why) alert(why);
      mp.back?.();
    } else if (!started && cancel) cancel();
    done(started);
  }
  function toggleReady() {
    const me = players.find(mine);
    if (!me) return;
    if (!me.ready && !me.army.length && !watching(me)) {
      error.textContent = 'Add some ships to your fleet first.';
      return;
    }
    me.ready = !me.ready;
    net.send(0, { k: 'ready', on: me.ready, faction: me.faction, livery: me.ready && !watching(me) ? activeLivery(me.faction) : null });
    draw();
  }
  function launch() {
    if (board && !editing && (!battle?.file || board.go.disabled || (battle.domain==='space' && st.mapFile!==battle.file))) return;
    if(board && blocked(battle?.domain==='land'?groundPicks:filled()))return;
    const refsFor=(domain,list)=>guestRefs(list.map(p=>sources && sources.guest(domain,p.faction) ? sources.get(domain,p.faction).ref : null));
    if (board && !editing && battle.domain === 'land') {
      const groundSides=groundPicks.map(p=>p.faction),refs=refsFor('land',groundPicks);
      const setup = {mode:'land', type:'instant', mapFile:battle.file, planetBattle:{id:battle.world.id,authored:battle.authored},
        credits:0,popCap:0,fog:false,preBuilt:false, teamFactions:groundSides.slice(),
        players:[{human:true,team:0,auto:true,color:PALETTE[0],livery:activeLivery(groundSides[0])},{human:false,team:1,auto:true,difficulty:'medium',color:PALETTE[1]}],
        ...(refs.length?{skirmishRosters:refs}:{}),instant:{domain:'land',groundArmies:groundPicks.map(groundArmy)}};
      close(true);audio?.unlock?.();start(setup);return;
    }
    const used = teamsUsed();
    if (used.length < 2) {
      setEditor(true);
      error.textContent = 'At least two teams are needed for a battle.';
      return;
    }
    const empty = players.findIndex(p => p.kind !== 'open' && !watching(p) && !p.army.length);
    if (empty >= 0) {
      view.sel = empty;
      draw();
      setEditor(true);
      error.textContent = `${nameOf(players[empty], empty)} has no ships yet — add some or press Random.`;
      return;
    }
    if (net && players.some(p => p.kind === 'human' && p.peer !== 0 && !p.ready)) {
      error.textContent = 'Waiting for every player to press Ready.';
      return;
    }
    const index = new Map(used.map((t, k) => [t, k]));
    const teamFactions = used.map(t => players.find(p => p.team === t && p.kind !== 'open').faction);
    const all = colors();
    const fleets = players.map((p, i) => ({ p, color: all[i] })).filter(({ p }) => p.kind !== 'open' && !watching(p));
    const watchers = players.filter(p => p.kind === 'human' && watching(p));
    const refs=refsFor('space',fleets.map(f=>f.p));
    const setup = {
      ...(refs.length?{skirmishRosters:refs}:{}),
      mode: 'space',
      type: 'instant',
      mapFile: st.mapFile,
      ...(battle?.domain === 'space' && battle.file === st.mapFile ? {planetBattle:{id:battle.world.id,authored:battle.authored}} : {}),
      credits: 0,
      popCap: 0,
      fog: st.fog,
      teamFactions,
      players: fleets.map(({ p, color }) => ({
        ...(p.faction!==teamFactions[index.get(p.team)]?{skirmishFaction:p.faction}:{}),
        ...(p.kind === 'you'
          ? { human: true, team: index.get(p.team), color, auto: false, livery: activeLivery(p.faction) }
          : p.kind === 'human'
            ? { human: true, peer: p.peer, name: p.name, team: index.get(p.team), color, auto: false, livery: launchPaint(p, p.faction, mine(p)) }
            : { human: false, team: index.get(p.team), difficulty: p.kind, color, auto: false })
      })),
      instant: { turn: entryTurn(), armies: fleets.map(({ p }) => p.army.slice()) },
      ...(players.some(p => p.kind === 'you' && watching(p)) ? { spectate: true } : {}),
      ...(watchers.length ? { spectators: watchers.map(p => p.peer), spectatorNames: watchers.map(p => p.name) } : {})
    };
    if (net) {
      setup.seed = crypto.getRandomValues(new Uint32Array(1))[0];
      setup.spaceWorker = !new URLSearchParams(location.search).has('nospaceworker');
      net.setListing(null);
      net.broadcast({ k: 'start', setup });
      mp.started?.({ st: { ...st }, players: JSON.parse(JSON.stringify(players)) });
    }
    close(true);
    audio?.unlock?.();
    start(setup);
  }

  if (net && host) {
    offs.push(
      net.on('message', (from, m) => {
        const i = players.findIndex(p => p.kind === 'human' && p.peer === from),
          s = players[i];
        if (m.k === 'hello') {
          if (m.version !== mp.version || m.data !== mp.data) {
            net.send(from, { k: 'refuse', why: "Your game version or game data differs from the host's." });
            setTimeout(() => net.kick(from), 300);
            return;
          }
          if (mp.password && m.password !== mp.password) {
            net.send(from, { k: 'password', wrong: m.password !== undefined });
            return;
          }
          if (s) return;
          const who = String(m.name || 'Player').slice(0, 24);
          const slot = players.find(p => p.kind === 'open' && p.was === who) || players.find(p => p.kind === 'open');
          if (!slot) {
            net.send(from, { k: 'refuse', why: 'The game is full.' });
            setTimeout(() => net.kick(from), 300);
            return;
          }
          const back = slot.was === who && slot.army.length;
          Object.assign(slot, { kind: 'human', peer: from, name: who, ready: false });
          if (!back) slot.army = randomArmy(rosterOf(slot), slot.budget);
          const text = `${slot.name} joined the game.`;
          say('', text);
          net.broadcast({ k: 'chat', name: '', text });
          publish();
          draw();
        } else if (!s) return;
        else if (m.k === 'fleet' && m.fleet) {
          const f = m.fleet;
          if (Number.isInteger(f.team) && f.team >= SPECTATOR_TEAM && f.team < INSTANT_MAX_TEAMS && f.team !== s.team) setTeam(s, f.team);
          if (typeof f.faction === 'string' && factions.includes(f.faction) && f.faction !== s.faction) unify(s, f.faction);
          if (f.color === null || (typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color))) s.color = f.color;
          if (Array.isArray(f.army)) {
            s.army = f.army.slice(0, 4000);
            prune(s);
          }
          s.ready = false;
          publish();
          draw();
        } else if (m.k === 'ready') {
          s.ready = !!m.on && (s.army.length > 0 || watching(s)) && (m.faction === undefined || m.faction === s.faction);
          readyPaint(s, m, s.faction);
          publish();
          draw();
        } else if (m.k === 'chat') {
          const text = String(m.text || '').slice(0, 200);
          if (text) {
            say(s.name, text);
            net.broadcast({ k: 'chat', name: s.name, text });
          }
        }
      }),
      net.on('leave', peer => {
        const s = players.find(p => p.kind === 'human' && p.peer === peer);
        if (!s) return;
        const text = `${s.name} left the game.`;
        say('', text);
        net.broadcast({ k: 'chat', name: '', text });
        Object.assign(s, { kind: 'open', peer: undefined, name: '', ready: false, army: [] });
        publish();
        draw();
      }),
      net.on('closed', why => close(false, 'The connection to the game was lost (' + why + ').'))
    );
    if (mp.kind !== 'lan') beat = setInterval(listing, 30000);
  } else if (net) {
    offs.push(
      net.on('message', (from, m) => {
        if (m.k === 'state' && m.ib) {
          Object.assign(st, m.ib.st);
          players = m.ib.players;
          draw();
        } else if (m.k === 'chat') say(m.name, m.text);
        else if (m.k === 'refuse') close(false, m.why);
        else if (m.k === 'start' && m.setup) {
          close(true);
          audio?.unlock?.();
          start(m.setup);
        }
      }),
      net.on('closed', why =>
        close(false, why === 'host left' ? 'The host closed the game.' : 'The connection to the game was lost (' + why + ').')
      )
    );
  }

  if (!board) addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  if (board) atlas = battlefieldAtlas(board,{files:{space:maps.filter(m=>!isDynamic(m)),land:landMaps},onPlanet:()=>tabs.select(0),change:info=>{
    battle=info;
    if(info.domain==='space' && info.file) st.mapFile=info.file;
    draw();
  }});
  draw();
  if (board) board.focus();
  if (net && host) {
    publish();
    for (const line of mp.invites || []) say('', line.text, line.copy);
  }
  if (net && !host) say('', 'You joined the game. Build your fleet and press Ready.');
  return true;
}
