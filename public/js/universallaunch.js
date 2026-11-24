// Only injected into Universal's profile frames. The presentation token is not
// a start ticket: it can describe/dismiss one plate, never authorize a launch.
(() => {
  const host = document.querySelector('meta[name="swr-universal"]').content;
  if (parent === window) return;
  let token = new URLSearchParams(location.search).get('universal-launch'),
    observer,
    last = '';
  function send(action, fields = {}) {
    if (token) parent.postMessage({ kind: 'universal-plate', action, token, ...fields }, host);
  }
  function end() {
    send('end');
    token = null;
    observer?.disconnect();
    observer = null;
    last = '';
  }
  function watch() {
    const stage = document.querySelector('#loadText');
    if (!stage) return;
    observer = new MutationObserver(() => {
      if (document.querySelector('#loading')?.dataset.failed === 'true') {
        end();
        return;
      }
      const text = stage.textContent.trim().replace(/\s*\(\d+\/\d+\)$/, '');
      if (text && text !== last) {
        last = text;
        send('stage', { text });
      }
    });
    observer.observe(stage, { childList: true, subtree: true, characterData: true });
    observer.observe(document.querySelector('#loading'), { attributes: true, attributeFilter: ['data-failed'] });
  }
  window.universalLaunch = {
    get pending() {
      return !!token;
    },
    begin(title, subtitle) {
      token = crypto.randomUUID();
      send('begin', { title, subtitle });
      watch();
    },
    end
  };
  if (token) watch();
})();
