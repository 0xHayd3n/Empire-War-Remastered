import { loadMapHeader } from '../ted.js';
import { strategicPreview } from './universalpreview.js';
import { soloLibrary, fieldProfiles, battlefieldEntries } from './solooperationlibrary.js';
import { element } from './operationsetup.js';
import { skirmishFieldList } from './skirmishfieldlist.js';

const lower = s => String(s || '').toLocaleLowerCase();
function portrait(art) {
  const el = element('span', 'op-globe');
  el.setAttribute('aria-hidden', 'true');
  if (art) {
    const size = 42;
    el.style.backgroundImage = `url('/api/universal/portraits/${art[0]}.png')`;
    el.style.backgroundSize = `${4 * size}px auto`;
    el.style.backgroundPosition = `-${(art[1] % 4) * size}px -${Math.floor(art[1] / 4) * size}px`;
  }
  return el;
}
// Both tactical boards use one scroll track. Planet parents are navigation;
// only a leaf supplies the profile, actual world, domain and TED for launch.
export function battlefieldAtlas(ui, { files, change, initialDomain = 'space', onPlanet }) {
  const { current, selection, openField } = ui.operation;
  const preview = strategicPreview(ui.canvas, { selectable: true, showBattlefieldNames: true });
  let closed = false,
    entries = [],
    selected = null,
    serial = 0,
    chartWorld = null,
    lastMatch,
    found;
  ui.root.classList.add('op-field-atlas');
  const search = element('input', 'op-search');
  search.type = 'search';
  search.placeholder = 'Search planet, mod, land or space';
  search.setAttribute('aria-label', 'Search battlefields');
  search.maxLength = 150;
  search.value = selection?.query || '';
  ui.tools.append(search);
  const list = skirmishFieldList(ui.list, portrait, pick);
  function matches() {
    const key = JSON.stringify([entries.length, chartWorld, search.value]);
    if (key !== lastMatch) {
      lastMatch = key;
      const query = lower(search.value).trim().replace(/\s+/g, ' '),
        words = query.split(' ');
      found = entries.filter(e => (chartWorld ? e.chartId === chartWorld : words.every(w => e.key.includes(w))));
      if (!chartWorld && query) {
        const exact = found.filter(f => ` ${query} `.includes(` ${lower(f.world.name)} `));
        const longest = exact.reduce((n, f) => Math.max(n, f.world.name.length), 0);
        if (longest) found = exact.filter(f => f.world.name.length === longest);
      }
    }
    return found;
  }
  function render(reveal = false) {
    list.update(matches(), selected, lastMatch, search.value.trim(), reveal);
  }
  function pick(f) {
    if (f.p.id !== current) return openField(f.p.id, f.world.id, f.domain, search.value, f.file);
    select(f);
    preview.locate(f.chartId);
    list.focus(f);
  }
  search.oninput = () => {
    chartWorld = null;
    if (selected && !matches().includes(selected)) select(null);
    else render();
  };
  ui.canvas.querySelector('.uc-map').setAttribute('aria-label', 'Galaxy battlefield selector');
  ui.canvas.onclick = e => {
    const id = e.target.closest('[data-planet]')?.dataset.planet || preview.labelHit(e),
      f = id && entries.find(f => f.chartId === id);
    if (!f) return;
    onPlanet?.();
    chartWorld = id;
    search.value = f.world.name;
    if (selected?.chartId !== id) select(null);
    else render();
    (ui.list.querySelector('.op-field-leaf') || ui.list.querySelector('button'))?.focus({ preventScroll: true });
  };
  async function select(f) {
    selected = f;
    preview.mark(f?.chartId);
    render();
    ui.canvas.querySelector('.op-selected')?.classList.remove('op-selected');
    if (f?.chartId) ui.canvas.querySelector(`[data-planet="${CSS.escape(f.chartId)}"]`)?.classList.add('op-selected');
    const n = ++serial;
    if (f?.generated) {
      change(f);
      return;
    }
    const info = {
      world: f?.world,
      domain: f?.domain || initialDomain,
      file: null,
      authored: !!f?.authored,
      title: f?.listTitle,
      mod: f?.p.name
    };
    if (!f) {
      change(info);
      return;
    }
    let valid;
    if (f.authored) {
      change({ ...info, loading: true });
      const h = await loadMapHeader(f.file).catch(() => null);
      valid = h?.kind === (f.domain === 'land' ? 1 : 2);
    } else valid = files[f.domain].includes(f.file);
    if (n === serial && !closed) change({ ...info, file: valid ? f.file : null });
  }
  ui.go.disabled = true;
  ui.status.textContent = 'Reading installed battlefields…';
  soloLibrary()
    .then(data => {
      if (closed) return;
      const profiles = fieldProfiles(data), chart = profiles[0];
      entries = battlefieldEntries(data);
      if (chart) {
        preview.setLibrary(profiles);
        preview.show(chart, { map: 0 });
      }
      ui.canvas.append(element('p', 'op-map-help', 'Choose a world to see its battlefields · Scroll to zoom'));
      const initial =
        selection &&
        entries.find(
          f =>
            f.p.id === current &&
            f.world.id === selection.world &&
            f.domain === selection.domain &&
            (!selection.file || f.file === selection.file)
        );
      select(initial);
      render(true);
      if (selection && !initial) ui.status.textContent = 'That battlefield is no longer installed. Choose another.';
      if (data.unavailable.length) ui.tools.append(element('small', 'op-origin', 'Some installed catalogs could not be read.'));
    })
    .catch(e => {
      if (!closed) {
        ui.status.textContent = e.message;
        ui.go.disabled = true;
      }
    });
  return {
    refresh: () => select(selected),
    selectGenerated: info => {
      chartWorld = null;
      search.value = '';
      select({ ...info, generated: true });
    },
    close() {
      closed = true;
      serial++;
      list.close();
      preview.dispose();
    }
  };
}
