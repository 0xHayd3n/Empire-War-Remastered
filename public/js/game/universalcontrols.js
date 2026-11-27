// Native radios and ranges keep keyboard / screen-reader semantics. Retain focused nodes across
// rule updates (in particular, never replace the thumb during a pointer drag).
const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
export function crest(fact, name, key = false) {
  const art = fact?.emblem || (key && fact?.keyIcon);
  const el = art ? node('img', 'uc-crest') : node('b', 'uc-crest uc-monogram');
  if (art) {
    el.src = art;
    if (!fact.emblem) el.title = name + ' · Faction unit icon';
    el.alt = '';
  } else {
    el.textContent = (name || '◇')
      .trim()
      .split(/[\s-]+/)
      .slice(0, 2)
      .map(n => [...n][0])
      .join('')
      .toUpperCase();
    el.title = 'No authored emblem · ' + name;
  }
  el.setAttribute('aria-hidden', 'true');
  return el;
}
export function settingsControls(panel) {
  const fields = new Map();
  function group(id, title, style) {
    if (!fields.has(id)) {
      const el = node('fieldset', 'uc-setting uc-' + style),
        legend = node('legend', '', title),
        body = node('div', 'uc-values');
      el.dataset.field = id;
      el.append(legend, body);
      panel.append(el);
      fields.set(id, { el, body, items: new Map() });
    }
    return fields.get(id);
  }
  function radios(id, title, rows, value, change, cards = false) {
    const g = group(id, title, cards ? 'cards' : 'checks');
    g.change = change;
    const live = new Set();
    for (const [i, r] of rows.entries()) {
      const k = String(r.value);
      live.add(k);
      let v = g.items.get(k);
      if (!v) {
        const el = node('label', 'uc-choice'),
          input = node('input'),
          face = node('span', 'uc-face'),
          caption = node('span', 'uc-choice-label');
        input.type = 'radio';
        input.name = 'uc-' + id;
        input.value = k;
        input.onchange = () => {
          if (!input.disabled && input.checked) g.change(input.value);
        };
        face.append(caption);
        el.append(input, face);
        v = { el, input, face, caption };
        g.items.set(k, v);
      }
      if (g.body.children[i] !== v.el) g.body.insertBefore(v.el, g.body.children[i] || null);
      v.input.disabled = !!r.disabled;
      v.input.checked = !r.disabled && k === String(value);
      v.caption.textContent = r.label;
      if (r.disabled) v.caption.append(node('small', 'uc-locked-note', 'Not selectable in this campaign'));
      if (cards && v.fact !== r.fact) {
        const fact = r.fact;
        v.fact = fact;
        v.el.style.setProperty('--faction', fact.color);
        v.face.replaceChildren(crest(fact, r.label));
        if (fact.portrait) {
          const img = node('img', 'uc-portrait');
          img.alt = '';
          img.src = fact.portrait;
          v.face.append(img);
        }
        v.face.append(v.caption);
        v.el.title = fact.representative ? `${r.label} · ${fact.representative}` : r.label;
      }
    }
    for (const [k, v] of g.items)
      if (!live.has(k)) {
        v.el.remove();
        g.items.delete(k);
      }
  }
  function slider(id, title, rows, value, change) {
    const g = group(id, title, 'slider');
    if (!g.input) {
      g.input = node('input');
      g.input.type = 'range';
      g.input.min = 0;
      g.input.step = 1;
      g.input.setAttribute('aria-label', title);
      g.output = node('span', 'uc-readout');
      g.body.append(g.input, g.output);
    }
    const i = Math.max(
      0,
      rows.findIndex(r => String(r.value) === String(value))
    );
    g.input.max = Math.max(1, rows.length - 1);
    g.input.disabled = rows.length < 2;
    g.input.value = i;
    g.input.setAttribute('aria-valuetext', rows[i].label);
    g.input.style.setProperty('--fill', (100 * i) / Number(g.input.max) + '%');
    g.output.textContent = rows[i].label;
    g.input.oninput = () => change(String(rows[g.input.valueAsNumber].value));
  }
  return { radios, slider };
}
