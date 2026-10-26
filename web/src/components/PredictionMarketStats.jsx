import React from 'react';

export default function PredictionMarketStats({ stats, marketName, showStep = true }) {
  if (!stats) return null;
  const losses = value => `${value} ${value === 1 ? 'loss' : 'losses'}`;
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
      <p className="prediction-summary-stats-note">Within the current tracking period. Each summary is tracked separately; only a win with the same label resets its losing streak.</p>
    </div>
  );
}
