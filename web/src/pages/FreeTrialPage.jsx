import React, { useEffect, useState } from 'react';

const HISTORY_API = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';
const CLOCK_API = import.meta.env.VITE_CLOCK_API_URL || HISTORY_API.replace(/\/public-history(?:\?.*)?$/, '/public-clock');
const PREDICTION_API = import.meta.env.VITE_LIVE_PREDICTION_API_URL || HISTORY_API.replace(/\/public-history(?:\?.*)?$/, '/public-current-prediction');
const markets = [
  { id: 'betzero', name: 'BetZero', help: 'Four-number set; the pick wins if none of those numbers appear.' },
  { id: 'bet49', name: 'Bet49', help: 'One number pick; it wins if the number appears in the next draw.' },
  { id: 'rainbow', name: 'Rainbow Color', help: 'One color prediction.' },
  { id: 'totalColor', name: 'Total Color (3-way)', help: 'Two target colors and one eliminated color.' },
  { id: 'totalColor2', name: 'Total Color (2-way)', help: 'Two selected colors.' },
  { id: 'hilo', name: 'High / Low', help: 'A prediction on the draw total range.' },
  { id: 'unified', name: 'Unified', help: 'The single pick chosen from the available markets.' },
];

function countdown(value) {
  if (value === null) return '--:--';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function Ball({ value }) {
  const n = Number(value);
  const color = n === 49 ? 'yellow' : n % 3 === 1 ? 'red' : n % 3 === 2 ? 'blue' : 'green';
  return <span className={`ball-number ball-${color}`}>{value}</span>;
}

function Pick({ record, market }) {
  if (!record) return <span className="no-pick">Waiting for the next prediction</span>;
  const pick = record.predicted || {};
  if (market === 'betzero') return pick.betzero?.length ? <span className="pick-balls">{pick.betzero.map((n, i) => <Ball key={`${n}-${i}`} value={n} />)}</span> : <span className="no-pick">No active pick this draw</span>;
  if (market === 'bet49') return Number.isInteger(Number(pick.bet49)) && Number(pick.bet49) >= 1 && Number(pick.bet49) <= 49 ? <Ball value={pick.bet49} /> : <span className="no-pick">No active pick this draw</span>;
  if (market === 'rainbow') return pick.rainbow && pick.rainbow !== 'SKIP' ? <span className={`color-name color-${String(pick.rainbow).toLowerCase()}`}><i />{pick.rainbow}</span> : <span className="no-pick">No active pick this draw</span>;
  if (market === 'hilo') return pick.hilo && pick.hilo !== 'SKIP' ? <span className={`range-tag range-${String(pick.hilo).toLowerCase()}`}>{pick.hilo}</span> : <span className="no-pick">No active pick this draw</span>;
  if (market === 'totalColor') {
    const item = pick.totalColor;
    return item?.status === 'ACTIVE' ? <span className="live-market-picks"><span className="pick-colors">{item.topColors.map(color => <span className={`color-name color-${String(color).toLowerCase()}`} key={color}><i />{color}</span>)}<span className="color-name color-black"><i />NO WIN</span></span><small>Eliminated: {item.noWinColor || '—'}</small></span> : <span className="no-pick">No active pick this draw</span>;
  }
  if (market === 'totalColor2') return pick.totalColor2?.status === 'ACTIVE' ? <span className="pick-colors">{pick.totalColor2.top2.map(color => <span className={`color-name color-${String(color).toLowerCase()}`} key={color}><i />{color}</span>)}</span> : <span className="no-pick">No active pick this draw</span>;
  if (market === 'unified') {
    const key = pick.unified?.key;
    if (!key) return <span className="no-pick">No unified pick this draw</span>;
    const aliases = { u4: 'betzero', color: 'rainbow', sum: 'hilo' };
    const source = aliases[key] || key;
    return <span className="live-unified-pick"><small>{markets.find(item => item.id === source)?.name || source}</small><Pick record={record} market={source} /></span>;
  }
  return <span className="no-pick">Waiting</span>;
}

function SummaryModelBadge({ label }) {
  if (!['ENTER', 'HOLD', 'LEARNING'].includes(label)) return null;
  return <span className={`summary-model-badge summary-model-${label.toLowerCase()}`} aria-label={`Summary model recommendation: ${label.toLowerCase()}`}>Summary · {label}</span>;
}

export default function FreeTrialPage() {
  const [selectedMarket, setSelectedMarket] = useState(() => {
    try { const saved = localStorage.getItem('balls49-trial-market'); return markets.some(item => item.id === saved) ? saved : 'betzero'; }
    catch { return 'betzero'; }
  });
  const [clock, setClock] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [now, setNow] = useState(Date.now());
  const secondsLeft = clock ? Math.max(0, Number(clock.timeLeftSeconds) - Math.floor((now - clock.receivedAt) / 1000)) : null;
  const revealOpen = secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 10;
  const activePrediction = prediction && String(prediction.drawId) === String(clock?.drawId) ? prediction : null;
  const activePredictionKey = activePrediction
    ? `${activePrediction.drawId}:${selectedMarket}:${JSON.stringify(activePrediction.predicted || {})}`
    : 'waiting';

  useEffect(() => {
    let active = true;
    async function refreshClock() {
      try {
        const response = await fetch(CLOCK_API, { cache: 'no-store' });
        if (!response.ok) throw new Error('clock unavailable');
        const value = await response.json();
        if (active && Number.isFinite(Number(value.timeLeftSeconds)) && value.drawId) setClock({ ...value, receivedAt: Date.now() });
      } catch { if (active) setClock(current => current && Date.now() - current.receivedAt < 15000 ? current : null); }
    }
    refreshClock();
    const poll = window.setInterval(refreshClock, 2500);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshPrediction() {
      try {
        const url = new URL(PREDICTION_API, window.location.href);
        url.searchParams.set('market', selectedMarket);
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error('prediction unavailable');
        const value = await response.json();
        if (active) { setPrediction(value.prediction || null); setPrevious(value.previous || null); }
      } catch { if (active) { setPrediction(null); setPrevious(null); } }
    }
    refreshPrediction();
    const poll = window.setInterval(refreshPrediction, 2000);
    return () => { active = false; window.clearInterval(poll); };
  }, [selectedMarket]);

  function changeMarket(value) {
    setSelectedMarket(value);
    try { localStorage.setItem('balls49-trial-market', value); } catch { /* Selection persistence is optional. */ }
  }

  return <main className="page-wrap prediction-page free-trial-page">
    <section className="page-intro prediction-intro"><span className="overline">BALLS49 · FREE TRIAL</span><h1>Try one market before the draw.</h1><p>Choose a market and see its prediction during the final 10 seconds. Your choice locks when that reveal window begins.</p></section>
    <section className="prediction-countdown" aria-label="Time remaining until the next draw"><div className="countdown-copy"><span className="overline">LIVE DRAW CLOCK</span><strong>Free Trial reveal countdown</strong><span>{clock ? `Draw #${clock.drawId}` : 'Waiting for the live clock from the bot…'}</span></div><div className="countdown-display" aria-live="off">{countdown(secondsLeft)}</div><span className={`countdown-live${clock && now - clock.receivedAt < 15000 ? ' is-live' : ''}`}><i />{clock && now - clock.receivedAt < 15000 ? 'LIVE' : 'CONNECTING'}</span></section>
    <section className="content-card free-trial-panel"><div className="prediction-section-heading"><div><span className="overline">ONE MARKET PER DRAW</span><h2>Choose your trial market</h2></div><a className="text-link" href="predictions.html#plans">Compare paid plans →</a></div><label className="free-trial-select-label" htmlFor="free-trial-market">Market</label><select id="free-trial-market" value={selectedMarket} onChange={event => changeMarket(event.target.value)} disabled={revealOpen}>{markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="free-trial-help">{markets.find(item => item.id === selectedMarket)?.help} {revealOpen ? 'Your selection is locked for this draw.' : 'Selection locks at 00:10.'}</p>
      <article className="prediction-game-card free-trial-result-card"><div className="prediction-game-heading"><span className="prediction-game-icon" aria-hidden="true">✦</span><span className={`locked-label${activePrediction && revealOpen ? ' prediction-active-label' : ''}`}>{activePrediction && revealOpen ? 'FREE PICK REVEALED' : 'YOUR FREE TRIAL PICK'}</span></div><h3>{markets.find(item => item.id === selectedMarket)?.name}</h3><div className={`live-prediction-value${activePrediction && revealOpen ? ' is-revealed' : ' is-hidden'}`}>{activePrediction && revealOpen ? <Pick key={activePredictionKey} record={activePrediction} market={selectedMarket} /> : <span className="trial-pick-message">{secondsLeft === null ? 'Waiting for the live countdown' : secondsLeft === 0 ? 'Draw closing · waiting for the next prediction' : `Prediction appears at 00:10 · ${countdown(secondsLeft)} remaining`}</span>}</div>{activePrediction && revealOpen && <SummaryModelBadge label={activePrediction.summaryLabel} />}<div className="game-last-result"><div className="game-last-result-label"><span>LAST DRAW{previous ? ` · #${previous.drawId}` : ''}</span><small>Previous pick</small></div><div className="game-last-pick"><Pick record={previous} market={selectedMarket} /></div><span className={`outcome-badge ${String(previous?.result?.[selectedMarket] || 'pending').toLowerCase()}`}>{previous?.result?.[selectedMarket] || 'WAITING'}</span></div></article>
    </section>
    <section className="free-trial-upgrade"><div><span className="overline">WANT EARLIER PICKS?</span><h2>Unlock predictions before the reveal window.</h2><p>Premium covers selected games. Elite includes all seven markets and Telegram access.</p></div><a className="btn btn-primary" href="predictions.html#plans">View plans</a></section>
  </main>;
}
