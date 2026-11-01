import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';

function formatTime(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
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
        if (active) {
          setError(requestError.message);
        }
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

  return <main className="page-wrap resource-page football-page football-hub">
    <section className="page-intro">
      <span className="overline">VIRTUAL FOOTBALL</span>
      <h1>Virtual Football predictions</h1>
      <p>Latest virtual match picks and reported results from the live feed.</p>
    </section>
    {error && <section className="content-card" role="alert">
      <h2>Virtual Football is temporarily unavailable</h2>
      <p>{error}</p>
    </section>}
    {!data && !error && <p role="status">Loading Virtual Football...</p>}
    {data && <>
      <section className="content-card resource-toolbar">
        <div>
          <strong>{data.stale ? 'Feed may be out of date' : 'Feed is up to date'}</strong>
          <p>
            {data.updatedAt ? `Last received ${formatTime(data.updatedAt)}` : 'Waiting for the first match feed.'}
            {data.sourceAt && ` · Source updated ${formatTime(data.sourceAt)}`}
          </p>
        </div>
      </section>
      {!data.matches?.length
        ? <p className="content-card">No virtual matches have been published yet. Please check back soon.</p>
        : <div className="football-match-grid">
          {data.matches.map(match => <article className="content-card football-match-card" key={match.id}>
            <span className="overline">{match.week} · {match.status}</span>
            <h2>{match.home} vs {match.away}</h2>
            <p>Published {formatTime(match.createdAt)}</p>
            <p><strong>1X2 pick:</strong> {match.pick || 'Not available'}</p>
            <p><strong>Both teams to score:</strong> {match.btts || 'Not available'}</p>
            {match.confidence !== null && <p><strong>Confidence:</strong> {match.confidence}%</p>}
            {match.score && <p className="football-final-score">Score: {match.score}</p>}
          </article>)}
        </div>}
      <p className="resource-note">Virtual football predictions are generated automatically and are uncertain. Please bet responsibly.</p>
    </>}
  </main>;
}
