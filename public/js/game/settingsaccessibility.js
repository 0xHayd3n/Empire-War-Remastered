import { captionOptions, feedbackOptions, advisorOptions, contactOptions, announceOptions } from './settingsview.js';
import { languageControl } from './settingslanguage.js';
import { reduceMenuMotion, setReduceMenuMotion } from './menumotion.js';
import { expansion } from '../edition.js';
import { el, action } from './commandui.js';
import { reading, readingChoices, setReading } from './readingpreferences.js';
import { categories, group, check, slider, select, flag, remember } from './settingsfields.js';
import { movieSubtitles, setMovieSubtitles } from './subtitles.js';
import { battlefrontFields } from './settingsbattlefront.js';
import { shooterPreferences, setShooterPreference } from './shooterpreferences.js';

const speechKey = 'swr-narrate-settings',
  rateKey = 'swr-settings-speech-rate';

// Speak the focused control, never text typed into a callsign, relay or search field.
function spokenLabel(control) {
  const name =
    control.getAttribute('aria-label') ||
    control.labels?.[0]?.querySelector('.us-label')?.textContent ||
    control.labels?.[0]?.firstChild?.textContent ||
    control.textContent;
  if (!name?.trim()) return '';
  const value =
    control.type === 'checkbox'
      ? control.checked
        ? 'On'
        : 'Off'
      : control.type === 'range'
        ? control.getAttribute('aria-valuetext') || control.value
        : control.tagName === 'SELECT'
          ? control.selectedOptions[0]?.textContent
          : '';
  return [name.trim(), value].filter(Boolean).join('. ');
}

export function settingsNarration(veil) {
  const synth = window.speechSynthesis,
    supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
  let enabled = flag(speechKey),
    rate = 1,
    own = null,
    timer;
  try {
    const n = Number(localStorage.getItem(rateKey));
    if (n >= 0.5 && n <= 2) rate = n;
  } catch {}
  function stop() {
    clearTimeout(timer);
    if (own) {
      own = null;
      synth.cancel();
    }
  }
  function speak(text, onError) {
    stop();
    if (!supported || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = document.documentElement.lang || navigator.language;
    u.rate = rate;
    u.onend = () => {
      if (u === own) own = null;
    };
    u.onerror = () => {
      if (u !== own) return;
      own = null;
      onError?.();
    };
    own = u;
    try {
      synth.speak(u);
    } catch {
      own = null;
      onError?.();
    }
  }
  function announce(e) {
    if (!enabled || !supported || !e.target.matches('button, input, select, summary')) return;
    stop();
    // Wait for range readouts/selected tab states and don't queue a whole arrow-key traversal.
    timer = setTimeout(() => speak(spokenLabel(e.target)), 120);
  }
  veil.addEventListener('focusin', announce);
  veil.addEventListener('change', announce);
  return {
    controls(page) {
      const g = group(page, 'Settings narration');
      if (!supported) {
        g.append(el('p', '', 'Text-to-speech is unavailable in this browser.'));
        return;
      }
      check(g, 'Read focused settings aloud', enabled, on => {
        enabled = on;
        remember(speechKey, Number(on));
        if (!on) stop();
      });
      slider(
        g,
        'Speech rate',
        rate,
        0.5,
        2,
        0.25,
        v => {
          rate = v;
          remember(rateKey, v);
        },
        v => `${v}×`
      );
      const status = el('p');
      status.setAttribute('role', 'status');
      action(g, 'Preview voice', () => {
        status.textContent = '';
        speak('This is the settings narration voice.', () => {
          status.textContent = 'Could not play speech. Check your system voice and audio output.';
        });
      });
      g.append(status);
    },
    close() {
      veil.removeEventListener('focusin', announce);
      veil.removeEventListener('change', announce);
      stop();
    }
  };
}

export function accessibilityTab(panel, game, _signal, narration) {
  const { pages } = categories(panel, 'Accessibility', ['General', 'Subtitles', 'Colourblindness', 'Text-to-speech'], { horizontal: true });
  pages.General.classList.add('us-columns');
  void languageControl(pages.General, _signal);
  const motion = group(pages.General, 'Menu motion');
  check(
    motion,
    'Always reduce menu and preview animations',
    reduceMenuMotion(),
    setReduceMenuMotion,
    'System reduced-motion preferences are always respected.'
  );
  const tips = group(pages.General, 'Tooltips');
  check(tips, 'Delay tooltips', game.delayTooltips ?? flag('swr-delay-tooltips'), on => {
    game.delayTooltips = on;
    remember('swr-delay-tooltips', Number(on));
  });
  select(tips, 'Tooltip wait time', readingChoices, reading.tooltip, v => setReading('tooltip', v));
  const text = group(pages.General, 'Reading speed');
  select(text, 'Campaign message reveal speed', readingChoices, reading.story, v => setReading('story', v));
  select(text, 'Credits scroll speed', readingChoices, reading.credits, v => setReading('credits', v));
  advisorOptions(pages.General);
  feedbackOptions(pages.General);
  battlefrontFields(pages.General, game, 'motion', 'Battlefront camera motion');
  check(group(pages.Subtitles, 'Movies'), 'Movie subtitles', movieSubtitles(), setMovieSubtitles);
  captionOptions(pages.Subtitles);
  const colours = group(pages.Colourblindness, 'Faction and team colours');
  check(colours, 'Simplified faction colors', !expansion() || flag('swr-simplified-faction-colors'), on => {
    game.simplifiedFactionColors = on || !expansion();
    remember('swr-simplified-faction-colors', Number(on));
  }).disabled = !expansion();
  check(colours, 'Colourblind-safe Battlefront markers', game.shooter?.cfg.colorblind ?? !!shooterPreferences().colorblind, on => {
    setShooterPreference(game.shooter, 'colorblind', on);
  });
  contactOptions(pages.Colourblindness);
  announceOptions(pages['Text-to-speech']);
  narration.controls(pages['Text-to-speech']);
}
