import { loadMapPreview, mapTitle } from '../ted.js';
import { el } from './commandui.js';

// The transport owns the ballot. This view never invents a vote or advances on its own clock.
export function ballotView(root, slate, rules) {
  root.innerHTML = `<figure class="mm-chart"><div class="mm-chart-plate"></div><figcaption><small>Tactical survey</small><strong></strong></figcaption></figure>
    <div class="mm-vote-caption"><strong>Vote for a map</strong><span class="mm-clock" role="timer"></span></div>
    <div class="mm-options" role="group" aria-label="Map ballot"></div><p class="mm-vote-help">Change your vote until time expires. Ties go to the first tied map listed.</p>`;
  const options = root.querySelector('.mm-options'),
    plate = root.querySelector('.mm-chart-plate'),
    caption = root.querySelector('figcaption strong');
  const pictures = new Map();
  let inspected = 0,
    state,
    dead = false;
  function inspect(i) {
    inspected = i;
    const file = slate[i];
    caption.textContent = mapTitle(file);
    plate.style.backgroundImage = pictures.has(file) ? `url("${pictures.get(file)}")` : '';
  }
  const rows = slate.map((file, i) => {
    const b = el('button', 'mm-candidate'),
      thumb = el('i', 'mm-thumb'),
      copy = el('span', 'mm-map-name');
    b.type = 'button';
    b.dataset.map = file;
    b.setAttribute('aria-label', 'Vote for ' + mapTitle(file));
    copy.append(el('small', '', rules.name), el('strong', '', mapTitle(file)));
    const count = el('b', 'mm-votes', '0');
    b.append(thumb, copy, count, el('i', 'mm-choice-mark'));
    b.onclick = () => {
      try {
        state?.cast(i);
      } catch (err) {
        if (err.code !== 'ballot-closed') throw err;
      } // A click can land on the deadline.
    };
    b.onfocus = b.onpointerenter = () => {
      if (!state?.winner) inspect(i);
    };
    options.append(b);
    loadMapPreview(file)
      .then(cv => {
        if (!cv || dead) return;
        const src = cv.toDataURL();
        pictures.set(file, src);
        thumb.style.backgroundImage = `url("${src}")`;
        if (inspected === i) inspect(i);
      })
      .catch(() => {}); // Some mod maps have no preview; keep the survey grid and real name.
    return { b, count };
  });
  inspect(0);
  function update(s) {
    state = s;
    for (const [i, { b, count }] of rows.entries()) {
      const n = s.votes[i];
      count.textContent = n;
      b.setAttribute('aria-label', `Vote for ${mapTitle(slate[i])}, ${n} ${n === 1 ? 'vote' : 'votes'}`);
      b.setAttribute('aria-pressed', String(s.mine === i));
      b.toggleAttribute('data-winner', s.winner === slate[i]);
      b.disabled = !!s.winner;
    }
    if (s.winner) {
      inspect(slate.indexOf(s.winner));
      root.querySelector('.mm-vote-caption strong').textContent = 'Ballot result';
      const highest = Math.max(...s.votes);
      root.querySelector('.mm-vote-help').textContent = !highest
        ? 'No votes cast. First map in the rotation selected.'
        : s.votes.filter(n => n === highest).length > 1
          ? 'Tie broken by the displayed map order.'
          : 'Selected by commander vote.';
    }
    root.querySelector('.mm-clock').textContent = s.winner ? 'Vote closed' : `0:${String(s.remaining).padStart(2, '0')}`;
  }
  return {
    update,
    focus: () => rows[0]?.b.focus({ preventScroll: true }),
    close: () => {
      dead = true;
      state = null;
      pictures.clear();
      root.replaceChildren();
    }
  };
}
