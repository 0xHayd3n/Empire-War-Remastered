// These screens describe work owned by the game. No timers, asset fetches or minimum display time.
const BRIEFINGS = {
  boot: ['System link', 'Empire at War', 'Opening game files'],
  menu: ['Command deck', 'Main menu', 'Preparing the command interface'],
  conquest: ['Campaign archive', 'Galactic Conquest', 'Reading available campaigns and factions'],
  galaxy: ['Strategic command', 'Galactic map', 'Preparing planets, fleets and trade routes'],
  era: ['Campaign chronicle', 'Era transition', 'Opening the selected campaign'],
  space: ['Fleet operations', 'Space battle', 'Reading the tactical map'],
  land: ['Ground operations', 'Land battle', 'Reading terrain and landing zones'],
  save: ['Holo archive', 'Restore saved game', 'Reading the saved session'],
  staging: ['Deployment', 'Battle setup', 'Preparing maps and forces'],
  network: ['Communications', 'Multiplayer', 'Preparing the network session']
};
const $ = id => globalThis.document?.getElementById(id);
let owner = 0;
export function showSplash(kind = 'boot', destination = '') {
  const ticket = ++owner, el = $('splash');
  if (el) {
    const [section, title, status] = BRIEFINGS[kind] || BRIEFINGS.boot;
    el.dataset.scene = kind;
    $('briefSection').textContent = section;
    $('briefTitle').textContent = destination || title;
    $('briefStage').textContent = status;
    $('briefMeter').removeAttribute('value');
    el.classList.remove('hidden');
    $('loading')?.classList.add('hidden');
  }
  return () => { if (ticket === owner) hideSplash(); };
}
export function hideSplash() {
  ++owner;
  $('splash')?.classList.add('hidden');
}
export function splashProgress(text, fraction) {
  const el = $('splash');
  if (!el || el.classList.contains('hidden')) return;
  const stage = $('briefStage'), meter = $('briefMeter');
  if (stage.textContent !== text) stage.textContent = text;
  if (Number.isFinite(fraction)) meter.value = Math.min(1, Math.max(0, fraction));
  else meter.removeAttribute('value');
}
export async function whileLoading(kind, title, work) {
  const finish = showSplash(kind, title);
  try { return await work(); } finally { finish(); }
}
export function campaignDestination(id, label = '') {
  const name = String(id || '').replace(/[_-]+/g, ' ').trim();
  const era = /\b(Era|Year)\s*(\d+)\b/i.exec(name), date = /\b(\d+)\s*(BBY|ABY)\b/i.exec(name);
  const period = era ? `${era[1][0].toUpperCase()}${era[1].slice(1).toLowerCase()} ${era[2]}` : date ? `${date[1]} ${date[2].toUpperCase()}` : '';
  const title = label || name;
  return { kind: period ? 'era' : 'galaxy', title: period && !title.toLowerCase().includes(period.toLowerCase()) ? `${title} · ${period}` : title };
}
// A mod may implement its era picker through an ordinary story-choice dialog.
// Show the chronicle only for a set of period choices, never for unrelated hero abilities.
export function periodChoices(rows) {
  return rows.length > 0 && rows.every(r => /(?:^|_)(?:PROGRESSIVE_START|YEAR|ERA)_\d+(?:_|$)/i.test(r.type?.name || ''));
}
export function battleDestination(setup) {
  return String(setup.restore?.name || setup.campaign?.planetType || setup.mapFile || '').split(/[\\/]/).pop().replace(/\.ted$/i, '').replace(/_/g, ' ').trim();
}
export function showMessage(text) {
  hideSplash();
  const panel = $('loading');
  panel?.classList.remove('hidden');
  if (panel) panel.dataset.failed = 'true';
  $('loadText').textContent = text;
}
