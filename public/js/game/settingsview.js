import { check, select, group } from './settingsfields.js';
import { el, action } from './commandui.js';
import { configureMessageReader } from './battlemessages.js';
import { viewChoices, defaultViewOption, viewOptions as prefs, setViewOption } from './viewpreferences.js';
import { movieCaptionStyle } from './moviecaptionstyle.js';
const rate = n => `${n}×`,
  percent = n => `${Math.round(100 * n)}%`;
function option(g, key, label, format = rate, after) {
  const choices = viewChoices(key),
    put = v => {
      setViewOption(key, v);
      after?.();
    };
  const input = !choices
    ? check(g, label, prefs[key], put)
    : select(
        g,
        label,
        choices.map(v => [v, format(v)]),
        prefs[key],
        v => put(choices.find(x => String(x) === v))
      );
  input.dataset.viewOption = key;
  return input;
}
function restore(g, label) {
  action(
    g,
    label,
    () => {
      for (const input of g.querySelectorAll('[data-view-option]')) {
        const value = defaultViewOption(input.dataset.viewOption);
        if (input.type === 'checkbox') input.checked = value;
        else input.value = String(value);
        input.dispatchEvent(new Event('change'));
      }
    },
    'us-secondary'
  );
}
export function cameraOptions(parent) {
  const g = group(parent, 'Strategy camera and selection');
  option(g, 'pan', 'Keyboard and edge pan speed');
  option(g, 'edgeWidth', 'Edge scroll region');
  option(g, 'turn', 'Tactical camera turn speed');
  option(g, 'wheel', 'Tactical wheel zoom speed');
  option(g, 'invertWheel', 'Reverse strategy camera wheel');
  option(g, 'cursorZoom', 'Zoom toward cursor on space and galaxy maps');
  option(g, 'multiClick', 'Tactical same-type double-click window', n => (n ? rate(n) : 'Off'));
  restore(g, 'Restore camera defaults');
}
export function spaceOrderOptions(parent) {
  const g = group(parent, 'Space battle orders');
  option(
    g,
    'groupCenter',
    'Centre camera on control group recall',
    v => ({ selected: 'When already selected', always: 'Always', never: 'Never' })[v]
  );
  option(g, 'showWaypoints', 'Always show paths for selected ships');
  option(g, 'hazardShortcut', 'Allow double right-click to cross hazard fields');
  restore(g, 'Restore space order defaults');
}
export function unitCameraOptions(parent) {
  const g = group(parent, 'Unit tracking and direct control');
  option(g, 'orbitLook', 'Mouse look speed while tracking or piloting');
  option(g, 'orbitInvert', 'Invert vertical look while tracking or piloting');
  option(g, 'chaseBlend', 'Direct-control camera transition time', n => (n ? rate(n) : 'Instant'));
  restore(g, 'Restore unit camera defaults');
}
export function unitBarOptions(parent) {
  const g = group(parent, 'Tactical unit health');
  option(
    g,
    'barMode',
    'Show overhead health bars',
    v =>
      ({
        native: 'Battle default',
        damaged: 'Damaged, selected or hovered',
        focus: 'Selected or hovered',
        off: 'Off'
      })[v]
  );
  option(g, 'barWidth', 'Overhead bar width', percent);
  option(g, 'barShields', 'Include shield bars');
  restore(g, 'Restore unit bar defaults');
}
export function directOverlayOptions(parent) {
  const g = group(parent, 'Tactical direct control');
  option(g, 'fireArcs', 'Weapon firing arcs', v => ({ filled: 'Filled sectors', outline: 'Outlines only', off: 'Off' })[v]);
  option(g, 'chaseReticle', 'Direct-control sight size', percent);
  option(g, 'chaseTip', 'Show direct-control mouse reminder');
  restore(g, 'Restore direct-control display');
}
export function cinematicOptions(parent) {
  const g = group(parent, 'Player cinematic camera');
  option(g, 'cineTime', 'Time between cinematic cuts');
  option(g, 'cineBars', 'Cinematic letterbox height', n => (n ? percent(n) : 'Off'));
  option(g, 'cineReturn', 'Return to previous map position on exit');
  g.append(
    el('p', 'us-help', 'Applies when you turn on the tactical cinematic camera. Mission sequences keep their own timing and framing.')
  );
  restore(g, 'Restore cinematic camera defaults');
}
export function touchOptions(parent) {
  const g = group(parent, 'Touch gestures');
  option(g, 'touchHold', 'Hold for right-click', n => `${n} ms`);
  option(g, 'touchSlop', 'Finger movement before dragging', n => `${n} px`);
  option(g, 'touchPan', 'Two-finger pan speed');
  option(g, 'touchPinch', 'Pinch zoom sensitivity');
  option(g, 'touchTwist', 'Two-finger rotation', n => (n ? rate(n) : 'Off'));
  option(g, 'touchRing', 'Show ring on long press');
  restore(g, 'Restore touch defaults');
}
export function checkpointOptions(parent) {
  const g = group(parent, 'Galactic Conquest autosaves');
  option(g, 'saveBeforeBattle', 'Save before entering a tactical battle');
  option(g, 'saveCycles', 'Periodic campaign checkpoint', n => (n ? `Every ${n === 1 ? 'cycle' : n + ' cycles'}` : 'Off'));
  g.append(
    el(
      'p',
      'us-help',
      'Solo Galactic Conquest only. The periodic checkpoint replaces its own save slot, not manual, opening or pre-battle saves.'
    )
  );
}
export function radarOptions(parent) {
  const g = group(parent, 'Strategy minimap');
  option(g, 'radarScale', 'Unit and planet marker size');
  option(g, 'radarGrid', 'Tactical grid texture');
  option(g, 'radarView', 'Show camera footprint');
  option(g, 'radarLine', 'Camera outline thickness');
  restore(g, 'Restore minimap defaults');
}
export function mapTextOptions(parent) {
  const g = group(parent, 'Galaxy map text');
  option(g, 'labelScale', 'Planet name and income text size', percent);
  option(g, 'whiteNames', 'Use white galaxy labels');
  option(g, 'labelOutline', 'Always outline galaxy labels');
  restore(g, 'Restore label defaults');
  const routes = group(parent, 'Galaxy routes and fleets');
  option(routes, 'routeWidth', 'Trade route line width', percent);
  option(routes, 'routeSparks', 'Animate traffic on trade routes');
  option(routes, 'fleetTracks', 'Fleet movement lines', v => ({ visible: 'All visible fleets', mine: 'My faction only', off: 'Off' })[v]);
  restore(routes, 'Restore route defaults');
}
export function observerLogOptions(parent, view) {
  const g = group(parent, 'Spectator event log');
  option(g, 'logMerge', 'Group repeated events within', n => (n ? `${n} s` : 'Do not group'));
  option(g, 'logRows', 'Maximum displayed event rows', String, () => view?.renderLog());
  option(g, 'logLocation', 'Jump to event location instead of following the unit');
  restore(g, 'Restore spectator log defaults');
}
export function replayRateOption(parent) {
  option(parent, 'replayRate', 'Playback speed for new replays');
}
export function captionOptions(parent) {
  const preview = el('p', 'us-caption-preview'),
    sample = el('span', '', 'This is a sample movie caption.');
  preview.append(sample);
  const paint = () => {
    movieCaptionStyle(sample, 16);
    preview.style.alignItems = prefs.captionPosition === 'top' ? 'flex-start' : 'flex-end';
  };
  const g = group(parent, 'Caption appearance');
  option(g, 'captionScale', 'Movie caption size', percent, paint);
  const labels = {
    white: 'White',
    yellow: 'Yellow',
    cyan: 'Cyan',
    none: 'None',
    dim: 'Dim',
    black: 'Solid black',
    bottom: 'Bottom',
    top: 'Top'
  };
  for (const [k, name] of [
    ['captionInk', 'Caption text colour'],
    ['captionPlate', 'Caption background'],
    ['captionPosition', 'Caption position']
  ])
    option(g, k, name, v => labels[v], paint);
  paint();
  g.append(preview);
  restore(g, 'Restore caption appearance');
}
export function feedbackOptions(parent) {
  const g = group(parent, 'Tactical feedback');
  option(g, 'spaceShake', 'Space explosion camera shake', percent);
  option(g, 'messageTime', 'Battle message duration');
  option(g, 'messageCount', 'Maximum visible battle messages', String);
  option(g, 'stormFlash', 'Land weather lightning brightness', percent);
  option(g, 'bombardFlash', 'Orbital bombardment lighting', percent);
  restore(g, 'Restore tactical feedback defaults');
}
export function advisorOptions(parent) {
  const g = group(parent, 'Advisor messages');
  option(g, 'advisorHold', 'Advisor message display time');
  option(g, 'tacticalHintInterval', 'Time between space battle hints');
}
export function contactOptions(parent) {
  const g = group(parent, 'Tactical radar contacts');
  option(g, 'radarShapes', 'Distinguish contacts by shape');
  g.append(el('p', '', 'Friendly units are circles, enemies are triangles and neutral contacts are squares.'));
}
export function announceOptions(parent) {
  const g = group(parent, 'Screen reader');
  option(g, 'messageReader', 'Announce incoming tactical messages', undefined, () => configureMessageReader());
  g.append(el('p', '', 'Uses your screen reader. New messages are announced without interrupting current speech.'));
}
export function audioChannelLevels(parent) {
  for (const [k, n] of [
    ['guiGain', 'Interface sound level'],
    ['ambientGain', 'Ambient chatter level'],
    ['replyGain', 'Unit response level'],
    ['hudGain', 'HUD announcement level']
  ])
    option(parent, k, n, percent);
}
export const soundKeys = [
  'speechMusic',
  'peaceDelay',
  'movieMix',
  'musicFade',
  'musicResume',
  'duckLevel',
  'guiGain',
  'ambientGain',
  'replyGain',
  'hudGain'
];
export function soundtrackOptions(parent, audio) {
  const g = group(parent, 'Music and movies');
  option(g, 'movieMix', 'Movie soundtrack relative to music', percent);
  option(g, 'musicFade', 'Fade between music tracks');
  option(g, 'musicResume', 'Remember position in event playlists');
  option(g, 'duckLevel', 'Effects volume ceiling during dialogue', percent);
  option(g, 'speechMusic', 'Background music during mission dialogue', percent, () => audio.refreshMusicSpeech());
  option(g, 'peaceDelay', 'Delay before calm tactical music resumes');
}
