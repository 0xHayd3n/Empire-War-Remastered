import { el, action, askDesk } from './commandui.js';
import { addModArchive, archivesSupported, listMods, removeBrowserArchive } from '../mods.js';

export async function archiveRows() {
  if (!archivesSupported()) return [];
  const mods = await listMods(),
    root = await navigator.storage.getDirectory();
  let dir;
  try {
    dir = await root.getDirectoryHandle('mods');
  } catch (e) {
    if (e.name !== 'NotFoundError') throw e;
  }
  const rows = [];
  for (const m of mods.filter(m => m.archive && !m.game)) {
    let available = false;
    try {
      available = (await (await dir.getFileHandle(m.archive.file)).getFile()).size === m.archive.size;
    } catch {}
    rows.push({
      id: 'archive-' + m.id,
      archiveId: m.id,
      available,
      enabled: m.on,
      name: String(m.label || m.name),
      size: m.archive.size,
      collections: []
    });
  }
  return rows;
}
export function importDesk(root, tools, note, changed) {
  if (!archivesSupported()) return;
  const input = el('input');
  input.type = 'file';
  input.accept = '.tar';
  input.hidden = true;
  input.setAttribute('aria-label', 'Compatible local mod archive');
  tools.append(input);
  const b = action(tools, 'Import archive…', () => input.click());
  input.onchange = () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    askDesk(
      root,
      `Install “${file.name}” as a browser mod? Use only authorized, trusted .tar archives containing a mod’s Data folder. This copies the archive into this profile’s private storage and enables it on next reload, outside Steam playsets.`,
      {
        label: 'Install local archive',
        run: async () => {
          b.disabled = true;
          const output = el('p', 'wx-import-progress');
          output.setAttribute('role', 'status');
          tools.after(output);
          output.textContent = 'Checking archive…';
          try {
            const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
            if (!/\.tar$/i.test(file.name) || file.size < 512 || file.size > 8 * 1024 ** 3 || (head[0] === 0x1f && head[1] === 0x8b))
              throw Error(
                'Choose an uncompressed .tar containing Data, up to 8 GiB. Extract ZIP/RAR releases and package the mod folder first.'
              );
            const m = await addModArchive(file, msg => (output.textContent = 'Installing in browser storage: ' + msg), {
              lookupTitles: false
            });
            await changed('archive-' + m.id);
            note.textContent = 'Installed in this browser profile. Reload this game to apply; Steam was not changed.';
          } catch (e) {
            note.textContent = e.message || 'Local import failed.';
          } finally {
            b.disabled = false;
            output.remove();
          }
        }
      }
    );
  };
}
export function archiveActions(root, body, r, note, changed) {
  body.append(
    el(
      'p',
      '',
      `${r.available ? `${r.size.toLocaleString()} bytes in private browser storage` : 'Archive file missing; library record remains'}. ${r.enabled ? 'Enabled' : 'Disabled'} for this profile on next reload. Not a Steam subscription or server playset layer.`
    )
  );
  action(body, 'Remove browser copy…', () =>
    askDesk(
      root,
      `Remove the browser copy of “${r.name}” from this profile? This deletes only its imported archive and library entry. Your original file, Steam items, and player saves are untouched. Reload to update mounted content.`,
      {
        label: 'Remove browser copy',
        run: async () => {
          try {
            await removeBrowserArchive(r.archiveId);
            await changed(null);
            note.textContent = 'Browser archive removed. Original file and saves kept.';
          } catch (e) {
            note.textContent = e.message || 'Could not remove the browser archive.';
          }
        }
      }
    )
  );
}
