import React from 'react';

function ProbabilityBars({ title, options }) {
  const available = options.filter(([, value]) => Number.isFinite(value));
  if (!available.length) return null;
  return <section className="rf-probability-chart" aria-label={`${title} probability chart`}>
    <h3>{title}</h3>
    {available.map(([label, value]) => {
      const bounded = Math.max(0, Math.min(100, value));
      return <div className="rf-probability-row" key={label}>
        <span>{label}</span>
        <div className="rf-probability-track" role="meter" aria-label={`${label} estimate`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={bounded}>
          <i style={{ width: `${bounded}%` }} />
        </div>
        <strong>{value}%</strong>
      </div>;
    })}
  </section>;
}

export default function FootballPick({ prediction: p, results = false }) {
  const rows = [{ key: 'match', name: 'Match result', pick: p.pick === 'HOME' ? '1 · Home' : p.pick === 'AWAY' ? '2 · Away' : 'X · Draw', percentage: p.probabilities[p.pick], outcome: p.outcome }];
  if (p.markets?.goals25) {
    const m = p.markets.goals25;
    rows.push({ key: 'goals', name: 'Goals 2.5', pick: m.pick === 'OVER' ? 'Over 2.5' : 'Under 2.5', percentage: m.probabilities[m.pick], outcome: m.outcome });
  }
  if (p.markets?.btts) {
    const m = p.markets.btts;
    rows.push({ key: 'btts', name: 'Both teams score', pick: m.pick === 'YES' ? 'Yes' : 'No', percentage: m.probabilities[m.pick], outcome: m.outcome });
  }
  return <>
    <div className="football-pick-rows">{rows.map(r => <div key={r.key}><span>{r.name}</span><strong>{r.pick}</strong><small>{results ? (r.outcome === 'PENDING' ? 'Pending' : r.outcome) : `${r.percentage}%`}</small></div>)}</div>
    <details className="football-pick-details"><summary>Details</summary>
      <div className="rf-probability-charts">
        <ProbabilityBars title="Match result" options={[
          ['Home', p.probabilities.HOME], ['Draw', p.probabilities.DRAW], ['Away', p.probabilities.AWAY],
        ]} />
        {p.markets?.goals25 && <ProbabilityBars title="Goals 2.5" options={[
          ['Over', p.markets.goals25.probabilities.OVER], ['Under', p.markets.goals25.probabilities.UNDER],
        ]} />}
        {p.markets?.btts && <ProbabilityBars title="Both teams score" options={[
          ['Yes', p.markets.btts.probabilities.YES], ['No', p.markets.btts.probabilities.NO],
        ]} />}
      </div>
      <p>Model estimates: home {p.probabilities.HOME}%, draw {p.probabilities.DRAW}%, away {p.probabilities.AWAY}%.</p>
      {p.markets?.goals25 && <p>Over 2.5: {p.markets.goals25.probabilities.OVER}%. Under 2.5: {p.markets.goals25.probabilities.UNDER}%.</p>}
      {p.markets?.btts && <p>Both teams score: yes {p.markets.btts.probabilities.YES}%, no {p.markets.btts.probabilities.NO}%.</p>}
      {!p.markets && <p>This older saved prediction covers match result only. Additional markets are available on newly generated predictions.</p>}
      <p>{p.explanation}</p><p>Saved {new Date(p.generatedAt).toLocaleString()}. Predictions remain unchanged.</p>
    </details>
  </>;
}
