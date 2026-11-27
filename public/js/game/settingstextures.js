import { el, action } from './commandui.js';
import { group, check, select } from './settingsfields.js';
import { endorID, refitID, packKey } from '../texture-showcase/recipes.js';
import {
  profile,
  entries,
  alternateEdition,
  edition,
  chooseEdition,
  selectedEdition,
  active,
  enabled,
  installed,
  installZip,
  privateZip,
  removePack
} from '../texture-showcase/store.js';

const download = (href, name) => {
  const a = el('a');
  a.href = href;
  a.download = name;
  a.click();
};
function build(signal, progress, id) {
  return new Promise((ok, no) => {
    const w = new Worker(new URL('../texture-showcase/worker.js', import.meta.url), { type: 'module' });
    const stop = () => {
        w.terminate();
        signal.removeEventListener('abort', abort);
      },
      abort = () => {
        stop();
        no(Error('Build cancelled'));
      };
    signal.addEventListener('abort', abort, { once: true });
    w.onmessage = ({ data }) => {
      if (data.file) {
        progress(data.file);
        return;
      }
      stop();
      data.error ? no(Error(data.error)) : ok(data.zip);
    };
    w.onerror = e => {
      stop();
      no(Error(e.message || 'Builder unavailable'));
    };
    w.postMessage(id);
  });
}
export function texturePackFields(parent, signal) {
  if (!entries.length) return;
  const box = group(parent, 'Enhanced texture pack');
  let managed = selectedEdition();
  const choice =
    alternateEdition &&
    select(
      box,
      'Texture edition',
      [
        [profile, 'Enhanced showcase'],
        [alternateEdition, profile === 'stock' ? 'Endor · Forest floor and canopy' : 'Venator · Shipyard Refit']
      ],
      managed,
      id => {
        chooseEdition(id);
        managed = id;
        on.checked = enabled(id);
        void run(async () => {});
      }
    );
  const blurb = el('p', 'us-help');
  box.append(blurb);
  const status = el('p', 'us-help');
  status.setAttribute('role', 'status');
  const actions = el('div', 'us-actions us-pack-actions');
  const on = check(box, 'Use enhanced textures', enabled(managed), v => {
    try {
      localStorage.setItem(packKey(managed), v ? 'on' : 'off');
      message();
      sync();
    } catch {
      on.checked = !v;
      status.textContent = 'Could not save this preference.';
    }
  });
  box.append(status, actions);
  let have = false,
    busy = false;
  const message = () => {
    blurb.textContent =
      managed === endorID
        ? 'Endor: ridged bark, evergreen sprays and a mossy forest floor. Built from your stock textures.'
        : managed === refitID
        ? 'Shipyard Refit: new Venator armor, maintenance bays and turret finishes. Keeps faction markings.'
        : profile === 'stock'
          ? 'Showcase: Star Destroyer hull, Naboo surface and three Kuat ground textures.'
          : 'Showcase: Fall of the Republic Venator hull and turrets.';
    status.textContent = pending()
      ? 'Save any battle, then reopen this profile to apply.'
      : have
        ? live()
          ? 'Active for this profile.'
          : 'Installed. Original textures are in use.'
        : 'Build from your installation. Steam and Workshop files stay unchanged.';
  };
  const live = () => active && edition === managed;
  const pending = () => live() !== enabled(managed) || (active && edition !== managed);
  const sync = () => {
    if (choice) choice.disabled = busy;
    on.disabled = busy || !have;
    make.disabled = busy || live();
    imp.disabled = busy || live();
    save.disabled = busy || !have;
    del.disabled = busy || !have || live();
    restart.hidden = !pending();
    restart.disabled = busy;
  };
  const run = async fn => {
    if (busy) return;
    busy = true;
    sync();
    try {
      await fn();
      have = !!(await installed(managed));
      message();
    } catch (e) {
      status.textContent = e.message;
    } finally {
      busy = false;
      sync();
    }
  };
  const make = action(actions, 'Build local pack', () =>
    run(async () => {
      const a = await build(signal, file => (status.textContent = 'Building ' + file + '…'), managed);
      await installZip(a, managed);
    })
  );
  const input = el('input');
  input.type = 'file';
  input.accept = '.zip';
  input.hidden = true;
  box.append(input);
  const imp = action(actions, 'Import private ZIP', () => input.click());
  input.onchange = () =>
    run(async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      if (file.size > 64 * 1024 * 1024) throw Error('This ZIP is too large for the showcase.');
      await installZip(new Uint8Array(await file.arrayBuffer()), managed);
    });
  const save = action(actions, 'Save private ZIP', () =>
    run(async () => {
      const url = URL.createObjectURL(await privateZip(managed));
      download(url, 'showcase-' + managed + '.zip');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    })
  );
  const del = action(actions, 'Remove pack', () =>
    run(async () => {
      await removePack(managed);
      on.checked = false;
    })
  );
  action(actions, 'Download builder', () => download('/downloads/texture-showcase-builder.zip', 'texture-showcase-builder.zip'));
  const restart = action(actions, 'Reopen profile', () => {
    window.parent.postMessage(
      { kind: 'universal-select', id: profile, mode: profile === 'stock' ? 'title' : 'profile-play' },
      document.querySelector('meta[name="swr-universal"]').content
    );
  });
  sync();
  void run(async () => {});
}
