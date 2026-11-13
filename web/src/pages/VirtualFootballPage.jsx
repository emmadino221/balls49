import React, { useEffect, useRef, useState } from 'react';
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
  { id: 'win', label: 'Win', description: 'One team to win' },
  { id: 'over', label: 'Over 1.5', description: 'Total goals' },
  { id: 'ng', label: 'NG', description: 'BTTS: No' },
  { id: 'gg', label: 'GG', description: 'BTTS: Yes' },
];

const resultMarkets = ['over', 'gg', 'ng', 'win'].map(id => predictionMarkets.find(market => market.id === id));

function hasMarketResult(match, market) {
  return match.status === 'REPORTED'
    && !!match.roundId
    && Array.isArray(match.selectedMarkets)
    && match.selectedMarkets.includes(market)
    && !(market === 'over' && match.goals15 === 'UNDER')
    && !!getMarketPrediction(match, market);
}

const FEED_REFRESH_INTERVAL_MS = 10000;

function getMarketPrediction(match, market) {
  if (Array.isArray(match.selectedMarkets) && !match.selectedMarkets.includes(market)) return null;
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

function getMarketRoundGroups(matches, market) {
  const rounds = new Map();
  for (const match of [...matches].sort((a, b) => b.createdAt - a.createdAt)) {
    const prediction = getMarketPrediction(match, market);
    if (!prediction) continue;
    const week = String(match.week || 'Week unavailable');
    const key = `${String(match.id).split(':')[0]}:${match.roundId}`;
    if (!rounds.has(key)) rounds.set(key, { key, week, createdAt: match.createdAt, rows: [] });
    rounds.get(key).rows.push({ match, prediction });
  }
  return [...rounds.values()];
}

function Crest({ name, variant }) {
  return <span className={`vf-crest vf-crest-${variant}`} aria-hidden="true">
    <svg viewBox="0 0 48 54" focusable="false"><path d="M24 2 44 9v19c0 12-8 20-20 24C12 48 4 40 4 28V9Z" /></svg>
    <b>{String(name || '?').trim().slice(0, 1)}</b>
  </span>;
}

function MatchCard({ match, market }) {
  const marketConfidence = market === 'win' ? match.confidence : market === 'over' && match.goals15 != null ? match.over15Confidence : match.bttsConfidence;
  const confidence = Number.isFinite(marketConfidence) ? marketConfidence : null;
  const statusLabel = match.status === 'REPORTED'
    ? 'Result reported'
    : match.status === 'EXPIRED' ? 'Past fixture' : 'Upcoming';
  const pickLabel = getPickLabel(match.pick, match);
  const marketPrediction = market ? getMarketPrediction(match, market) : null;

  const reported = !!match.score && match.status === 'REPORTED';
  const confidenceLabel = market === 'over'
    ? (match.goals15 != null ? 'Over 1.5 model confidence' : 'Historical BTTS confidence')
    : 'Model confidence';

  return <article className="vf-match-card">
    <div className="vf-card-main">
      <div className="vf-match-card-topline">
        <span className="vf-week">{match.week} <i aria-hidden="true">·</i> Virtual league</span>
        <span className={`vf-status vf-status-${String(match.status).toLowerCase()}`}>
          <i aria-hidden="true" />{statusLabel}
        </span>
      </div>

      <div className="vf-matchup">
        <div className="vf-team">
          <Crest name={match.home} variant="home" />
          <strong className="vf-team-name">{match.home}</strong>
          <span className="vf-team-role">Home</span>
        </div>
        <div className="vf-match-center">
          {reported
            ? <><strong className="vf-score" aria-label={`Final score ${match.score}`}>{match.score.replace('-', ' – ')}</strong><span className="vf-vs">Full time</span></>
            : <span className="vf-score-placeholder">VS</span>}
        </div>
        <div className="vf-team">
          <Crest name={match.away} variant="away" />
          <strong className="vf-team-name">{match.away}</strong>
          <span className="vf-team-role">Away</span>
        </div>
      </div>
    </div>

    <div className="vf-card-side">
    <div className="vf-pick-highlight">
      <span className="vf-pick-copy">
        <small>{marketPrediction?.label || '1X2 prediction'}</small>
        <strong>{marketPrediction?.value || pickLabel}</strong>
        {market === 'win' && Number.isFinite(match.winOdds) && <em className="vf-odds">Selection odds <b>{match.winOdds.toFixed(2)}</b></em>}
      </span>
      {confidence !== null && <span className="vf-ring-wrap">
        <span className="vf-ring" style={{ '--value': Math.min(100, Math.max(0, confidence)) }} role="img" aria-label={`${confidenceLabel} ${confidence.toFixed(1)} percent`}>
          <strong>{Math.round(confidence)}<i>%</i></strong>
        </span>
        <small>Confidence</small>
      </span>}
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
          <div className="vf-confidence-label"><span>{confidenceLabel}</span><strong>{confidence.toFixed(1)}%</strong></div>
          <div className="vf-confidence-track" role="img" aria-label={`Model confidence ${confidence.toFixed(1)} percent`}>
            <span style={{ width: `${confidence}%` }} />
          </div>
        </div>}
        <p className="vf-published-time">Published {formatTime(match.createdAt)}</p>
      </div>
    </details>
    </div>
  </article>;
}

export default function VirtualFootballPage({ showResults = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [activeMarket, setActiveMarket] = useState(showResults ? 'over' : 'win');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [weekFilter, setWeekFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const resultTabRefs = useRef([]);
  function handleResultTabKey(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % resultMarkets.length;
    else if (event.key === 'ArrowLeft') next = (index + resultMarkets.length - 1) % resultMarkets.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = resultMarkets.length - 1;
    else return;
    event.preventDefault();
    setActiveMarket(resultMarkets[next].id);
    resultTabRefs.current[next]?.focus();
  }

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
  const invalidDates = fromDate && toDate && fromDate > toDate;
  const historyMatches = matches.filter(match => {
    const date = new Date(match.createdAt);
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return !invalidDates && (!fromDate || localDate >= fromDate) && (!toDate || localDate <= toDate)
      && (!weekFilter || match.week === weekFilter);
  });
  const historyFor = market => {
    const groups = getMarketRoundGroups(historyMatches.filter(match => hasMarketResult(match, market)), market);
    for (const group of groups) {
      const outcomes = group.rows.map(({ match }) => getMarketSettlement(match, market));
      group.outcome = outcomes.length !== (market === 'over' ? 2 : 1) || outcomes.includes('NO SCORE')
        ? 'INCOMPLETE' : outcomes.every(outcome => outcome === 'WIN') ? 'WIN' : 'LOSS';
    }
    let current = 0, worst = 0, wins = 0, losses = 0;
    for (const group of [...groups].reverse()) {
      if (group.outcome === 'LOSS') { current += 1; losses += 1; worst = Math.max(worst, current); }
      else { current = 0; if (group.outcome === 'WIN') wins += 1; }
    }
    return { groups: groups.filter(group => !outcomeFilter || group.outcome === outcomeFilter), current, worst, wins, losses };
  };
  const reportedCount = matches.filter(match => match.status === 'REPORTED').length;
  const upcomingCount = matches.filter(match => match.status === 'UPCOMING').length;
  const freshMatches = matches.filter(match => match.status === 'UPCOMING' && Array.isArray(match.selectedMarkets) && match.roundId);
  const latestRound = [...freshMatches].sort((a,b) => b.createdAt-a.createdAt || Number(b.id.split(':').at(-1))-Number(a.id.split(':').at(-1)))[0];
  const roundMatches = latestRound ? freshMatches.filter(match => match.roundId === latestRound.roundId && match.id.split(':')[0] === latestRound.id.split(':')[0]) : [];
  const overPairReady = roundMatches.filter(match => getMarketPrediction(match, 'over')).length === 2;
  const currentMarketMatches = market => market === 'over' && !overPairReady
    ? [] : roundMatches.filter(match => getMarketPrediction(match, market));
  const visibleMatches = showResults
    ? historyFor(activeMarket).groups.flatMap(group => group.rows.map(row => row.match))
    : currentMarketMatches(activeMarket).slice(0, activeMarket === 'over' ? 2 : 1);

  const boardRows = (showResults ? resultMarkets : predictionMarkets).map(item => {
    if (showResults) {
      const stats = historyFor(item.id);
      return { ...item, value: `${stats.wins} won · ${stats.losses} lost`, ready: stats.wins + stats.losses > 0 };
    }
    const count = currentMarketMatches(item.id).length;
    return { ...item, value: count ? `${count} ${count === 1 ? 'pick' : 'picks'}` : 'No pick', ready: count > 0 };
  });

  return <main className="page-wrap resource-page vf-page">
    <section className="vf-hero">
      <div className="vf-hero-copy">
        <span className="vf-eyebrow"><i aria-hidden="true" /> Virtual football · {showResults ? 'Results archive' : 'Match center'}</span>
        <h1>{showResults ? <>Virtual results.<br /><span>Reported scores.</span></> : <>Every match.<br /><span>One clear view.</span></>}</h1>
        <p>{showResults
          ? 'Review completed virtual fixtures and the scores reported by the match feed.'
          : 'Each round: two qualifying Over 1.5 picks or skip, one GG, one NG and one winner with selection odds above 1.70.'}</p>
        <a className="vf-hero-link" href={showResults ? 'virtual-football.html' : 'virtual-results.html'}>
          {showResults ? 'Back to match predictions' : 'View reported results'} <span aria-hidden="true">→</span>
        </a>
      </div>
      <aside className="vf-board" aria-label={showResults ? 'Round record by market' : 'Current round by market'}>
        <div className="vf-board-head">
          <span>{showResults ? 'Round record' : 'Current round'}</span>
          <strong>{showResults ? 'Your filters' : latestRound?.week || '—'}</strong>
        </div>
        {data
          ? <ul className="vf-board-rows">
              {boardRows.map(row => <li key={row.id} className={row.ready ? 'is-ready' : ''}>
                <span><strong>{row.label}</strong><small>{row.description}</small></span>
                <b>{row.value}</b>
              </li>)}
            </ul>
          : <p className="vf-board-wait">{error ? 'The match feed is unavailable right now.' : 'Waiting for the match feed…'}</p>}
        <div className={`vf-board-foot${data && !data.stale ? ' is-live' : ''}`}>
          <i aria-hidden="true" />{!data ? 'Not connected' : data.stale ? 'Feed may be out of date' : 'Live feed · refreshes every 10 seconds'}
        </div>
      </aside>
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
        <dl className="vf-feed-stats">
          <div><dt>Upcoming</dt><dd>{upcomingCount}</dd></div>
          <div><dt>Reported</dt><dd>{reportedCount}</dd></div>
          <div><dt>In feed</dt><dd>{matches.length}</dd></div>
        </dl>
      </section>

      <section className="vf-fixtures" id="virtual-matches">
        <div className="vf-fixtures-heading">
          <div>
            <span className="vf-section-eyebrow">{showResults ? 'COMPLETED FIXTURES' : 'LATEST FROM THE FEED'}</span>
            <h2>{showResults ? 'Reported results' : 'Match predictions'}</h2>
            <p>{showResults
              ? 'Only the picks selected before each round: up to two for Over 1.5 and one each for GG, NG and Win. Older results without saved selections are excluded.'
              : activeMarket === 'over'
                ? 'Exactly two picks from the dedicated Over 1.5 model, each with model confidence of at least 60%. If fewer than two qualify, we skip the round. Confidence is an estimate, not a guarantee.'
                : activeMarket === 'win' ? 'The highest-confidence qualifying winner with selection odds strictly above 1.70.' : 'One match with the highest available model confidence for this market. No qualifying match means no pick.'}</p>
          </div>
          <span className="vf-fixture-count">{visibleMatches.length} {visibleMatches.length === 1 ? 'match' : 'matches'}</span>
        </div>
        {showResults && data.historyStart && <p className="vf-history-note">Fresh prediction history started {formatTime(data.historyStart)}. Earlier results have been cleared.</p>}
        {showResults && <div className="vf-history-filters">
          <label>From date<input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
          <label>To date<input type="date" value={toDate} onChange={event => setToDate(event.target.value)} /></label>
          <label>Week<select value={weekFilter} onChange={event => setWeekFilter(event.target.value)}><option value="">All weeks</option>{[...new Set(matches.map(match => match.week))].sort().map(week => <option key={week} value={week}>{week}</option>)}</select></label>
          <label>Round result<select value={outcomeFilter} onChange={event => setOutcomeFilter(event.target.value)}><option value="">All results</option><option value="WIN">Won</option><option value="LOSS">Lost</option><option value="INCOMPLETE">Incomplete</option></select></label>
          <button type="button" onClick={() => { setFromDate(''); setToDate(''); setWeekFilter(''); setOutcomeFilter(''); }}>Reset filters</button>
          {invalidDates && <p role="alert">The end date must be on or after the start date.</p>}
        </div>}
        {showResults && <div className="vf-market-tabs" role="tablist" aria-label="Virtual football result markets">
          {resultMarkets.map((item, index) => <button key={item.id} type="button" role="tab"
            id={`vf-result-tab-${item.id}`} aria-controls={`vf-result-panel-${item.id}`}
            aria-selected={activeMarket === item.id} tabIndex={activeMarket === item.id ? 0 : -1}
            ref={element => { resultTabRefs.current[index] = element; }}
            className={`vf-market-tab${activeMarket === item.id ? ' is-active' : ''}`}
            onKeyDown={event => handleResultTabKey(event, index)} onClick={() => setActiveMarket(item.id)}>
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
            <b>{historyFor(item.id).groups.reduce((total, group) => total + group.rows.length, 0)}</b>
          </button>)}
        </div>}
        {!showResults && <div className="vf-market-tabs" role="group" aria-label="Filter virtual predictions by market">
          {predictionMarkets.map(item => {
            const count = currentMarketMatches(item.id).length;
            return <button key={item.id} type="button" className={`vf-market-tab${activeMarket === item.id ? ' is-active' : ''}`}
              aria-pressed={activeMarket === item.id} onClick={() => setActiveMarket(item.id)}>
              <span><strong>{item.label}</strong><small>{item.description}</small></span><b>{count}</b>
            </button>;
          })}
        </div>}
        {showResults
          ? <div className="vf-results-markets">
              {resultMarkets.map(market => {
                const stats = historyFor(market.id);
                const weekGroups = stats.groups;
                const count = weekGroups.reduce((total, group) => total + group.rows.length, 0);
                return <section className="vf-results-market" key={market.id} role="tabpanel" id={`vf-result-panel-${market.id}`} aria-labelledby={`vf-result-tab-${market.id}`} hidden={activeMarket !== market.id} tabIndex="0">
                  <div className="vf-results-market-heading">
                    <h3 id={`vf-results-${market.id}`}>{market.label}</h3>
                    <span>{count} {count === 1 ? 'prediction' : 'predictions'}</span>
                  </div>
                  <div className="vf-streak-stats">
                    <article><span>Worst losing streak</span><strong>{stats.worst}</strong><small>consecutive rounds</small></article>
                    <article><span>Current losing streak</span><strong>{stats.current}</strong><small>consecutive rounds</small></article>
                    <article><span>Won rounds</span><strong>{stats.wins}</strong></article>
                    <article><span>Lost rounds</span><strong>{stats.losses}</strong></article>
                  </div>
                  <p className="vf-history-note">Statistics cover the loaded history within your date and week filters, not all-time results. Result filtering only changes the table. Dates use your local time. {market.id === 'over' ? 'Both picks must win for a round to win; either pick losing makes it a losing round. ' : ''}Incomplete rounds break the streak; skipped rounds are not counted.</p>
                  <div className="vf-results-table-scroll">
                    <table className="vf-results-table">
                      <thead><tr><th scope="col">Fixture</th><th scope="col">Prediction</th><th scope="col">Score</th><th scope="col">Result</th></tr></thead>
                      {weekGroups.map(group => <tbody key={group.key}>
                        <tr className="vf-results-week"><th scope="rowgroup" colSpan="4">{group.week} · {formatTime(group.createdAt)} · {group.rows.length} selected {group.rows.length === 1 ? 'pick' : 'picks'} · Round: {group.outcome}</th></tr>
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
                      {!weekGroups.length && <tbody><tr><td colSpan="4" className="vf-results-no-picks">No selected picks have reported results for this market yet.</td></tr></tbody>}
                    </table>
                  </div>
                </section>;
              })}
            </div>
          : visibleMatches.length === 0
            ? <div className="vf-empty-state"><span aria-hidden="true">{activeMarket === 'over' ? '1.5' : '–'}</span>
              <h3>{activeMarket === 'over' ? 'Over 1.5 picks not available' : 'No picks available for this market'}</h3>
              <p>{activeMarket === 'over'
                ? 'This round is skipped for Over 1.5 because two qualifying matches are not available. Check again next round.'
                : 'No current match meets the selection requirements. Check again next round.'}</p></div>
            : <div className="vf-match-grid">{visibleMatches.map(match => <MatchCard key={match.id} match={match} market={activeMarket} />)}</div>}
      </section>

      <p className="vf-responsible-note">Predictions are uncertain and are shown for information only. Review results carefully and bet responsibly.</p>
    </>}
  </main>;
}
