// Small DOM helpers shared by the title's interactive workbenches. Metadata is always text.
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
export function action(parent, label, fn, cls = '') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.onclick = fn;
  parent.append(b);
  return b;
}
export function link(parent, label, url, cls = '') {
  const a = el('a', cls, label);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  parent.append(a);
  return a;
}
export function option(select, value, label) {
  const o = el('option', '', label);
  o.value = value;
  select.append(o);
}
export function loadList(key) {
  try {
    const a = JSON.parse(localStorage.getItem(key));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
// Native confirm() is suppressed inside cross-origin Universal frames.
export function askDesk(root, message, yes) {
  const d = el('dialog', 'campaign-picker');
  d.setAttribute('aria-label', message);
  d.append(el('p', '', message));
  const foot = el('footer');
  d.append(foot);
  const close = () => {
    d.close();
    d.remove();
  };
  action(foot, 'Cancel', close);
  action(foot, yes.label, () => {
    close();
    yes.run();
  });
  d.oncancel = e => {
    e.preventDefault();
    close();
  };
  d.onkeydown = e => e.stopPropagation();
  root.append(d);
  d.showModal();
}
export const universalHost = () => document.querySelector('meta[name="swr-universal"]')?.content;
export const profile = () => document.querySelector('meta[name="swr-pack-revision"]')?.content.split(':')[0] || 'stock';
export function switchProfile(id, mode) {
  const host = universalHost();
  if (host && parent !== window && /^(stock|\d+)$/.test(id)) parent.postMessage({ kind: 'universal-select', id, mode }, host);
}
