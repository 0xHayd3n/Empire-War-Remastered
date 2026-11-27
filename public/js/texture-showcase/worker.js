import { buildProfile } from './build.js';
self.onmessage = async ({ data: profile }) => {
  try {
    const zip = await buildProfile(
      profile,
      async file => {
        const r = await fetch('/asset/Data/Art/Textures/' + encodeURIComponent(file), { redirect: 'error' });
        return r.ok && r.status !== 204 ? new Uint8Array(await r.arrayBuffer()) : null;
      },
      file => postMessage({ file })
    );
    postMessage({ zip }, [zip.buffer]);
  } catch (e) {
    postMessage({ error: e.message });
  }
};
