import { el, action } from './commandui.js';
import { group, check, integer, select, remember } from './settingsfields.js';
import { SKIRMISH_DRAFT, INSTANT_DRAFT, readBattleDraft, patchBattleDraft, startingDifficulty, startingFilters } from './battledrafts.js';
import { INSTANT_BUDGET, INSTANT_BUDGET_MIN, INSTANT_BUDGET_MAX } from './instantbattle.js';
import { preferences, savePreferences, matchSheet, routeName } from './matchsettings.js';
import { variants } from './operationvariants.js';

export function battleDefaults(parent) {
  const box = el('details', 'us-disclosure'),
    body = el('div', 'us-columns');
  box.append(el('summary', '', 'Battle setup defaults'), body);
  parent.append(box);
  const sk = readBattleDraft(SKIRMISH_DRAFT),
    ib = readBattleDraft(INSTANT_DRAFT),
    put = (key, field) => v => patchBattleDraft(key, field, v);
  const s = group(body, 'Solo skirmish');
  check(s, 'Fog of war', sk.fog ?? true, put(SKIRMISH_DRAFT, 'fog'));
  check(s, 'Pre-built bases', sk.preBuilt ?? true, put(SKIRMISH_DRAFT, 'preBuilt'));
  integer(s, 'Starting credits', sk.credits ?? 6000, 0, Number.MAX_SAFE_INTEGER, put(SKIRMISH_DRAFT, 'credits'));
  integer(s, 'Unit cap', sk.popCap ?? 0, 0, Number.MAX_SAFE_INTEGER, put(SKIRMISH_DRAFT, 'popCap'), '0 uses the faction default.');
  const i = group(body, 'Space Instant Battle');
  check(i, 'Fog of war', ib.fog ?? false, put(INSTANT_DRAFT, 'fog'));
  integer(
    i,
    'Budget for new fleets',
    ib.budget ?? INSTANT_BUDGET,
    INSTANT_BUDGET_MIN,
    INSTANT_BUDGET_MAX,
    put(INSTANT_DRAFT, 'budget'),
    'Saved fleets keep their individual budgets.'
  );
  const c = group(body, 'New campaigns');
  select(
    c,
    'Starting difficulty',
    [
      ['easy', 'Easy'],
      ['medium', 'Normal'],
      ['hard', 'Hard']
    ],
    startingDifficulty(),
    v => remember('swr-new-campaign-difficulty', v)
  );
}
export function galaxyOverlays(parent, game) {
  const active = game.galactic && game.galaxy;
  const g = group(parent, active ? 'Galaxy map overlays · current campaign' : 'Galaxy map overlays · new campaigns');
  for (const [bit, label] of [
    [1, 'Planet income'],
    [2, 'Planetary structures'],
    [4, 'Planet status and corruption'],
    [8, 'Prioritize hero fleet icons']
  ]) {
    const mask = () => (active ? game.filters : startingFilters());
    check(g, label, !!(mask() & bit), on => {
      const next = on ? mask() | bit : mask() & ~bit;
      if (active) {
        game.filters = game.galaxy.displayFilters = next;
        game.ui?.refresh();
      } else remember('swr-new-galaxy-overlays', next);
    });
  }
}
export function matchmakingSettings(panel, signal) {
  const g = group(panel, 'Matchmaking'),
    p = preferences();
  const save = (k, v) => {
    p[k] = v;
    savePreferences(p);
  };
  select(
    g,
    'Playlist category',
    [
      ['social', 'Social'],
      ['ranked', 'Ranked']
    ],
    p.ladder,
    v => save('ladder', v)
  );
  select(
    g,
    'Matchmaking ruleset',
    variants.map(v => [v.id, v.name]),
    p.variant,
    v => save('variant', v)
  );
  const status = el('p', 'us-help'),
    paint = () => (status.textContent = `${p.name} · ${routeName(p.mode)}`);
  paint();
  g.append(status);
  let closeSheet;
  const b = action(g, 'Configure matchmaking network', () => {
    closeSheet = matchSheet(
      panel,
      'network',
      p,
      next => {
        Object.assign(p, next);
        savePreferences(p);
        paint();
      },
      () => {
        closeSheet = null;
        if (b.isConnected) b.focus();
      }
    );
  });
  signal.addEventListener('abort', () => closeSheet?.(), { once: true });
}
