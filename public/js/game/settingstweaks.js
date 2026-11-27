import { unitBarOptions, directOverlayOptions, mapTextOptions, radarOptions, replayRateOption, checkpointOptions, observerLogOptions } from './settingsview.js';
import { battlefrontRuleDefaults } from './settingsbattlefrontrules.js';
import { battlefrontFields } from './settingsbattlefront.js';
import { battleDefaults, galaxyOverlays, matchmakingSettings } from './settingsstaging.js';
import { campaignDefaultsPanel } from './settingscampaign.js';
import { particleCap, setParticleCap } from '../particles.js';
import { PARTICLE_CAP } from '../particlesim.js';
import {
  STRATEGIC_FRAMES,
  STRATEGIC_DEFAULT,
  tacticalSpeed,
  saveTacticalSpeed,
  strategicIndex,
  strategicIndexOf,
  strategicMultiplier,
  saveStrategicIndex
} from './galacticspeed.js';
import { TWEAKS, TWEAK_SLIDERS, BATTLEFRONT, BATTLEFRONT_CHECKS, setInput } from './menus.js';
import { tacticalHintsEnabled, saveTacticalHints } from './advisor.js';
import { reportGraphs } from './spectator.js';
import { observerDisplay, saveObserverDisplay, logFilters, spectatorTeamVision, setSpectatorTeamVision } from './spectatorpreferences.js';
import { mountSocial } from './socialpanel.js';
import { el, action } from './commandui.js';
import { categories, group, check, select, slider, flag, remember } from './settingsfields.js';

const placement = {
  optRecordBattles: 'replay',
  optCaptureBars: 'interface',
  optAllUnitIcons: 'interface',
  optKeyLabels: 'interface',
  optDiscord: 'social'
};
function liveCheck(g, t, after) {
  const input = document.getElementById(t.input);
  return check(
    g,
    t.label,
    input.checked,
    v => {
      setInput(t.input, v);
      after?.(v);
    },
    input.parentElement.title
  );
}
function sectionChecks(g, section) {
  for (const t of TWEAKS) if ((placement[t.input] || 'tweaks') === section) liveCheck(g, t);
}
export function socialTab(panel, game, signal) {
  const network = group(panel, 'Commander network');
  const unmount = mountSocial(network, { settingsOnly: true });
  signal.addEventListener('abort', unmount, { once: true });
  matchmakingSettings(panel, signal);
  if (TWEAKS.some(t => placement[t.input] === 'social')) sectionChecks(group(panel, 'Presence'), 'social');
}
export function replayControls(panel) {
  const recording = group(panel, 'Battle recordings');
  sectionChecks(recording, 'replay');
  replayRateOption(recording);
  recording.append(el('p', 'us-help', 'Space skirmish replays run to the recorded moment and pause automatically.'));
}
export function gameplayTab(panel, game) {
  const { pages } = categories(panel, 'Gameplay', ['General', 'HUD', 'Replays and Spectate'], { horizontal: true });
  const general = pages.General,
    watch = pages['Replays and Spectate'];
  for (const page of Object.values(pages)) page.classList.add('us-columns');
  const speed = group(general, 'Game speed');
  const campaign = !!game.galactic,
    title = !!game.setup?.attract;
  const setTactical = v => {
    saveTacticalSpeed(v);
    if (!campaign) game.setSpeed?.(v);
  };
  const setStrategic = i => {
    if (game.speedLocked?.()) return;
    saveStrategicIndex(i);
    if (campaign) game.setSpeed(strategicMultiplier(i));
  };
  if (!campaign) slider(speed, 'Tactical game speed', tacticalSpeed(), 0.5, 2, 0.05, setTactical, n => `${n}×`);
  if (campaign || title)
    slider(
      speed,
      'Galactic game speed',
      campaign ? strategicIndexOf(game.speed) : strategicIndex(),
      0,
      STRATEGIC_FRAMES.length - 1,
      1,
      setStrategic,
      i => `${Number(strategicMultiplier(i).toFixed(2))}×`
    ).disabled = !!game.speedLocked?.();
  if (title || (campaign && !game.net && game.setup.menuFamily === 'conquest')) checkpointOptions(general);
  const rules = group(general, 'Battle rules');
  liveCheck(rules, { input: 'optAutofire', label: 'Abilities default to autofire' });
  const autoResolve = on => {
    game.autoResolveOption = on;
    remember('swr-auto-resolve', Number(on));
  };
  if (campaign || title) check(rules, 'Auto-resolve galactic battles', game.autoResolveOption ?? flag('swr-auto-resolve'), autoResolve);
  if (campaign && !game.net)
    select(
      rules,
      'Campaign difficulty',
      [
        ['easy', 'Easy'],
        ['medium', 'Medium'],
        ['hard', 'Hard']
      ],
      game.setup.difficulty || 'medium',
      v => game.setDifficulty(v)
    );
  const tacticalHUD = group(pages.HUD, 'Tactical interface');
  sectionChecks(tacticalHUD, 'interface');
  check(
    tacticalHUD,
    'Tactical advisor hints',
    game.advisor?.enabled ?? tacticalHintsEnabled(),
    on => {
      if (game.advisor) game.advisor.setEnabled(on);
      else saveTacticalHints(on);
    },
    'Periodic tips from the tactical droid. Mission messages and campaign hint rules are separate.'
  );
  unitBarOptions(pages.HUD);
  directOverlayOptions(pages.HUD);
  radarOptions(pages.HUD);
  mapTextOptions(pages.HUD);
  galaxyOverlays(pages.HUD, game);
  battlefrontFields(pages.HUD, game, 'hud', 'Battlefront interface');
  battlefrontFields(pages.HUD, game, 'navigation', 'Battlefront radar and compass');
  battlefrontFields(pages.HUD, game, 'feedback', 'Battlefront combat feedback');
  replayControls(watch);
  const spectate = group(watch, 'Spectating');
  const view = game.spectatorView,
    prefs = observerDisplay();
  for (const [key, label] of [
    ['log', 'Show battle log'],
    ['balance', 'Show team power balance'],
    ['clock', 'Show spectator clock']
  ]) {
    check(spectate, label, prefs[key], on => {
      prefs[key] = on;
      saveObserverDisplay(key, on);
      view?.applyDisplay(prefs);
    });
  }
  select(spectate, 'Battle log filter', logFilters, view?.filter ?? prefs.filter, v => {
    saveObserverDisplay('filter', v);
    if (view) {
      view.filter = v;
      view.renderLog();
    }
  });
  select(
    spectate,
    'First battle report graph',
    reportGraphs.map(n => [n, n]),
    prefs.graph,
    v => {
      saveObserverDisplay('graph', v);
      if (game.reportView) game.reportView.graphTab = reportGraphs.indexOf(v);
    }
  );
  check(
    spectate,
    'Start with the followed team’s fog of war',
    spectatorTeamVision(),
    setSpectatorTeamVision,
    'Applies to new spectator sessions in battles with fog of war enabled.'
  );
  observerLogOptions(watch, view);
  tacticalTweaks(general);
  battlefrontRuleDefaults(general);
  battlefrontFields(general, game, 'gameplay', 'Battlefront deployment and views');
  action(
    general,
    'Restore game speed and rules',
    () => {
      if (!campaign) setTactical(1);
      if (campaign || title) {
        setStrategic(STRATEGIC_DEFAULT);
        autoResolve(false);
      }
      if (campaign && !game.net) game.setDifficulty('medium');
      setInput('optAutofire', true);
      panel.replaceChildren();
      gameplayTab(panel, game);
      panel.querySelector('.us-secondary').focus({ preventScroll: true });
    },
    'us-secondary'
  );
  battleDefaults(general);
  campaignDefaultsPanel(general);
}
function tacticalTweaks(panel) {
  const tactics = group(panel, 'Tactical options');
  sectionChecks(tactics, 'tweaks');
  slider(tactics, 'Particle count', particleCap(), PARTICLE_CAP.min, PARTICLE_CAP.max, PARTICLE_CAP.step, setParticleCap, n =>
    n.toLocaleString()
  );
  const battle = group(panel, 'Battlefront'),
    extra = el('div');
  const toggle = liveCheck(battle, BATTLEFRONT, on => {
    extra.hidden = !on;
  });
  extra.hidden = !toggle.checked;
  battle.append(extra);
  for (const t of BATTLEFRONT_CHECKS) liveCheck(extra, t);
  for (const s of TWEAK_SLIDERS) {
    const input = document.getElementById(s.input);
    slider(extra, s.label, input.value, s.min, s.max, s.step, v => setInput(s.input, v), s.show, input.parentElement.title);
  }
}
