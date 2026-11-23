// Theme follows the selected collection; the browser owns autoplay permission and tab mute.
const audio = document.querySelector('#theme-audio');
if (audio) {
  const policy = document.querySelector('.theme-policy');
  audio.volume = 0.28;
  // Older running launchers may still emit the data-src form of this element.
  if (!audio.hasAttribute('src') && audio.dataset.src) audio.src = audio.dataset.src;
  const start = () => {
    if (document.hidden || !audio.paused) return;
    audio.play().catch(error => {
      if (policy && error.name === 'NotAllowedError' && audio.paused && !document.hidden) policy.hidden = false;
    });
  };
  audio.addEventListener('playing', () => { if (policy) policy.hidden = true; });
  document.addEventListener('keydown', start);
  document.addEventListener('pointerup', start);
  document.addEventListener('click', start);
  document.addEventListener('visibilitychange', () => document.hidden ? audio.pause() : start());
  addEventListener('pagehide', () => audio.pause());
  addEventListener('pageshow', start);
  start();
}

const tiles = document.querySelector('.tiles');
if (tiles) {
  const links = [...tiles.querySelectorAll('a')];
  const current = tiles.querySelector('[aria-current]');
  if (current) tiles.scrollLeft = tiles.scrollLeft + current.getBoundingClientRect().left - tiles.getBoundingClientRect().left + (current.offsetWidth - tiles.clientWidth) / 2;
  tiles.addEventListener('keydown', event => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const i = links.indexOf(event.target);
    if (!step || i < 0 || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    links[(i + step + links.length) % links.length].focus();
  });
}
