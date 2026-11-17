// Read-only statistics. Events never bridge missing or unresolved draw records.
export function losingStreakGaps(records, market, view = 'completed') {
  const grouped = new Map();
  for (const record of records) {
    const id = Number(record.drawId);
    if (!Number.isSafeInteger(id) || id < 1) continue;
    const outcome = record.result?.[market] || 'PENDING';
    if (!grouped.has(id)) grouped.set(id, outcome);
    else if (grouped.get(id) !== outcome) grouped.set(id, 'CONFLICT');
  }
  const ordered = [...grouped].sort((a, b) => a[0] - b[0]);
  const events = new Map();
  let run = 0, worst = 0, knownStart = false, segment = 0, previous = null;
  let blocked = false, breaks = 0, unresolved = 0, boundaryRuns = 0;
  const add = (level, id) => {
    if (!events.has(level)) events.set(level, []);
    events.get(level).push({ id, segment });
  };
  for (const [id, outcome] of ordered) {
    if ((previous !== null && id !== previous + 1) || (blocked && ['WIN', 'LOSS', 'SKIP'].includes(outcome))) {
      if (run && !knownStart) boundaryRuns++;
      run = 0; knownStart = false; segment++; breaks++; blocked = false;
    }
    previous = id;
    if (!['WIN', 'LOSS', 'SKIP'].includes(outcome)) { blocked = true; unresolved++; continue; }
    if (outcome === 'SKIP') continue;
    if (outcome === 'LOSS') {
      run++; worst = Math.max(worst, run);
      if (knownStart && view === 'levels') add(run, id);
    } else {
      if (run && knownStart && view === 'completed') add(run, id);
      if (run && !knownStart) boundaryRuns++;
      run = 0; knownStart = true;
    }
  }
  const latest = ordered.at(-1)?.[0];
  const rows = Array.from({ length: worst }, (_, index) => {
    const level = index + 1, occurrences = events.get(level) || [];
    const gaps = occurrences.slice(1).flatMap((event, i) => event.segment === occurrences[i].segment ? [event.id - occurrences[i].id] : []);
    const last = occurrences.at(-1);
    return { level, count: occurrences.length, gaps, ids: occurrences.map(e => e.id),
      average: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      minimum: gaps.length ? Math.min(...gaps) : null, maximum: gaps.length ? Math.max(...gaps) : null,
      since: last && last.segment === segment && !blocked ? latest - last.id : null };
  });
  return { rows, run, worst, lowerBound: run > 0 && !knownStart, breaks, unresolved, boundaryRuns,
    pending: blocked, count: ordered.length, first: ordered[0]?.[0], latest };
}
