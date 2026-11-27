import { el, action } from './commandui.js';
import { setInput } from './menus.js';
import { tabPanels } from './playtabs.js';
import { mixOptions, voiceChannels } from '../audio.js';
import { group, check, slider, select, percent, remember } from './settingsfields.js';
import { soundtrackOptions, audioChannelLevels, soundKeys } from './settingsview.js';
import { viewOptions, setViewOption, defaultViewOption } from './viewpreferences.js';
import { gfx } from '../gfx.js';
import { preferenceSnapshot, preferenceChanges, settingsHost } from '../playerprefs.js';
import { reading } from './readingpreferences.js';
import { observerDisplay } from './spectatorpreferences.js';
import { videoTab } from './settingsvideo.js';
import { controlsTab } from './settingskeyboard.js';
import { gameplayTab, socialTab } from './settingstweaks.js';
import { accessibilityTab, settingsNarration } from './settingsaccessibility.js';

function audioTab(panel, game) {
  panel.classList.add('us-columns');
  const audio = game.audio;
  const mix = group(panel, 'Volume');
  const master = value => {
    audio.setMasterVolume(value);
    remember('swr-master', value);
  };
  slider(mix, 'Master volume', audio.masterVolume, 0, 1, 0.01, master, percent);
  for (const [name, key, id] of [
    ['Sound effects', 'sfxVolume', 'sfxVol'],
    ['Dialogue', 'voiceVolume', 'voiceVol'],
    ['Music', 'musicVolume', 'musicVol']
  ])
    slider(mix, name, audio[key], 0, 1, 0.01, v => setInput(id, v), percent);
  const playback = el('div');
  panel.append(playback);
  const output = group(playback, 'Playback');
  select(
    output,
    'Audio output',
    [
      ['headphones', 'Headphones (3D)'],
      ['speakers', 'Speakers']
    ],
    audio.headphones ? 'headphones' : 'speakers',
    v => audio.setHeadphones(v === 'headphones')
  );
  for (const [key, label] of Object.entries(mixOptions)) check(output, label, audio.mixOptions[key], on => audio.setMixOption(key, on));
  soundtrackOptions(playback, audio);
  const voices = group(playback, 'Battle voices');
  for (const [key, label] of Object.entries(voiceChannels))
    check(voices, label, audio.voiceChannels[key] !== false, on => audio.setVoiceChannel(key, on));
  audioChannelLevels(group(panel, 'Channel levels'));
  action(
    panel,
    'Restore audio defaults',
    () => {
      master(1);
      setInput('sfxVol', 0.7);
      setInput('voiceVol', 0.9);
      setInput('musicVol', 0.45);
      audio.setHeadphones(true);
      for (const key of Object.keys(voiceChannels)) audio.setVoiceChannel(key, true);
      for (const key of Object.keys(mixOptions)) audio.setMixOption(key, true);
      for (const k of soundKeys) setViewOption(k, defaultViewOption(k));
      audio.refreshMusicSpeech();
      panel.replaceChildren();
      audioTab(panel, game);
      panel.querySelector('.us-secondary').focus({ preventScroll: true });
    },
    'us-secondary'
  );
}

const tabs = [
  ['Video', videoTab],
  ['Audio', audioTab],
  ['Controls', controlsTab],
  ['Gameplay', gameplayTab],
  ['Social', socialTab],
  ['Accessibility', accessibilityTab]
].map(([label, render]) => ({ key: label.toLowerCase().replaceAll(' ', '-'), label, render }));

export function settingsPage(game, leave) {
  const veil = el('dialog', 'universal-settings');
  veil.dataset.universalScreen = 'settings';
  veil.setAttribute('aria-label', 'Settings');
  const browser = el('div', 'us-browser'),
    footer = el('footer', 'us-footer');
  action(footer, 'Back', leave, 'us-back');
  veil.append(browser, footer);
  // Let native inputs handle arrows, Space, Tab and Escape; keep gameplay shortcuts outside the page.
  veil.onkeydown = veil.onkeyup = e => e.stopPropagation();
  veil.oncancel = e => {
    e.preventDefault();
    leave();
  };
  document.body.append(veil);
  const narration = settingsNarration(veil);
  const host = settingsHost();
  function snapshot() {
    // Some owners serialize all their defaults on the first edit. Compare their actual
    // values, not the presence of the storage record, to keep untouched mod choices.
    const a = game.audio;
    return preferenceSnapshot(localStorage, {
      'swr-gfx': gfx, 'swr-player-view-v1': viewOptions, 'swr-reading-speeds': reading,
      'swr-volume': {music:a.musicVolume,sfx:a.sfxVolume,voice:a.voiceVolume},
      'swr-voice-channels': a.voiceChannels, 'swr-sound-mix': a.mixOptions,
      'swr-observer-display': observerDisplay()
    });
  }
  let before;
  if (host) try { before = snapshot(); } catch {}
  function publish() {
    if (!before) return;
    try {
      const after = snapshot(), patch = preferenceChanges(before, after);
      if (Object.keys(patch).length) parent.postMessage({kind:'save-player-preferences',patch}, host);
      before = after;
    } catch { /* Storage can be disabled; Back must still work. */ }
  }
  veil.addEventListener('change', publish);
  window.addEventListener('pagehide', publish);
  let tabLife;
  tabPanels(
    browser,
    tabs,
    tabs[0].key,
    (panel, key) => {
      tabLife?.abort();
      const { signal } = (tabLife = new AbortController());
      panel.scrollTop = 0;
      Promise.resolve()
        .then(() => {
          if (!signal.aborted) return tabs.find(t => t.key === key).render(panel, game, signal, narration);
        })
        .catch(error => {
          if (signal.aborted) return;
          console.warn('Settings:', error);
          panel.append(el('p', 'us-help', 'Could not load these settings. Select this tab again to retry.'));
        });
    },
    { prefix: 'us', label: 'Settings categories', panelClass: 'us-panel' }
  );
  browser.querySelector('.us-tabs').addEventListener('focusin', e => e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  const focus = () => veil.querySelector('[aria-selected="true"]').focus({ preventScroll: true });
  veil.showModal();
  focus();
  return {
    veil,
    focus,
    close() {
      publish();
      window.removeEventListener('pagehide', publish);
      tabLife.abort();
      narration.close();
      veil.close();
      veil.remove();
    }
  };
}
