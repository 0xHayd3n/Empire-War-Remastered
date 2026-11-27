import {startingDifficulty} from './battledrafts.js';
import { activeLanguage } from '../language.js';
import { soloLibrary, storyProfiles } from './solooperationlibrary.js';
import { strategicPreview } from './universalpreview.js';
import { operationSetup, element, action } from './operationsetup.js';
import { storyArchive, storyInfo } from './solostoryarchive.js';
import { sidebarTabs } from './universalsidebartabs.js';
import { campaignFactionCards } from './campaignfactions.js';
import { settingsControls } from './universalcontrols.js';

export function openSoloStories({ start, cancel, signal, profiles, original }) {
  let closed = false,
    group,
    selected,
    difficulty = startingDifficulty(),
    busy = false;
  const ui = operationSetup({
    title: 'New Campaign',
    library: 'Story campaigns',
    profiles,
    scene: 'chart',
    launchLabel: 'Start campaign',
    back: () => {
      if (!busy) {
        close();
        cancel?.();
      }
    },
    launch
  });
  const preview = strategicPreview(ui.canvas);
  const { current, host } = ui.operation;
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener('message', error);
    signal?.removeEventListener('abort', close);
    preview.dispose();
    ui.root.remove();
  }
  function failed(message) {
    busy = ui.root.inert = false;
    ui.status.textContent = message;
    window.universalLaunch?.end();
  }
  function error(e) {
    if (e.source === parent && e.origin === host && e.data?.kind === 'universal-error') failed(e.data.error);
  }
  async function post(endpoint, payload) {
    const r = await fetch('/api/universal/atlas/' + endpoint, { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) throw Error(await r.text());
    return r.json();
  }
  async function launch() {
    if (!selected || closed || busy) return;
    busy = ui.root.inert = true;
    ui.status.textContent = 'Opening campaign…';
    const p = group.p;
    window.universalLaunch?.begin(group.title, p.name);
    try {
      const { ticket } = await post('start', {
        mode: 'story',
        language: activeLanguage,
        profile: p.id,
        target: selected.id,
        row: selected.row,
        tech: selected.tech,
        faction: selected.faction,
        difficulty
      });
      if (closed) return;
      if (p.id === current) {
        const setup = await post('consume', { ticket });
        if (!closed) {
          close();
          start(setup);
        }
      } else if (parent !== window) {
        parent.postMessage({ kind: 'universal-start', id: p.id, ticket }, host);
      } else throw Error('Open the Universal Library window to launch another mod.');
    } catch (e) {
      if (!closed) failed(e.message);
    }
  }
  const title = element('h2', 'op-name'),
    source = element('small', 'op-origin');
  const tabs = sidebarTabs('story', 'Campaign options', ['Info', 'Faction', 'Settings'], i => tabs.select(i));
  let mark;
  const [info, sides, opts] = tabs.panels,
    cards = settingsControls(sides),
    rules = settingsControls(opts);
  const required = element('small', 'op-required', 'Selection needed');
  tabs.buttons[1].append(required);
  ui.detail.append(source, title, tabs.bar, ...tabs.panels);
  function draw() {
    const p = group.p,
      opening = selected || group.choices[0];
    title.textContent = group.title;
    source.textContent = p.name;
    cards.radios(
      'story-faction',
      'Campaign factions',
      campaignFactionCards(p, group.choices.map(c => {
        const fact = p.facts[c.faction];
        return { value: c.id, faction:c.faction, label: fact.label, fact };
      }), selected ? [selected] : group.choices),
      selected?.id,
      id => {
        selected = group.choices.find(c => c.id === id);
        draw();
        mark(group, selected);
      },
      true
    );
    storyInfo(info, group, selected);
    const showRules = () =>
      rules.radios(
        'difficulty',
        'Difficulty',
        ['Easy', 'Medium', 'Hard'].map(label => ({ label, value: label.toLowerCase() })),
        difficulty,
        v => {
          difficulty = v;
          showRules();
        }
      );
    showRules();
    opts.querySelector('.op-action')?.remove();
    if (selected?.native && p.id === current && original)
      opts.append(
        action('Original setup', async () => {
          ui.root.hidden = true;
          const restore = () => {
            if (!closed) {
              ui.root.hidden = false;
              ui.focus();
            }
          };
          try {
            if (
              !(await original({
                difficulty,
                signal,
                cancel: restore,
                start: s => {
                  close();
                  start(s);
                }
              }))
            )
              restore();
          } catch {
            restore();
            ui.status.textContent = 'Original setup unavailable.';
          }
        })
      );
    preview.show(p, { map: opening.map });
    required.hidden = !!selected;
    ui.go.disabled = !selected;
    ui.status.textContent = selected ? '' : 'Choose a faction to start.';
  }
  addEventListener('message', error);
  signal?.addEventListener('abort', close, { once: true });
  document.body.append(ui.root);
  ui.go.disabled = true;
  ui.status.textContent = 'Reading installed stories…';
  ui.focus();
  soloLibrary()
    .then(data => {
      if (closed) return;
      ui.status.textContent = data.unavailable.length ? 'Some installed catalogs could not be read.' : '';
      if (!data.stories.length) {
        ui.status.textContent = 'No installed story campaigns available.';
        return;
      }
      preview.setLibrary(storyProfiles(data));
      mark = storyArchive(ui, data.stories, current, g => {
        if (group !== g) {
          selected = null;
          tabs.select(0);
        }
        group = g;
        draw();
        return selected;
      });
    })
    .catch(e => {
      if (!closed) ui.status.textContent = e.message;
    });
  return true;
}
