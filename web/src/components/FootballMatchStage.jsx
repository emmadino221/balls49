import React, { useEffect, useState } from 'react';
import FootballPick from './FootballPick';

const MARKETS = [ ['match', 'Match result'], ['over', 'Over 2.5'], ['under', 'Under 2.5'], ['yes', 'BTTS Yes'], ['no', 'BTTS No'] ];
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0]).join('').toUpperCase();
function clock(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
export default function FootballMatchStage({ matches, stale, leagueName }) {
  const [selected, setSelected] = useState(null), [market, setMarket] = useState('match'), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const index = Math.max(0, matches.findIndex(m => m.id === selected));
  const match = matches[index];
  if (!match) return <section className="football-stage-empty"><h2>No upcoming fixtures</h2><p>There are no loaded matches for this league in the next seven days. Choose another league or check again later.</p></section>;
  const prediction = match.prediction;
  const started = Date.parse(match.kickoff) <= now;
  const active = prediction && prediction.outcome === 'PENDING' && !started && ['SCHEDULED', 'TIMED'].includes(match.status);
  let label = 'No pick', probability = null, strongest = false;
  if (active) {
    if (market === 'match') {
      label = prediction.pick === 'HOME' ? 'Home win · 1' : prediction.pick === 'AWAY' ? 'Away win · 2' : 'Draw · X';
      probability = prediction.probabilities[prediction.pick]; strongest = true;
    } else {
      const key = market === 'over' || market === 'under' ? 'goals25' : 'btts';
      const choice = { over: 'OVER', under: 'UNDER', yes: 'YES', no: 'NO' }[market];
      const saved = prediction.markets?.[key];
      label = MARKETS.find(([id]) => id === market)[1];
      probability = saved?.probabilities?.[choice] ?? null;
      strongest = saved?.pick === choice;
    }
  }
  const available = typeof probability === 'number' && Number.isFinite(probability);
  const noPick = started ? 'Kickoff reached. Check Results for settlement.' : prediction?.outcome === 'VOID'
    ? 'Saved pick voided after a fixture change.' : !['SCHEDULED', 'TIMED'].includes(match.status)
      ? 'This fixture is not currently scheduled for play.' : active
        ? 'This market was not included in the original saved prediction.' : 'Not enough recent results, or no prediction saved before the cutoff.';
  const navigate = direction => setSelected(matches[(index + direction + matches.length) % matches.length].id);
  return <section className="football-stage" aria-label="Football match predictions">
    <div className="football-stage-meta"><div><span>Competition</span><strong>{leagueName}</strong></div><div><span>Kickoff · your timezone</span><strong>{new Date(match.kickoff).toLocaleString()}</strong></div><div><span>Match</span><strong>{index + 1} of {matches.length}</strong></div><div className="football-countdown"><span>{started ? 'Match status' : 'Time to kickoff'}</span><strong>{started ? 'Started' : clock(Date.parse(match.kickoff) - now)}</strong></div></div>
    <div className="football-market-tabs" role="group" aria-label="Prediction market">{MARKETS.map(([id, name]) => <button type="button" key={id} aria-pressed={market === id} onClick={() => setMarket(id)}>{name}</button>)}</div>
    {stale && <p className="football-stage-notice" role="status">Data may be out of date. The countdown uses the last known kickoff.</p>}
    <div className="football-pitch">
      <div className="football-team football-team-home"><div className="football-team-badge" aria-hidden="true">{initials(match.home)}</div><h2>{match.home}</h2><span>HOME</span></div>
      <div className="football-stage-pick"><span className="football-pick-tag">{available ? label : started ? 'Started' : 'No pick'}</span>
        {available ? <><div className="football-estimate-ring" style={{ '--estimate': `${Math.max(0, Math.min(100, probability))}%` }}><div><strong>{probability}%</strong><span>Model estimate</span></div></div><small>{strongest ? 'Highest estimate in this market' : 'Selected outcome estimate'}</small></> : <p>{noPick}</p>}
      </div>
      <div className="football-team football-team-away"><div className="football-team-badge" aria-hidden="true">{initials(match.away)}</div><h2>{match.away}</h2><span>AWAY</span></div>
    </div>
    <div className="football-match-navigation"><button type="button" disabled={matches.length < 2} onClick={() => navigate(-1)} aria-label="Previous match">←</button><label><span className="football-visually-hidden">Select match</span><select value={match.id} onChange={e => setSelected(Number(e.target.value))}>{matches.map(m => <option key={m.id} value={m.id}>{m.home} vs {m.away}</option>)}</select></label><button type="button" disabled={matches.length < 2} onClick={() => navigate(1)} aria-label="Next match">→</button></div>
    {active && <details className="football-stage-details" key={match.id}><summary>Prediction details</summary><FootballPick prediction={prediction} /></details>}
    <p className="football-stage-caption">90 minutes + stoppage time. Estimates are experimental, not bookmaker odds or guarantees.</p>
  </section>;
}
