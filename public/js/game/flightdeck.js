import { loadContent, describeContent } from '../content.js';
import { ballotView } from './ballotview.js';
import { mapTitle } from '../ted.js';
import { variantOf } from './operationvariants.js';
import { preferences, savePreferences, address, routeName, ladderName, matchSheet } from './matchsettings.js';
import { lobbyRecord } from './matchrank.js';

// A countdown owns no relay resources. Only its final tick can transfer its controller into a search.
export function flightDeck(root, findMatch, customGrid, { goBack, immersive, mapRotation }) {
  let p = preferences(),
    phase = 'ready',
    job = null,
    timer,
    closeSheet = null,
    vote = null,
    dead = false,
    custom = false,
    revision = 0,
    content = 'Reading mounted content…';
  if (!globalThis.SWR_BASE && ['localhost', '127.0.0.1'].includes(location.hostname))
    document.body.style.setProperty('--mm-photo', 'url("/api/title-art/rendezvous.jpg")');
  root.innerHTML = `<div class="mm-lobby"><section class="mm-left"><div class="mm-kicker"><i></i> Holonet <span>/</span> Fleet operations</div>
    <div class="mm-mast"><svg class="mm-crest" aria-hidden="true" viewBox="0 0 56 64"><g fill="none" stroke="currentColor" stroke-width="3"><path d="m28 3 20 35-20-9-20 9z"/><path d="m5 45 23-10 23 10M10 53l18-8 18 8M19 58l9-4 9 4"/></g></svg><h1 class="mm-title">Matchmaking</h1></div>
    <div class="mm-message"><small class="mm-state"></small><p class="op-status" role="status"></p></div>
    <div class="mm-menu"><button type="button" data-id="FLIGHT_PLAYLIST"><small>Playlist</small><strong></strong></button><button type="button" data-id="FLIGHT_NETWORK"><small>Connection</small><strong></strong></button>
    <button type="button" data-id="FLIGHT_SEARCH" class="mm-launch"></button><button type="button" data-id="FLIGHT_CUSTOM">Custom games</button></div>
    <div class="mm-ballot" hidden></div><p class="mm-metrics" hidden></p></section>
    <aside class="mm-wing"><header><div><small>Command channel</small><h3>Flight roster</h3></div><span class="mm-count">01 / 02</span></header><div class="mm-member"><i class="mm-insignia" aria-hidden="true">◇</i><strong></strong><b>You</b></div><div class="mm-slot"><i></i><span>Opponent slot open</span></div>
    <div class="mm-brief"><small class="mm-domain"></small><h3 class="mm-variant"></h3><p class="mm-rule"></p><p class="mm-record" hidden></p></div></aside></div>
    <footer class="mm-foot"><span class="mm-select"><kbd>Enter</kbd> Select</span><button type="button" data-id="FLIGHT_BACK" aria-label="Back"><kbd>Backspace</kbd> Back</button><span class="mm-content"></span></footer>
    <div class="mm-manual" hidden><p>Host your own game, browse public rooms or join by code. No matchmaking queue.</p></div>`;
  const $ = s => root.querySelector(s),
    ctl = id => $(`[data-id="FLIGHT_${id}"]`),
    start = ctl('SEARCH'),
    playlist = ctl('PLAYLIST'),
    network = ctl('NETWORK'),
    sw = ctl('CUSTOM'),
    status = $('.op-status');
  const focus = b => b?.focus({ preventScroll: true });
  const active = () => ['countdown', 'search', 'ballot'].includes(phase);
  function clearVote() {
    vote?.close();
    vote = null;
  }
  function message(label, text) {
    $('.mm-state').textContent = label;
    status.textContent = text;
  }
  function draw() {
    if (dead) return;
    const v = variantOf(p.variant);
    root.dataset.state = phase;
    root.dataset.step = custom ? 'custom' : 'lobby';
    $('.mm-lobby').hidden = $('.mm-foot').hidden = custom;
    $('.mm-manual').hidden = !custom;
    customGrid.hidden = !custom;
    immersive(!custom);
    const busy = active(),
      voting = phase === 'ballot';
    $('.mm-menu').hidden = voting;
    $('.mm-ballot').hidden = !voting;
    $('.mm-count').textContent = voting ? '02 / 02' : '01 / 02';
    playlist.disabled = network.disabled = sw.disabled = busy;
    $('.mm-title').textContent = voting ? 'Match found' : phase === 'search' ? 'Searching' : 'Matchmaking';
    playlist.querySelector('strong').textContent = `${ladderName(p.ladder)} · ${v.name}`;
    network.querySelector('strong').textContent = routeName(p.mode);
    $('.mm-member strong').textContent = p.name;
    $('.mm-slot span').textContent = phase === 'search' ? 'Looking for a commander…' : 'Opponent slot open';
    $('.mm-domain').textContent = `${ladderName(p.ladder)}   /   ${v.domain}   /   1 v 1`;
    $('.mm-variant').textContent = v.name;
    $('.mm-rule').textContent = v.rule;
    $('.mm-content').textContent = content;
    start.textContent =
      phase === 'countdown'
        ? 'Cancel countdown'
        : phase === 'search'
          ? 'Cancel search'
          : phase === 'error'
            ? 'Retry matchmaking'
            : 'Start matchmaking';
    start.setAttribute('aria-label', start.textContent);
    $('.mm-metrics').hidden = phase !== 'search';
    if (phase === 'search') $('.mm-metrics').textContent = 'Tickets: —   /   Compatible: —';
    const record = $('.mm-record');
    record.hidden = p.ladder !== 'ranked';
    const n = ++revision;
    if (!record.hidden) {
      record.textContent = 'Reading local service record…';
      Promise.resolve()
        .then(() => lobbyRecord(address(p), p.variant))
        .then(r => {
          if (n === revision && !dead)
            record.textContent = r ? `Device rating ${r.rating}   ·   ${r.wins} W / ${r.losses} L` : 'Local record unavailable';
        })
        .catch(() => {
          if (n === revision && !dead) record.textContent = 'Local record unavailable';
        });
    }
  }
  function ready(note = 'Choose an operation and inspect its map pool.') {
    clearVote();
    phase = 'ready';
    draw();
    message('Ready', note);
  }
  function abort(redraw = true) {
    if (!job) return false;
    const req = job;
    job = null;
    clearTimeout(timer);
    req.abort();
    if (redraw && !dead) {
      const count = phase === 'countdown';
      ready(
        count
          ? 'Countdown cancelled. No queue ticket was created.'
          : phase === 'ballot'
            ? 'Left the map vote. No result recorded.'
            : 'Search cancelled. No flight reserved.'
      );
      focus(start);
    }
    return true;
  }
  function edit(which) {
    if (active() || closeSheet || dead) return;
    const owner = which === 'playlists' ? playlist : network;
    closeSheet = matchSheet(
      root,
      which,
      p,
      next => {
        p = next;
        const saved = savePreferences(p);
        ready(saved ? 'Configuration applied. Ready to match.' : 'Applied for this session. Device storage unavailable.');
      },
      () => {
        closeSheet = null;
        focus(owner);
      },
      mapRotation
    );
  }
  async function enter(req) {
    if (dead || job !== req) return;
    phase = 'search';
    draw();
    message('Search active', 'Verifying ruleset and active content…');
    try {
      await findMatch({
        variant: p.variant,
        ladder: p.ladder,
        relay: address(p),
        name: p.name,
        signal: req.signal,
        status: text => {
          if (!dead && job === req) status.textContent = text;
        },
        telemetry: ({ tickets, compatible }) => {
          if (!dead && job === req) $('.mm-metrics').textContent = `Tickets: ${tickets}   /   Compatible: ${compatible}`;
        },
        ballot: s => {
          if (dead || job !== req) return;
          if (!vote) {
            phase = 'ballot';
            draw();
            vote = ballotView($('.mm-ballot'), s.slate, variantOf(p.variant));
            message('Map vote open', 'Choose the battlefield for this operation.');
            vote.focus();
          }
          $('.mm-slot span').textContent = s.opponent || 'Paired commander';
          vote.update(s);
          if (s.winner) {
            $('.mm-title').textContent = 'Map selected';
            message('Proceed to staging', mapTitle(s.winner));
            if (!root.contains(document.activeElement) || document.activeElement.disabled) focus(ctl('BACK'));
          }
        },
        returned: () => {
          if (dead) return;
          job = null;
          ready('Returned from staging. Ready to match.');
          focus(start);
        }
      });
      if (job === req) {
        job = null;
        phase = 'staged';
      }
    } catch (e) {
      if (job !== req || dead) return;
      job = null;
      clearVote();
      phase = 'error';
      draw();
      message('Search ended', e.message || 'Unable to search. Retry or configure your network.');
      focus(start);
    }
  }
  function begin() {
    if (abort()) return;
    if (custom || closeSheet || dead || phase === 'staged') return;
    const req = (job = new AbortController()),
      until = performance.now() + 5000;
    phase = 'countdown';
    draw();
    const tick = () => {
      if (dead || job !== req) return;
      const remaining = until - performance.now(),
        s = Math.ceil(remaining / 1000);
      if (s <= 0) {
        enter(req);
        return;
      }
      message('Preflight countdown', `Searching in ${s} ${s === 1 ? 'second' : 'seconds'}. You can still cancel.`);
      timer = setTimeout(tick, Math.max(1, remaining - (s - 1) * 1000));
    };
    tick();
  }
  function manual() {
    if (dead || active()) return;
    custom = true;
    draw();
    focus(customGrid.querySelector('button:not(:disabled)'));
  }
  function back() {
    if (closeSheet) {
      closeSheet();
      return true;
    }
    if (abort()) return true;
    if (!custom) return false;
    custom = false;
    ready();
    focus(sw);
    return true;
  }
  function dispose() {
    dead = true;
    revision++;
    clearVote();
    document.body.style.removeProperty('--mm-photo');
    root.removeEventListener('keydown', move);
    closeSheet?.();
    abort(false);
    window.removeEventListener('pagehide', onHide);
  }
  const onHide = () => abort();
  window.addEventListener('pagehide', onHide);
  const controls = [playlist, network, start, sw];
  const highlight = b => controls.forEach(row => row.toggleAttribute('data-highlight', row === b));
  for (const b of controls)
    b.onfocus = b.onpointerenter = () => {
      if (!b.disabled) highlight(b);
    };
  highlight(playlist);
  playlist.onclick = () => edit('playlists');
  network.onclick = () => edit('network');
  start.onclick = begin;
  sw.onclick = manual;
  ctl('BACK').onclick = goBack;
  function move(e) {
    if (closeSheet || custom || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const buttons = [...root.querySelectorAll('.mm-menu button, .mm-options button, .mm-foot button')].filter(
      b => !b.disabled && b.checkVisibility()
    );
    const i = buttons.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  root.addEventListener('keydown', move);
  ready();
  loadContent()
    .then(c => {
      if (!dead) {
        content = describeContent(c);
        $('.mm-content').textContent = content;
      }
    })
    .catch(() => {
      if (!dead) $('.mm-content').textContent = 'Content unavailable';
    });
  return { cancel: abort, back, dispose };
}
