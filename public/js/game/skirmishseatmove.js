// Reallocation never allocates a slot. Drag, touch or pick up a seat with Enter,
// then activate the destination (including the new-team target) with Enter.
export function seatMoves(list, move) {
  let held = null,
    hover = null,
    touch = null,
    suppressClick = false;
  const zone = target => target?.closest?.('[data-drop-team]');
  function highlight(el) {
    hover?.classList.remove('op-drag-over');
    hover = el;
    hover?.classList.add('op-drag-over');
  }
  function hold(seat) {
    held = seat;
    list.classList.toggle('op-carrying', seat !== null);
    for (const row of list.querySelectorAll('[data-seat]')) row.classList.toggle('op-lifted', +row.dataset.seat === seat);
    for (const b of list.querySelectorAll('[data-lift-seat]')) b.setAttribute('aria-pressed', String(+b.dataset.liftSeat === seat));
  }
  function cancel() {
    const was = held;
    touch = null;
    highlight(null);
    hold(null);
    return was;
  }
  function drop(target) {
    const to = zone(target),
      s = held;
    if (s === null || !to || !list.contains(to)) return false;
    cancel();
    move(s, +to.dataset.dropTeam);
    return true;
  }
  list.ondragstart = e => {
    const row = e.target.closest('[data-seat]');
    if (!row || e.target.closest('input,select')) return;
    touch = null;
    hold(+row.dataset.seat);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'skirmish-seat');
  };
  list.ondragover = e => {
    if (held === null) return;
    const z = zone(e.target);
    highlight(z);
    if (z) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };
  list.ondragleave = e => {
    if (!list.contains(e.relatedTarget)) highlight(null);
  };
  list.ondrop = e => {
    e.preventDefault();
    if (!drop(e.target)) cancel();
  };
  list.ondragend = cancel;
  list.onkeydown = e => {
    if (e.key === 'Escape' && held !== null) {
      e.preventDefault();
      e.stopPropagation();
      const s = cancel();
      list.querySelector(`[data-lift-seat="${s}"]`)?.focus();
    }
  };
  // A tap also picks up/drops: moving to a team below the fold never requires
  // holding a finger down while scrolling. Touch-drag can use the same targets.
  function handle(b, seat) {
    b.dataset.liftSeat = seat;
    b.setAttribute('aria-pressed', 'false');
    b.onclick = () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (held === seat) cancel();
      else hold(seat);
    };
    b.onpointerdown = e => {
      suppressClick = false;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false };
      b.setPointerCapture(e.pointerId);
    };
    b.onpointermove = e => {
      if (touch?.id !== e.pointerId) return;
      if (!touch.drag && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 8) {
        touch.drag = true;
        hold(seat);
      }
      if (touch.drag) highlight(zone(document.elementFromPoint(e.clientX, e.clientY)));
    };
    b.onpointerup = e => {
      if (touch?.id !== e.pointerId) return;
      const drag = touch.drag;
      touch = null;
      if (drag) {
        suppressClick = true;
        if (!drop(document.elementFromPoint(e.clientX, e.clientY))) cancel();
      }
    };
    b.onpointercancel = cancel;
  }
  return {
    handle,
    drop,
    cancel,
    get held() {
      return held;
    }
  };
}
