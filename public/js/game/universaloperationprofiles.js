// This is transport, not a profile picker. A battlefield card carries its owning
// profile; only the Universal host may mount it. No unit or asset IDs cross origins.
export function operationProfiles(ui, { current, mode, host, selection }) {
  ui.root.dataset.universalScreen = mode;
  ui.root.dataset.profile = current;
  ui.operation = {
    current,
    host,
    selection,
    openField(id, world, domain, query, file) {
      if (ui.root.inert || ui.operation.beforeTravel?.() === false) return;
      if (window.parent === window) {
        ui.status.textContent = 'Open the Universal Library to use this battlefield.';
        return;
      }
      ui.root.inert = true;
      ui.status.textContent = 'Opening battlefield…';
      const failed = e => {
        if (e.source !== parent || e.origin !== host || e.data?.kind !== 'universal-error') return;
        removeEventListener('message', failed);
        ui.root.inert = false;
        ui.status.textContent = e.data.error || 'Battlefield unavailable.';
      };
      addEventListener('message', failed);
      const draft = ui.operation.travel?.(id);
      parent.postMessage({ kind: 'universal-field', id, mode, world, domain, query, draft, file }, host);
    }
  };
}
