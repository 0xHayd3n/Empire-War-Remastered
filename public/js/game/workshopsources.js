import { el, action, link } from './commandui.js';

// Curated same-project links, not release/version equivalence. Never derive slugs from titles or follow metadata URLs.
export const mirrors = new Map([
  [
    '1125571106',
    {
      page: 'https://www.moddb.com/mods/thrawns-revenge/downloads',
      evidence: 'https://thrawnsrevenge.com/downloads',
      credit: 'The publisher lists both mirrors. Versions and packaging may differ.'
    }
  ]
]);
const api = '/api/title-workshop/status/';
const safe = id => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id) && BigInt(id) <= 18446744073709551615n;
const fmt = n => `${Number(n).toLocaleString()} bytes`;
export function sourceDesk(root, repaint) {
  const handed = new Set(),
    watching = new Set();
  let generation = 0;
  function render(body, row, universal, clientDetected) {
    const id = row.workshopId || row.id;
    if (!safe(id)) return;
    const mirror = mirrors.get(id),
      sources = el('details', 'wx-notes');
    sources.append(el('summary', '', mirror ? 'Sources · Steam + Mod DB' : 'Source · Steam Workshop'));
    sources.append(el('p', '', `Steam Workshop · ${row.clientTarget ? 'Empire at War' : ''}${row.clientTarget ? ' · ' : ''}item ${id}.`));
    link(
      sources,
      universal && !row.installed ? 'Open Steam to subscribe ↗' : 'View on Steam ↗',
      'https://steamcommunity.com/sharedfiles/filedetails/?id=' + id
    );
    if (mirror) {
      sources.append(el('p', '', mirror.credit));
      link(sources, 'Mod DB downloads ↗', mirror.page);
      link(sources, 'Publisher’s mirror list ↗', mirror.evidence);
    }
    body.append(sources);
    if (!universal) return;
    const strip = el('div', 'wx-transfer'),
      info = el('div', 'wx-transfer-reading'),
      buttons = el('div', 'desk-actions');
    body.append(strip);
    strip.append(buttons, info);
    const ticket = generation;
    const manage = action(buttons, row.installed ? 'Manage in Steam…' : 'Get with Steam…', () => {
      const dlg = el('dialog', 'campaign-picker wx-handoff');
      dlg.setAttribute('aria-label', 'Steam handoff');
      dlg.append(
        el('small', '', 'Steam client / 32470'),
        el('h2', '', row.name),
        el(
          'p',
          '',
          row.installed
            ? 'Manage subscriptions on Steam’s item page. If subscribed, you can unsubscribe there. Removing a playset entry does not unsubscribe or delete anything.'
            : 'Open this exact Workshop item in your Steam client, then choose Subscribe there. Steam handles account, license and downloads. Opening a page does not queue or install the item.'
        )
      );
      const close = () => {
        dlg.close();
        dlg.remove();
      };
      const foot = el('footer');
      dlg.append(foot);
      const native = clientDetected && link(foot, 'Open item in Steam client', `steam://url/CommunityFilePage/${id}`);
      if (!clientDetected) dlg.insertBefore(el('p', '', 'Desktop Steam was not detected in the scanned libraries. Use the website.'), foot);
      // Launch only an explicit anchor on a user gesture. No executable, console input or remote request is dispatched by our server.
      if (native)
        native.onclick = () => {
          handed.add(id);
          watching.add(id);
          close();
          repaint();
        };
      link(foot, 'Open Steam website ↗', 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + id);
      if (!row.installed && row.clientTarget && clientDetected) {
        const d = el('details', 'wx-notes');
        d.append(
          el('summary', '', 'One-time download with the Steam client console'),
          el(
            'p',
            '',
            'For desktop Steam clients with this console command: open the console, paste this item-specific command yourself and press Enter. Access depends on Steam. This is not a subscription.'
          ),
          el('code', '', `workshop_download_item 32470 ${id}`)
        );
        if (navigator.clipboard?.writeText)
          action(d, 'Copy item command', async e => {
            try {
              await navigator.clipboard.writeText(`workshop_download_item 32470 ${id}`);
              e.target.textContent = 'Command copied';
            } catch {
              e.target.textContent = 'Select and copy the command above';
            }
          });
        link(d, 'Open Steam console', 'steam://open/console');
        dlg.insertBefore(d, foot);
      }
      action(foot, 'Cancel', close);
      dlg.oncancel = e => {
        e.preventDefault();
        close();
      };
      dlg.onkeydown = e => e.stopPropagation();
      root.append(dlg);
      dlg.showModal();
    });
    if (!row.installed) manage.className = 'cmd-primary';
    const watch = action(buttons, watching.has(id) ? 'Stop watching' : 'Watch local status', () => {
      if (watching.has(id)) watching.delete(id);
      else watching.add(id);
      repaint();
    });
    watch.setAttribute('aria-pressed', String(watching.has(id)));
    if (!watching.has(id)) return;
    info.setAttribute('role', 'status');
    async function sample() {
      if (!root.isConnected || ticket !== generation || !watching.has(id)) return;
      if (!document.hidden)
        try {
          const r = await fetch(api + id, { cache: 'no-store' });
          if (!r.ok) throw Error();
          const s = await r.json();
          if (!info.isConnected || ticket !== generation) return;
          const nodes = [];
          nodes.push(
            el(
              'p',
              '',
              s.verified
                ? `Steam installation confirmed · item manifest + Data folder${s.item?.size != null ? ' · ' + fmt(s.item.size) + ' on disk' : ''}.`
                : s.data
                  ? 'Local Data folder present; Steam installation not confirmed by the manifest.'
                  : s.item
                    ? 'Steam manifest entry present; no usable Data folder found.'
                    : 'No installed item found.'
            )
          );
          if (!s.verified)
            nodes.push(
              el(
                'p',
                '',
                handed.has(id)
                  ? 'Client handoff requested. Subscription and item queue unconfirmed; item bytes unknown.'
                  : 'Item queue and download bytes unavailable without Steamworks.'
              )
            );
          if (s.job) {
            nodes.push(
              el(
                'p',
                '',
                'Steam app 32470 · ' +
                  {
                    scheduled: 'scheduled update',
                    paused: 'paused',
                    staging: 'staging files',
                    committing: 'committing files',
                    downloading: 'downloading'
                  }[s.job.state] +
                  '. App-wide, not specific to this item.'
              )
            );
            if (s.job.total) {
              const p = el('progress');
              p.max = s.job.total;
              p.value = s.job.done;
              p.setAttribute('aria-label', 'App-wide Steam transfer');
              nodes.push(p, el('span', '', fmt(s.job.done) + ' / ' + fmt(s.job.total)));
            } else if (s.job.state === 'downloading') nodes.push(el('span', '', 'App bytes unknown.'));
          } else if (s.needed)
            nodes.push(el('p', '', 'Workshop manifest reports a download needed for this app; no active transfer confirmed.'));
          if (s.verified !== !!row.steamVerified || s.data !== !!row.filesPresent)
            nodes.push(el('p', '', 'Refresh the library to update actions.'));
          const signature = nodes.map(n => n.textContent).join('|');
          if (info.dataset.last !== signature) {
            info.replaceChildren(...nodes);
            info.dataset.last = signature;
          }
        } catch {
          if (info.isConnected) {
            info.textContent = 'Local Steam status unavailable. Check Downloads in Steam.';
            delete info.dataset.last;
          }
        }
      if (info.isConnected && ticket === generation) setTimeout(sample, 3000);
    }
    sample();
  }
  return {
    render,
    reset() {
      generation++;
    }
  };
}
