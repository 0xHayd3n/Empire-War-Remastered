// One local read per candidate, one HTTP response per mount. Only chunk zero
// is consumed by parseMapHeader; don't transfer the rest of these 4 KiB slices.
export function mountedMapHeaders(assets) {
  const rows = [];
  for (const key of [...assets.index.keys()].sort()) {
    const hit = /^(DATA\\ART\\MAPS|DATA\\CUSTOMMAPS)\\([^\\]+\.TED)$/i.exec(key);
    if (!hit) continue;
    const bytes = assets.readPart(key, 0, 4096);
    let end = 8;
    if (bytes?.length >= 8 && bytes.readUInt32LE(0) === 0) end += bytes.readUInt32LE(4) & 0x7fffffff;
    rows.push([hit[1].toUpperCase() === 'DATA\\CUSTOMMAPS', hit[2], bytes ? bytes.subarray(0, end).toString('base64') : null]);
  }
  return rows;
}
