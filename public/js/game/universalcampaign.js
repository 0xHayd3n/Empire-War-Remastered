import { activeLanguage } from '../language.js';
import { ruleFields } from './universalrules.js';
import { ruleChoices, rulePresets } from './universalrulemenu.js';
import { periods, chronology } from './universalmodes.js';
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
    difficulty,
    options,
    settings,
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
        v = row.variants[row.initial] || row.variants[0];
        render();
      }
    }
  );
  ui.allow(false);
  ui.status.textContent = 'Reading the local campaign atlas…';
  function finish() {
    closed = true;
    removeEventListener('message', error);
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
    settings = {};
  }
  function pickProfile(id) {
    p = data.profiles.find(p => p.id === id);
    faction = p?.rows[0]?.faction;
    defaults();
    pickMap(p?.rows[0]);
  }
  function pickMap(next) {
    row = next;
    v = row?.variants[row.initial] || row?.variants[0];
    settings = {};
    delete options.expedition;
    render();
  }
  function drawRules() {
    const donors = data.profiles.filter(p => p.donor).map(p => ({ name: p.name, values: p.donor.values })),
      ps = [{ key: '', label: 'Campaign defaults', options: {} }, ...rulePresets(donors, p.defaults)],
      match = ps.find(e => Object.keys(ruleFields).every(k => e.options[k] === options[k]));
    ui.field(
      'preset',
      'Economy & politics',
      ps.map(e => opt(e.key, e.label)).concat(match ? [] : [opt('custom', 'Custom mix')]),
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
      ui.field(
        k,
        k === 'treasury' ? 'Treasury / planet' : 'Political control / point',
        [
          opt('', `Default · ${p.defaults[k].toLocaleString()} ${r.unit}`),
          ...ruleChoices(donors, k, p.defaults[k]).map(([n, names]) => opt(n, `${n.toLocaleString()} ${r.unit} — ${names.join(' / ')}`))
        ],
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
    ui.field('path', 'Objective', paths, options.expedition ? 'expedition' : '', value => {
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
        : 'Initial control from the campaign data. Story events can change ownership after launch.';
  }
  function render() {
    const eras = [...data.eras].sort((a, b) => chronology.indexOf(periods[a.id]) - chronology.indexOf(periods[b.id]));
    ui.el.dataset.profile = p.id;
    ui.field(
      'story',
      'Storyline / time period',
      eras.map(e => ({
        ...opt(e.id, `${periods[e.id]} · ${e.name}${!e.ready ? ' (not built)' : data.unavailable.includes(e.id) ? ' (unavailable)' : ''}`),
        disabled: !e.ready || data.unavailable.includes(e.id)
      })),
      p.id,
      pickProfile
    );
    const fs = [...new Set(p.rows.map(r => r.faction))],
      rows = p.rows.filter(r => r.faction === faction);
    ui.field(
      'faction',
      'Faction',
      fs.map(f => opt(f, p.facts[f].label)),
      faction,
      f => {
        faction = f;
        pickMap(p.rows.find(r => r.faction === f));
      }
    );
    const labels = new Set(),
      dup = new Set();
    for (const r of rows) {
      if (labels.has(r.label)) dup.add(r.label);
      labels.add(r.label);
    }
    ui.field(
      'campaign',
      'Campaign',
      rows.map(r => opt(r.id, dup.has(r.label) ? `${r.label} — ${r.id}` : r.label)),
      row?.id,
      id => pickMap(rows.find(r => r.id === id))
    );
    const techDate = row?.limits.custom && row.slots.includes('tech') && !!p.yearLegend;
    if (techDate) {
      const legends = new Map([...p.yearLegend.matchAll(/^(\d+)\.\s*-\s*(.+)$/gm)].map(m => [+m[1], m[2]])),
        choices = [opt('', 'Campaign default')],
        adj = p.facts[faction].adj;
      for (let n = row.limits.minTech; n <= row.limits.maxTech && choices.length < 256; n++)
        choices.push(opt(n - adj, legends.get(n) || String(n)));
      ui.field('date', 'Starting date', choices, settings.tech ?? '', value => {
        if (value === '') delete settings.tech;
        else settings.tech = +value;
      });
    } else
      ui.field('date', 'Starting date', row?.variants.map(v => opt(v.id, v.date || 'Authored start')) || [], v?.id, id => {
        v = row.variants.find(v => v.id === id);
        delete options.expedition;
        render();
      });
    ui.field(
      'difficulty',
      'Difficulty',
      ['easy', 'medium', 'hard'].map((n, i) => opt(n, p.levels[i] || n)),
      difficulty,
      n => (difficulty = n)
    );
    drawRules();
    for (const [k, title] of Object.entries({
      credits: 'Starting credits',
      tech: 'Starting tech',
      maxTech: 'Maximum tech',
      autoResolve: 'Auto-resolve'
    })) {
      if (!row?.limits.custom || !row.slots.includes(k) || (techDate && k === 'tech')) {
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
    ui.allow(!!v);
    ui.el.dataset.campaign = v?.id || '';
    ui.title.textContent = (row?.label || p.name) + (v?.date ? '  /  ' + v.date : '');
    ui.summary.textContent =
      (row?.description || (row ? '' : 'No listed campaigns in this storyline.')).replace(/\\n/g, '\n') +
      (techDate ? '\n' + p.yearLegend : '');
    if (v) ui.map.show(p, v);
    else ui.map.clear();
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
    pickProfile(data.profiles.some(p => p.id === origin) ? origin : data.profiles[0].id);
    ui.focus();
  } catch (e) {
    if (!closed) ui.status.textContent = 'Campaign atlas unavailable. Restart Universal from this checkout and reopen setup. ' + e.message;
  }
  return true;
}
