import { iconUrl } from '../icons.js';
import { operationSetup, element, action } from './operationsetup.js';
import { skirmishSummary } from './skirmishsummary.js';
import { dynamicTitle, isDynamic, resizeDynamic } from './dynamicmap.js';
import { battlefieldAtlas } from './operationatlas.js';
import { soloLibrary } from './solooperationlibrary.js';
import { sidebarTabs } from './universalsidebartabs.js';
import { skirmishBattlefront } from './skirmishbattlefront.js';
import { skirmishTeams } from './skirmishteams.js';
import { travelDraft, applyTravel } from './skirmishtravel.js';
import { readDetachment } from './tacticalroster.js';
import { activeLanguage } from '../language.js';

export function showSkirmishBriefing(model, { factions, cancel, start, editor, profiles }) {
  const { st, official, customMaps, teamsUsed, remember } = model;
  let battle,
    atlas,
    catalog = [];
  const invalidNumbers = new Set();
  const numberIssue = () =>
    invalidNumbers.size ? `Enter a non-negative whole number for ${[...invalidNumbers].join(' and ').toLowerCase()}.` : '';
  const close = () => {
    remember();
    teams.dispose();
    atlas.close();
    ui.root.remove();
  };
  const ui = operationSetup({
    title: 'Skirmish Battles',
    library: 'Battlefields',
    profiles,
    back: () => {
      close();
      cancel();
    },
    launch: () => {
      const setup = model.setup();
      if (!ui.go.disabled && setup && setup.mapFile === battle?.file && ui.root.isConnected) {
        launchReady(setup);
      }
    }
  });
  async function launchReady(setup) {
    ui.root.inert = true;
    try {
      await Promise.all((setup.skirmishRosters || []).map(ref=>readDetachment(ref,setup.mode,activeLanguage)));
    } catch (e) {
      ui.root.inert = ui.root.hidden = false;
      ui.status.textContent = e.message;
      ui.go.focus();
      return;
    }
    close();
    start(setup);
  }
  ui.detail.remove();
  const summary = skirmishSummary(ui, model);
  const { current, selection } = ui.operation;
  let validDraft = applyTravel(model, selection?.draft, current, factions);
  const bfRules = skirmishBattlefront(model);
  ui.operation.travel = () => travelDraft(model);
  ui.operation.beforeTravel = () => {
    if (!numberIssue()) return true;
    showTab(2);
    settings.querySelector('[aria-invalid="true"]')?.focus();
    return false;
  };
  function showTab(i) {
    teams.dismiss();
    tabs.select(i);
    if (i === 1) teams.enter();
  }
  const tabs = sidebarTabs('skirmish', 'Skirmish setup', ['Battlefield', 'Teams', 'Settings'], showTab);
  const [fields, forces, settings] = tabs.panels;
  fields.classList.add('op-battlefields');
  fields.append(ui.list.parentElement);
  ui.body.append(tabs.bar, ...tabs.panels);
  const dynamic = action(
    'Choose generated space map',
    () => {
      const file = resizeDynamic('medium');
      atlas.selectGenerated({ file, domain: 'space', title: dynamicTitle(file), mod: catalog.find(p => p.id === current)?.name });
    },
    'op-generated'
  );
  if (model.dynamic.length) ui.tools.append(dynamic);
  function validate() {
    bfRules.update(battle?.domain === 'land' && !!battle.file && model.slots.some(s => s.kind === 'you' && s.team >= 0));
    const count = teamsUsed().length,
      supported = count >= 2 && (count === 2 || isDynamic(battle?.file));
    const rosterIssue = battle?.file && model.rosterError();
    ui.go.disabled = !catalog.length || !battle?.file || !supported || !validDraft || !!rosterIssue || !!numberIssue();
    edit.disabled = !catalog.length || !battle?.file || !supported || !!rosterIssue || !!numberIssue();
    summary.show(
      battle,
      catalog.find(p => p.id === current)
    );
    ui.status.textContent = numberIssue()
      ? numberIssue()
      : !validDraft
        ? 'The transferred roster is unavailable. Review both teams before starting.'
        : rosterIssue
          ? rosterIssue
          : battle?.loading
            ? 'Reading battlefield…'
            : count > 2 && !isDynamic(battle?.file)
              ? 'Three or more teams need a generated space map. Choose one in Battlefield or move players onto two teams.'
              : !battle?.file
                ? ''
                : !supported
                  ? 'Add an opponent in Teams.'
                  : [...new Set(model.slots.filter(s=>s.kind!=='closed' && s.team>=0 && !model.isNativeSeat(s)).map(s=>{
                      const ref=model.sourceOf(s),p=model.profileOf(s),note=p?.availability?.[ref.faction]?.[battle.domain+'Note'];
                      return note ? `${p.commanders[ref.faction].family}: ${note}` : null;
                    }).filter(Boolean))].join(' · ');
  }
  async function advanced() {
    if (ui.operation.beforeTravel() === false) return;
    ui.root.inert = true;
    try {
      const ok = await editor({
        start: launchReady,
        cancel: () => {
          ui.root.hidden = false;
          settingsView();
          atlas.refresh();
          edit.focus();
        }
      });
      if (ok) ui.root.hidden = true;
      else ui.status.textContent = 'The original staging dialog is unavailable.';
    } catch {
      ui.status.textContent = 'The original staging dialog is unavailable.';
    } finally {
      ui.root.inert = false;
    }
  }
  const edit = action('Players & options', advanced);
  function settingsView() {
    settings.replaceChildren();
    invalidNumbers.clear();
    for (const [key, title, art] of [
      ['credits', 'Starting credits', 'i_icon_credit.tga'],
      ['popCap', 'Unit cap', 'i_icon_planet_pop.tga']
    ]) {
      const label = element('label', 'op-field op-quantity'),
        caption = element('span', 'op-quantity-label'),
        input = element('input'),
        src = iconUrl(art);
      if (src) {
        const icon = element('img');
        icon.src = src;
        icon.alt = '';
        caption.append(icon);
      }
      caption.append(title);
      Object.assign(input, { type: 'number', inputMode: 'numeric', min: '0', step: '1', required: true, value: st[key] });
      input.setAttribute('aria-label', title);
      input.oninput = () => {
        const n = input.valueAsNumber,
          ok = input.validity.valid && Number.isSafeInteger(n) && n >= 0;
        input.setAttribute('aria-invalid', String(!ok));
        if (ok) {
          st[key] = n;
          invalidNumbers.delete(title);
        } else invalidNumbers.add(title);
        validate();
      };
      label.append(caption, input);
      if (key === 'popCap') {
        const hint = element('small', 'op-number-hint', '0 uses the faction default.');
        hint.id = 'op-unit-cap-hint';
        input.setAttribute('aria-describedby', hint.id);
        label.append(hint);
      }
      settings.append(label);
    }
    for (const [key, title] of [
      ['fog', 'Fog of war'],
      ['preBuilt', 'Pre-built bases']
    ]) {
      const label = element('label', 'op-check'),
        check = element('input');
      check.type = 'checkbox';
      check.checked = st[key];
      check.onchange = () => {
        st[key] = check.checked;
      };
      label.append(check, document.createTextNode(title));
      settings.append(label);
    }
    settings.append(bfRules.root, edit);
  }
  settingsView();
  const teams = skirmishTeams(forces, model, {
    ui,
    profiles: () => catalog,
    advanced,
    change: () => {
      validDraft = true;
      validate();
    }
  });
  document.body.append(ui.root);
  atlas = battlefieldAtlas(ui, {
    onPlanet: () => showTab(0),
    files: { space: [...official.space, ...customMaps.space], land: [...official.land, ...customMaps.land] },
    initialDomain: st.mode,
    change: info => {
      battle = info;
      // Keep the authored map and seat assignments even if this combination
      // cannot start. A third team is never silently merged or moved to space.
      if (battle.file) model.selectPlanet(battle, true);
      teams.render();
      validate();
    }
  });
  soloLibrary()
    .then(data => {
      if (!ui.root.isConnected) return;
      catalog = data.profiles;
      model.configureRosters(catalog, current);
      teams.render();
      validate();
      if (selection?.draft?.pick || !validDraft) showTab(1);
    })
    .catch(() => {}); // The atlas displays the catalog error and disables Start.
  ui.focus();
  return true;
}
