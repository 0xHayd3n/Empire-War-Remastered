// Optional: only contact Steam after the user asks for public Workshop titles.
export async function steamTitles(items, request = fetch) {
  const ids = [...items.values()].filter(m => m.name === `Workshop ${m.id}`).map(m => m.id);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100), body = new URLSearchParams({ itemcount: String(batch.length) });
    batch.forEach((id, j) => body.set(`publishedfileids[${j}]`, id));
    const r = await request('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('Steam titles unavailable');
    const data = await r.json();
    for (const row of data.response?.publishedfiledetails || []) {
      const id = String(row.publishedfileid);
      if (batch.includes(id) && row.result === 1 && String(row.consumer_app_id) === '32470' && typeof row.title === 'string' && row.title.trim()) {
        items.get(id).name = row.title.trim().slice(0, 240);
      }
    }
  }
}
