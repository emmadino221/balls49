import FootballMatchStage from '../components/FootballMatchStage';
import FootballCombinationHistory from '../components/FootballCombinationHistory';
import FootballCombinations from '../components/FootballCombinations';
import TeamCrest from '../components/TeamCrest';
import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';
import './football-page.css';
import './football-analysis.css';

const LEAGUES = [
  ['PL', 'Premier League'], ['PD', 'La Liga'], ['BL1', 'Bundesliga'],
  ['SA', 'Serie A'], ['FL1', 'Ligue 1'], ['CL', 'Champions League']
];
const OUTCOME_LABEL = { WIN: 'Won', LOSS: 'Lost', VOID: 'Void', PENDING: 'Pending' };

// football.html?league=PD opens that competition directly; add view=results for its results.
function leagueFromAddress() {
  const requested = new URLSearchParams(window.location.search).get('league');
  return LEAGUES.some(([code]) => code === requested) ? requested : 'PL';
}

function marketRows(p) {
  const rows = [{ key: 'match', name: 'Match result', pick: p.pick === 'HOME' ? `${p.home} win` : p.pick === 'AWAY' ? `${p.away} win` : 'Draw', percentage: p.probabilities?.[p.pick], outcome: p.outcome }];
  const goals = p.markets?.goals25, both = p.markets?.btts;
  rows.push(goals ? { key: 'goals', name: 'Goals 2.5', pick: goals.pick === 'OVER' ? 'Over 2.5' : 'Under 2.5', percentage: goals.probabilities?.[goals.pick], outcome: goals.outcome } : { key: 'goals', name: 'Goals 2.5' });
  rows.push(both ? { key: 'btts', name: 'Both teams score', pick: both.pick === 'YES' ? 'Yes' : 'No', percentage: both.probabilities?.[both.pick], outcome: both.outcome } : { key: 'btts', name: 'Both teams score' });
  return rows;
}

function FootballResults({ history }) {
  if (!history.length) return <p className="rf-empty-state">No recorded prediction results yet. Picks are never created for matches that already started.</p>;
  const rows = history.map(p => ({ p, markets: marketRows(p) }));
  const summary = ['Match result', 'Goals 2.5', 'Both teams score'].map((name, index) => {
    const outcomes = rows.map(row => row.markets[index].outcome);
    const won = outcomes.filter(outcome => outcome === 'WIN').length, lost = outcomes.filter(outcome => outcome === 'LOSS').length;
    return { name, won, lost, rate: won + lost ? Math.round(won / (won + lost) * 100) : null };
  });
  return <section className="rfx-results" aria-label="Recorded prediction results">
    <div className="rfx-record">
      {summary.map(item => <article key={item.name}>
        <span>{item.name}</span>
        <strong>{item.rate === null ? '—' : `${item.rate}%`}</strong>
        <small>{item.won} won · {item.lost} lost{item.rate === null ? '' : ' · settled picks shown below'}</small>
      </article>)}
    </div>
    <div className="rfx-table-scroll">
      <table className="rfx-table">
        <thead><tr><th scope="col">Match</th><th scope="col">Score</th><th scope="col">Match result</th><th scope="col">Goals 2.5</th><th scope="col">Both teams score</th></tr></thead>
        <tbody>{rows.map(({ p, markets }) => <tr key={p.id}>
          <th scope="row">
            <span className="rfx-table-team"><TeamCrest id={p.homeId} name={p.home} size="sm" />{p.home}</span>
            <span className="rfx-table-team"><TeamCrest id={p.awayId} name={p.away} size="sm" />{p.away}</span>
            <small>{new Date(p.kickoff).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small>
          </th>
          <td className="rfx-table-score">{p.score ? p.score.replace(' - ', ' – ') : '—'}</td>
          {markets.map(market => <td key={market.key}>{market.pick
            ? <><span className="rfx-table-pick">{market.pick}{Number.isFinite(market.percentage) && <small>{market.percentage}%</small>}</span>
                <span className={`rfx-outcome rfx-outcome-${String(market.outcome || 'PENDING').toLowerCase()}`}>{OUTCOME_LABEL[market.outcome] || 'Pending'}</span></>
            : <span className="rfx-table-none">Not predicted</span>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

export default function FootballPage() {
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    let active = true;
    apiRequest('/admin/preview').then(() => { if (active) setIsOwner(true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [league, setLeague] = useState(leagueFromAddress);
  const [data, setData] = useState(null), [error, setError] = useState(''), [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get('view') === 'results' ? 'history' : 'upcoming'));
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
  function chooseLeague(code) {
    setLeague(code);
    try { window.history.replaceState(null, '', code === 'PL' ? window.location.pathname : `${window.location.pathname}?league=${code}`); } catch { /* address bar update is optional */ }
  }
  const leagueName = LEAGUES.find(([code]) => code === league)?.[1];
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
    <section className="rfx-league-picker" aria-label="Competition selection">
      <span className="rf-section-eyebrow">CHOOSE YOUR COMPETITION</span>
      <div className="rfx-leagues" role="group" aria-label="Competition">
        {LEAGUES.map(([code, name]) => <button type="button" key={code} aria-pressed={league === code} onClick={() => chooseLeague(code)}>{name}</button>)}
      </div>
    </section>
    {error && <section className="content-card" role="alert"><h2>Football is temporarily unavailable</h2><p>{error}</p></section>}
    {!data && !error && <p className="rf-loading" role="status"><span aria-hidden="true" /> Loading football fixtures…</p>}
    {data && <>
      {!data.configured && <p className="content-card rf-message">Football predictions are being prepared. Please check back later.</p>}
      {data.error && <p className="content-card rf-message" role="alert">{data.accessDenied ? 'This competition is unavailable with the current data subscription. Choose another league.' : data.error}</p>}
      <div className="rf-feed-toolbar" id="real-football-matches">
        <div className="rf-feed-meta">
          <span className={`rf-feed-dot${data.stale || data.error ? ' is-stale' : ''}`} aria-hidden="true" />
          <div><span className="rf-section-eyebrow">{leagueName}</span>
            <p>{data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for the first successful sync.'}{data.stale && ' · Data may be out of date.'}</p></div>
        </div>
        <div className="football-tabs rf-tabs" role="group" aria-label="Football views">
          <button className="btn btn-secondary" aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming</button>
          <button className="btn btn-secondary" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Results</button>
          <button className="btn btn-secondary" aria-pressed={tab === 'combinations'} onClick={() => setTab('combinations')}>Combination History</button>
        </div>
      </div>
      {tab === 'upcoming' ? <>
        <FootballMatchStage key={league} matches={data.upcoming} stale={data.stale || !!data.error} leagueName={leagueName} />
        {league === 'CL' && <p className="resource-note">Champions League picks need five completed matches per team in the current season. Some fixtures may have no pick.</p>}
        <FootballCombinations data={data.combinations} isOwner={isOwner} compact />
      </> : tab === 'history' ? <FootballResults history={data.history} /> : <FootballCombinationHistory />}
      <p className="resource-note">Fixtures, results and club crests supplied by <a href="https://www.football-data.org/" target="_blank" rel="noreferrer">football-data.org</a>. Free-plan results may be delayed. Each league refreshes about every 30 minutes. Initial league loading may take a couple of minutes. Schedule changes, postponements, cancellations and suspensions void existing picks.</p>
    </>}
  </main>;
}
