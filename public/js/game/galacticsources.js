// Source text only. A galaxy can discover GameScoring's dependencies while its
// models load, without creating a VM, executing Lua or touching the world.
import { fetchText, decodeFileText, pageOverlay } from '../vfs.js';
import { expansion } from '../edition.js';

export function unpackGalacticSources(buffer) {
  const view = new DataView(buffer),
    decoder = new TextDecoder(),
    files = new Map();
  for (let i = 0; i < buffer.byteLength; ) {
    const pathSize = view.getUint16(i, true),
      size = view.getUint32(i + 2, true);
    i += 6;
    const path = decoder.decode(new Uint8Array(buffer, i, pathSize));
    i += pathSize;
    files.set(path, new Uint8Array(buffer, i, size));
    i += size;
  }
  return files;
}
export async function mountedSourceLibrary() {
  if (!globalThis.document?.querySelector?.('meta[name="swr-mounted-index"]') || (await pageOverlay())) return null;
  try {
    const r = await fetch('/api/universal/galactic-sources' + (expansion() ? '' : '?game=eaw'));
    if (r.status === 200) return unpackGalacticSources(await r.arrayBuffer());
  } catch {
    /* Retain individual reads for older hosts, oversized libraries or a failed request. */
  }
  return null;
}
export const moduleKey = s =>
  String(s || '')
    .replace(/\\/g, '/')
    .toUpperCase()
    .replace(/\.LUA$/, '')
    .replace(/\./g, '/');
export class GalacticSources {
  constructor(files, packed = null) {
    this.packed = packed;
    this.index = new Map();
    this.prefetchModules = new Map();
    this.moduleAliases = new Map();
    this.canonical = new Map();
    this.sources = new Map();
    this.pending = new Map();
    this.errors = new Map();
    this.queue = [];
    this.active = 0;
    for (const path of files.slice().sort((a, b) => Number(!/\\LIBRARY\\/i.test(a)) - Number(!/\\LIBRARY\\/i.test(b)))) {
      const full = path
          .replace(/\\/g, '/')
          .toUpperCase()
          .replace(/^.*?\/SCRIPTS\//, '')
          .replace(/\.LUA$/, ''),
        parts = full.split('/');
      this.canonical.set(path, moduleKey(full));
      for (let i = 0; i < parts.length; i++) {
        const n = parts.slice(i).join('/');
        if (!this.index.has(n)) this.index.set(n, path);
        const aliases = this.moduleAliases.get(n) || [];
        aliases.push(full);
        this.moduleAliases.set(n, aliases);
      }
      if (parts.at(-1) === 'INIT')
        for (let i = 0; i < parts.length - 1; i++) {
          const n = parts.slice(i, -1).join('/'),
            modules = this.prefetchModules.get(n) || [];
          modules.push(full);
          this.prefetchModules.set(n, modules);
        }
    }
  }
  source(name) {
    const requested = moduleKey(name),
      path = this.index.get(requested),
      n = path ? this.canonical.get(path) : requested;
    if (this.sources.has(n)) return this.sources.get(n);
    if (!path) {
      this.sources.set(n, null);
      return null;
    }
    if (!this.pending.has(n)) {
      this.pending.set(
        n,
        this.read(path)
          .catch(error => {
            this.errors.set('Lua source: ' + path, String(error.message || error));
            return null;
          })
          .then(src => {
            if (src === null && !this.errors.has('Lua source: ' + path))
              this.errors.set('Lua source: ' + path, 'Indexed Lua source was not readable');
            this.sources.set(n, src);
            this.pending.delete(n);
            if (this.disposed) return;
            for (const m of (src || '').matchAll(/require\s*\(?\s*["']([^"']+)["']/g)) this.source(m[1]);
            for (const m of (src || '').matchAll(/ModContentLoader\.get\s*\(\s*["']([^"']+)["']/g)) {
              const suffix = '/' + moduleKey(m[1]);
              for (const name of this.index.keys()) if (name.endsWith(suffix)) this.source(name);
            }
            for (const m of (src || '').matchAll(/["']([^"'\r\n]+)["']/g)) {
              const name = moduleKey(m[1]);
              for (const candidate of this.moduleAliases.get(name) || []) this.source(candidate);
              for (const candidate of this.prefetchModules.get(name) || []) this.source(candidate);
              if (/[/_]$/.test(name))
                for (const [alias, candidates] of this.moduleAliases)
                  if (alias.startsWith(name)) for (const candidate of candidates) this.source(candidate);
            }
            for (const m of (src || '').matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=/g))
              for (const candidate of this.moduleAliases.get(moduleKey(m[1])) || []) this.source(candidate);
          })
      );
    }
  }
  read(path) {
    const bytes = this.packed?.get(path);
    if (bytes)
      return Promise.resolve().then(() => decodeFileText(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    return new Promise((resolve, reject) => {
      this.queue.push({ path: path.replace(/\\/g, '/'), resolve, reject });
      this.drain();
    });
  }
  drain() {
    while (this.active < 8 && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      fetchText(job.path)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
