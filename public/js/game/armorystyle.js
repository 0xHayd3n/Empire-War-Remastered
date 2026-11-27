export function armoryStyle() {
  if (document.querySelector('link[data-armory]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../armory.css', import.meta.url).href;
  link.dataset.armory = '';
  document.head.append(link);
}
