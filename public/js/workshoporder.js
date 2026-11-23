// A Steam launch line is data, not a command. Keep IDs as strings (PublishedFileId is uint64).
export function parseWorkshopOrder(text) {
  const ids = [], seen = new Set();
  for (const token of text.trim().split(/\s+/)) {
    const id = /^STEAMMOD=([1-9][0-9]{0,19})$/i.exec(token)?.[1];
    if (!id || (id.length === 20 && id > '18446744073709551615')) throw new Error('Paste only STEAMMOD=number entries separated by spaces.');
    if (seen.has(id)) throw new Error(`Workshop item ${id} appears twice.`);
    ids.push(id);
    seen.add(id);
  }
  return ids;
}

export function matchWorkshopOrder(ids, mods) {
  return ids.map(id => {
    // Never match a display name. Older directory-picker records still have their original handle.
    const hits = mods.filter(m => (m.workshop || m.workshopFolder || m.handle?.name) === id);
    if (hits.length > 1) throw new Error(`Several mods match Workshop item ${id}. Remove the duplicate from the list first.`);
    return hits[0];
  });
}

export function workshopLayers(ids, mods) {
  const matches = matchWorkshopOrder(ids, mods);
  const missing = ids.filter((_, i) => !matches[i]);
  if (missing.length) throw new Error(`Not in the mod list: ${missing.join(', ')}. Add the numbered item folders and try again.`);
  // Steam checks the first item first; openOverlay reads the menu's list from the end.
  const enabled = new Set(matches);
  return [...matches.reverse(), ...mods.filter(m => !enabled.has(m))].map((mod, order) => ({ mod, order, on: enabled.has(mod) }));
}
