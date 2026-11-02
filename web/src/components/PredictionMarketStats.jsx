import React from 'react';

export default function PredictionMarketStats({ stats, marketName, showStep = true }) {
  if (!stats) return null;
  const losses = value => `${value} ${value === 1 ? 'loss' : 'losses'}`;
  const summaryRows = ['ENTER', 'HOLD'].map(label => {
    const summary = stats.summaryStats?.[label];
    const hasData = Number.isSafeInteger(summary?.settled)
      && summary.settled > 0
      && Number.isSafeInteger(summary.maxLosingStreak)
      && summary.maxLosingStreak >= 0;
    return { label, hasData, maxLosingStreak: hasData ? summary.maxLosingStreak : 0 };
  });
  const largestSummaryStreak = Math.max(1, ...summaryRows.map(row => row.maxLosingStreak));
  return (
    <div className="prediction-stats-block">
      <div className="prediction-market-stats" aria-label={`${marketName} step and streak statistics`}>
        {showStep && <div><span>Current tracking step</span><strong>{stats.step > 0 ? `Step ${stats.step}` : '—'}</strong></div>}
        <div><span>Max losing streak · tracking period</span><strong>{losses(stats.maxLosingStreak)}</strong></div>
        <div><span>Current winning streak</span><strong>{Number.isSafeInteger(stats.currentWinStreak) ? `${stats.currentWinStreak} ${stats.currentWinStreak === 1 ? 'win' : 'wins'}` : '--'}</strong></div>
        {['ENTER', 'HOLD'].map(label => {
          const summary = stats.summaryStats?.[label];
          const hasData = summary?.settled > 0;
          return (
            <div key={label}>
              <span>Summary {label} · max losing streak</span>
              <strong>{hasData ? losses(summary.maxLosingStreak) : '—'}</strong>
              <small>{hasData ? `${summary.settled} settled ${label} picks` : 'No summary data'}</small>
            </div>
          );
        })}
      </div>
      {summaryRows.some(row => row.hasData) && <section className="summary-streak-chart" aria-label={`${marketName} Summary ENTER and HOLD maximum losing streaks`}>
        {summaryRows.map(row => (
          <div className="summary-streak-chart-row" key={row.label}>
            <span>Summary {row.label}</span>
            <div className="summary-streak-chart-track" aria-hidden="true">
              <span style={{ width: `${row.hasData ? row.maxLosingStreak / largestSummaryStreak * 100 : 0}%` }} />
            </div>
            <strong>{row.hasData ? losses(row.maxLosingStreak) : 'No data'}</strong>
          </div>
        ))}
        <small>Bar lengths scale to the larger reported maximum streak.</small>
      </section>}
      <p className="prediction-summary-stats-note">Within the current tracking period. Each summary is tracked separately; only a win with the same label resets its losing streak.</p>
    </div>
  );
}
