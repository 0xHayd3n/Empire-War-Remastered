import { viewOptions as prefs } from './viewpreferences.js';
export function movieCaptionStyle(text, size) {
  text.style.fontSize = `${size * prefs.captionScale}px`;
  text.style.color = { white: '#fff', yellow: '#ffed80', cyan: '#9ffaff' }[prefs.captionInk];
  text.style.backgroundColor = { none: 'transparent', dim: 'rgba(0,0,0,.65)', black: '#000' }[prefs.captionPlate];
  text.style.textShadow = '0 0 2px #000, 0 0 2px #000';
  text.style.boxDecorationBreak = 'clone';
}
