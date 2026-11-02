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

function Jersey({ variant }) {
  return <svg className={`vf-jersey vf-jersey-${variant}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="m21 8-13 7 6 13 7-3v29h22V25l7 3 6-13-13-7-5 7h-12l-5-7Z" />
    <path className="vf-jersey-stripe" d="M25 15h14v39H25z" />
    <path className="vf-jersey-neck" d="M25 15c1 5 13 5 14 0" />
  </svg>;
}

function MatchCard({ match }) {
  const confidence = Number.isFinite(match.confidence) ? match.confidence : null;
  const statusLabel = match.status === 'REPORTED'
    ? 'Result reported'
    : match.status === 'EXPIRED' ? 'Past fixture' : 'Upcoming';
  const pickLabel = getPickLabel(match.pick, match);

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
      <span className="vf-pick-icon" aria-hidden="true">↗</span>
      <span><small>1X2 prediction</small><strong>{pickLabel}</strong></span>
    </div>

    <details className="vf-match-details">
      <summary>Prediction details <span aria-hidden="true">⌄</span></summary>
      <div className="vf-detail-grid">
        <div className="vf-detail-item">
          <span>Match outcome</span>
          <strong>{pickLabel}</strong>
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

export default function VirtualFootballPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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
        if (active) timer = setTimeout(load, 30000);
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

  return <main className="page-wrap resource-page vf-page">
    <section className="vf-hero">
      <div className="vf-hero-copy">
        <span className="vf-eyebrow"><i aria-hidden="true" /> Virtual football · Match center</span>
        <h1>Every match.<br /><span>One clear view.</span></h1>
        <p>Explore the latest virtual fixtures, model picks, and reported scores from your prediction feed.</p>
        <a className="vf-hero-link" href="#virtual-matches">Explore match feed <span aria-hidden="true">↓</span></a>
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
        <span className="vf-refresh-note"><i aria-hidden="true" /> Auto-refresh · 30 sec</span>
      </section>

      <section className="vf-overview" aria-label="Feed overview">
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
      </section>

      <section className="vf-fixtures" id="virtual-matches">
        <div className="vf-fixtures-heading">
          <div>
            <span className="vf-section-eyebrow">LATEST FROM THE FEED</span>
            <h2>Match predictions</h2>
            <p>Team labels and match details come from the feed; jersey colors are decorative.</p>
          </div>
          <span className="vf-fixture-count">{matches.length} {matches.length === 1 ? 'match' : 'matches'}</span>
        </div>
        {matches.length === 0
          ? <div className="vf-empty-state"><span aria-hidden="true">⚽</span><h3>No matches yet</h3><p>No virtual matches have been published. Check back soon for updates.</p></div>
          : <div className="vf-match-grid">{matches.map(match => <MatchCard key={match.id} match={match} />)}</div>}
      </section>

      <p className="vf-responsible-note">Predictions are uncertain and are shown for information only. Review results carefully and bet responsibly.</p>
    </>}
  </main>;
}
