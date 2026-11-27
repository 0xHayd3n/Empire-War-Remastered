// Browsing is presentation only. Only the explicit assign button commits the
// focused profile/affiliation; the physical team and battlefield stay untouched.
import { element, action } from './operationsetup.js';
import { periods, chronology } from './universalmodes.js';
import { commandColor } from './commandcolor.js';
import { commandGroup } from './commandgroups.js';
import { commandMark } from './skirmishcommandpicker.js';
import { ringBackdrop } from './ringbackdrop.js';
import { factionBrowser } from './commandfactionbrowser.js';
import { exhibitName } from './commandcardart.js';
const fold = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’']/g, '')
    .toLocaleLowerCase()
    .trim();
// Era context, not a skirmish date or a character's lifetime. For the two
// EAWX eras these are the supported start years (not unavailable tech slots).
const eraDates = {
  'Old Republic': '3964–3957 BBY',
  'Clone Wars': '22–19 BBY',
  'Galactic Civil War': 'Yavin to Endor · 0–4 ABY',
  'New Republic': '4–12 ABY'
};
export function commanderStage(ui, profiles, pick, back, portraits) {
  const el = element('section', 'op-command-stage'),
    tools = element('div', 'op-ring-tools'),
    search = element('input', 'op-search'),
    rail = element('div', 'op-faction-rail'),
    toggle = action('', () => (browser.shown ? browser.close(true) : browser.open(rows, visible[index])), 'op-faction-toggle'),
    directoryIcon = element('span', 'op-directory-icon'),
    family = element('div', 'op-family-current'),
    stack = element('div', 'op-family-stack'),
    shelf = action('', toggleGroup, 'op-group-link'),
    arena = element('div', 'op-ring-arena'),
    foot = element('div', 'op-ring-caption'),
    bio = element('div', 'op-ring-bio'),
    name = element('h3'),
    dates = element('div', 'op-ring-dates'),
    origin = element('div', 'op-ring-origin'),
    meta = element('div', 'op-ring-meta'),
    prev = action('‹', () => turn(-1), 'op-ring-arrow op-ring-prev'),
    next = action('›', () => turn(1), 'op-ring-arrow op-ring-next'),
    apply = action(
      'Assign',
      () => {
        const r = visible[index];
        if (r) pick(r.p, r.id);
      },
      'op-ring-assign'
    ),
    notice = element('small', 'op-ring-notice');
  const background = ringBackdrop(el);
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Commander staging');
  el.id = 'op-command-stage';
  search.type = 'search';
  search.placeholder = 'Search';
  search.setAttribute('aria-label', 'Search faction, commander, era or mod');
  directoryIcon.setAttribute('aria-hidden', 'true');
  toggle.append(directoryIcon);
  toggle.title = 'Faction directory';
  toggle.setAttribute('aria-label', toggle.title);
  const browser = factionBrowser({
    stage: el,
    search,
    toggle,
    covered: [rail, arena, foot],
    portraits,
    fold,
    choose: choice => {
      const preferred = choice?.preferred || visible[index]?.key;
      section = choice?.section || null;
      // A directory pick scopes the ring. Keep the scope visible and clearable
      // through the existing Search field, without an extra 'All' control.
      search.value = choice?.group || (section && rows.find(r => r.key === preferred)?.heading) || '';
      previousSearch = '';
      previousSection = null;
      filter(preferred);
    }
  });
  prev.setAttribute('aria-label', 'Previous commander');
  next.setAttribute('aria-label', 'Next commander');
  arena.tabIndex = 0;
  arena.setAttribute('aria-label', 'Commander ring. Use left and right arrows to rotate.');
  bio.setAttribute('aria-live', 'polite');
  notice.setAttribute('role', 'status');
  rail.append(family);
  tools.append(toggle, search);
  bio.append(name, dates, origin, meta);
  foot.append(bio, apply);
  arena.append(prev, next, notice);
  el.append(tools, rail, arena, foot, browser.panel);
  let rows = [],
    visible = [],
    section = null,
    previousSection = null,
    index = 0,
    open = false,
    ring = null,
    load = null,
    revision = 0,
    expired = 0,
    dead = false,
    lastReport = '',
    previousSearch = '';
  function directory() {
    const result = [];
    for (const p of profiles())
      for (const id of p.skirmishFactions) {
        const c = p.commanders[id],
          label = c.displayFaction || p.facts[id]?.label || id,
          era = periods[p.id] || 'Other eras',
          art = c.stage,
          group = commandGroup(p.id, id),
          // Warlords is a cross-pack family, not the name of these four seats.
          heading = c.family === 'Warlords' ? label : c.family;
        result.push({
          key: p.id + '/' + id,
          p,
          id,
          c,
          art,
          era,
          label,
          family: c.family,
          group: group?.name || '',
          hue: group?.hue || '',
          heading,
          section: group ? `${group.name}/${heading}` : `${p.id}/${id}`,
          search: fold(
            [
              c.name,
              c.leader,
              c.campaignRole,
              art?.label,
              c.family,
              group?.name,
              group?.aliases,
              group?.hue,
              label,
              p.facts[id]?.label,
              c.family === 'Confederacy' ? 'Separatist Alliance' : '',
              era,
              eraDates[era],
              p.name
            ].join(' ')
          )
        });
      }
    return result.sort(
      (a, b) =>
        (a.group || a.family).localeCompare(b.group || b.family) ||
        a.family.localeCompare(b.family) ||
        a.heading.localeCompare(b.heading) ||
        chronology.indexOf(a.era) - chronology.indexOf(b.era) ||
        a.c.name.localeCompare(b.c.name) ||
        a.p.name.localeCompare(b.p.name)
    );
  }
  function toggleGroup() {
    const r = visible[index];
    if (!r?.group) return;
    if (fold(search.value) === fold(r.group)) {
      search.value = previousSearch;
      section = previousSection;
      previousSearch = '';
      previousSection = null;
    } else {
      previousSearch = search.value;
      previousSection = section;
      section = null;
      search.value = r.group;
    }
    filter(r.key);
  }
  function crestStrip(r) {
    rail.hidden = !r;
    if (!r) return;
    const current = commandMark(r.p, r.id);
    stack.replaceChildren(element('strong', '', r.heading), shelf);
    if (current.dataset.crestKind === 'standard') stack.append(element('small', 'op-crest-credit', 'Universal marker'));
    family.replaceChildren(current, stack);
    shelf.hidden = !r.group;
    shelf.textContent = r.group;
    shelf.style.setProperty('--roster-shade', commandColor(r));
    const filtered = !!r.group && fold(search.value) === fold(r.group);
    shelf.setAttribute('aria-pressed', String(filtered));
    shelf.title = `${r.hue} · ${filtered ? 'Clear group filter' : `Browse ${r.group}`}`;
    shelf.setAttribute('aria-label', filtered ? `Clear ${r.group} filter` : `Browse ${r.group}`);
  }
  let lastX = -1,
    lastWidth = -1;
  function report(e, drawn, x = 0, reduced = false) {
    if (!open) return;
    const w = arena.clientWidth,
      px = Math.round((x * w) / 2);
    if (px !== lastX || w !== lastWidth) {
      foot.style.setProperty('--follow', px + 'px');
      foot.style.setProperty('--half-stage', w / 2 + 'px');
      lastX = px;
      lastWidth = w;
    }
    const code = (e?.rig?.model || '') + ':' + drawn + ':' + !!e?.failed + ':' + (e?.rig?.actionName || '') + ':' + reduced;
    if (code === lastReport) return;
    lastReport = code;
    el.dataset.motion = reduced ? 'held' : 'animated';
    el.dataset.figures = drawn;
    el.dataset.ready = String(!!e?.rig);
    el.dataset.model = e?.rig?.model || '';
    el.dataset.bound = e?.rig?.bound || 0;
    el.dataset.focusAction = e?.rig?.actionName || '';
    notice.textContent = e?.contextLost
      ? 'Graphics interrupted. Restoring the stage…'
      : e?.failed
        ? 'Figure unavailable. Browse away and return to retry.'
        : !e?.rig
          ? 'Loading figure…'
          : '';
  }
  function renderer() {
    if (!load && !dead)
      load = import('./commandring.js')
        .then(({ CommandRing }) => (dead ? null : (ring = new CommandRing(arena, report))))
        .catch(() => {
          if (open) notice.textContent = '3D rendering unavailable.';
          load = null;
          return null;
        });
    return load;
  }
  function display(jump) {
    const token = ++revision,
      r = visible[index];
    lastReport = '!';
    report(null, 0);
    prev.disabled = next.disabled = visible.length < 2;
    apply.disabled = !r;
    crestStrip(r);
    el.dataset.total = visible.length;
    el.dataset.index = index;
    bio.hidden = !r;
    apply.hidden = !r;
    name.textContent = exhibitName(r?.c) || '';
    if (r) {
      const { p, id, c } = r,
        a = p.availability[id];
      Object.assign(apply.dataset, { source: p.id, faction: id, commander: c.name });
      dates.textContent = [r.era, eraDates[r.era]].filter(Boolean).join(' · ');
      dates.title = 'Era reference · BBY / ABY: before / after the Battle of Yavin';
      origin.textContent = p.name;
      meta.textContent = [
        c.campaignRole,
        id === 'Sector_Forces' && c.family === 'Galactic Republic' ? 'Republic-Aligned Sector Forces' : '',
        a?.land && !a.space ? 'Land only' : a?.space && !a.land ? 'Space only' : '',
        r.art?.kind === 'unit' ? 'Field representative' : '',
        r.art?.mod ? `Figure: ${r.art.mod}` : ''
      ]
        .filter(Boolean)
        .join(' · ');
      background.show(r);
      apply.title = `Use ${r.label} from ${p.name}`;
    } else {
      for (const key of ['source', 'faction', 'commander']) delete apply.dataset[key];
      notice.textContent = 'No matching commanders.';
      background.clear();
    }
    // A warm rig can be repositioned in the very next paint, without any fetch.
    const run = g => {
      if (!g || !open || token !== revision) return;
      if (r) g.set(visible, index, jump);
      else {
        g.stop();
        g.gl.clear();
      }
    };
    if (ring) run(ring);
    else renderer()?.then(run);
  }
  function filter(preferred) {
    const q = fold(search.value),
      words = q.split(/\s+/),
      exact = rows.find(r => fold(r.family) === q)?.family,
      exactGroup = q && rows.find(r => fold(r.group) === q)?.group;
    // A group link is an exact collection, not a bag of words that might also
    // occur in another group's faction name or a mod title.
    visible = rows.filter(
      r =>
        (!section || r.section === section) &&
        (exact ? r.family === exact : exactGroup ? r.group === exactGroup : words.every(w => r.search.includes(w)))
    );
    index = Math.max(
      0,
      visible.findIndex(r => r.key === preferred)
    );
    display(true);
  }
  function turn(d) {
    if (visible.length < 2) return;
    index = (index + d + visible.length) % visible.length;
    display(false);
  }
  search.oninput = () => {
    if (browser.shown) {
      browser.filter();
      return;
    }
    section = previousSection = null;
    previousSearch = '';
    filter(visible[index]?.key);
  };
  let sx = null;
  arena.onpointerdown = e => {
    if (e.target.tagName === 'BUTTON') return;
    sx = e.clientX;
    arena.setPointerCapture(e.pointerId);
  };
  arena.onpointercancel = () => (sx = null);
  arena.onpointerup = e => {
    if (sx === null) return;
    const d = e.clientX - sx;
    sx = null;
    if (Math.abs(d) > 24) turn(d < 0 ? 1 : -1);
  };
  function keys(e) {
    if (browser.shown && el.contains(e.target)) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        browser.close(true);
      } else if (e.target === search && e.key === 'ArrowDown') {
        e.preventDefault();
        browser.first();
      }
      return;
    }
    // Escape in a card's native difficulty/color picker belongs to that
    // control. Don't cancel the ring or leave the operation underneath it.
    if (e.key === 'Escape' && e.target.closest?.('.op-seat-card :is(select,input[type="color"])')) {
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape' && !e.target.closest?.('.op-carrying')) {
      e.preventDefault();
      e.stopPropagation();
      back(true);
      return;
    }
    if (!el.contains(e.target)) return;
    if (e.target === search) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        arena.focus();
      }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      turn(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.target === arena && e.key === 'Enter') {
      e.preventDefault();
      apply.click();
    }
  }
  function dropRenderer() {
    clearTimeout(expired);
    ring?.dispose();
    ring = load = null;
  }
  function close() {
    if (!open) return;
    browser.close();
    open = false;
    revision++;
    ring?.stop();
    background.clear();
    ui.root.removeEventListener('keydown', keys, true);
    ui.panel.classList.remove('op-staging');
    ui.canvas.inert = ui.foot.inert = false;
    el.remove();
    clearTimeout(expired);
    expired = setTimeout(dropRenderer, 15000);
  }
  return {
    close,
    dispose() {
      close();
      dead = true;
      dropRenderer();
    },
    warm(ref) {
      if (dead || open || !ref) return;
      const r = directory().find(r => r.p.id === ref.profile && r.id === ref.faction);
      if (!r) return;
      renderer()?.then(g => {
        if (!dead && !open) {
          g?.warm(r);
          clearTimeout(expired);
          expired = setTimeout(dropRenderer, 15000);
        }
      });
    },
    open(ref, seatName, focus = true, previousSeat = null) {
      const preview = visible[index];
      // A player may pick the hero first, then click the seat that should
      // receive it. Otherwise show that seat's existing commander.
      const keepPreview = open && previousSeat && preview && preview.key !== previousSeat.profile + '/' + previousSeat.faction;
      if (!open) {
        clearTimeout(expired);
        open = true;
        ui.canvas.inert = true;
        ui.canvas.after(el);
        ui.panel.classList.add('op-staging');
        ui.root.addEventListener('keydown', keys, true);
      } else browser.close();
      el.setAttribute('aria-label', `${seatName}: commander staging`);
      apply.setAttribute('aria-description', `Assign the displayed roster to ${seatName}.`);
      // The automatic Teams preview doesn't lock Start or steal tab focus.
      ui.foot.inert = focus;
      if (!keepPreview) {
        rows = directory();
        search.value = previousSearch = '';
        section = previousSection = null;
        filter(ref.profile + '/' + ref.faction);
      }
      if (focus) arena.focus({ preventScroll: true });
    }
  };
}
