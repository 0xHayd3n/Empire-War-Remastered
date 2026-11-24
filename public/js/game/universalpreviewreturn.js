// Short-lived handoff on Escape only. No worker, GL context, request, or old dialog is
// retained. Identity is the exact immutable atlas object, not a profile name or map index.
export function previewReturn(ms = 45000) {
  let saved, timer;
  function clear() {
    clearTimeout(timer);
    if (saved) {
      for (const entry of [saved.plate, saved.shot]) entry?.[1].bitmap.close();
      saved = null;
    }
  }
  return {
    clear,
    put(entry) {
      clear();
      saved = entry;
      timer = setTimeout(clear, ms);
    },
    take(profiles) {
      if (saved?.profiles !== profiles) {
        clear();
        return null;
      }
      const result = saved;
      saved = null;
      clearTimeout(timer);
      return result;
    }
  };
}
