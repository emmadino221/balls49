import React from 'react';

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
      <p>Model estimates: home {p.probabilities.HOME}%, draw {p.probabilities.DRAW}%, away {p.probabilities.AWAY}%.</p>
      {p.markets?.goals25 && <p>Over 2.5: {p.markets.goals25.probabilities.OVER}%. Under 2.5: {p.markets.goals25.probabilities.UNDER}%.</p>}
      {p.markets?.btts && <p>Both teams score: yes {p.markets.btts.probabilities.YES}%, no {p.markets.btts.probabilities.NO}%.</p>}
      {!p.markets && <p>This older saved prediction covers match result only. Additional markets are available on newly generated predictions.</p>}
      <p>{p.explanation}</p><p>Saved {new Date(p.generatedAt).toLocaleString()}. Predictions remain unchanged.</p>
    </details>
  </>;
}
