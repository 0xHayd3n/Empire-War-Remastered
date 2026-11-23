// Dates use elapsed time. A reviewed prewar opening gets a short, separately labeled
// lead-in, not a fictional BBY coordinate. Other named scenarios remain off the scale.
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
  const lead = periods.find(p => p.ftgu && calendarYear(p.label) === null),
    inset = lead ? (max > min ? 0.2 : 1) : 0;
  const dated = stops.map(s => {
    const at = inset + (1 - inset) * (max > min ? (s.year - min) / (max - min) : 0);
    return { ...s, at, value: lead ? at : s.year };
  });
  return lead ? [{ period: lead, year: null, at: 0, value: 0 }, ...dated] : dated;
}
export function nearestStop(stops, n) {
  return stops.reduce((a, b) => (Math.abs(b.value - n) < Math.abs(a.value - n) ? b : a));
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
    lastCalendar,
    calendarButton,
    scenarioButton,
    labels,
    buttons = [];
  function select(period) {
    if (period !== current) pick(period);
  }
  function button(label, action) {
    const b = el('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = action;
    return b;
  }
  return {
    close() {
      labels?.disconnect();
    },
    mount(periods) {
      labels?.disconnect();
      host.replaceChildren();
      stops = yearStops(periods);
      const scenario = periods.find(p => p.scenario);
      lastCalendar = stops[0]?.period || periods.find(p => !p.scenario);
      buttons = [];
      range = calendarButton = scenarioButton = null;
      if (stops.length > 1 && stops[0].value < stops.at(-1).value) {
        const frame = el('div', 'uc-year-scale'),
          ruler = el('div', 'uc-year-ruler');
        ruler.setAttribute('aria-hidden', 'true');
        for (const s of stops) {
          const tick = el('span', 'uc-year-tick');
          tick.dataset.year = s.period.label;
          tick.style.left = `${100 * s.at}%`;
          const text = el('small');
          const number = s.period.label.split(' ')[0];
          text.textContent = s.year === null ? 'FTGU' : s.period.ftgu ? `${number} · FTGU` : number;
          tick.title = s.period.ftgu && s.year !== null ? `${s.period.label} · From the Ground Up available` : s.period.label;
          tick.append(text);
          ruler.append(tick);
        }
        // Preserve every tick and snap target. Omit only colliding interior captions when
        // e.g. the 32-year gap to 3964 BBY compresses the remaining years at the right.
        const captions = [...ruler.querySelectorAll('small')];
        labels = new ResizeObserver(() => {
          const rects = captions.map(c => c.getBoundingClientRect());
          let right = rects[0].right;
          captions.slice(1, -1).forEach((c, i) => {
            const r = rects[i + 1],
              fits = r.left >= right + 3 && r.right + 3 <= rects.at(-1).left;
            c.style.visibility = fits ? '' : 'hidden';
            if (fits) right = r.right;
          });
        });
        labels.observe(ruler);
        range = el('input', 'uc-year-range');
        range.type = 'range';
        range.min = stops[0].value;
        range.max = stops.at(-1).value;
        range.step = 'any';
        range.setAttribute('aria-label', 'Starting year');
        range.oninput = () => {
          const s = nearestStop(stops, range.valueAsNumber);
          range.value = s.value;
          select(s.period);
        };
        // A click directly on the thumb need not emit an input event.
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
        if (p.scenario || (range && stops.some(s => s.period === p))) continue;
        const b = button(p.label, () => select(p));
        buttons.push([p, b]);
        host.append(b);
      }
      if (scenario) {
        const modes = el('div', 'uc-start-modes');
        if (lastCalendar) {
          calendarButton = button('By year', () => select(lastCalendar));
          scenarioButton = button(scenario.label, () => select(scenario));
          modes.setAttribute('role', 'group');
          modes.setAttribute('aria-label', 'Browse starts');
          modes.append(calendarButton, scenarioButton);
        } else modes.textContent = 'Scenario starts · no year required';
        host.append(modes);
      }
    },
    show(period) {
      current = period;
      if (!period.scenario) lastCalendar = period;
      const s = stops.find(s => s.period === (period.scenario ? lastCalendar : period));
      readout.textContent = range && s ? s.period.label : '';
      readout.classList.toggle('inactive', period.scenario);
      calendarButton?.setAttribute('aria-pressed', String(!period.scenario));
      scenarioButton?.setAttribute('aria-pressed', String(period.scenario));
      if (range) {
        range.disabled = period.scenario;
        range.parentElement.classList.toggle('inactive', period.scenario);
        range.value = s?.value ?? stops[0].value;
        range.dataset.onTrack = String(!!s);
        range.style.setProperty('--elapsed', `${100 * (s?.at ?? 0)}%`);
        range.setAttribute(
          'aria-valuetext',
          period.scenario
            ? 'Inactive for scenario starts'
            : s
              ? period.ftgu && s.year !== null
                ? `${period.label} · FTGU available`
                : period.label
              : `${period.label} · no calendar year selected`
        );
      }
      for (const [p, b] of buttons) {
        b.setAttribute('aria-pressed', String(p === period));
        b.disabled = period.scenario;
      }
    }
  };
}
