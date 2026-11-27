import { el, action, askDesk, loadList } from './commandui.js';
import { mirrors } from './workshopsources.js';
const key = 'swr-workshop-categories-v1';
export function categoryDesk(root, region, announce, refresh) {
  const builtins = [
    ['all', 'All mods', () => true],
    ['packs', 'Primary overhauls', r => r.pack],
    ['collections', 'Collection members', r => r.collections.length],
    ['mirrors', 'Mod DB mirrors', r => mirrors.has(r.workshopId || r.id)],
    ['imports', 'Browser imports', r => r.archiveId]
  ];
  let folders = loadList(key)
      .filter(
        f =>
          f &&
          /^c-[a-z0-9-]{1,60}$/.test(f.id) &&
          typeof f.name === 'string' &&
          f.name.trim() &&
          Array.isArray(f.items) &&
          f.items.every(k => typeof k === 'string')
      )
      .slice(0, 40),
    active = 'all';
  const all = () => [...builtins, ...folders.map(f => [f.id, f.name, r => f.items.includes(r.categoryKey || r.id)])];
  const current = () => all().find(([id]) => id === active) || builtins[0];
  function write(next) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      folders = next;
      return true;
    } catch {
      announce('Could not save categories on this device.');
      return false;
    }
  }
  function edit(folder, item) {
    const d = el('dialog', 'campaign-picker wx-organize'),
      title = folder ? 'Edit category' : 'New category';
    d.setAttribute('aria-label', title);
    d.append(el('h2', '', title));
    const form = el('form'),
      lab = el('label', '', 'Category name'),
      input = el('input');
    input.maxLength = 48;
    input.required = true;
    input.value = folder?.name || '';
    lab.append(input);
    form.append(lab);
    const foot = el('footer');
    form.append(foot);
    d.append(form);
    const close = () => {
      d.close();
      d.remove();
    };
    action(foot, 'Cancel', close);
    const save = el('button', 'cmd-primary', 'Save category');
    save.type = 'submit';
    foot.append(save);
    form.onsubmit = e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name || all().some(([id, n]) => id !== folder?.id && n.toLowerCase() === name.toLowerCase())) {
        input.setCustomValidity('Choose a unique category name.');
        input.reportValidity();
        return;
      }
      const changed = { id: folder?.id || 'c-' + crypto.randomUUID(), items: folder?.items || (item ? [item] : []), name };
      if (write(folder ? folders.map(f => (f === folder ? changed : f)) : [...folders, changed])) {
        active = changed.id;
        close();
        refresh();
        region.querySelector('[aria-pressed=true]')?.focus();
        announce(`Category saved: ${name}.`);
      }
    };
    input.oninput = () => input.setCustomValidity('');
    d.onkeydown = e => e.stopPropagation();
    d.oncancel = e => {
      e.preventDefault();
      close();
    };
    root.append(d);
    d.showModal();
    input.focus();
  }
  function draw(rows) {
    region.replaceChildren();
    const head = el('div', 'wx-cat-head');
    head.append(el('h2', '', 'Browse by category'));
    action(head, 'New category', () => edit(null)).disabled = folders.length >= 40;
    const f = folders.find(f => f.id === active);
    if (f) {
      action(head, 'Rename', () => edit(f));
      action(head, 'Delete category…', () =>
        askDesk(root, `Delete category “${f.name}”? Its mods, files and playsets will be kept.`, {
          label: 'Delete category',
          run: () => {
            if (write(folders.filter(x => x !== f))) {
              active = 'all';
              refresh();
              region.querySelector('[aria-pressed=true]').focus();
            }
          }
        })
      );
    }
    const nav = el('div', 'wx-cat-nav');
    region.append(head, nav);
    for (const [id, name, includes] of all()) {
      const b = action(nav, '', () => {
        active = id;
        refresh();
        region.querySelector('[aria-pressed=true]').focus({ preventScroll: true });
      });
      b.append(el('span', '', name), el('b', '', String(rows.filter(includes).length)));
      b.setAttribute('aria-pressed', String(id === active));
    }
  }
  function file(body, r) {
    const item = r.categoryKey || r.id;
    const d = el('details', 'wx-notes');
    const inFolders = folders.filter(f => f.items.includes(item));
    d.append(el('summary', '', 'File in categories' + (inFolders.length ? ' · ' + inFolders.map(f => f.name).join(', ') : '')));
    if (!folders.length) d.append(el('p', '', 'Create a category to file this item. Category membership never changes the load order.'));
    for (const f of folders) {
      const label = el('label', 'wx-check'),
        box = el('input');
      box.type = 'checkbox';
      box.checked = f.items.includes(item);
      label.append(box, document.createTextNode(f.name));
      d.append(label);
      box.onchange = () => {
        const next = { ...f, items: box.checked ? [...new Set([...f.items, item])] : f.items.filter(i => i !== item) };
        if (write(folders.map(x => (x.id === f.id ? next : x)))) {
          refresh();
          const newer = [...root.querySelectorAll('.wx-check')].find(e => e.textContent === f.name);
          if (newer && root.querySelector('[data-mod][aria-pressed=true]')?.dataset.mod === r.id) {
            newer.closest('details').open = true;
            newer.querySelector('input').focus();
          } else region.querySelector('[aria-pressed=true]').focus();
        } else box.checked = !box.checked;
      };
    }
    action(d, 'New category with this mod…', () => edit(null, item)).disabled = folders.length >= 40;
    body.append(d);
  }
  return {
    draw,
    file,
    accept: r => current()[2](r),
    name: () => current()[1],
    go: id => {
      active = id;
    },
    search: r => folders.filter(f => f.items.includes(r.categoryKey || r.id)).map(f => f.name)
  };
}
