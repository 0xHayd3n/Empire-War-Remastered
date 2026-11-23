import { activeLanguage } from '../language.js';
import { ruleFields } from './universalrules.js';
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
export async function openUniversalCampaign({ start, back, profileId = 'stock', host }) {
  const origin = profileId || 'stock',
    language = activeLanguage;
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
        finish();
        back();
      }
    },
    launch,
    () => {
      if (!busy && row) {
        defaults();
        choose(family, mapStart(family, null, faction));
      }
    }
  );
  ui.allow(false);
  ui.status.textContent = 'Reading the local campaign atlas…';
  function finish() {
    closed = true;
    removeEventListener('message', error);
    roster?.close();
    ui.close();
  }
  function error(e) {
    if (e.origin === host && e.source === window.parent && e.data?.kind === 'universal-error') {
      busy = false;
      ui.panel.inert = false;
      ui.allow(!!v);
      ui.status.textContent = e.data.error;
    }
  }
  addEventListener('message', error);
  async function launch() {
    if (!v || busy || closed) return;
    busy = ui.panel.inert = true;
    ui.allow(false);
    ui.status.textContent = 'Opening ' + p.name + '…';
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
      ui.status.textContent = e.message;
    }
  }
  function defaults() {
    difficulty = 'medium';
    options = {};
    customMix = null;
    settings = {};
  }
  function choose(next, selection) {
    const s = selection.choice;
    if (next.p !== p) defaults();
    if (s.row !== row) {
      settings = {};
      if (!s.row.eraProgression || !row?.eraProgression) delete options.progressive;
    }
    if (s.variant !== v) delete options.expedition;
    family = next;
    p = next.p;
    date = selection.date;
    period = era.periods.find(x => x.label === periodOf(family, date));
    row = s.row;
    faction = row.faction;
    v = s.variant;
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
    else {
      family = row = date = v = null;
      render();
    }
  }
  function pickEra(next) {
    if (next === era) return;
    era = next;
    const first = next.first;
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
          for (const k of Object.keys(ruleFields)) delete options[k];
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
          if (value === '') delete options[k];
          else options[k] = +value;
          drawRules();
        }
      );
    }
    const paths = [opt('', 'Authored objectives')];
    if (p.id !== '3417277973' && v?.sites.length && data.profiles.some(p => p.donor?.hasSearch))
      paths.push(opt('expedition', 'Star Map Expedition'));
    ui.radios('path', 'Objective', paths, options.expedition ? 'expedition' : '', value => {
      if (value) options.expedition = true;
      else delete options.expedition;
      note();
    });
  }
  function note() {
    ui.status.textContent = options.expedition
      ? `Expedition: capture ${v.sites.join(', ')} for a one-time 3,000-credit grant.`
      : row?.scripted
        ? 'Authored setup scenario. Its script chooses the final galaxy after launch.'
        : '';
  }
  function render() {
    roster.show(era, period, family, date);
    ui.el.toggleAttribute('data-await-map', !family);
    ui.el.dataset.profile = family ? p.id : '';
    ui.el.dataset.campaign = v?.id || '';
    ui.allow(!!v);
    if (!family) {
      ui.map.clear();
      previewProfile = previewMap = null;
      ui.status.textContent = period.scenario
        ? 'Choose a scenario to preview its starting galaxy.'
        : 'Choose a map to preview its starting galaxy.';
      return;
    }
    const techDate = techCalendar(p, row);
    ui.radios(
      'faction',
      'Faction',
      date.choices.map(s => ({ value: s.row.faction, label: p.facts[s.row.faction].label || s.row.faction, fact: p.facts[s.row.faction] })),
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
        if (s === '') delete settings[k];
        else settings[k] = +s;
      });
    }
    if (p !== previewProfile || v?.map !== previewMap) {
      if (v) ui.map.show(p, v);
      else ui.map.clear();
      previewProfile = p;
      previewMap = v?.map;
    }
    note();
  }
  try {
    if (!cached.has(language))
      cached.set(
        language,
        request('?language=' + language).catch(e => {
          cached.delete(language);
          throw e;
        })
      );
    data = await cached.get(language);
    if (closed) return true;
    const eras = eraTimeline(data);
    roster = campaignRoster(ui.roster, eras, { pickEra, pickPeriod, pickMap, pickDate });
    const families = e => e.periods.flatMap(period => [...period.maps.keys()]);
    era = eras.find(e => families(e).some(f => f.p.id === origin)) || eras.find(e => e.first);
    if (era) {
      const initial = families(era).find(f => f.p.id === origin) || era.first;
      choose(initial, mapStart(initial));
      roster.focus();
    } else ui.status.textContent = 'No playable campaigns available.';
  } catch (e) {
    if (!closed) ui.status.textContent = 'Campaign atlas unavailable. Restart Universal from this checkout and reopen setup. ' + e.message;
  }
  return true;
}
