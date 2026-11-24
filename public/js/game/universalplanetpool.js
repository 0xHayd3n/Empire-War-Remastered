// One live, revision-bound art namespace. Serialize GPU work; when several choices arrive
// during an upload only the newest still runs next. Never reuse pack-local model names across VFS mounts.
export function planetPool() {
  let worker,
    namespace,
    current,
    waiting,
    names = new Set(),
    hasPlate = false;
  function close() {
    if (worker) {
      worker.onmessage = worker.onerror = null;
      worker.terminate();
    }
    worker = null;
    namespace = null;
    hasPlate = false;
    names.clear();
    for (const job of [current, waiting]) job?.reject(new DOMException('Preview superseded', 'AbortError'));
    current = waiting = null;
  }
  function run(job) {
    if (job.signal.aborted) {
      job.reject(job.signal.reason);
      return;
    }
    current = job;
    const { q } = job;
    try {
      worker.postMessage({ ...q, backplate: hasPlate ? null : q.backplate });
      if (q.pass !== 'backdrop') hasPlate = true;
      if (!q.laneKit) for (const w of q.worlds) names.add(w[0]);
    } catch (e) {
      job.reject(e);
      close();
    }
  }
  function request(ns, q, signal) {
    if (ns !== namespace || (!q.laneKit && new Set([...names, ...q.worlds.map(w => w[0])]).size > Math.max(256, q.worlds.length))) close();
    if (!worker) {
      namespace = ns;
      worker = new Worker(new URL('./universalviewworker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = current;
        current = null;
        if (data.error) {
          job.reject(Error(data.error));
          close();
          return;
        }
        if (job.signal.aborted) {
          data.bitmap.close();
          job.reject(job.signal.reason);
        } else job.resolve(data);
        const next = waiting;
        waiting = null;
        if (next) run(next);
      };
      worker.onerror = e => {
        current?.reject(Error(e.message));
        close();
      };
    }
    return new Promise((resolve, reject) => {
      const job = { q, signal, resolve, reject };
      if (current) {
        waiting?.reject(new DOMException('Preview superseded', 'AbortError'));
        waiting = job;
      } else run(job);
    });
  }
  return {
    request,
    close,
    retain(ns) {
      if (ns !== namespace) close();
    }
  };
}
