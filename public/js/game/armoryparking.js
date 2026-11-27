// One fully loaded hull may sleep between visits to this title. No frame clock,
// DOM from the departed desk, unbounded model cache, or cross-document sharing.
let slot;
function clear(keep = false) {
  if (!slot) return;
  const { worker, timeout, events, observer } = slot;
  slot = null;
  clearTimeout(timeout);
  events.abort();
  observer.disconnect();
  worker.onmessage = worker.onerror = null;
  if (!keep) worker.terminate();
}
export function parkHull(owner, key, worker, model) {
  clear();
  if (!owner?.isConnected || document.hidden || !owner.checkVisibility() || navigator.connection?.saveData) {
    worker.terminate();
    return;
  }
  const events = new AbortController(),
    drop = () => clear(),
    check = () => {
      if (document.hidden || !owner.isConnected || !owner.checkVisibility()) drop();
    };
  const observer = new MutationObserver(check);
  observer.observe(owner, { attributes: true, attributeFilter: ['style', 'hidden'] });
  observer.observe(owner.parentNode, { childList: true });
  window.addEventListener('pagehide', drop, { signal: events.signal, once: true });
  document.addEventListener('visibilitychange', check, { signal: events.signal });
  slot = { owner, key, worker, model, events, observer, timeout: setTimeout(drop, 15000) };
  worker.onmessage = ({ data }) => {
    data.bitmap?.close(); // Drain an already-requested frame.
    if (data.kind === 'error') drop();
  };
  worker.onerror = drop;
}
export function takeHull(owner, key) {
  if (!slot) return null;
  const hit = slot.owner === owner && slot.key === key ? { worker: slot.worker, model: slot.model } : null;
  clear(!!hit);
  return hit;
}
export function forgetHull() {
  clear();
}
