// Run the checked-out Worker modules on loopback with caller-owned disposable persistence.
const path = require('node:path');
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [path.resolve('lobby')] }));
exports.worker = (tmp, port) =>
  new Miniflare({
    ...convertV4MiniflareOptions({
      cf: false,
      host: '127.0.0.1',
      port,
      modulesRoot: path.resolve('lobby/src'),
      modules: ['index.js', 'social.js'].map(f => ({ type: 'ESModule', path: path.resolve('lobby/src', f) })),
      compatibilityDate: '2026-09-01',
      durableObjects: { REGISTRY: 'Registry', LOBBY: 'Lobby', HALL: 'Hall', SOCIAL: { className: 'Social', useSQLite: true } }
    }),
    resourcePersistencePath: tmp,
    telemetry: { enabled: false }
  });
