import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';

const pickName = p => p.pick === 'HOME' ? p.home : p.pick === 'AWAY' ? p.away : 'Draw';
export default function FootballPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [tab, setTab] = useState('upcoming');
  useEffect(() => {
    let active = true, timer;
    async function load() {
      try { const response = await apiRequest('/admin/football'); if (active) { setData(response); setError(''); } }
      catch (e) { if (active) { setData(null); setError(e.message); } }
      finally { if (active) timer = setTimeout(load, 60000); }
    }
    load(); return () => { active = false; clearTimeout(timer); };
  }, []);
  return <main className="page-wrap resource-page football-page">
    <section className="page-intro"><span className="overline">FOOTBALL · OWNER PREVIEW</span><h1>Before the whistle.</h1><p>Premier League match-winner estimates. Pre-match only, with results saved for review.</p></section>
    {error && <section className="content-card" role="alert"><h2>Owner access required</h2><p>{error}</p><a className="btn btn-secondary" href="predictions.html">Open Owner Tools to sign in</a></section>}
    {!data && !error && <p role="status">Loading football...</p>}
    {data && <>
      {!data.configured && <p className="content-card">Football is not configured in this server process. Add FOOTBALL_DATA_API_KEY to the website service environment and restart that service.</p>}
      {data.error && <p className="content-card" role="alert">{data.error}</p>}
      <div className="content-card resource-toolbar"><div><strong>Premier League</strong><p>{data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for the first successful sync.'}{data.stale && ' Data is not fresh.'}</p></div><div className="football-tabs"><button className="btn btn-secondary" aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming</button><button className="btn btn-secondary" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Results</button></div></div>
      <p className="resource-note">Experimental model estimates, not verified confidence or betting odds. Match winner means the result after 90 minutes plus stoppage time. All times use your device timezone.</p>
      {tab === 'upcoming' ? <div className="resource-grid">
        {!data.upcoming.length && <p>No fixtures available for the next seven days.</p>}
        {data.upcoming.map(m => <article className="content-card" key={m.id}><span className="overline">{new Date(m.kickoff).toLocaleString()}</span><h2>{m.home} <small>vs</small> {m.away}</h2><p>{m.status}</p>
          {m.prediction && m.prediction.outcome !== 'VOID' ? <><span>Saved prediction</span><h3>{pickName(m.prediction)}</h3><div className="football-probabilities">{[['HOME', m.home], ['DRAW', 'Draw'], ['AWAY', m.away]].map(([key, label]) => <div key={key}><span>{label}</span><strong>{m.prediction.probabilities[key]}%</strong></div>)}</div><p>{m.prediction.explanation}</p><small>Saved {new Date(m.prediction.generatedAt).toLocaleString()}. This pick will not change.</small></> : <p>{m.prediction?.outcome === 'VOID' ? 'Previous pick voided after a schedule or status change.' : 'No pick: insufficient recent results, match too close to kickoff, or fixture not ready.'}</p>}
        </article>)}
      </div> : <div className="resource-grid">{!data.history.length && <p>No recorded prediction results yet. Picks are never created for matches that already started.</p>}{data.history.map(p => <article className="content-card" key={p.id}><span className="overline">{new Date(p.kickoff).toLocaleString()}</span><h2>{p.home} vs {p.away}</h2><p>Pick: <strong>{pickName(p)}</strong></p><h3>{p.outcome === 'PENDING' ? 'Awaiting final result' : p.outcome}</h3>{p.score && <p>Score: {p.score}</p>}<small>Prediction saved {new Date(p.generatedAt).toLocaleString()}</small></article>)}</div>}
      <p className="resource-note">Fixtures and results supplied by <a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a>. Free-plan results may be delayed. Sync runs every 30 minutes. Schedule changes, postponements, cancellations and suspensions void existing picks.</p>
    </>}
  </main>;
}
