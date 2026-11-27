import { el, action, link, loadList, universalHost, switchProfile, option, askDesk } from './commandui.js';
import { categoryDesk } from './workshopcategories.js';
import { sourceDesk } from './workshopsources.js';
import { archiveRows, importDesk, archiveActions } from './workshopimports.js';
import { describeContent, loadContent } from '../content.js';

const api = '/api/title-workshop/',
  store = 'swr-workshop-playset-v1',
  setsKey = store + '-collection';
const steam = 'https://steamcommunity.com/app/32470/workshop/';
const isId = id => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id);
const serial = n => String(n).padStart(2, '0');
function art(row, large = false) {
  const plate = el('span', 'wx-plate');
  plate.setAttribute('aria-hidden', 'true');
  plate.dataset.chart = String(row.number % 4);
  if (row.art && isId(row.id)) {
    const img = el('img', row.scene ? 'wx-scene' : 'wx-insignia');
    img.alt = '';
    img.loading = large ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.onerror = () => img.remove();
    img.src = api + 'picture/' + row.id;
    plate.append(img);
  }
  return plate;
}

export async function workshopDesk(root) {
  const universal = !!universalHost(),
    canSwitch = universal && parent !== window;
  if (!document.getElementById('workshop-exchange-css')) {
    const css = el('link');
    css.id = 'workshop-exchange-css';
    css.rel = 'stylesheet';
    css.href = new URL('../../workshop-exchange.css', import.meta.url).href;
    document.head.append(css);
  }
  root.className = 'workshop-exchange';
  root.innerHTML = `<section class="wx-categories" aria-label="Mod categories"></section><div class="wx-tools"><input type="search" aria-label="Search mods" placeholder="Search name, Workshop ID or collection…"><select aria-label="Filter library"><option value="all">Any status</option><option value="installed">Installed items</option><option value="absent">No local Steam item</option><option value="ready">Playable packs</option><option value="collection">In a collection</option><option value="deck">In playset</option></select></div>
    <p role="status" class="wx-status"></p><div class="wx-spread"><section aria-label="Mod gallery" class="wx-shelf"><header class="wx-strip"><b class="wx-section-name">All mods</b><span class="wx-count"></span></header><div class="wx-wall"></div></section>
    <section class="wx-dossier" id="wx-dossier" aria-label="Selected mod preview" tabindex="-1"></section></div><section class="playset-dock wx-dock" aria-label="My playset"></section>`;
  const $ = s => root.querySelector(s),
    q = $('input'),
    filter = $('select'),
    tools = $('.wx-tools'),
    list = $('.wx-wall'),
    detail = $('.wx-dossier'),
    dock = $('.wx-dock'),
    note = $('[role=status]');
  if (universal) {
    const mounted = el('details', 'wx-mounted');
    mounted.append(el('summary', '', 'Mounted content'));
    tools.after(mounted);
    void loadContent().then(content => mounted.append(el('p', '', describeContent(content))));
  }
  let rows = [],
    byId = new Map(),
    collections = [],
    gameAvailable = false,
    clientDetected = false,
    selected = null,
    visible = [],
    ids = [...new Set(loadList(store).filter(isId))].slice(0, 64),
    prepared = '',
    preparing = false,
    revision = 0,
    busy = false;
  const cats = categoryDesk(
    root,
    $('.wx-categories'),
    text => (note.textContent = text),
    () => {
      paint();
    }
  );
  const sources = sourceDesk(root, () => drawDetail(byId.get(selected)));
  async function importsChanged(id) {
    cats.go('imports');
    q.value = '';
    filter.value = 'all';
    selected = id;
    await fetchShelf();
  }
  const name = id => byId.get(id)?.name || `Workshop ${id}`;
  const key = (control, k) => {
    control.dataset.wxKey = k;
    return control;
  };
  function restore(k, fallback) {
    if (!k) return;
    const node = [...root.querySelectorAll('[data-wx-key]')].find(b => b.dataset.wxKey === k && !b.disabled);
    (node || fallback)?.focus({ preventScroll: true });
  }
  function change(next, msg, focus = document.activeElement?.dataset.wxKey) {
    if (next.length > 64) {
      note.textContent = 'A playset holds up to 64 items.';
      return;
    }
    ids = [...new Set(next)];
    revision++;
    prepared = '';
    try {
      localStorage.setItem(store, JSON.stringify(ids));
      note.textContent = msg || 'Working order saved on this device.';
    } catch {
      note.textContent = 'Working order changed for this visit only.';
    }
    paint();
    drawDock();
    restore(focus, dock.querySelector('h2'));
  }
  function status(r) {
    if (r.archiveId) return r.available ? 'Browser copy' : 'Missing archive';
    if (!universal) return r.source === 'added' ? 'Browser overlay' : 'Mounted';
    if (r.duplicate) return 'Duplicate install';
    if (r.installed) return r.steamVerified ? 'Steam installed' : 'Local Data folder';
    if (r.filesPresent) return 'Awaiting Steam receipt';
    if (r.ready) return 'Offline pack';
    return 'Not installed';
  }
  function validation() {
    if (!gameAvailable) return 'Forces of Corruption was not found. Locate the game and refresh.';
    const chosen = ids.map(id => byId.get(id));
    if (chosen.some(r => !r?.installed || r.duplicate))
      return 'Remove missing or duplicate installations, or resolve them in Steam and refresh.';
    if (new Set(chosen.map(r => r.baseId || r.id)).size !== ids.length) return 'Use just one edition of each mod.';
    if (chosen.filter(r => r.pack).length > 1) return 'Use only one primary overhaul in a playset.';
    return '';
  }
  function savedControls() {
    const bar = el('div', 'desk-toolbar'),
      sets = loadList(setsKey).filter(
        s =>
          s &&
          typeof s.name === 'string' &&
          s.name.trim() &&
          Array.isArray(s.ids) &&
          s.ids.length > 0 &&
          s.ids.length <= 64 &&
          s.ids.every(isId)
      );
    const sel = key(el('select'), 'sets');
    sel.setAttribute('aria-label', 'Saved playset');
    option(sel, '', 'Saved playsets…');
    sets.forEach((s, i) => option(sel, String(i), s.name));
    bar.append(sel);
    key(
      action(bar, 'Use saved', () => {
        if (sel.value === '') {
          sel.focus();
          note.textContent = 'Choose a saved playset first.';
          return;
        }
        const s = sets[Number(sel.value)];
        change(s.ids, 'Using ' + s.name + '.');
      }),
      'use-saved'
    ).disabled = !sets.length;
    const title = key(el('input'), 'set-name');
    title.placeholder = 'Name this playset';
    title.maxLength = 50;
    title.setAttribute('aria-label', 'Playset name');
    bar.append(title);
    const write = (next, msg, focus, chosen = '') => {
      try {
        localStorage.setItem(setsKey, JSON.stringify(next));
        drawDock();
        if (chosen !== '') dock.querySelector('select').value = String(chosen);
        note.textContent = msg;
        restore(focus, dock.querySelector('select'));
      } catch {
        note.textContent = 'Could not save playsets on this device.';
      }
    };
    key(
      action(bar, 'Save playset', () => {
        const n = title.value.trim();
        if (!n) {
          title.focus();
          return;
        }
        const same = sets.find(s => s.name.toLowerCase() === n.toLowerCase());
        const commit = () => {
          const next = [...sets.filter(s => s !== same), { name: n, ids: [...ids] }];
          write(next, 'Saved playset: ' + n, 'save-set', next.length - 1);
        };
        if (same) askDesk(root, 'Replace the saved order for ' + same.name + '?', { label: 'Replace', run: commit });
        else if (sets.length < 40) commit();
        else note.textContent = 'Remove a saved playset before adding another.';
      }),
      'save-set'
    ).disabled = !ids.length;
    if (sets.length)
      action(bar, 'Delete saved…', () => {
        if (sel.value === '') {
          sel.focus();
          note.textContent = 'Choose a saved playset to delete.';
          return;
        }
        const item = sets[Number(sel.value)];
        askDesk(root, 'Delete saved playset ' + item.name + '?', {
          label: 'Delete',
          run: () =>
            write(
              sets.filter(s => s !== item),
              'Saved playset deleted. Working order unchanged.',
              'sets'
            )
        });
      });
    return bar;
  }
  async function prepare() {
    if (preparing || validation() || !ids.length) return;
    preparing = true;
    const ticket = revision,
      b = dock.querySelector('[data-wx-key="prepare"]');
    b.disabled = true;
    b.textContent = 'Preparing…';
    note.textContent = 'Opening a local game server for this order…';
    try {
      const res = await fetch(api + 'prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) throw Error(await res.text());
      const u = new URL((await res.json()).url);
      if (
        u.protocol !== 'http:' ||
        u.hostname !== '127.0.0.1' ||
        u.pathname !== '/play.html' ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw Error('Unexpected game address.');
      if (ticket === revision) {
        prepared = u.href;
        note.textContent = 'Playset ready. Open the game in a new tab.';
      }
    } catch (e) {
      if (ticket === revision) note.textContent = e.message;
    } finally {
      preparing = false;
      const refocus = document.activeElement === b || document.activeElement === document.body;
      drawDock();
      if (refocus && ticket === revision && root.isConnected) restore('prepare');
    }
  }
  function drawDock() {
    dock.hidden = !universal;
    if (!universal) return;
    const draft = dock.querySelector('input')?.value || '',
      activeSet = dock.querySelector('select')?.selectedOptions[0]?.textContent;
    dock.replaceChildren();
    const h = el('header');
    const title = el('h2', '', `My playset · ${ids.length}`);
    title.tabIndex = -1;
    h.append(el('small', '', '03  /  Launch manifest'), title);
    dock.append(h, savedControls());
    dock.querySelector('input').value = draft;
    const sel = dock.querySelector('select'),
      opt = [...sel.options].find(o => o.textContent === activeSet);
    if (opt) sel.value = opt.value;
    if (!ids.length) {
      dock.append(el('p', '', 'Add an installed item from its dossier, or use a collection’s order.'));
      return;
    }
    dock.append(el('p', '', 'First item wins conflicting files. Dependencies are not added automatically.'));
    const ol = el('ol', 'set-order');
    ids.forEach((id, i) => {
      const li = el('li'),
        label = name(id);
      li.append(el('strong', '', label));
      const move = by => {
        const a = ids.slice();
        [a[i], a[i + by]] = [a[i + by], a[i]];
        change(
          a,
          `${label} is now priority ${i + by + 1}.`,
          (i + by === 0 ? 'Lower' : i + by === ids.length - 1 ? 'Raise' : by < 0 ? 'Raise' : 'Lower') + id
        );
      };
      for (const [verb, glyph, fn, disabled] of [
        ['Raise', '↑', () => move(-1), i === 0],
        ['Lower', '↓', () => move(1), i === ids.length - 1],
        [
          'Remove',
          '×',
          () =>
            change(
              ids.filter(k => k !== id),
              'Removed ' + label + '.',
              'Remove' + (ids[i + 1] || ids[i - 1])
            ),
          false
        ]
      ]) {
        const b = key(action(li, glyph, fn), verb + id);
        b.setAttribute('aria-label', verb + ' ' + label);
        b.disabled = disabled;
      }
      ol.append(li);
    });
    dock.append(ol);
    const problem = validation();
    dock.append(el('p', problem ? 'desk-warn' : '', problem || 'Opens a separate local game. Saves stay with this exact order.'));
    if (prepared && !problem) key(link(dock, 'Open playset game ↗', prepared, 'cmd-primary'), 'prepare');
    else
      key(action(dock, preparing ? 'Preparing…' : 'Prepare playset', prepare, 'cmd-primary'), 'prepare').disabled = !!problem || preparing;
  }
  function choose(id) {
    selected = id;
    for (const b of list.querySelectorAll('button')) {
      const on = b.dataset.mod === id;
      b.setAttribute('aria-pressed', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    drawDetail(byId.get(id));
  }
  function inspectEdition(id) {
    if (!visible.some(r => r.id === id)) {
      q.value = '';
      filter.value = 'all';
      cats.go('all');
      selected = id;
      paint();
    } else choose(id);
    detail.focus();
  }
  function drawDetail(r) {
    sources.reset();
    detail.replaceChildren();
    if (!r) {
      detail.append(el('p', 'desk-empty', 'No signal selected.'));
      return;
    }
    const header = el('header', 'wx-cover'),
      overlay = el('div');
    overlay.append(el('small', '', `02  /  Item dossier   ·   ${serial(r.number)}`), el('h2', '', r.name));
    header.append(art(r, true), overlay);
    detail.append(header);
    const body = el('div', 'wx-brief'),
      meta = el('div', 'wx-data');
    detail.append(body);
    body.append(meta);
    const identity = r.workshopId || (isId(r.id) && r.id);
    for (const s of [status(r), identity && '#' + identity, r.version && 'v' + r.version]) if (s) meta.append(el('span', '', s));
    if (r.archiveId) {
      body.append(el('h3', '', 'Imported archive'));
      archiveActions(root, body, r, note, importsChanged);
      cats.file(body, r);
      return;
    }
    if (universal) {
      body.append(el('h3', '', r.baseId ? 'Native · Author’s stripped edition' : 'Base · Original source mod'));
      if (r.baseId) body.append(el('p', '', r.evidence));
      const sibling = r.baseId || r.nativeId;
      if (sibling) action(body, r.baseId ? 'Inspect Base edition' : 'Inspect Native edition', () => inspectEdition(sibling));
    }
    body.append(
      el(
        'p',
        'wx-guide',
        !universal
          ? r.source === 'added'
            ? 'Applied from browser storage.'
            : 'Mounted in this game.'
          : r.duplicate
            ? 'This ID occurs in multiple Steam libraries. Resolve the duplicate and refresh before adding it.'
            : r.installed
              ? 'Use the installed item in a playset. Follow the author’s dependency order.'
              : r.ready
                ? 'The offline pack can run without a Steam copy. To add this item to a playset, subscribe on Steam and refresh after download.'
                : 'Steam handles subscriptions and downloads. Return here and refresh once the item is installed.'
      )
    );
    const buttons = el('div', 'desk-actions');
    body.append(buttons);
    if (universal && r.installed && !r.duplicate) {
      const inSet = ids.includes(r.id);
      key(
        action(
          buttons,
          inSet ? 'Remove from playset' : 'Add to playset',
          () =>
            change(
              inSet ? ids.filter(k => k !== r.id) : [...ids, r.id],
              inSet
                ? `Removed ${r.name} from this playset only. Installed files are unchanged.`
                : `Added ${r.name} at priority ${ids.length + 1}.`
            ),
          'cmd-primary'
        ),
        'membership'
      );
    }
    if (universal && ids.includes(r.id)) action(buttons, `Review playset (${ids.length}) ↓`, () => dock.querySelector('h2').focus());
    sources.render(body, r, universal, clientDetected);
    if (r.ready && canSwitch) {
      const pack = el('div', 'wx-sub');
      pack.append(el('small', '', 'Universal pack · Same source data'));
      const a = el('div', 'desk-actions');
      pack.append(a);
      action(a, 'Play this overhaul', () => switchProfile(r.id, 'profile-play'));
      action(a, 'Customize fleets', () => switchProfile(r.id, 'customize'));
      body.append(pack);
    }
    cats.file(body, r);
    if (r.summary) {
      const d = el('details', 'wx-notes');
      d.append(el('summary', '', 'Author notes'), el('p', '', r.summary));
      body.append(d);
    }
    for (const c of collections.filter(c => c.order.includes(r.id) || c.disabled.includes(r.id))) {
      const d = el('details', 'collection-note');
      d.append(el('summary', '', `Collection: ${c.name} · ${c.order.length} enabled`));
      const ol = el('ol');
      for (const id of c.order) ol.append(el('li', '', name(id)));
      d.append(ol);
      if (c.disabled.length) d.append(el('p', '', 'Off: ' + c.disabled.map(name).join(', ')));
      const problem = c.problem || (c.order.length > 64 && 'This order exceeds the 64-item limit.');
      if (problem) d.append(el('p', 'desk-warn', problem));
      action(d, 'Use collection order', () => {
        change(c.order, 'Applied collection: ' + c.name + '.', null);
        dock.querySelector('h2').focus();
      }).disabled = !!problem;
      body.append(d);
    }
  }
  function paint() {
    cats.draw(rows);
    $('.wx-section-name').textContent = cats.name();
    const term = q.value.toLowerCase().trim();
    visible = rows.filter(
      r =>
        cats.accept(r) &&
        (filter.value === 'all' ||
          (filter.value === 'installed' && r.installed) ||
          (filter.value === 'absent' && isId(r.id) && !r.installed) ||
          (filter.value === 'ready' && r.ready) ||
          (filter.value === 'deck' && ids.includes(r.id)) ||
          (filter.value === 'collection' && r.collections.length)) &&
        [r.name, r.workshopId || r.id, ...r.collections, ...cats.search(r)].some(v => v.toLowerCase().includes(term))
    );
    if (!visible.some(r => r.id === selected)) selected = visible[0]?.id;
    $('.wx-count').textContent = `${visible.length} / ${rows.length}`;
    list.replaceChildren();
    for (const r of visible) {
      const b = action(
        list,
        '',
        () => {
          choose(r.id);
          if (matchMedia('(max-width:650px)').matches) detail.focus();
        },
        'wx-tile index-row'
      );
      b.dataset.mod = r.id;
      b.setAttribute('aria-controls', detail.id);
      b.setAttribute('aria-pressed', String(selected === r.id));
      b.tabIndex = selected === r.id ? 0 : -1;
      const plate = art(r);
      plate.append(el('i', 'wx-number', serial(r.number)));
      const pos = ids.indexOf(r.id);
      if (universal && pos !== -1) {
        plate.append(el('i', 'wx-rank', 'Priority ' + serial(pos + 1)));
        b.setAttribute('aria-label', `${r.name}, ${status(r)}, playset priority ${pos + 1}`);
      }
      const text = el('span', 'wx-label');
      text.append(el('strong', '', r.name), el('small', '', status(r) + (r.ready ? ' · Pack' : '') + (r.baseId ? ' · Native' : '')));
      b.append(plate, text);
    }
    if (!visible.length)
      list.append(
        el(
          'p',
          'desk-empty',
          rows.length
            ? cats.name() !== 'All mods' && !q.value && filter.value === 'all'
              ? 'No items in this category. File mods from their details in All mods.'
              : 'No matching mods.'
            : universal
              ? 'No items in the local inventory.'
              : 'No mods mounted in this game.'
        )
      );
    drawDetail(byId.get(selected));
  }
  list.onkeydown = e => {
    const b = e.target.closest('button');
    if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
    const tiles = [...list.children],
      i = tiles.indexOf(b),
      firstTop = tiles[0].offsetTop;
    const nextRow = tiles.findIndex(t => t.offsetTop !== firstTop),
      cols = nextRow > 0 ? nextRow : tiles.length;
    const j = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: tiles.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const to = tiles[Math.max(0, Math.min(tiles.length - 1, j))];
    choose(to.dataset.mod);
    to.focus();
  };
  async function fetchShelf(mode = 'catalog') {
    if (busy) return;
    busy = true;
    tools.setAttribute('aria-busy', 'true');
    note.textContent = mode === 'titles' ? 'Looking up unnamed item IDs…' : 'Reading local inventory…';
    // OPFS and the Steam catalog are independent snapshots. Read in parallel, never reuse an old receipt.
    const archives = archiveRows().catch(() => null);
    try {
      if (universal) {
        const res = await fetch(api + mode, { method: mode === 'catalog' ? 'GET' : 'POST' });
        if (!res.ok)
          throw Error(
            mode === 'titles'
              ? 'Steam titles unavailable. Your local catalog is unchanged.'
              : 'Could not read the local Workshop. Try Refresh.'
          );
        const data = await res.json();
        rows = data.mods;
        collections = data.collections;
        gameAvailable = data.gameAvailable;
        clientDetected = data.clientDetected;
      } else {
        const data = await loadContent();
        rows = data.mods.map((m, i) => ({
          ...m,
          id: 'local-' + i,
          categoryKey: m.workshop || `${m.source}:${m.name}`,
          workshopId: isId(m.workshop) ? m.workshop : null,
          collections: []
        }));
      }
      const local = await archives;
      if (!root.isConnected) return;
      rows.push(...(local || []));
      rows.forEach((r, i) => {
        r.number = i + 1;
      });
      byId = new Map(rows.map(r => [r.id, r]));
      if (mode === 'refresh') {
        revision++;
        prepared = '';
      }
      paint();
      drawDock();
      note.textContent = universal
        ? `${rows.filter(r => r.installed).length} local items · ${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}. Steam manages downloads.`
        : 'Mounted content and browser copies. Open Universal to build Steam playsets.';
      if (!local) note.textContent += ' Browser archive storage unavailable.';
    } catch (e) {
      note.textContent = e.message;
    } finally {
      busy = false;
      tools.removeAttribute('aria-busy');
    }
  }
  q.oninput = filter.onchange = () => {
    paint();
    note.textContent = `${visible.length} matching ${visible.length === 1 ? 'item' : 'items'}.`;
  };
  const discovery = el('details', 'wx-discover');
  discovery.append(el('summary', '', 'Discover & import'));
  const tray = el('div', 'wx-source-tools');
  discovery.append(tray);
  tools.after(discovery);
  link(tray, 'Discover on Steam ↗', steam);
  link(tray, 'Browse Mod DB ↗', 'https://www.moddb.com/');
  importDesk(root, tray, note, importsChanged);
  tray.append(el('p', '', 'Publisher pages open externally. Import a trusted .tar with a Data folder; no automatic web downloads.'));
  if (universal) {
    action(tools, 'Refresh', () => fetchShelf('refresh'));
    action(tools, 'Look up titles', () =>
      askDesk(root, 'Send unnamed Workshop item IDs to Steam to look up their public titles?', {
        label: 'Look up titles',
        run: () => fetchShelf('titles')
      })
    );
  } else {
    filter.hidden = true;
    const a = el('a', '', 'Manage local mods');
    a.href = 'index.html';
    tools.append(a);
  }
  await fetchShelf();
}
