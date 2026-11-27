// Read-only packet for a committed campaign. The path table is also its Lua
// index. Large libraries stay on the normal demand-driven VFS path.
export function mountedGalacticSources(assets) {
  const files = [...assets.index.keys()].filter(k => /SCRIPTS\\.*\.LUA$/i.test(k)).sort();
  if (files.length > 4096 || files.reduce((n, k) => n + assets.index.get(k).size, 0) > 8 * 1024 * 1024) return null;
  const chunks = [];
  for (const name of files) {
    const path = Buffer.from(name),
      src = assets.read(name);
    if (!src || path.length > 65535) return null;
    const header = Buffer.allocUnsafe(6);
    header.writeUInt16LE(path.length);
    header.writeUInt32LE(src.length, 2);
    chunks.push(header, path, src);
  }
  return Buffer.concat(chunks);
}
