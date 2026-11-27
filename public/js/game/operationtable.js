import { element } from './operationsetup.js';

export function operationTable(label, columns) {
  const table = element('table', 'op-table');
  table.setAttribute('aria-label', label);
  const row = table.createTHead().insertRow();
  for (const column of columns) {
    const th = element('th', '', column);
    th.scope = 'col';
    row.append(th);
  }
  return table;
}
// One keyboard stop per choice; clicking anywhere on its row selects the same target.
export function choiceRow(body, button, values) {
  const row = body.insertRow();
  row.insertCell().append(button);
  for (const value of values) row.insertCell().append(value);
  row.onclick = e => {
    if (!button.contains(e.target)) {
      button.focus({ preventScroll: true });
      button.click();
    }
  };
  return row;
}
