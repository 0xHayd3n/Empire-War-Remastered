import { el, action, option, universalHost, profile, switchProfile } from './commandui.js';
import { modeSaves } from './modesaves.js';
// Only the owner of a save origin enumerates or loads its files. Selecting another era opens this same picker there.
export async function chooseCampaign({ load, back }) {
  const d = el('dialog', 'campaign-picker');
  d.setAttribute('aria-labelledby', 'choose-campaign-title');
  d.innerHTML =
    '<small>Galactic Conquest / Save archive</small><h2 id="choose-campaign-title">Choose campaign</h2><p>Restore a specific checkpoint without changing the latest-save shortcut.</p><label hidden>Game profile <select aria-label="Campaign profile"></select></label><div class="checkpoint-rows"></div><footer></footer>';
  const list = d.querySelector('.checkpoint-rows'),
    foot = d.querySelector('footer'),
    label = d.querySelector('label'),
    sel = label.querySelector('select');
  list.textContent = 'Reading checkpoints…';
  document.body.append(d);
  d.showModal();
  const events = new AbortController();
  const close = () => {
    events.abort();
    d.close();
    d.remove();
    back();
  };
  d.oncancel = e => {
    e.preventDefault();
    close();
  };
  action(foot, 'Back', close);
  if (universalHost()) {
    fetch('/api/universal/eras', { signal: events.signal })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => {
        if (!d.open || !rows.length) return;
        for (const r of rows) {
          option(sel, r.id, r.name + (r.ready ? '' : ' · not built'));
          sel.lastChild.disabled = !r.ready;
        }
        sel.value = profile();
        label.hidden = false;
        sel.onchange = () => {
          const id = sel.value;
          sel.value = profile();
          switchProfile(id, 'campaigns');
        };
      })
      .catch(() => {});
    addEventListener(
      'message',
      e => {
        if (e.origin === universalHost() && e.source === parent && e.data?.kind === 'universal-error')
          list.textContent = 'Could not open that profile. Choose another or go back.';
      },
      { signal: events.signal }
    );
  }
  try {
    const rows = (await modeSaves('conquest')).filter(r => r.id !== 'resume');
    if (!d.open) return;
    list.replaceChildren();
    if (!rows.length) list.append(el('p', '', 'No Galactic Conquest checkpoints in this profile.'));
    for (const r of rows) {
      const b = action(
        list,
        '',
        () => {
          close();
          load(r.id);
        },
        'index-row'
      );
      b.append(
        el('strong', '', r.name || r.id),
        el('small', '', [r.summary?.factions?.join(' vs '), new Date(r.saved).toLocaleString()].filter(Boolean).join(' · '))
      );
    }
  } catch {
    list.textContent = 'Checkpoints could not be read.';
  }
}
