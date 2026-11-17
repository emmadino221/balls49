import React, { useMemo, useState } from 'react';
import { losingStreakGaps } from '../losing-streak-gaps.js';
import './losing-streak-gaps.css';
const value = n => n == null ? '?' : Number.isInteger(n) ? String(n) : n.toFixed(1);

export default function LosingStreakGaps({ records, markets, total, loading, error }) {
  const [view, setView] = useState('completed');
  const reports = useMemo(() => markets.map(m => ({ ...m, report: losingStreakGaps(records, m.resultKey, view) })), [records, markets, view]);
  return <section className="content-card loss-gaps" aria-labelledby="loss-gaps-title">
    <span className="overline">LOSING STREAK ANALYSIS</span><h2 id="loss-gaps-title">How often do losing streaks happen?</h2>
    <label>Counting method<select value={view} onChange={e => setView(e.target.value)}>
      <option value="completed">Completed streaks ? exact length</option>
      <option value="levels">Loss levels reached ? 1, 2, 3?</option>
    </select></label>
    <p>{view === 'completed' ? 'Four losses followed by a win count once at length 4. The occurrence is dated at the win that closes the streak.' : 'Four consecutive losses count once at each level: 1, 2, 3 and 4. Each occurrence is dated at the loss that reaches that level. An unfinished streak can contribute confirmed levels.'}</p>
    <p>Uses loaded history in the selected draw range and market filter, independently of the owner?s streak reset. Draw-ID search does not change this analysis. {records.length} records loaded{total > records.length ? ` out of ${total} available; load more history for broader coverage` : ''}.</p>
    <p>Gaps are draw-ID differences between occurrences, including skipped draws. Skips do not add losses or reset a streak. Missing draws and unresolved results break continuity. A boundary streak with an unknown beginning is excluded from occurrence counts until a win establishes a new starting point.</p>
    {loading && <p role="status">Updating history?</p>}
    {error && <p role="status">History refresh failed. Any statistics shown use the last loaded records.</p>}
    {!records.length && <p>No history loaded yet.</p>}
    {reports.map(({ id, label, report: r }) => <details key={id} className="loss-gaps-market">
      <summary>{label} ? current losses: {r.lowerBound ? 'at least ' : ''}{r.run}; largest observed run: {r.worst}</summary>
      <p>{r.count ? `Draws #${r.first}?#${r.latest}.` : 'No records.'} Current unfinished streak: {r.lowerBound ? 'at least ' : ''}{r.run} losses.{r.pending ? ' Unresolved results may change this streak.' : ''}</p>
      {(r.breaks > 0 || r.unresolved > 0 || r.boundaryRuns > 0) && <p role="status">Partial coverage: {r.breaks} continuity breaks, {r.unresolved} unresolved/conflicting records, {r.boundaryRuns} closed or interrupted boundary streaks excluded. Largest observed run may be only part of a longer streak.</p>}
      {!r.rows.length ? <p>No losing streaks observed in this loaded history.</p> : <div className="loss-gaps-grid">{r.rows.map(row => <article key={row.level}>
        <h3>{row.level} {row.level === 1 ? 'loss' : 'losses'}</h3>
        <dl><div><dt>Occurrences</dt><dd>{row.count}</dd></div><div><dt>Average gap</dt><dd>{value(row.average)} draws</dd></div><div><dt>Shortest / longest gap</dt><dd>{value(row.minimum)} / {value(row.maximum)}</dd></div><div><dt>Draws since last</dt><dd>{value(row.since)}</dd></div></dl>
        <details><summary>Occurrence draw IDs and gaps</summary><p>Draw IDs: {row.ids.length ? row.ids.map(n => `#${n}`).join(', ') : 'None confirmed'}</p><p>Consecutive-event gaps within continuous history: {row.gaps.length ? row.gaps.join(', ') : 'Not enough continuous occurrences'}</p></details>
      </article>)}</div>}
    </details>)}
    <p>??? means insufficient or interrupted history. Historical gaps do not predict when a win or another losing streak is due.</p>
  </section>;
}
