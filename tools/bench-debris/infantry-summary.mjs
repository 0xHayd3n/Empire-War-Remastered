// Read only the saved measured legs. No model/assets or local absolute paths in a report.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
export function summarize(paths) {
  const buckets = new Map(),
    quality = [];
  const median = rows => {
    const t = rows.slice().sort((a, b) => a - b);
    return (t[(t.length - 1) >> 1] + t[t.length >> 1]) / 2;
  };
  for (const file of paths) {
    const run = JSON.parse(fs.readFileSync(file));
    if (run.result.suite === 'soak') continue;
    for (const leg of run.result.legs) {
      if (!leg.timing) {
        quality.push({
          file,
          engine: leg.engine,
          n: leg.n,
          neck: leg.peakNeckDeg,
          gap: leg.peakSocketGap,
          skin: leg.minPostFallClearance,
          detached: leg.detached,
          freed: leg.afterParking,
          failures: leg.failures
        });
        continue;
      }
      const key = [run.result.suite, leg.n, run.meta.cpuRate || 1, leg.engine].join('/');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(leg);
    }
  }
  const timings = Object.fromEntries(
    [...buckets].map(([k, v]) => [
      k,
      {
        legs: v.length,
        samples: v.reduce((n, l) => n + l.timing.frameMs.n, 0),
        failures: v.flatMap(l => l.failures),
        ...Object.fromEntries(
          ['solverMs', 'ragdollMs', 'frameMs'].map(m => [
            m,
            Object.fromEntries(['median', 'p95'].map(p => [p, +median(v.map(l => l.timing[m][p])).toFixed(3)]))
          ])
        )
      }
    ])
  );
  return { quality, timings };
}
if (process.argv.length > 2 && pathToFileURL(process.argv[1]).href === import.meta.url) console.log(JSON.stringify(summarize(process.argv.slice(2)), null, 2));
