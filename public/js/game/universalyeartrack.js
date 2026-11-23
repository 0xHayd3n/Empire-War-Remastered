// Time, not array index, determines the position of a playable start. Scenarios without
// a calendar coordinate never enter the scale. Keep the native range alive during a drag.
export function calendarYear(label) {
  const m = /^(\d+(?:\.\d+)?) (BBY|ABY)$/.exec(label);
  return m ? Number(m[1]) * (m[2] === 'BBY' ? -1 : 1) : null;
}
export function yearStops(periods) {
  const stops = periods
    .map(period => ({ period, year: calendarYear(period.label) }))
    .filter(s => s.year !== null)
    .sort((a, b) => a.year - b.year);
  const min = stops[0]?.year,
    max = stops.at(-1)?.year;
  return stops.map(s => ({ ...s, at: max > min ? (s.year - min) / (max - min) : 0 }));
}
export function nearestStop(stops, n) {
  return stops.reduce((a, b) => (Math.abs(b.year - n) < Math.abs(a.year - n) ? b : a));
}
const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
export function yearTrack(host, readout, pick) {
  let stops = [],
    range,
    current,
    buttons = [];
  function select(period) {
    if (period !== current) pick(period);
  }
  return {
    mount(periods) {
      host.replaceChildren();
      stops = yearStops(periods);
      buttons = [];
      range = null;
      if (stops.length > 1 && stops[0].year !== stops.at(-1).year) {
        const frame = el('div', 'uc-year-scale'),
          ruler = el('div', 'uc-year-ruler');
        ruler.setAttribute('aria-hidden', 'true');
        for (const s of stops) {
          const tick = el('span', 'uc-year-tick');
          tick.dataset.year = s.period.label;
          tick.style.left = `${100 * s.at}%`;
          const text = el('small');
          text.textContent = s.period.label.split(' ')[0];
          tick.append(text);
          ruler.append(tick);
        }
        frame.classList.toggle('dense', stops.length > 4);
        range = el('input', 'uc-year-range');
        range.type = 'range';
        range.min = stops[0].year;
        range.max = stops.at(-1).year;
        range.step = 'any';
        range.setAttribute('aria-label', 'Starting year');
        range.oninput = () => {
          const s = nearestStop(stops, range.valueAsNumber);
          range.value = s.year;
          select(s.period);
        };
        // Clicking the resting endpoint when an undated scenario is active need not emit an input event.
        range.onclick = () => select(nearestStop(stops, range.valueAsNumber).period);
        range.onkeydown = e => {
          const i = stops.findIndex(s => s.period === current),
            last = stops.length - 1;
          const keys = {
            ArrowRight: i + 1,
            ArrowUp: i + 1,
            ArrowLeft: i - 1,
            ArrowDown: i - 1,
            Home: 0,
            End: last,
            PageUp: i + 1,
            PageDown: i - 1,
            Enter: Math.max(0, i),
            ' ': Math.max(0, i)
          };
          if (!Object.hasOwn(keys, e.key)) return;
          e.preventDefault();
          select(stops[Math.min(last, Math.max(0, keys[e.key]))].period);
        };
        frame.append(ruler, range);
        host.append(frame);
      }
      for (const p of periods) {
        if (range && calendarYear(p.label) !== null) continue;
        const b = el('button');
        b.type = 'button';
        b.textContent = p.label;
        b.onclick = () => select(p);
        buttons.push([p, b]);
        host.append(b);
      }
    },
    show(period) {
      current = period;
      const s = stops.find(s => s.period === period);
      readout.textContent = range && s ? period.label : '';
      if (range) {
        range.value = s?.year ?? stops[0].year;
        range.dataset.dated = String(!!s);
        range.style.setProperty('--elapsed', `${100 * (s?.at ?? 0)}%`);
        range.setAttribute('aria-valuetext', s ? period.label : `${period.label} · no calendar year selected`);
      }
      for (const [p, b] of buttons) b.setAttribute('aria-pressed', String(p === period));
    }
  };
}
