// The load screen and live graphics switch share one attempt per mounted battlefield.
// A live switch may draw stock while loading; an enabled cold launch must await prepare().
export function landscapeBinding({ status, enabled, signal, load, update, discard, changed, warning = 'Reviewed landscape: retaining original scene.' }) {
  let pending;
  function start(game) {
    status.state = 'loading';
    pending = load(game).then(() => {
      if (!signal.aborted) status.state = 'ready';
    }).catch(error => {
      if (signal.aborted) return;
      discard();
      status.state = 'unavailable';
      status.reason = error.message;
      console.warn(warning, error.message);
    }).finally(() => { if (!signal.aborted) changed?.(); });
    changed?.();
    return pending;
  }
  function tick(game) {
    if (signal.aborted) return;
    const on = enabled();
    if (on && status.state === 'idle') start(game);
    else if (status.state === 'ready') update(game, on);
  }
  tick.prepare = game => {
    if (!enabled() || signal.aborted) return;
    return (pending || start(game)).then(() => {
      if (!signal.aborted && status.state === 'ready') update(game, enabled());
    });
  };
  return tick;
}
