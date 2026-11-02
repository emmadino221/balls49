import FootballMatchStage from '../components/FootballMatchStage';
import FootballCombinationHistory from '../components/FootballCombinationHistory';
import FootballCombinations from '../components/FootballCombinations';
import FootballPick from '../components/FootballPick';
import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';
import './football-page.css';

const LEAGUES = [
  ['PL', 'Premier League'], ['PD', 'La Liga'], ['BL1', 'Bundesliga'],
  ['SA', 'Serie A'], ['FL1', 'Ligue 1'], ['CL', 'Champions League']
];
export default function FootballPage() {
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    let active = true;
    apiRequest('/admin/preview').then(() => { if (active) setIsOwner(true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [league, setLeague] = useState('PL');
  const [data, setData] = useState(null), [error, setError] = useState(''), [tab, setTab] = useState('upcoming');
  useEffect(() => {
    let active = true, timer;
    setData(null); setError('');
    async function load() {
      try { const response = await apiRequest(`/public-football?league=${encodeURIComponent(league)}`); if (active) { setData(response); setError(''); } }
      catch (e) { if (active) { setData(null); setError(e.message); } }
      finally { if (active) timer = setTimeout(load, 60000); }
    }
    load(); return () => { active = false; clearTimeout(timer); };
  }, [league]);
  return <main className="page-wrap resource-page football-page football-hub real-football-page">
    <section className="rf-hero">
      <div className="rf-hero-copy">
        <span className="rf-eyebrow"><i aria-hidden="true" /> Real football · Match analytics</span>
        <h1>Read the match.<br /><span>See the numbers.</span></h1>
        <p>Explore upcoming fixtures, saved model estimates, and recorded results across six competitions.</p>
        <a className="rf-hero-link" href="#real-football-matches">Explore fixtures <span aria-hidden="true">↓</span></a>
      </div>
      <div className="rf-hero-art" aria-hidden="true">
        <div className="rf-art-pitch"><i /><b /></div>
        <div className="rf-art-orbit"><span>1</span><span>X</span><span>2</span></div>
        <div className="rf-art-chip">MATCH<br />ANALYTICS</div>
      </div>
    </section>
    <section className="rf-league-picker" aria-label="Competition selection">
      <div><span className="rf-section-eyebrow">CHOOSE YOUR COMPETITION</span><strong>League center</strong></div>
      <label><span className="football-visually-hidden">League</span><select value={league} onChange={e => setLeague(e.target.value)}>{LEAGUES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
    </section>
    {error && <section className="content-card" role="alert"><h2>Football is temporarily unavailable</h2><p>{error}</p></section>}
    {!data && !error && <p className="rf-loading" role="status"><span aria-hidden="true" /> Loading football fixtures…</p>}
    {data && <>
      {!data.configured && <p className="content-card rf-message">Football predictions are being prepared. Please check back later.</p>}
      {data.error && <p className="content-card rf-message" role="alert">{data.accessDenied ? 'This competition is unavailable with the current data subscription. Choose another league.' : data.error}</p>}
      <div className="rf-feed-toolbar" id="real-football-matches">
        <div className="rf-feed-meta">
          <span className={`rf-feed-dot${data.stale || data.error ? ' is-stale' : ''}`} aria-hidden="true" />
          <div><span className="rf-section-eyebrow">{LEAGUES.find(([code]) => code === league)?.[1]}</span>
            <p>{data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for the first successful sync.'}{data.stale && ' · Data may be out of date.'}</p></div>
        </div>
        <div className="football-tabs rf-tabs" role="group" aria-label="Football views">
          <button className="btn btn-secondary" aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming</button>
          <button className="btn btn-secondary" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Results</button>
          <button className="btn btn-secondary" aria-pressed={tab === 'combinations'} onClick={() => setTab('combinations')}>Combination History</button>
        </div>
      </div>
      {tab === 'upcoming' ? <>
        <FootballMatchStage key={league} matches={data.upcoming} stale={data.stale || !!data.error} leagueName={LEAGUES.find(([code]) => code === league)?.[1]} />
        {league === 'CL' && <p className="resource-note">Champions League picks need five completed matches per team in the current season. Some fixtures may have no pick.</p>}
        <FootballCombinations data={data.combinations} isOwner={isOwner} compact />
      </> : tab === 'history' ? <div className="football-match-grid rf-history-grid">{!data.history.length && <p className="rf-empty-state">No recorded prediction results yet. Picks are never created for matches that already started.</p>}{data.history.map(p => <article className="content-card football-match-card rf-history-card" key={p.id}><span className="overline">{new Date(p.kickoff).toLocaleString()}</span><div className="rf-history-teams"><span>{p.home}</span><b>vs</b><span>{p.away}</span></div>{p.score && <p className="football-final-score">Final score: {p.score}</p>}<FootballPick prediction={p} results /></article>)}</div> : <FootballCombinationHistory />}
      <p className="resource-note">Fixtures and results supplied by <a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a>. Free-plan results may be delayed. Each league refreshes about every 30 minutes. Initial league loading may take a couple of minutes. Schedule changes, postponements, cancellations and suspensions void existing picks.</p>
    </>}
  </main>;
}
