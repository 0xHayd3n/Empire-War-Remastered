// No network audio request before the listener enables the theme.
const audio = document.querySelector('#theme-audio');
const control = document.querySelector('#theme-control');
if (audio && control) {
  let wanted = false;
  try { wanted = sessionStorage.getItem('workshop-theme') === 'on'; } catch {}
  audio.volume = 0.28;
  function paint() {
    const on = !audio.paused;
    control.setAttribute('aria-pressed', String(on));
    control.textContent = on ? '♫  Sound on' : '♫  Sound off';
  }
  async function start() {
    if (!wanted || document.hidden) return;
    if (!audio.hasAttribute('src')) audio.src = audio.dataset.src;
    try { await audio.play(); } catch { paint(); }
  }
  control.addEventListener('click', () => {
    wanted = audio.paused;
    try { sessionStorage.setItem('workshop-theme', wanted ? 'on' : 'off'); } catch {}
    if (wanted) start(); else audio.pause();
  });
  for (const event of ['play', 'pause', 'error']) audio.addEventListener(event, paint);
  document.addEventListener('visibilitychange', () => document.hidden ? audio.pause() : start());
  addEventListener('pagehide', () => audio.pause());
  addEventListener('pageshow', start);
}
