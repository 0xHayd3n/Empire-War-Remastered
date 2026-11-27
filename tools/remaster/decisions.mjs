// A decision is a reviewer's material note, not permission to apply a map overhaul.
import { fingerprint } from './survey.mjs';
export function learn(job, report, decision, note) {
  if (
    fingerprint(job.identity) !== job.id ||
    report.job !== job.id ||
    report.state !== 'trial-needs-visual-review' ||
    report.errors?.length ||
    !['webgl', 'webgpu'].includes(report.backend)
  )
    throw Error('Needs a successful mounted trial for this exact job');
  if (!['candidate', 'avoid'].includes(decision) || typeof note !== 'string' || note.trim().length < 16 || note.length > 1000)
    throw Error('Give candidate/avoid and a specific visual reason');
  const pin = report.donorPin,
    slot = report.trial?.slot,
    s = job.identity.slots.find(row => row[0] === slot);
  if (
    !s ||
    !s[2] ||
    !pin ||
    pin.id !== report.trial.donor ||
    !report.activeSlots.includes(slot) ||
    report.unreadable.includes(slot) ||
    report.views.surface?.trial <= 32 ||
    !Number.isFinite(report.views.surface?.trial)
  )
    throw Error('Missing visible source/donor evidence');
  for (const v of ['surface', 'squad', 'command'])
    if (!Number.isInteger(report.views[v]?.restored) || report.views[v].restored > 32) throw Error('Missing matched rollback');
  return {
    format: 1,
    pair: `${s[2]}:${s[4] || '-'}`,
    decision,
    donor: pin,
    reason: note.trim(),
    example: {
      job: job.id,
      path: job.identity.path,
      edition: job.identity.edition,
      order: job.identity.order,
      slot,
      backend: report.backend,
      environment: report.environment,
      revision: report.revision
    }
  };
}
export function annotate(job, notes, pins) {
  for (const s of job.slots) {
    s.reviews = notes
      .filter(
        n =>
          s.pair &&
          n.pair === s.pair &&
          pins.some(
            p =>
              p.id === n.donor.id &&
              p.colorHash === n.donor.colorHash &&
              p.surfaceHash === n.donor.surfaceHash &&
              p.tileMeters === n.donor.tileMeters
          )
      )
      .map(n => ({ decision: n.decision, donor: n.donor.id, reason: n.reason, example: n.example.job }));
  }
  return job;
}
