import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';
import './virtual-football.css';

function formatTime(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function getPickLabel(pick, match) {
  if (pick === 'HOME') return `Home · ${match.home}`;
  if (pick === 'AWAY') return `Away · ${match.away}`;
  if (pick === 'DRAW') return 'Draw';
  return 'Not available';
}

const predictionMarkets = [
  { id: 'win', label: 'Win', description: 'Home, draw, or away' },
  { id: 'over', label: 'Over 1.5', description: 'Total goals' },
  { id: 'ng', label: 'NG', description: 'BTTS: No' },
  { id: 'gg', label: 'GG', description: 'BTTS: Yes' },
];

const FEED_REFRESH_INTERVAL_MS = 10000;

function getMarketPrediction(match, market) {
  if (market === 'win' && match.pick) {
    return { label: 'Match winner', value: getPickLabel(match.pick, match) };
  }
  if (market === 'over' && (match.goals15 === 'OVER' || match.goals15 === 'UNDER')) {
    return { label: 'Total goals · 1.5 line', value: match.goals15 === 'OVER' ? 'Over 1.5 goals' : 'Under 1.5 goals' };
  }
  if (market === 'over' && match.goals15 == null && match.btts === 'GG') {
    return { label: 'Derived from both teams to score', value: 'Over 1.5 goals · GG signal' };
  }
  if (market === 'ng' && match.btts === 'NG') {
    return { label: 'Both teams to score', value: 'No · NG' };
  }
  if (market === 'gg' && match.btts === 'GG') {
    return { label: 'Both teams to score', value: 'Yes · GG' };
  }
  return null;
}

function getMarketSettlement(match, market) {
  const score = typeof match.score === 'string' ? match.score.match(/^(\d{1,2})-(\d{1,2})$/) : null;
  if (!score) return 'NO SCORE';
  const homeGoals = Number(score[1]);
  const awayGoals = Number(score[2]);
  let won;

  if (market === 'win') {
    const outcome = homeGoals > awayGoals ? 'HOME' : homeGoals < awayGoals ? 'AWAY' : 'DRAW';
    won = match.pick === outcome;
  } else if (market === 'over') {
    const pick = match.goals15 || (match.btts === 'GG' ? 'OVER' : null);
    if (!pick) return 'NO PICK';
    won = pick === (homeGoals + awayGoals >= 2 ? 'OVER' : 'UNDER');
  } else {
    const outcome = homeGoals > 0 && awayGoals > 0 ? 'GG' : 'NG';
    won = match.btts === outcome;
  }

  return won ? 'WIN' : 'LOSS';
}

function getMarketWeekGroups(matches, market) {
  const weeks = new Map();
  for (const match of matches) {
    const prediction = getMarketPrediction(match, market);
    if (!prediction) continue;
    const week = String(match.week || 'Week unavailable');
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push({ match, prediction });
  }
  return [...weeks].map(([week, rows]) => ({ week, rows }));
}

function Jersey({ variant }) {
  return <svg className={`vf-jersey vf-jersey-${variant}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="m21 8-13 7 6 13 7-3v29h22V25l7 3 6-13-13-7-5 7h-12l-5-7Z" />
    <path className="vf-jersey-stripe" d="M25 15h14v39H25z" />
    <path className="vf-jersey-neck" d="M25 15c1 5 13 5 14 0" />
  </svg>;
}

function MatchCard({ match, market }) {
  const confidence = Number.isFinite(match.confidence) ? match.confidence : null;
  const statusLabel = match.status === 'REPORTED'
    ? 'Result reported'
    : match.status === 'EXPIRED' ? 'Past fixture' : 'Upcoming';
  const pickLabel = getPickLabel(match.pick, match);
  const marketPrediction = market ? getMarketPrediction(match, market) : null;

  return <article className="vf-match-card">
    <div className="vf-match-card-topline">
      <span className="vf-week">{match.week}</span>
      <span className={`vf-status vf-status-${String(match.status).toLowerCase()}`}>
        <i aria-hidden="true" />{statusLabel}
      </span>
    </div>

    <div className="vf-matchup">
      <div className="vf-team">
        <Jersey variant="home" />
        <span className="vf-team-role">Home</span>
        <strong className="vf-team-name">{match.home}</strong>
      </div>
      <div className="vf-match-center">
        <span className="vf-vs">VS</span>
        {match.score && match.status === 'REPORTED'
          ? <strong className="vf-score" aria-label={`Final score ${match.score}`}>{match.score}</strong>
          : <span className="vf-score-placeholder">— : —</span>}
      </div>
      <div className="vf-team">
        <Jersey variant="away" />
        <span className="vf-team-role">Away</span>
        <strong className="vf-team-name">{match.away}</strong>
      </div>
    </div>

    <div className="vf-pick-highlight">
      <span className="vf-pick-icon" aria-hidden="true">{market === 'over' ? '1.5' : market === 'gg' || market === 'ng' ? 'BT' : '↗'}</span>
      <span><small>{marketPrediction?.label || '1X2 prediction'}</small><strong>{marketPrediction?.value || pickLabel}</strong></span>
    </div>

    <details className="vf-match-details">
      <summary>Prediction details <span aria-hidden="true">⌄</span></summary>
      <div className="vf-detail-grid">
        <div className="vf-detail-item">
          <span>Match outcome</span>
          <strong>{pickLabel}</strong>
        </div>
        <div className="vf-detail-item">
          <span>Total goals · 1.5 line</span>
          <strong>{match.goals15 === 'OVER'
            ? 'Over 1.5'
            : match.goals15 === 'UNDER'
              ? 'Under 1.5'
              : match.goals15 == null && match.btts === 'GG'
                ? 'Over 1.5 · derived from GG'
                : 'Not provided by feed'}</strong>
        </div>
        <div className="vf-detail-item">
          <span>Both teams to score</span>
          <strong>{match.btts === 'GG' ? 'Yes' : match.btts === 'NG' ? 'No' : 'Not available'}</strong>
        </div>
        {confidence !== null && <div className="vf-confidence">
          <div className="vf-confidence-label"><span>Model confidence</span><strong>{confidence.toFixed(1)}%</strong></div>
          <div className="vf-confidence-track" role="img" aria-label={`Model confidence ${confidence.toFixed(1)} percent`}>
            <span style={{ width: `${confidence}%` }} />
          </div>
        </div>}
        <p className="vf-published-time">Published {formatTime(match.createdAt)}</p>
      </div>
    </details>
  </article>;
}

export default function VirtualFootballPage({ showResults = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [activeMarket, setActiveMarket] = useState('win');

  useEffect(() => {
    let active = true;
    let timer;
    async function load() {
      try {
        const response = await apiRequest('/public-virtual-football');
        if (active) {
          setData(response);
          setError('');
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) timer = setTimeout(load, FEED_REFRESH_INTERVAL_MS);
      }
    }
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const reportedCount = matches.filter(match => match.status === 'REPORTED').length;
  const upcomingCount = matches.filter(match => match.status === 'UPCOMING').length;
  const visibleMatches = showResults
    ? matches.filter(match => match.status === 'REPORTED'
      && predictionMarkets.some(market => getMarketPrediction(match, market.id)))
    : matches.filter(match => match.status !== 'REPORTED' && getMarketPrediction(match, activeMarket));

  return <main className="page-wrap resource-page vf-page">
    <section className="vf-hero">
      <div className="vf-hero-copy">
        <span className="vf-eyebrow"><i aria-hidden="true" /> Virtual football · {showResults ? 'Results archive' : 'Match center'}</span>
        <h1>{showResults ? <>Virtual results.<br /><span>Reported scores.</span></> : <>Every match.<br /><span>One clear view.</span></>}</h1>
        <p>{showResults
          ? 'Review completed virtual fixtures and the scores reported by the match feed.'
          : 'Explore virtual fixtures and the available Win, Over 1.5, NG, and GG picks from your prediction feed.'}</p>
        <a className="vf-hero-link" href={showResults ? 'virtual-football.html' : 'virtual-results.html'}>
          {showResults ? 'Back to match predictions' : 'View reported results'} <span aria-hidden="true">{showResults ? '→' : '↓'}</span>
        </a>
      </div>
      <div className="vf-hero-art" aria-hidden="true">
        <div className="vf-art-pitch"><span /><i /><b /></div>
        <div className="vf-art-ball">49</div>
        <div className="vf-art-chip vf-art-chip-top">MATCH<br />INSIGHT</div>
        <div className="vf-art-chip vf-art-chip-bottom">VIRTUAL<br />LEAGUE</div>
      </div>
    </section>

    {error && <section className="vf-error" role="alert">
      <span className="vf-error-mark" aria-hidden="true">!</span>
      <div><h2>Feed temporarily unavailable</h2><p>{error}</p></div>
    </section>}

    {!data && !error && <section className="vf-loading" role="status">
      <span className="vf-loading-spinner" aria-hidden="true" />
      <span>Connecting to the virtual match feed…</span>
    </section>}

    {data && <>
      <section className={`vf-feed-status${data.stale ? ' is-stale' : ''}`} aria-label="Feed status">
        <span className="vf-feed-indicator" aria-hidden="true"><i /></span>
        <div className="vf-feed-copy">
          <strong>{data.stale ? 'Feed may be out of date' : 'Prediction feed is up to date'}</strong>
          <p>
            {data.updatedAt ? `Last received ${formatTime(data.updatedAt)}` : 'Waiting for the first match feed.'}
            {data.sourceAt && ` · Source updated ${formatTime(data.sourceAt)}`}
          </p>
        </div>
        <span className="vf-refresh-note"><i aria-hidden="true" /> Auto-refresh · 10 sec</span>
      </section>

      {!showResults && <section className="vf-overview" aria-label="Feed overview">
        <div className="vf-overview-heading">
          <span className="vf-section-eyebrow">YOUR MATCH CENTER</span>
          <h2>Feed overview</h2>
        </div>
        <div className="vf-overview-stats">
          <article className="vf-stat-card">
            <span className="vf-stat-icon vf-stat-icon-total" aria-hidden="true">⚽</span>
            <span className="vf-stat-label">Matches in feed</span>
            <strong>{matches.length}</strong>
          </article>
          <article className="vf-stat-card">
            <span className="vf-stat-icon vf-stat-icon-reported" aria-hidden="true">✓</span>
            <span className="vf-stat-label">Reported results</span>
            <strong>{reportedCount}</strong>
          </article>
          <article className="vf-stat-card">
            <span className="vf-stat-icon vf-stat-icon-upcoming" aria-hidden="true">↗</span>
            <span className="vf-stat-label">Upcoming picks</span>
            <strong>{upcomingCount}</strong>
          </article>
        </div>
      </section>}

      <section className="vf-fixtures" id="virtual-matches">
        <div className="vf-fixtures-heading">
          <div>
            <span className="vf-section-eyebrow">{showResults ? 'COMPLETED FIXTURES' : 'LATEST FROM THE FEED'}</span>
            <h2>{showResults ? 'Reported results' : 'Match predictions'}</h2>
            <p>{showResults
              ? 'Scores are shown only after the feed reports a result.'
              : activeMarket === 'over'
                ? 'Feed Over/Under 1.5 picks take precedence; when unavailable, GG implies Over 1.5.'
                : 'Team labels and predictions come from the feed; jersey colors are decorative.'}</p>
          </div>
          <span className="vf-fixture-count">{visibleMatches.length} {visibleMatches.length === 1 ? 'match' : 'matches'}</span>
        </div>
        {!showResults && <div className="vf-market-tabs" role="group" aria-label="Filter virtual predictions by market">
          {predictionMarkets.map(item => {
            const count = matches.filter(match => match.status !== 'REPORTED' && getMarketPrediction(match, item.id)).length;
            return <button key={item.id} type="button" className={`vf-market-tab${activeMarket === item.id ? ' is-active' : ''}`}
              aria-pressed={activeMarket === item.id} onClick={() => setActiveMarket(item.id)}>
              <span><strong>{item.label}</strong><small>{item.description}</small></span><b>{count}</b>
            </button>;
          })}
        </div>}
        {visibleMatches.length === 0
          ? <div className="vf-empty-state"><span aria-hidden="true">{showResults ? '✓' : activeMarket === 'over' ? '1.5' : '⚽'}</span>
            <h3>{showResults ? 'No reported results yet' : activeMarket === 'over' ? 'Over 1.5 picks not available' : 'No picks available for this market'}</h3>
            <p>{showResults
              ? 'No virtual match scores have been reported by the feed yet.'
              : activeMarket === 'over'
                ? 'No Over/Under 1.5 picks or GG predictions are currently available in the feed.'
                : 'No published virtual fixtures currently include a prediction for this market.'}</p></div>
          : showResults
            ? <div className="vf-results-markets">
              {predictionMarkets.map(market => {
                const weekGroups = getMarketWeekGroups(visibleMatches, market.id);
                const count = weekGroups.reduce((total, group) => total + group.rows.length, 0);
                return <section className="vf-results-market" key={market.id} aria-labelledby={`vf-results-${market.id}`}>
                  <div className="vf-results-market-heading">
                    <h3 id={`vf-results-${market.id}`}>{market.label}</h3>
                    <span>{count} {count === 1 ? 'prediction' : 'predictions'}</span>
                  </div>
                  <div className="vf-results-table-scroll">
                    <table className="vf-results-table">
                      <thead><tr><th scope="col">Fixture</th><th scope="col">Prediction</th><th scope="col">Score</th><th scope="col">Result</th></tr></thead>
                      {weekGroups.map(group => <tbody key={group.week}>
                        <tr className="vf-results-week"><th scope="rowgroup" colSpan="4">{group.week}</th></tr>
                        {group.rows.map(({ match, prediction }) => {
                          const settlement = getMarketSettlement(match, market.id);
                          return <tr key={match.id}>
                            <td><strong>{match.home} vs {match.away}</strong><small>{formatTime(match.createdAt)}</small></td>
                            <td>{prediction.value}</td>
                            <td className="vf-results-score">{match.score || '—'}</td>
                            <td><span className={`vf-results-outcome vf-results-outcome-${settlement.toLowerCase().replace(' ', '-')}`}>{settlement}</span></td>
                          </tr>;
                        })}
                      </tbody>)}
                      {!weekGroups.length && <tbody><tr><td colSpan="4" className="vf-results-no-picks">No reported predictions for this market.</td></tr></tbody>}
                    </table>
                  </div>
                </section>;
              })}
            </div>
            : <div className="vf-match-grid">{visibleMatches.map(match => <MatchCard key={match.id} match={match} market={activeMarket} />)}</div>}
      </section>

      <p className="vf-responsible-note">Predictions are uncertain and are shown for information only. Review results carefully and bet responsibly.</p>
    </>}
  </main>;
}
