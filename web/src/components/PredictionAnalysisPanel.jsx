import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import '../pages/analysis.css';

const percent = value => value === null || value === undefined ? '—' : `${value}%`;

export default function PredictionAnalysisPanel({ market, hasAccess, signedIn }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!hasAccess || !signedIn) return undefined;
    let active = true;
    let timeout;
    let controller;
    let inFlight = false;

    async function load() {
      if (!active || document.hidden || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      let nextDelay = 5000;
      try {
        const result = await apiRequest(`/account/analysis?market=${encodeURIComponent(market)}`, { signal: controller.signal });
        if (!active) return;
        setPayload({ ...result, receivedAt: Date.now() });
        setError(null);
        nextDelay = result.status === 'LIVE' ? 5000 : 2000;
      } catch (requestError) {
        if (!active || controller.signal.aborted) return;
        setPayload(null);
        setError(requestError);
      } finally {
        inFlight = false;
        if (active && !document.hidden) timeout = window.setTimeout(load, nextDelay);
      }
    }

    function refreshWhenVisible() {
      window.clearTimeout(timeout);
      if (document.hidden) controller?.abort();
      else load();
    }

    setPayload(null);
    setError(null);
    load();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller?.abort();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [hasAccess, market, signedIn]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!signedIn) {
    return <section className="content-card analysis-main"><span className="overline">MARKET ANALYSIS</span><h2>Sign in to view this analysis</h2><p>Sign in to see historical support for this market’s current prediction.</p><div className="analysis-actions"><a className="btn btn-primary" href="login.html">Log in</a></div></section>;
  }

  if (!hasAccess || error?.status === 403) {
    return <section className="content-card analysis-main"><span className="overline">MARKET ANALYSIS</span><h2>Unlock prediction analysis</h2><p>Historical prediction analysis is included with approved Premium and Elite access for this market.</p><div className="analysis-actions"><a className="btn btn-primary" href="pricing.html">View plans</a></div></section>;
  }

  if (error) {
    return <section className="content-card analysis-main"><span className="overline">MARKET ANALYSIS</span><h2>Analysis is temporarily unavailable</h2><p role="alert">{error.message}</p><p>The analysis will retry automatically.</p></section>;
  }

  if (!payload) return <p role="status">Loading this market’s analysis…</p>;

  const remaining = payload.secondsRemaining == null
    ? 0
    : Math.max(0, payload.secondsRemaining - Math.floor((now - payload.receivedAt) / 1000));
  const live = payload.status === 'LIVE' && remaining > 0 && now - payload.receivedAt < 20000;
  const selected = live ? payload.analysis.find(item => item.market === market) : null;

  return <section className="analysis-page prediction-inline-analysis" aria-label="Prediction analysis">
    <div className="content-card analysis-access"><div><span className="overline">{payload.tier} ACCESS</span><h2>{live ? `Analysis for draw #${payload.drawId}` : 'Current market analysis'}</h2></div><span className="analysis-live">{live ? `${remaining}s remaining` : 'Waiting for a fresh prediction'}</span></div>
    <article className="content-card analysis-main"><span className="overline">HISTORICAL MARKET DATA</span><h2>Current pick analysis</h2>
      {!live ? <p role="status">Live data is updating. Analysis will appear when the next current prediction is available.</p>
        : !selected?.items.length ? <p>No active pick is available for this market on this draw.</p>
          : <><p className="analysis-explanation">Historical support describes past outcomes, not the probability of winning the next draw. Values use up to 100 completed draws before this prediction.</p>
            {market === 'rainbow' && <p className="analysis-explanation">Each color is measured by draws containing at least two balls of that color. {selected.items.some(item => item.selected) ? 'The badge marks the live prediction.' : 'There is no active Rainbow prediction for this draw.'}</p>}
            <div className="analysis-picks">{selected.items.map((item, index) => <article className={`analysis-pick${item.selected ? ' analysis-pick-selected' : ''}`} key={`${item.value}-${index}`}>
              <span className={item.type === 'number' ? `ball-number ball-${item.color}` : `color-name color-${item.color || 'neutral'}`}>{item.type === 'color' && <i aria-hidden="true" />}{item.value === 'black' ? 'No winning color' : item.value}</span>
              {item.selected && <span className="analysis-selected-badge">Selected prediction</span>}
              <strong>{percent(item.support)}</strong><span>Historical support</span>
              {item.support !== null && <meter min="0" max="100" value={item.support} aria-label={`${item.value}: ${item.description}`} />}
              <p>{item.description}</p><small>{item.count} of {item.sampleSize} valid draws</small>
              {item.sampleSize < 20 && <small className="analysis-limited">Limited data — interpret cautiously</small>}
            </article>)}</div>
            <p className="analysis-explanation">Individual number or color values are not the combined chance of a multi-pick winning. High historical support does not establish a future advantage.</p>
          </>}
    </article>
    {selected && <article className="content-card"><span className="overline">RECENT PREDICTION RESULTS</span><h2>How this market has performed</h2><div className="analysis-metrics"><div><strong>{percent(selected.recentWinRate)}</strong><span>Historical win rate</span></div><div><strong>{selected.wins} / {selected.losses}</strong><span>Wins / losses</span></div><div><strong>{selected.settled}</strong><span>Settled picks in {selected.historyDraws} draws</span></div></div><div className="analysis-results" aria-label="Latest settled results, newest first">{selected.recentResults.map((outcome, index) => <span className={`outcome-badge ${outcome.toLowerCase()}`} key={index}>{outcome}</span>)}</div><p className="analysis-explanation">Newest result first. Skipped picks are excluded from win rate. These results cover published picks, not a replay of the current selection.</p></article>}
  </section>;
}
