// Eligibility is about having a battlefield to draw, not who controls its simulation.
// The legacy space launcher omits mode. Never allocate a solver for a headless run,
// the strategic map, or an auto-resolve that doesn't open a tactical battlefield.
export function usesBattleDestruction(setup) {
  return !!setup && !setup.headless && (!setup.mode || setup.mode === 'land' || setup.mode === 'space');
}

// Import only for eligible battles: one local WASM module, separate render-only worlds.
let ready;
export function loadWreckPhysics() {
  return (ready ||= import('../../vendor/rapier/rapier.es.js')
    .then(async R => {
      await R.init();
      return R;
    })
    .catch(e => {
      ready = null;
      throw e;
    }));
}
