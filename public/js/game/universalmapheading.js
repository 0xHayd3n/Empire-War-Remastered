// Navigation belongs to the stationary chart frame, never the pan/zoom plane.
export function mapHeading(canvas, title, back, id) {
  const head = document.createElement('header'),
    exit = document.createElement('button'),
    heading = document.createElement('h1');
  head.className = 'uc-map-heading';
  exit.type = 'button';
  exit.className = 'uc-map-back';
  exit.title = 'Back';
  exit.setAttribute('aria-label', 'Back');
  exit.onclick = back;
  heading.textContent = title;
  if (id) heading.id = id;
  head.append(exit, heading);
  canvas.prepend(head);
  return exit;
}
