import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';

const HISTORY_API = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';
const CLOCK_API = import.meta.env.VITE_CLOCK_API_URL || HISTORY_API.replace(/\/public-history(?:\?.*)?$/, '/public-clock');
const LIVE_PREDICTION_API = import.meta.env.VITE_LIVE_PREDICTION_API_URL || HISTORY_API.replace(/\/public-history(?:\?.*)?$/, '/public-current-prediction');
const games = [
  { id: 'betzero', name: 'BetZero', detail: 'Four-number set. A win means none of the selected numbers appear.' },
  { id: 'rainbow', name: 'Rainbow Color', detail: 'One color pick, graded by the draw’s color result.' },
  { id: 'totalColor', name: 'Total Color (3-way)', detail: 'Two target colors and one eliminated color.' },
  { id: 'totalColor2', name: 'Total Color (2-way)', detail: 'Two selected colors.' },
  { id: 'hilo', name: 'High / Low', detail: 'A prediction on the draw total range.' },
  { id: 'unified', name: 'Unified', detail: 'One selected pick from the available markets.' },
];


function OwnerTools({ onSession }) {
  const [unlocked, setUnlocked] = useState(false);
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState('trial');
  const [months, setMonths] = useState('1');
  const [gamesSelected, setGamesSelected] = useState(['betzero']);
  const [notice, setNotice] = useState('');
  const [users, setUsers] = useState([]);
  const [resettingStats, setResettingStats] = useState(false);
  useEffect(() => {
    apiRequest('/admin/preview')
      .then(plan => { setUnlocked(true); onSession('admin', plan); })
      .catch(() => apiRequest('/auth/me')
        .then(() => onSession('account', null))
        .catch(() => onSession('', null)));
  }, []);
  async function login(event) {
    event.preventDefault();
    try { await apiRequest('/admin/session', { method: 'POST', body: JSON.stringify({ key }) }); window.location.reload(); }
    catch (error) { setNotice(error.message); }
  }
  async function loadUsers() {
    try { const result = await apiRequest('/admin/users'); setUsers(result.users); }
    catch (error) { setNotice(error.message); }
  }
  async function approve(event) {
    event.preventDefault();
    try {
      const result = await apiRequest('/admin/approve', { method: 'POST', body: JSON.stringify({ email, tier, months, games: gamesSelected }) });
      setNotice(`${result.user.email} approved for ${tier}.`); loadUsers();
    } catch (error) { setNotice(error.message); }
  }
  async function preview(previewTier) {
    try { const result = await apiRequest('/admin/preview', { method: 'POST', body: JSON.stringify({ tier: previewTier, games: gamesSelected }) }); setNotice(`Preview mode: ${previewTier}. The prediction feed now uses that plan.`); onSession('admin', { tier: result.tier, games: result.games }); }
    catch (error) { setNotice(error.message); }
  }
  async function logout() {
    try { await apiRequest('/admin/logout', { method: 'POST' }); }
    catch { /* Reload to re-check the cookie session if the API is unavailable. */ }
    finally { window.location.reload(); }
  }
  async function resetMarketStats() {
    if (!window.confirm('Start a fresh max-loss tracking period now? Existing prediction history will be kept.')) return;
    setResettingStats(true);
    try {
      const result = await apiRequest('/admin/reset-market-stats', { method: 'POST' });
      setNotice(`Max-loss tracking restarted ${new Date(result.resetAt).toLocaleString()}. Previous history is preserved.`);
    } catch (error) { setNotice(error.message); }
    finally { setResettingStats(false); }
  }
  if (!unlocked) return <section className="content-card owner-tools"><h2>Owner tools</h2><p>Sign in with the server-side admin key to approve accounts or preview each plan. This key must never be placed in website code.</p><form className="auth-form" onSubmit={login}><label htmlFor="owner-key">Site admin key</label><input id="owner-key" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" required /><button className="btn btn-secondary">Unlock owner tools</button>{notice && <p role="status">{notice}</p>}</form></section>;
  return <section className="content-card owner-tools"><div className="prediction-section-heading"><div><span className="overline">OWNER CONTROLS</span><h2>Approvals &amp; plan preview</h2></div><button className="btn btn-secondary" type="button" onClick={logout}>End owner session</button></div><p>Preview mode changes only this owner session. Approvals change the selected user account.</p><div className="owner-preview-actions"><button className="btn btn-secondary" onClick={() => preview('trial')}>Preview Free Trial</button><button className="btn btn-secondary" onClick={() => preview('premium')}>Preview Premium</button><button className="btn btn-primary" onClick={() => preview('elite')}>Preview Elite</button></div><div className="owner-stats-reset"><div><h3>Prediction statistics</h3><p>Start max-loss tracking from zero while keeping all existing prediction history.</p></div><button className="btn btn-secondary" type="button" onClick={resetMarketStats} disabled={resettingStats}>{resettingStats ? 'Restarting…' : 'Reset max-loss tracking'}</button></div><form className="auth-form" onSubmit={approve}><h3>Manually approve an account</h3><label htmlFor="approval-email">Registered account email</label><input id="approval-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /><label htmlFor="approval-tier">Plan</label><select id="approval-tier" value={tier} onChange={(event) => setTier(event.target.value)}><option value="trial">Free Trial</option><option value="premium">Premium</option><option value="elite">Elite</option></select><label htmlFor="approval-months">Duration (months)</label><input id="approval-months" type="number" min="1" max="12" value={months} onChange={(event) => setMonths(event.target.value)} /><fieldset className="premium-game-picker"><legend>Premium games / preview selection</legend>{games.map(game => <label key={game.id}><input type="checkbox" checked={gamesSelected.includes(game.id)} onChange={() => setGamesSelected(current => current.includes(game.id) ? current.filter(id => id !== game.id) : [...current, game.id])} /><span>{game.name}</span></label>)}</fieldset><button className="btn btn-primary">Save manual approval</button><button className="btn btn-secondary" type="button" onClick={loadUsers}>Refresh account list</button>{notice && <p role="status">{notice}</p>}</form>{users.length > 0 && <div className="owner-user-list"><h3>Accounts</h3>{users.map(user => <p key={user.email}><strong>{user.email}</strong> · {user.plan?.tier || 'trial'} · {user.expiresAt > Date.now() ? new Date(user.expiresAt).toLocaleDateString() : 'expired / trial'}</p>)}</div>}</section>;
}

function formatCountdown(seconds) {
  if (seconds === null) return '--:--';
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function SummaryModelBadge({ label }) {
  if (!['ENTER', 'HOLD', 'LEARNING'].includes(label)) return null;
  return <span className={`summary-model-badge summary-model-${label.toLowerCase()}`} aria-label={`Summary model recommendation: ${label.toLowerCase()}`}>Summary · {label}</span>;
}

function getBallColor(number) {
  const value = Number(number);
  if (value === 49) return 'yellow';
  return value % 3 === 1 ? 'red' : value % 3 === 2 ? 'blue' : 'green';
}

function LiveMarketPick({ record, marketId }) {
  const predicted = record?.predicted || {};
  if (!record) return <span className="no-pick">Waiting for next prediction</span>;
  if (marketId === 'betzero') {
    return predicted.betzero?.length
      ? <span className="pick-balls">{predicted.betzero.map((number, index) => <span className={`ball-number ball-${getBallColor(number)}`} key={`${number}-${index}`}>{number}</span>)}</span>
      : <span className="no-pick">Waiting</span>;
  }
  if (marketId === 'rainbow') {
    return predicted.rainbow && predicted.rainbow !== 'SKIP'
      ? <span className={`color-name color-${String(predicted.rainbow).toLowerCase()}`}><i aria-hidden="true" />{predicted.rainbow}</span>
      : <span className="no-pick">Waiting</span>;
  }
  if (marketId === 'totalColor') {
    const pick = predicted.totalColor;
    return pick?.status === 'ACTIVE' && pick.topColors?.length
      ? <span className="live-market-picks"><span className="pick-colors">{pick.topColors.map((color) => <span className={`color-name color-${String(color).toLowerCase()}`} key={color}><i aria-hidden="true" />{color}</span>)}<span className="color-name color-black"><i aria-hidden="true" />NO WIN</span></span><small>Eliminated: {pick.noWinColor || '—'}</small></span>
      : <span className="no-pick">Waiting</span>;
  }
  if (marketId === 'totalColor2') {
    const colors = predicted.totalColor2?.top2 || [];
    return predicted.totalColor2?.status === 'ACTIVE' && colors.length
      ? <span className="pick-colors">{colors.map((color) => <span className={`color-name color-${String(color).toLowerCase()}`} key={color}><i aria-hidden="true" />{color}</span>)}</span>
      : <span className="no-pick">Waiting</span>;
  }
  if (marketId === 'hilo') {
    return predicted.hilo && predicted.hilo !== 'SKIP'
      ? <span className={`range-tag range-${String(predicted.hilo).toLowerCase()}`}>{predicted.hilo}</span>
      : <span className="no-pick">Waiting</span>;
  }
  if (marketId === 'unified') {
    const key = predicted.unified?.key;
    if (!key) return <span className="no-pick">No market selected</span>;
    const aliases = { u4: 'betzero', color: 'rainbow', sum: 'hilo' };
    const selectedMarket = aliases[key] || key;
    const selectedName = games.find((game) => game.id === selectedMarket)?.name || selectedMarket;
    return <span className="live-unified-pick"><small>Selected market: {selectedName}</small><LiveMarketPick record={record} marketId={selectedMarket} /></span>;
  }
  return <span className="no-pick">Waiting</span>;
}

export default function PredictionsPage() {
  const [sessionKind, setSessionKind] = useState('');
  const [accountPlan, setAccountPlan] = useState(null);
  const [previewPlan, setPreviewPlan] = useState(null);
  const [activeMarketId, setActiveMarketId] = useState('betzero');
  const [clock, setClock] = useState(null);
  const [marketPredictions, setMarketPredictions] = useState({});
  const [previousPrediction, setPreviousPrediction] = useState(null);
  const [now, setNow] = useState(Date.now());
  const secondsLeft = clock
    ? Math.max(0, Number(clock.timeLeftSeconds) - Math.floor((now - clock.receivedAt) / 1000))
    : null;

  useEffect(() => {
    let active = true;
    async function refreshClock() {
      try {
        const response = await fetch(CLOCK_API, { cache: 'no-store' });
        if (!response.ok) throw new Error('Clock unavailable');
        const payload = await response.json();
        if (active && Number.isFinite(Number(payload.timeLeftSeconds)) && payload.drawId) {
          setClock({ ...payload, receivedAt: Date.now() });
        }
      } catch {
        if (active) setClock((current) => current && Date.now() - current.receivedAt < 15000 ? current : null);
      }
    }
    refreshClock();
    const clockPoll = window.setInterval(refreshClock, 2500);
    const displayTick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      window.clearInterval(clockPoll);
      window.clearInterval(displayTick);
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest('/admin/preview')
      .then(plan => { if (active) { setSessionKind('admin'); setPreviewPlan(plan); setAccountPlan(null); } })
      .catch(() => apiRequest('/auth/me')
        .then(result => { if (active) { setSessionKind('account'); setPreviewPlan(null); setAccountPlan(result.account?.plan || null); } })
        .catch(() => { if (active) { setSessionKind(''); setPreviewPlan(null); setAccountPlan(null); } }));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshPrediction() {
      const plan = previewPlan || accountPlan;
      const markets = plan?.tier === 'elite' ? games.map(game => game.id) : plan?.tier === 'premium' ? [...new Set(plan.games || [])] : [activeMarketId];
      try {
        const results = await Promise.all(markets.map(async market => {
          const predictionUrl = new URL(LIVE_PREDICTION_API, window.location.href);
          predictionUrl.searchParams.set('market', market);
          const response = await fetch(predictionUrl, { cache: 'no-store', credentials: 'include' });
          if (!response.ok) throw new Error('Prediction feed unavailable');
          return [market, await response.json()];
        }));
        if (active) {
          setMarketPredictions(Object.fromEntries(results.map(([market, payload]) => [market, payload.prediction || null])));
          setPreviousPrediction(results[0]?.[1]?.previous || null);
        }
      } catch {
        if (active) { setMarketPredictions({}); setPreviousPrediction(null); }
      }
    }
    refreshPrediction();
    const predictionPoll = window.setInterval(refreshPrediction, 2500);
    return () => {
      active = false;
      window.clearInterval(predictionPoll);
    };
  }, [sessionKind, accountPlan, previewPlan, activeMarketId]);

  const currentPrediction = Object.values(marketPredictions).find(record => record && clock?.drawId === record.drawId) || null;
  const activeGame = games.find(game => game.id === activeMarketId) || games[0];
  const activeMarketPrediction = clock?.drawId === marketPredictions[activeGame.id]?.drawId ? marketPredictions[activeGame.id] : null;
  const activeMarketHasAccess = previewPlan?.tier === 'elite' || accountPlan?.tier === 'elite' || (previewPlan?.tier === 'premium' && previewPlan.games.includes(activeGame.id)) || (accountPlan?.tier === 'premium' && accountPlan.games.includes(activeGame.id));
  const activeMarketReveal = Boolean(activeMarketPrediction && activeMarketHasAccess);
  return (
    <main className="page-wrap prediction-page">
      <section className="page-intro prediction-intro">
        <span className="overline">BALLS49 · LIVE PICKS</span>
        <h1>Predictions for the next draw.</h1>
        <p>Current picks for your approved plan appear here. Try one market on the separate Free Trial page, revealed during the final 10 seconds.</p>
      </section>

      <section className="prediction-countdown" aria-label="Time remaining until the next prediction">
        <div className="countdown-copy"><span className="overline">LIVE DRAW CLOCK</span><strong>Time left for the next prediction</strong><span>{clock ? `Draw #${clock.drawId}` : 'Waiting for the live clock from the bot…'}</span></div>
        <div className="countdown-display" aria-live="off">{formatCountdown(secondsLeft)}</div>
        <span className={`countdown-live${clock && now - clock.receivedAt < 15000 ? ' is-live' : ''}`}><i />{clock && now - clock.receivedAt < 15000 ? 'LIVE' : 'CONNECTING'}</span>
      </section>

      <section className="prediction-access-state" aria-label="Current access status">
        <span className="access-state-icon" aria-hidden="true">◉</span>
        <div><strong>{previewPlan?.tier ? `Owner preview: ${previewPlan.tier}` : accountPlan?.tier ? `${accountPlan.tier} plan` : 'Plan access'}</strong><p>{(previewPlan?.tier || accountPlan?.tier) === 'elite' ? 'All six markets are available in this plan.' : (previewPlan?.tier || accountPlan?.tier) === 'premium' ? `Approved markets: ${(previewPlan?.games || accountPlan?.games || []).map(id => games.find(game => game.id === id)?.name || id).join(', ') || 'none'}.` : 'Your Free Trial is on its own page, with one selected market revealed in the final 10 seconds.'}</p></div>
        <a className="btn btn-secondary" href="pricing.html">Compare plans</a>
      </section>

      <details className="owner-tools-disclosure"><summary>Site owner tools</summary><OwnerTools onSession={(kind, plan) => { setSessionKind(kind); setPreviewPlan(plan || null); if (kind !== 'account') setAccountPlan(null); }} /></details>

      {(!accountPlan || accountPlan.tier === 'trial') && !previewPlan && <p className="trial-page-link"><a className="btn btn-secondary" href="free-trial.html">Open the Free Trial page</a></p>}

      <section className="prediction-games-section" aria-labelledby="available-games-title">
        <div className="prediction-section-heading">
          <div><span className="overline">SIX MARKETS</span><h2 id="available-games-title">Current prediction{currentPrediction ? ` · Draw #${currentPrediction.drawId}` : ''}</h2></div>
          <a className="text-link" href="guide.html">Read the market guide <span aria-hidden="true">→</span></a>
        </div>
        <div className="prediction-market-browser">
          <div className="prediction-market-tabs" role="tablist" aria-label="Choose a prediction market" aria-orientation="vertical" onKeyDown={event => {
            if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
            const nextIndex = (games.findIndex(game => game.id === activeMarketId) + direction + games.length) % games.length;
            setActiveMarketId(games[nextIndex].id);
            event.currentTarget.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
          }}>
            {games.map((game, index) => {
              const hasAccess = previewPlan?.tier === 'elite' || accountPlan?.tier === 'elite' || (previewPlan?.tier === 'premium' && previewPlan.games.includes(game.id)) || (accountPlan?.tier === 'premium' && accountPlan.games.includes(game.id));
              const selected = game.id === activeGame.id;
              return <button className={`prediction-market-tab${selected ? ' is-active' : ''}`} id={`market-tab-${game.id}`} type="button" role="tab" aria-selected={selected} aria-controls="prediction-market-panel" tabIndex={selected ? 0 : -1} key={game.id} onClick={() => setActiveMarketId(game.id)}><span className="market-tab-index">{String(index + 1).padStart(2, '0')}</span><span className="market-tab-copy"><strong>{game.name}</strong><small>{hasAccess ? 'Included in your plan' : `Premium market`}</small></span><span className={`market-tab-state${hasAccess ? ' is-unlocked' : ''}`} aria-label={hasAccess ? 'Included' : 'Locked'}>{hasAccess ? '✓' : '›'}</span></button>;
            })}
          </div>
          <article className="prediction-game-card prediction-market-panel" id="prediction-market-panel" role="tabpanel" aria-labelledby={`market-tab-${activeGame.id}`}>
            <div className="prediction-game-heading"><span className="prediction-game-icon" aria-hidden="true">✦</span><span className={`locked-label${activeMarketHasAccess ? ' prediction-active-label' : ''}`}>{activeMarketHasAccess ? 'YOUR PLAN' : 'PREMIUM ACCESS'}</span></div>
            <h3>{activeGame.name}</h3>
            <p>{activeGame.detail}</p>
            <div className={`live-prediction-value${activeMarketReveal ? ' is-revealed' : ' is-hidden'}`}>
              {activeMarketReveal
                ? <LiveMarketPick record={activeMarketPrediction} marketId={activeGame.id} />
                : <span className="trial-pick-message">{activeMarketHasAccess ? 'No prediction is available for this market yet. It will appear here when the bot publishes one.' : previewPlan?.tier === 'trial' || accountPlan?.tier === 'trial' ? 'Your trial pick is on the Free Trial page' : 'Unlock this market with Premium or Elite'}</span>}
            </div>
            {activeMarketReveal && <SummaryModelBadge label={activeMarketPrediction.summaryLabel} />}
            {activeMarketReveal && activeMarketPrediction.marketStats && (
              <div className="prediction-market-stats" aria-label={`${activeGame.name} step and losing streak statistics`}>
                <div><span>Current step</span><strong>{activeMarketPrediction.marketStats.step > 0 ? `Step ${activeMarketPrediction.marketStats.step}` : '—'}</strong></div>
                <div><span>Max losing streak · tracking period</span><strong>{activeMarketPrediction.marketStats.maxLosingStreak} {activeMarketPrediction.marketStats.maxLosingStreak === 1 ? 'loss' : 'losses'}</strong></div>
              </div>
            )}
            <div className="game-last-result">
              <div className="game-last-result-label"><span>LAST DRAW{previousPrediction ? ` · #${previousPrediction.drawId}` : ''}</span><small>Previous pick</small></div>
              <div className="game-last-pick"><LiveMarketPick record={previousPrediction} marketId={activeGame.id} /></div>
              <span className={`outcome-badge ${String(previousPrediction?.result?.[activeGame.id] || 'pending').toLowerCase()}`}>{previousPrediction?.result?.[activeGame.id] || 'WAITING'}</span>
            </div>
          </article>
        </div>
      </section>

      <aside className="prediction-responsibility"><strong>Predictions are uncertain.</strong> Review the public track record, make your own decisions, and bet responsibly.</aside>
    </main>
  );
}
