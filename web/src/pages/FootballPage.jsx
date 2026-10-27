import FootballPick from '../components/FootballPick';
import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';

export default function FootballPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [tab, setTab] = useState('upcoming');
  useEffect(() => {
    let active = true, timer;
    async function load() {
      try { const response = await apiRequest('/public-football'); if (active) { setData(response); setError(''); } }
      catch (e) { if (active) { setData(null); setError(e.message); } }
      finally { if (active) timer = setTimeout(load, 60000); }
    }
    load(); return () => { active = false; clearTimeout(timer); };
  }, []);
  return <main className="page-wrap resource-page football-page">
    <section className="page-intro"><span className="overline">FOOTBALL · FREE PREVIEW</span><h1>Before the whistle.</h1><p>Premier League picks: match result, goals and both teams to score.</p></section>
    {error && <section className="content-card" role="alert"><h2>Football is temporarily unavailable</h2><p>{error}</p></section>}
    {!data && !error && <p role="status">Loading football...</p>}
    {data && <>
      {!data.configured && <p className="content-card">Football predictions are being prepared. Please check back later.</p>}
      {data.error && <p className="content-card" role="alert">{data.error}</p>}
      <div className="content-card resource-toolbar"><div><strong>Premier League</strong><p>{data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for the first successful sync.'}{data.stale && ' Data is not fresh.'}</p></div><div className="football-tabs"><button className="btn btn-secondary" aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming</button><button className="btn btn-secondary" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Results</button></div></div>
      <p className="resource-note">Read the suggested outcome on each card: 1 = home win, X = draw, 2 = away win. No pick means no suggestion. Percentages are experimental model estimates, not betting odds or proven accuracy. All markets use 90 minutes plus stoppage time. Over 2.5 means at least 3 goals; both teams to score means each scores at least once. All times use your device timezone.</p>
      {tab === 'upcoming' ? <div className="football-match-grid">
        {!data.upcoming.length && <p>No fixtures available for the next seven days.</p>}
        {data.upcoming.map(m => <article className="content-card football-match-card" key={m.id}><span className="overline">{new Date(m.kickoff).toLocaleString()}</span><h2>{m.home} <small>vs</small> {m.away}</h2>
          {m.prediction && m.prediction.outcome !== 'VOID' ? <FootballPick prediction={m.prediction} /> : <p>{m.prediction?.outcome === 'VOID' ? 'Previous pick voided after a schedule or status change.' : 'No pick: insufficient recent results, match too close to kickoff, or fixture not ready.'}</p>}
        </article>)}
      </div> : <div className="football-match-grid">{!data.history.length && <p>No recorded prediction results yet. Picks are never created for matches that already started.</p>}{data.history.map(p => <article className="content-card football-match-card" key={p.id}><span className="overline">{new Date(p.kickoff).toLocaleString()}</span><h2>{p.home} vs {p.away}</h2>{p.score && <p className="football-final-score">Final score: {p.score}</p>}<FootballPick prediction={p} results /></article>)}</div>}
      <p className="resource-note">Fixtures and results supplied by <a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a>. Free-plan results may be delayed. Sync runs every 30 minutes. Schedule changes, postponements, cancellations and suspensions void existing picks.</p>
    </>}
  </main>;
}
