import React from 'react';

export default function PredictionMarketStats({ stats, marketName, showStep = true }) {
  if (!stats) return null;
  const losses = value => `${value} ${value === 1 ? 'loss' : 'losses'}`;
  return (
    <div className="prediction-stats-block">
      <div className="prediction-market-stats" aria-label={`${marketName} step and losing streak statistics`}>
        {showStep && <div><span>Current tracking step</span><strong>{stats.step > 0 ? `Step ${stats.step}` : '—'}</strong></div>}
        <div><span>Max losing streak · tracking period</span><strong>{losses(stats.maxLosingStreak)}</strong></div>
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
        {['current', 'alternative'].map(key => {
          const strategy = stats.strategyStats?.[key];
          if (!strategy) return null;
          return <div key={key}>
            <span>{strategy.label} · worst losing streak</span>
            <strong>{strategy.settled > 0 ? losses(strategy.maxLosingStreak) : '—'}</strong>
            <small>{strategy.settled > 0 ? `${strategy.settled} settled candidate picks` : 'Collecting strategy results'}</small>
          </div>;
        })}
      </div>
      <p className="prediction-summary-stats-note">Within the current tracking period. Each summary is tracked separately; only a win with the same label resets its losing streak.</p>
      {stats.strategyStats && <p className="prediction-summary-stats-note">Strategy streaks include saved candidate picks even when not selected. Each strategy tracks its own wins and losses; skipped picks do not change its streak.</p>}
    </div>
  );
}
