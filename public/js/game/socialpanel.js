import { social, socialRelay, setRelay, contentStamp, joinUrl } from './socialclient.js';
import { el, action } from './commandui.js';

function relayLabel() {
  try {
    return socialRelay();
  } catch {
    return '';
  }
}
function field(parent, label, value = '', maxLength = 32) {
  const l = el('label', 'social-field', label),
    i = el('input');
  i.setAttribute('aria-label', label);
  i.autocomplete = 'off';
  i.maxLength = maxLength;
  i.value = value;
  l.append(i);
  parent.append(l);
  return i;
}
function line(parent, label, sub) {
  const row = el('section', 'social-row'),
    text = el('div');
  text.append(el('strong', '', label));
  if (sub) text.append(el('small', '', sub));
  const acts = el('div', 'social-actions');
  row.append(text, acts);
  parent.append(row);
  return acts;
}
function copy(text, root, status) {
  return async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied.';
    } catch {
      const i = field(root, 'Select and copy', text, 1024);
      i.readOnly = true;
      i.select();
      status.textContent = 'Copy the selected text.';
    }
  };
}
export function mountSocial(root, { room, kind, settingsOnly = false, beforeJoin = join => join() } = {}) {
  const abort = new AbortController(),
    signal = abort.signal;
  let state = null,
    timer,
    busy = false,
    first = true,
    view = settingsOnly ? 'settings' : 'roster',
    peer = null,
    history = [],
    serial = 0;
  const container = el('div', 'social-console'),
    status = el('p', 'social-status'),
    body = el('div', 'social-body');
  status.setAttribute('role', 'status');
  root.append(container);
  container.append(body, status);
  const btn = (p, label, fn) =>
    action(p, label, () => {
      if (!busy) run(fn);
    });
  const call = (op, args) => social(op, args, signal);
  async function run(fn) {
    if (signal.aborted || busy) return;
    busy = true;
    serial++;
    container.setAttribute('aria-busy', 'true');
    status.textContent = '';
    try {
      await fn();
    } catch (e) {
      if (!signal.aborted) status.textContent = e.message;
    } finally {
      busy = false;
      container.removeAttribute('aria-busy');
    }
  }
  async function mutate(op, args, message) {
    const next = await call(op, args);
    if (signal.aborted) return;
    state = next;
    render();
    if (message) status.textContent = message;
  }
  function change(to, id) {
    view = to;
    peer = id;
    history = [];
    render();
    if (id) refreshChat();
  }
  async function refreshChat() {
    const id = peer,
      items = (await call('history', { target: id })).messages;
    if (signal.aborted || peer !== id) return;
    if (JSON.stringify(items) !== JSON.stringify(history)) {
      history = items;
      chatLines();
    }
  }
  function chatLines() {
    const log = body.querySelector('[role="log"]');
    if (!log) return;
    log.replaceChildren();
    for (const m of history) {
      const p = el('p');
      p.append(
        el('b', '', m.src === state.me.id ? 'You: ' : (state.friends.find(f => f.id === peer)?.name || 'Friend') + ': '),
        document.createTextNode(m.body)
      );
      log.append(p);
    }
    if (!history.length) log.append(el('p', '', 'No messages yet.'));
    log.scrollTop = log.scrollHeight;
  }
  async function refresh(force = false) {
    if (signal.aborted || !root.isConnected || document.hidden || busy) return;
    const turn = ++serial;
    try {
      const next = await call('state');
      if (signal.aborted || turn !== serial) return;
      if (first || force || JSON.stringify(state) !== JSON.stringify(next)) {
        state = next;
        first = false;
        render();
      }
      if (peer && view === 'chat') await refreshChat();
    } catch (e) {
      if (signal.aborted || turn !== serial) return;
      status.textContent = e.message;
      if (first) {
        first = false;
        render();
      }
    }
  }
  function render() {
    if (signal.aborted) return;
    const old = body.contains(document.activeElement) ? document.activeElement : null,
      focus = old?.getAttribute('aria-label') || old?.textContent,
      values = new Map([...body.querySelectorAll('input:not([readonly])')].map(i => [i.getAttribute('aria-label'), i.value]));
    body.replaceChildren();
    const relaySettings = () => {
      if (room) return;
      const d = el('details', 'social-route');
      d.append(
        el('summary', '', 'Relay settings'),
        el(
          'p',
          '',
          'Both games must use the same relay. Only use a service you trust. Friends and device codes are separate on each relay.'
        )
      );
      const i = field(d, 'Relay URL', relayLabel(), 256);
      btn(d, 'Use relay', async () => {
        setRelay(i.value);
        state = null;
        view = settingsOnly ? 'settings' : 'roster';
        peer = null;
        render();
        const next = await call('state');
        if (!signal.aborted) {
          state = next;
          render();
        }
      });
      body.append(d);
    };
    const main = () => {
      if (room) {
        const a = line(body, 'Private transmission', 'Send the join code to a commander on the same relay and game build.');
        btn(a, 'Copy code', copy(room, body, status));
        if (relayLabel()) btn(a, 'Copy join link', copy(joinUrl(room, kind), body, status));
        if (['localhost', '127.0.0.1'].includes(location.hostname))
          body.append(
            el(
              'p',
              'social-note',
              'This link opens a local game address. On another computer, use the code in a compatible game on the same reachable relay.'
            )
          );
      }
      if (!state) {
        const r = el('div', 'social-entry');
        body.append(r);
        r.append(
          el('strong', '', 'Commander network'),
          el('p', '', 'Create a device callsign to exchange friend requests, messages and lobby invites. No Steam account is used.')
        );
        const name = field(r, 'Callsign', localStorage.getItem('swr.mpname') || '', 32);
        btn(r, 'Enable social', () => mutate('enable', { name: name.value }, 'Commander registered. Share your friend code to connect.'));
        r.append(el('small', '', 'Relay: ' + (relayLabel() || 'unavailable — check relay settings')));
        relaySettings();
        return;
      }
      const me = state.me,
        top = line(body, me.name, 'Friend code · ' + me.id);
      btn(top, 'Copy friend code', copy(me.id, body, status));
      if (!settingsOnly) btn(top, view === 'settings' ? 'Back to roster' : 'Manage', () => change(view === 'settings' ? 'roster' : 'settings'));
      if (view === 'settings') {
        relaySettings();
        const nm = field(body, 'Change callsign', me.name);
        btn(body, 'Save callsign', () => mutate('rename', { name: nm.value }));
        btn(body, me.visible ? 'Hide online status' : 'Show online status', () => mutate('presence', { visible: !me.visible }));
        body.append(el('h3', '', 'Connections'));
        for (const f of state.friends) {
          const a = line(body, f.name, f.id);
          btn(a, 'Remove', () => mutate('remove', { target: f.id }));
          btn(a, 'Block', () => mutate('block', { target: f.id }));
        }
        for (const b of state.blocked) {
          btn(line(body, b.name, 'Blocked'), 'Unblock', () => mutate('unblock', { target: b.id }));
        }
        return;
      }
      if (view === 'chat') {
        const f = state.friends.find(f => f.id === peer && f.confirmed);
        if (!f) {
          view = 'roster';
          peer = null;
          return render();
        }
        const a = line(body, 'Comms / ' + f.name, 'Private to this pair. Up to 32 recent messages, for 7 days.');
        btn(a, 'Back to friends', () => change('roster'));
        const log = el('div', 'social-log');
        log.setAttribute('role', 'log');
        body.append(log);
        chatLines();
        const i = field(body, 'Message', '', 240),
          send = () =>
            run(async () => {
              history = (await call('chat', { target: peer, body: i.value })).messages;
              i.value = '';
              chatLines();
            });
        i.onkeydown = e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        };
        action(body, 'Transmit', send);
        return;
      }
      const input = field(body, 'Add by friend code', '', 16);
      const add = () => mutate('request', { target: input.value.trim().toLowerCase() }, 'Friend request sent.');
      btn(body, 'Send request', add);
      input.onkeydown = e => {
        if (e.key === 'Enter') run(add);
      };
      if (state.invites.length) {
        body.append(el('h3', '', 'Lobby invitations'));
        for (const i of state.invites) {
          const a = line(
            body,
            i.name,
            `${i.kind === 'lan' ? 'Private' : 'Internet'} lobby · ${i.profile} · expires ${new Date(i.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          );
          if (!room)
            action(a, 'Join lobby', () =>
              beforeJoin(() =>
                run(async () => {
                  const local = await contentStamp();
                  if (local.stamp !== i.stamp)
                    throw Error('Open the matching build, edition and ordered mod playset before joining. The invitation stays here.');
                  const { invite } = await call('join', { target: i.id });
                  if (signal.aborted) return;
                  if (invite.stamp !== local.stamp) throw Error('Invitation changed; ask your friend to resend.');
                  location.assign(joinUrl(invite.room, invite.kind));
                })
              )
            );
          btn(a, 'Dismiss', () => mutate('dismiss', { target: i.id }));
        }
      }
      const pending = state.friends.filter(f => !f.confirmed);
      if (pending.length) {
        body.append(el('h3', '', 'Requests'));
        for (const f of pending) {
          const outgoing = f.asked === me.id,
            a = line(body, f.name, outgoing ? 'Request sent' : 'Wants to connect');
          if (!outgoing) btn(a, 'Accept', () => mutate('approve', { target: f.id }));
          btn(a, outgoing ? 'Cancel request' : 'Decline', () => mutate('remove', { target: f.id }));
        }
      }
      const friends = state.friends.filter(f => f.confirmed);
      body.append(el('h3', '', `Friends / ${friends.length}`));
      if (!friends.length)
        body.append(el('p', 'social-note', 'Exchange friend codes and accept a request. Your friends will appear here.'));
      for (const f of friends) {
        const a = line(body, f.name, f.online ? 'Active in comms' : 'Away');
        btn(a, 'Message', async () => {
          view = 'chat';
          peer = f.id;
          history = [];
          render();
          await refreshChat();
        });
        if (room) {
          const sent = state.sent.some(s => s.id === f.id && s.room === room);
          btn(a, sent ? 'Withdraw invite' : 'Invite to lobby', async () => {
            if (sent) return mutate('withdraw', { target: f.id });
            const identity = await contentStamp();
            await mutate('invite', { target: f.id, room, kind, ...identity }, 'Lobby invitation sent.');
          });
        }
      }
    };
    main();
    for (const i of body.querySelectorAll('input:not([readonly])')) {
      const oldValue = values.get(i.getAttribute('aria-label'));
      if (oldValue !== undefined) i.value = oldValue;
    }
    if (old && focus) {
      const match = [...body.querySelectorAll('button,input')].find(e => (e.getAttribute('aria-label') || e.textContent) === focus);
      match?.focus({ preventScroll: true });
    }
  }
  status.textContent = 'Checking commander network…';
  refresh().finally(() => {
    if (status.textContent === 'Checking commander network…') status.textContent = '';
  });
  timer = setInterval(refresh, 4800);
  return () => {
    serial++;
    abort.abort();
    clearInterval(timer);
    container.remove();
  };
}

export function openInvitePanel({ room, kind }) {
  if (!/^[a-z2-9]{9}$/.test(room) || !['internet', 'lan'].includes(kind)) return;
  const d = el('dialog', 'social-dialog');
  d.setAttribute('aria-label', 'Invite friends');
  const head = el('header'),
    inner = el('div');
  head.append(el('h2', '', 'Invite friends'));
  const close = action(head, 'Close', () => d.close());
  d.append(head, inner);
  document.body.append(d);
  d.showModal();
  const stop = mountSocial(inner, { room, kind });
  d.onclose = () => {
    stop();
    d.remove();
  };
  d.addEventListener('keydown', e => e.stopPropagation());
  close.focus();
  return () => {
    if (d.open) d.close();
  };
}
// The title bell is passive until this device opts in. No accounts, mock activity or public name search.
export function watchBell(button, drawer) {
  const abort = new AbortController();
  let pending = false;
  async function tick() {
    if (pending || abort.signal.aborted || !button.isConnected || drawer.open || document.hidden) return;
    pending = true;
    try {
      const s = await social('state', {}, abort.signal);
      if (abort.signal.aborted) return;
      const n = s ? s.invites.length + s.friends.filter(f => !f.confirmed && f.asked !== s.me.id).length : 0;
      button.dataset.count = n ? String(n) : '';
      button.title = n ? `${n} pending social notifications` : 'Notifications';
    } catch {
      button.dataset.count = '';
    } finally {
      pending = false;
    }
  }
  tick();
  const t = setInterval(tick, 15000);
  return () => {
    abort.abort();
    clearInterval(t);
  };
}
