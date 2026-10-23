import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import './analysis.css';

const markets = [ ['betzero', 'BetZero'], ['bet49', 'Bet49'], ['rainbow', 'Rainbow'],
  ['totalColor', 'Total Color 3-way'], ['totalColor2', 'Total Color 2-way'], ['totalColor1', 'Winning Color'], ['hilo', 'High / Low'], ['unified', 'Unified'] ];
const percent = value => value === null || value === undefined ? '—' : `${value}%`;

export default function AnalysisPage() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [market, setMarket] = useState('');
  const [now, setNow] = useState(Date.now());
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, timeout, controller;
    let inFlight = false;
    setPayload(null); setError(null);
    async function load() {
      if (!active || document.hidden || inFlight) return;
      clearTimeout(timeout);
      inFlight = true;
      controller = new AbortController();
      let nextDelay = 10000;
      let timedOut = false;
      const requestTimeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15000);
      try {
        const result = await apiRequest('/account/analysis', { signal: controller.signal });
        if (!active || controller.signal.aborted) return;
        setPayload({ ...result, receivedAt: Date.now() }); setError(null);
        setMarket(current => result.games.includes(current) ? current : result.games[0] || '');
        nextDelay = result.status === 'LIVE' && result.secondsRemaining > 0
          ? Math.min(5000, Math.max(1000, result.secondsRemaining * 1000)) : 2000;
      } catch (err) {
        if (!active) return;
        if (controller.signal.aborted && !timedOut) {
          nextDelay = 0;
          return;
        }
        setPayload(null); setError({ status: err.status, message: timedOut ? 'Analysis request timed out. Retrying shortly...' : err.message });
      } finally {
        clearTimeout(requestTimeout);
        inFlight = false;
        if (active && !document.hidden) timeout = setTimeout(load, nextDelay);
      }
    }
    function refreshWhenVisible() {
      clearTimeout(timeout);
      if (document.hidden) controller?.abort();
      else load();
    }
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    load();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller?.abort();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [retry]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const remaining = payload?.secondsRemaining == null ? 0 : Math.max(0, payload.secondsRemaining - Math.floor((now - payload.receivedAt) / 1000));
  const live = payload?.status === 'LIVE' && remaining > 0 && now - payload.receivedAt < 20000;
  const selected = live ? payload.analysis.find(item => item.market === market) : null;
  const marketName = markets.find(([id]) => id === market)?.[1];

  return <main className="page-wrap analysis-page">
    <section className="page-intro"><span className="overline">PREDICTION ANALYSIS</span><h1>A closer look at your picks.</h1><p>Explore recent outcomes for your current numbers and colors, with a clear view of the data available for each market.</p></section>
    {error ? <section className="content-card"><h2>{error.status === 401 ? 'Sign in to view analysis' : error.status === 403 ? 'Unlock prediction analysis' : 'Analysis is temporarily unavailable'}</h2><p role="alert">{error.message}</p><div className="analysis-actions">{error.status === 401 ? <a className="btn btn-primary" href="login.html">Log in</a> : error.status === 403 ? <a className="btn btn-primary" href="pricing.html">View plans</a> : null}<button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Refresh access</button></div></section>
      : !payload ? <p role="status">Loading your analysis access...</p> : <>
      <section className="content-card analysis-access"><div><span className="overline">{payload.tier} ACCESS</span><h2>{payload.games.length} available markets</h2></div><span className="analysis-live">{live ? `Draw #${payload.drawId} · ${remaining}s remaining` : 'Waiting for a fresh prediction'}</span></section>
      <div className="analysis-layout">
        <nav className="analysis-nav" aria-label="Analysis markets">{markets.map(([id, name]) => {
          const allowed = payload.games.includes(id);
          return <button key={id} disabled={!allowed} aria-pressed={market === id} className={market === id ? 'selected' : ''} onClick={() => setMarket(id)}>{name}<small>{allowed ? 'Included' : 'Not in your plan'}</small></button>;
        })}<a href="pricing.html">Compare plans →</a></nav>
        <section className="analysis-content" aria-label={`${marketName || 'Market'} analysis`}>
          <article className="content-card analysis-main"><span className="overline">{marketName || 'YOUR MARKETS'}</span><h2>Current pick analysis</h2>
            {!live ? <p role="status">Live data is updating. Analysis will appear when the next current prediction is available.</p>
              : !selected?.items.length ? <p>No active pick is available for this market on this draw.</p>
              : <><p className="analysis-explanation">Historical support describes past outcomes, not the probability of winning the next draw. Values use up to 100 completed draws before this prediction.</p>
                <div className="analysis-picks">{selected.items.map((item, index) => <article className="analysis-pick" key={`${item.value}-${index}`}>
                  <span className={item.type === 'number' ? `ball-number ball-${item.color}` : `color-name color-${item.color || 'neutral'}`}>{item.type === 'color' && <i aria-hidden="true" />}{item.value === 'black' ? 'No winning color' : item.value}</span>
                  <strong>{percent(item.support)}</strong><span>Historical support</span>
                  {item.support !== null && <meter min="0" max="100" value={item.support} aria-label={`${item.value}: ${item.description}`} />}
                  <p>{item.description}</p><small>{item.count} of {item.sampleSize} valid draws</small>
                  {item.sampleSize < 20 && <small className="analysis-limited">Limited data — interpret cautiously</small>}
                </article>)}</div>
                <p className="analysis-explanation">Individual number or color values are not the combined chance of a multi-pick winning. High historical support does not establish a future advantage.</p>
              </>}
          </article>
          {selected && <article className="content-card"><span className="overline">RECENT PREDICTION RESULTS</span><h2>How this market has performed</h2><div className="analysis-metrics"><div><strong>{percent(selected.recentWinRate)}</strong><span>Historical win rate</span></div><div><strong>{selected.wins} / {selected.losses}</strong><span>Wins / losses</span></div><div><strong>{selected.settled}</strong><span>Settled picks in {selected.historyDraws} draws</span></div></div><div className="analysis-results" aria-label="Latest settled results, newest first">{selected.recentResults.map((outcome, index) => <span className={`outcome-badge ${outcome.toLowerCase()}`} key={index}>{outcome}</span>)}</div><p className="analysis-explanation">Newest result first. Skipped picks are excluded from win rate. These results cover published picks, not a replay of the current selection.</p></article>}
          <div className="analysis-actions"><a className="btn btn-primary" href="predictions.html">Open predictions</a><a className="btn btn-secondary" href="history.html">Explore history</a></div>
        </section>
      </div>
    </>}
  </main>;
}
