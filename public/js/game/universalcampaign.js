import { campaignFactionCards } from './campaignfactions.js';
import { conditionNames, conditionPrefs, eligibleConditions } from './startingconditions.js';
import { openingDefaults } from './openingpreferences.js';
import {startingDifficulty} from './battledrafts.js';
import { activeLanguage } from '../language.js';
import { appearances, appearanceEligible } from './appearancechoices.js';
import { canonEligible, fractalEligible, envoyStart, equalFootingStart } from './universaleligibility.js';
import { ruleFields, rescueCampaign } from './universalrules.js';
import { campaignFields, campaignPreferences, eligibleCampaignPreferences } from './campaignpreferences.js';
import { ruleChoices, rulePresets } from './universalrulemenu.js';
import { eraTimeline, periodOf, startWithin } from './universaltimeline.js';
import { mapStart, techCalendar } from './universalmaplist.js';
import { campaignRoster } from './universalroster.js';
import { atlasBoard } from './universalboard.js';
export function campaignChoices(campaigns, factionOf) {
  return [...campaigns.values()].filter(
    c =>
      c.bool('Is_Listed', true) &&
      !c.bool('Is_Multiplayer') &&
      !c.bool('Tutorial') &&
      c.list('Locations').length &&
      factionOf(c.str('Starting_Active_Player'))?.bool('Is_Playable')
  );
}
const cached = new Map(),
  opt = (value, label) => ({ value, label });
async function request(path, body) {
  const r = await fetch('/api/universal/atlas' + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw Error(await r.text());
  return r.json();
}
// Metadata only. Single Player and GC can share the same in-flight fetch; never mount
// a game, open a renderer, or delay showing the native menu during this read.
export function campaignLibrary(language = activeLanguage) {
  if (!cached.has(language))
    cached.set(
      language,
      request('?language=' + language).catch(e => {
        cached.delete(language);
        throw e;
      })
    );
  return cached.get(language);
}
export function campaignOpening(data, origin) {
  const eras = eraTimeline(data), families = e => e.periods.flatMap(period => [...period.maps.keys()]);
  const era = eras.find(e => families(e).some(f => f.p.id === origin)) || eras.find(e => e.first) || eras.find(e => e.views.length);
  const initial = era?.first && (families(era).find(f => f.p.id === origin) || era.first);
  return { eras, era, initial };
}
export async function openUniversalCampaign({ start, back, profileId = 'stock', host }) {
  const origin = profileId || 'stock',
    language = activeLanguage,
    preferred = campaignPreferences(), touched = new Set(), preferredConditions=conditionPrefs(), editedConditions=new Set();
  let data,
    p,
    row,
    v,
    faction,
    family,
    date,
    roster,
    era,
    period,
    difficulty,
    options,
    settings,
    customMix,
    previewProfile,
    previewMap,
    busy = false,
    closed = false;
  const ui = await atlasBoard(
    () => {
      if (!busy) {
        finish(true);
        back();
      }
    },
    launch,
    () => {
      if (!busy && row) {
        defaults();
        difficulty = 'medium'; // Reset to the game's standard difficulty for this start.
        for (const k of Object.keys(campaignFields)) touched.add(k); // Reset means authored defaults, not the stored preselection.
        choose(family, mapStart(family, null, faction), true);
      }
    }
  );
  ui.allow(false);
  ui.status.textContent = 'Reading the local campaign atlas…';
  function finish(remember = false) {
    closed = true;
    removeEventListener('message', error);
    roster?.close();
    ui.close(remember);
  }
  function error(e) {
    if (e.origin === host && e.source === window.parent && e.data?.kind === 'universal-error') {
      busy = false;
      ui.panel.inert = false;
      ui.allow(!!v);
      window.universalLaunch?.end();
      ui.status.textContent = e.data.error;
    }
  }
  addEventListener('message', error);
  async function launch() {
    if (!v || busy || closed) return;
    busy = ui.panel.inert = true;
    ui.allow(false);
    ui.status.textContent = 'Opening ' + p.name + '…';
    window.universalLaunch?.begin(
      family.title,
      [p.name, period.scenario ? 'Scenario' : period.label, p.facts[faction]?.label || faction].join(' · ')
    );
    try {
      const plan = await request('/start', { profile: p.id, language, row: row.id, target: v.id, difficulty, ...options, settings });
      if (p.id === origin) {
        const setup = await request('/consume', { ticket: plan.ticket });
        finish();
        start(setup);
      } else if (window.parent !== window) {
        window.parent.postMessage({ kind: 'universal-start', id: p.id, ticket: plan.ticket }, host);
      } else throw Error('Open the Universal game window to launch another storyline.');
    } catch (e) {
      busy = ui.panel.inert = false;
      ui.allow(true);
      window.universalLaunch?.end();
      ui.status.textContent = e.message;
    }
  }
  function defaults() {
    touched.clear();
    difficulty = startingDifficulty();
    options = {};
    customMix = null;
    settings = {};
  }
  function choose(next, selection, reset = false) {
    const s = selection.choice;
    if (next.p !== p) defaults();
    if (s.row !== row) {
      editedConditions.clear();
      settings = {};
      if (!s.row.customOpening || !row?.customOpening) delete options.opening;
      if (s.row.scripted) delete options.payAsYouGo;
      if (!s.row.eraProgression || !row?.eraProgression) delete options.progressive;
    }
    if (s.variant !== v) {
      delete options.canonUnits;
      delete options.fractal;
      delete options.buildTime;
      delete options.envoy;
      delete options.convoy;
      delete options.recovery;
      for (const k of ['mercenaries', 'fighterSupport', ...Object.keys(appearances)]) delete options[k];
      delete options.flagship;
      delete options.expedition;
      delete options.heroRescue;
      if (s.row.scripted || !next.p.combat?.transport?.allowed.includes(s.variant?.id)) delete options.transportLosses;
    }
    if (!reset && s.variant && (next.p !== p || s.row !== row || s.variant !== v)) {
      Object.assign(options, openingDefaults(next.p, s.row, s.variant));
    }
    family = next;
    p = next.p;
    date = selection.date;
    period = era.periods.find(x => x.label === periodOf(family, date));
    row = s.row;
    faction = row.faction;
    v = s.variant;
    const eligible = eligibleCampaignPreferences(data.profiles, p, row, v, preferred);
    for (const k of Object.keys(preferred)) if (!touched.has(k)) {
      if (Object.hasOwn(eligible,k)) options[k]=eligible[k];
      else delete options[k];
    }
    const conditions = v ? eligibleConditions(p,row,date,preferredConditions) : {};
    for(const k of Object.keys(conditionNames)) {
      if(reset) editedConditions.add(k);
      if(editedConditions.has(k))continue;
      if(Object.hasOwn(conditions,k)) settings[k]=conditions[k]; else delete settings[k];
    }
    if (row.defaultFtguYear && date.year === row.defaultFtguYear) delete settings.credits;
    if (techCalendar(p, row)) {
      if (s.tech === undefined) delete settings.tech;
      else settings.tech = s.tech;
    }
    render();
  }
  function pickMap(next) {
    choose(next, startWithin(next, period.maps.get(next), date, next.p === p ? faction : undefined));
  }
  function pickPeriod(next) {
    period = next;
    if (family && period.maps.has(family)) pickMap(family);
    else clearChoice();
  }
  function clearChoice() {
    family = row = date = v = null;
    render();
  }
  function pickEra(next) {
    if (next === era) return;
    era = next;
    const first = next.first;
    if (!first) {
      pickPeriod(next.views[0]);
      return;
    }
    const label = periodOf(first, mapStart(first).date);
    pickPeriod(next.periods.find(x => x.label === label));
  }
  function pickDate(next) {
    choose(family, { date: next, choice: next.choices.find(s => s.row.faction === faction) || next.choices[0] });
  }
  function drawRules() {
    const donors = data.profiles.filter(p => p.donor).map(p => ({ name: p.name, values: p.donor.values })),
      ps = [{ key: '', label: 'Campaign defaults', options: {} }, ...rulePresets(donors, p.defaults)],
      match = ps.find(e => Object.keys(ruleFields).every(k => e.options[k] === options[k]));
    if (!match)
      customMix = Object.fromEntries(
        Object.keys(ruleFields)
          .filter(k => options[k] !== undefined)
          .map(k => [k, options[k]])
      );
    if (customMix) ps.push({ key: 'custom', label: 'Custom mix', options: customMix });
    ui.slider(
      'preset',
      'Economy & politics',
      ps.map(e => opt(e.key, e.label)),
      match?.key ?? 'custom',
      value => {
        const a = ps.find(e => e.key === value);
        if (a) {
          for (const k of Object.keys(ruleFields)) { touched.add(k); delete options[k]; }
          Object.assign(options, a.options);
          drawRules();
        }
      }
    );
    for (const [k, r] of Object.entries(ruleFields)) {
      const choices = [[p.defaults[k], null], ...ruleChoices(donors, k, p.defaults[k])]
        .sort(([a], [b]) => a - b)
        .map(([n, names]) => opt(names ? n : '', `${n.toLocaleString()} ${r.unit} — ${names ? names.join(' / ') : 'Campaign default'}`));
      (k === 'treasury' ? ui.radios : ui.slider)(
        k,
        k === 'treasury' ? 'Treasury / planet' : 'Political control / point',
        choices,
        options[k] ?? '',
        value => {
          touched.add(k);
          if (value === '') delete options[k];
          else options[k] = +value;
          drawRules();
        }
      );
    }
    const native = p.payment?.native,
      sources = data.profiles.filter(x => x.payment?.declared && x.payment.native !== native);
    if (!row.scripted && typeof native === 'boolean' && sources.length) {
      const terms = installments => (installments ? 'Installments' : 'Upfront'),
        source = sources.length === 1 ? sources[0].name : `${sources[0].name} + ${sources.length - 1} more`;
      ui.field(
        'payment',
        'Your production payments',
        [opt('', `Campaign default · ${terms(native)}`), opt('alternate', `${terms(!native)} · ${source}`)],
        options.payAsYouGo === undefined ? '' : 'alternate',
        value => {
          touched.add('payAsYouGo');
          if (value) options.payAsYouGo = !native;
          else delete options.payAsYouGo;
        }
      );
    } else ui.hide('payment');
    const t = p.combat?.transport,
      terms = new Map();
    for (const x of data.profiles)
      if (x.combat?.transport?.declared && x.combat.transport.native !== t?.native && !terms.has(x.combat.transport.native))
        terms.set(x.combat.transport.native, x.name);
    const percent = n => `${+(n * 100).toFixed(2)}%`;
    if (!row.scripted && t?.allowed.includes(v?.id) && terms.size)
      ui.field(
        'transport',
        'Your transport losses on auto-resolve',
        [opt('', `Campaign default · ${percent(t.native)}`), ...[...terms].map(([n, name]) => opt(String(n), `${percent(n)} · ${name}`))],
        String(options.transportLosses ?? ''),
        value => {
          touched.add('transportLosses');
          if (value === '') delete options.transportLosses;
          else options.transportLosses = +value;
        }
      );
    else ui.hide('transport');
    const altTime = p.buildTime && data.profiles.find(x => x.buildTime?.declared && x.buildTime.native !== p.buildTime.native);
    if (altTime && !row.scripted)
      ui.field(
        'buildTime',
        'Your construction time',
        [
          opt('', `Campaign default · ${p.buildTime.native * 100}% base time`),
          opt('alternate', `${altTime.buildTime.native * 100}% base time · ${altTime.name}`)
        ],
        options.buildTime ? 'alternate' : '',
        value => {
          touched.add('buildTime');
          if (value) options.buildTime = altTime.buildTime.native;
          else delete options.buildTime;
        }
      );
    else ui.hide('buildTime');
    if (fractalEligible(p, row, v))
      ui.field(
        'fractal',
        'Fractalsponge Units',
        [opt('', 'Campaign default'), opt('request', 'Queue Fractalsponge Units after the briefing')],
        options.fractal ? 'request' : '',
        value => {
          if (value) options.fractal = true;
          else delete options.fractal;
        }
      );
    else ui.hide('fractal');
    if (canonEligible(p, row, v))
      ui.field(
        'canon',
        'Canon Units',
        [opt('', 'Campaign default'), opt('request', 'Queue Enable Canon Units after the briefing')],
        options.canonUnits ? 'request' : '',
        value => {
          if (value) options.canonUnits = true;
          else delete options.canonUnits;
        }
      );
    else ui.hide('canon');
    if (equalFootingStart(p, row, v))
      ui.field(
        'flagship',
        'Rebel flagship',
        [opt('', 'Campaign default'), opt('commission', 'Designate one Mon Calamari cruiser in the galactic log')],
        options.flagship ? 'commission' : '',
        value => {
          if (value) options.flagship = true;
          else delete options.flagship;
          note();
        }
      );
    else ui.hide('flagship');
    for (const [k, title, label] of [
      ['mercenaries', 'Mercenary contracts', 'Bespin corvette hire · 750 credits / 120s'],
      ['fighterSupport', 'Emergency fighter support', 'Station defense · 1,500 credits / 20s']
    ]) {
      if (equalFootingStart(p, row, v))
        ui.field(k, title, [opt('', 'Campaign default'), opt('offer', label)], options[k] ? 'offer' : '', value => {
          if (value) options[k] = true;
          else delete options[k];
        });
      else ui.hide(k);
    }
    for (const [k, d] of Object.entries(appearances)) {
      if (appearanceEligible(d, p, row, v))
        ui.field(
          k,
          d.title,
          [opt('', 'Campaign default'), ...d.choices.map((v, i) => opt(String(i), v))],
          options[k] === undefined ? '' : String(options[k]),
          value => {
            if (value === '') delete options[k];
            else options[k] = Number(value);
          }
        );
      else ui.hide(k);
    }
    const paths = [opt('', 'Authored objectives')];
    if (equalFootingStart(p, row, v))
      paths.push(opt('convoy', 'Freight charter · Hoth to Bespin'), opt('recovery', 'Derelict recovery · Sullust'));
    if (envoyStart(p, row, v)) paths.push(opt('envoy', 'Mon Mothma · diplomatic envoy'));
    if (p.combat?.rescue && v?.id === rescueCampaign) paths.push(opt('rescue', 'Rescue Han and Chewbacca'));
    if (p.id !== '3417277973' && v?.sites.length && data.profiles.some(p => p.donor?.hasSearch))
      paths.push(opt('expedition', 'Star Map Expedition'));
    ui.radios(
      'path',
      'Objective',
      paths,
      options.recovery
        ? 'recovery'
        : options.convoy
          ? 'convoy'
          : options.envoy
            ? 'envoy'
            : options.heroRescue
              ? 'rescue'
              : options.expedition
                ? 'expedition'
                : '',
      value => {
        delete options.envoy;
        delete options.convoy;
        delete options.recovery;
        if (value === 'recovery') options.recovery = true;
        if (value === 'convoy') options.convoy = true;
        if (value === 'envoy') options.envoy = true;
        delete options.expedition;
        delete options.heroRescue;
        if (value === 'expedition') options.expedition = true;
        if (value === 'rescue') options.heroRescue = true;
        note();
      }
    );
  }
  function note() {
    ui.status.textContent = options.recovery
      ? 'Assign a boarding team at Hoth. Secure one derelict during a manual space battle at Sullust and tow it back for an optional paid refit.'
      : options.convoy
        ? 'Review a 1,500-credit charter in the log. Escort the loaned freighter to collect; a lost ship earns nothing.'
        : options.envoy
          ? 'Bring Mon Mothma to friendly Bespin for a 60-second report on the fleet at Sullust. Campaign time pauses in the log.'
          : options.heroRescue
            ? 'If Han and Chewbacca fall in a lost battle, conquer their prison world to bring them back once.'
            : options.expedition
              ? `Expedition: capture ${v.sites.join(', ')} for a one-time 3,000-credit grant.`
              : row?.scripted
                ? 'Authored setup scenario. Its script chooses the final galaxy after launch.'
                : row?.customOpening
                  ? 'Choose Learner, Static era or Progressive era in Settings.'
                  : row?.layout
                    ? 'Choose starting locations and rosters in-game, using the mod’s own setup.'
                    : '';
    if (options.flagship)
      ui.status.textContent +=
        (ui.status.textContent ? ' ' : '') + 'Your flagship keeps battle damage. Repairs require confirmation at a friendly starbase.';
  }
  function render() {
    ui.el.toggleAttribute('data-await-map', !family);
    function showMap() {
      if (v) ui.map.show(p, v, false, family);
      else ui.map.clear();
      previewProfile = p;
      previewMap = v?.map;
    }
    // On an in-story switch start the worker before rebuilding the right panel. On
    // first entry build the form first so computing the viewport needs just one layout.
    if (family && previewProfile === p && previewMap !== v?.map) showMap();
    roster.show(era, period, family, date, v);
    ui.el.dataset.profile = family ? p.id : '';
    ui.el.dataset.campaign = v?.id || '';
    ui.allow(!!v);
    if (!family) {
      const first = period.maps.keys().next().value;
      if (first) ui.map.show(first.p, period.maps.get(first)[0].choices[0].variant, true);
      else ui.map.clear();
      previewProfile = previewMap = null;
      ui.status.textContent = period.discovery
        ? 'Local pack required. Choose a grayed-out map for submod details.'
        : period.scenario
          ? 'Choose a scenario to preview its starting galaxy.'
          : 'Choose a map to preview its starting galaxy.';
      return;
    }
    const techDate = techCalendar(p, row);
    ui.radios(
      'faction',
      'Faction',
      campaignFactionCards(p, date.choices.map(s => ({ value: s.row.faction, faction:s.row.faction, label: p.facts[s.row.faction].label || s.row.faction, fact: p.facts[s.row.faction] })), [v]),
      faction,
      f => choose(family, { date, choice: date.choices.find(s => s.row.faction === f) }),
      true
    );
    ui.radios(
      'difficulty',
      'Difficulty',
      ['easy', 'medium', 'hard'].map((n, i) => opt(n, p.levels[i] || n)),
      difficulty,
      n => (difficulty = n)
    );
    if (row.customOpening)
      ui.field(
        'opening',
        'Custom opening',
        [opt('static', 'Static era'), opt('learner', 'Learner · standard roster and heroes'), opt('progressive', 'Progressive era')],
        options.opening ?? 'static',
        value => {
          if (value === 'static') delete options.opening;
          else options.opening = value;
        }
      );
    else ui.hide('opening');
    if (row.eraProgression)
      ui.field(
        'progression',
        'Era progression',
        [opt('', 'Static era'), opt('on', 'Progressive era')],
        options.progressive ? 'on' : '',
        s => {
          options.progressive = s === 'on';
        }
      );
    else ui.hide('progression');
    drawRules();
    for (const [k, title] of Object.entries({
      credits: 'Starting credits',
      tech: 'Starting tech',
      maxTech: 'Maximum tech',
      autoResolve: 'Auto-resolve'
    })) {
      const fixedCredits = k === 'credits' && row.defaultFtguYear && date.year === row.defaultFtguYear;
      if (!row?.limits.custom || !row.slots.includes(k) || fixedCredits || (techDate && k === 'tech')) {
        ui.hide(k);
        continue;
      }
      const l = row.limits,
        adj = p.facts[faction].adj;
      let values = [];
      if (k === 'autoResolve') values = [opt(0, 'Always'), opt(2, 'Ask')];
      else if (k === 'credits') {
        for (let n = l.minCredits; n <= l.maxCredits && values.length < 1000; n += 1000) values.push(opt(n, n.toLocaleString()));
      } else for (let n = l.minTech; n <= l.maxTech && values.length < 256; n++) values.push(opt(n - adj, String(n)));
      ui.field(k, title, [opt('', 'Campaign default'), ...values], settings[k] ?? '', s => {
        editedConditions.add(k);
        if (s === '') delete settings[k];
        else settings[k] = +s;
      });
    }
    if (previewProfile !== p || previewMap !== v?.map) showMap();
    note();
  }
  try {
    data = await campaignLibrary(language);
    if (closed) return true;
    if (data.profiles.some(p => p.maps.length)) ui.map.setLibrary(data.profiles);
    const opening = campaignOpening(data, origin), { eras, initial } = opening;
    roster = campaignRoster(ui.roster, eras, { pickEra, pickPeriod, pickMap, pickDate, clearChoice });
    era = opening.era;
    if (initial) {
      choose(initial, mapStart(initial));
      roster.focus();
    } else if (era) {
      pickPeriod(era.views[0]);
      roster.focus();
    } else ui.status.textContent = 'No playable campaigns available.';
  } catch (e) {
    if (!closed) ui.status.textContent = 'Campaign atlas unavailable. Restart Universal from this checkout and reopen setup. ' + e.message;
  }
  return true;
}
