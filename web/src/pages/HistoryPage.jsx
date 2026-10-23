import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TotalColorPick from '../components/TotalColorPick.jsx';
import { apiRequest } from '../auth.js';

const PAGE_SIZE = 200;
const HISTORY_API = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';

const markets = [
  { id: 'betzero', label: 'BetZero', resultKey: 'betzero' },
  { id: 'bet49', label: 'Bet49', resultKey: 'bet49' },
  { id: 'rainbow', label: 'Rainbow', resultKey: 'rainbow' },
  { id: 'totalColor', label: 'Total Color 3-way', resultKey: 'totalColor' },
  { id: 'totalColor2', label: 'Total Color 2-way', resultKey: 'totalColor2' },
  { id: 'totalColor1', label: 'Winning Color', resultKey: 'totalColor1' },
  { id: 'hilo', label: 'High / Low', resultKey: 'hilo' },
  { id: 'unified', label: 'Unified', resultKey: 'unified' },
];

function getBallColor(number) {
  const value = Number(number);
  if (value === 49) return 'yellow';
  return value % 3 === 1 ? 'red' : value % 3 === 2 ? 'blue' : 'green';
}

function NoPick({ children = 'No pick' }) {
  return <span className="no-pick">{children}</span>;
}

function BallChip({ number }) {
  return <span className={`ball-number ball-${getBallColor(number)}`}>{number}</span>;
}

function ColorTag({ color }) {
  const safeColor = ['red', 'blue', 'green', 'yellow', 'black'].includes(String(color).toLowerCase())
    ? String(color).toLowerCase()
    : 'neutral';
  return <span className={`color-name color-${safeColor}`}><i aria-hidden="true" />{safeColor === 'black' ? 'No winning color' : color}</span>;
}

function MarketPick({ record, market }) {
  const predicted = record.predicted || {};
  if (market.id === 'betzero') {
    return predicted.betzero?.length
      ? <span className="pick-balls">{predicted.betzero.map((number, index) => <BallChip key={`${number}-${index}`} number={number} />)}</span>
      : <NoPick />;
  }
  if (market.id === 'bet49') {
    const number = predicted.bet49;
    return Number.isInteger(Number(number)) && Number(number) >= 1 && Number(number) <= 49
      ? <BallChip number={Number(number)} />
      : <NoPick />;
  }
  if (market.id === 'rainbow') {
    return predicted.rainbow && predicted.rainbow !== 'SKIP' ? <ColorTag color={predicted.rainbow} /> : <NoPick />;
  }
  if (market.id === 'totalColor') {
    return <TotalColorPick pick={predicted.totalColor} />;
  }
  if (market.id === 'totalColor2') {
    const colors = predicted.totalColor2?.top2 || [];
    return predicted.totalColor2?.status === 'ACTIVE' && colors.length
      ? <span className="pick-colors">{colors.map((color) => <ColorTag key={color} color={color} />)}</span>
      : <NoPick />;
  }
  if (market.id === 'totalColor1') {
    const colors = predicted.totalColor1?.top1 || [];
    return predicted.totalColor1?.status === 'ACTIVE' && colors.length
      ? <span className="pick-colors">{colors.map((color) => <ColorTag key={color} color={color} />)}</span>
      : <NoPick />;
  }
  if (market.id === 'hilo') {
    const range = predicted.hilo;
    return range && range !== 'SKIP'
      ? <span className={`range-tag range-${String(range).toLowerCase()}`}>{range}</span>
      : <NoPick />;
  }
  if (market.id === 'unified') {
    if (!predicted.unified?.key) return <NoPick>None selected</NoPick>;
    const marketAliases = { u4: 'betzero', color: 'rainbow', sum: 'hilo' };
    const sourceId = marketAliases[predicted.unified.key] || predicted.unified.key;
    const sourceMarket = markets.find((item) => item.id === sourceId);
    return sourceMarket
      ? <span className="unified-pick"><span>{sourceMarket.label}</span><MarketPick record={record} market={sourceMarket} /></span>
      : <NoPick />;
  }
  return <NoPick />;
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function getOutcome(record, market) {
  return record.result?.[market.resultKey] || (record.status === 'PENDING' ? 'PENDING' : 'SKIP');
}

function getSummaryLabel(record, marketId) {
  let sourceMarket = marketId;
  if (marketId === 'unified') {
    const key = record.predicted?.unified?.key;
    sourceMarket = ({ u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' })[key] || 'unified';
  }
  const label = record.summaryModel?.[sourceMarket];
  return ['ENTER', 'HOLD', 'LEARNING'].includes(label) ? label : null;
}

export default function HistoryPage() {
  const [predictions, setPredictions] = useState([]);
  const [total, setTotal] = useState(0);
  const [rangeStreaks, setRangeStreaks] = useState({});
  const [streakDrawCount, setStreakDrawCount] = useState(0);
  const [streakResetAt, setStreakResetAt] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [resettingStreaks, setResettingStreaks] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  useEffect(() => {
    let active = true;
    apiRequest('/admin/preview').then(() => { if (active) setIsOwner(true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [marketFilter, setMarketFilter] = useState('all');
  const [drawRange, setDrawRange] = useState('100');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const silentRefreshInFlight = useRef(false);
  const historyRequestId = useRef(0);

  const loadHistory = useCallback(async ({ offset = 0, append = false, silent = false } = {}) => {
    if (silent && silentRefreshInFlight.current) return;
    const requestId = ++historyRequestId.current;
    if (silent) silentRefreshInFlight.current = true;
    if (!silent) {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
    }
    if (!silent) setError('');
    try {
      const limit = drawRange === 'all' ? PAGE_SIZE : Number(drawRange);
      const response = await fetch(`${HISTORY_API}?limit=${limit}&offset=${offset}&range=${drawRange}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`History request failed (${response.status}).`);
      const payload = await response.json();
      if (requestId !== historyRequestId.current) return;
      setError('');
      const next = Array.isArray(payload.predictions) ? payload.predictions : [];
      setPredictions((current) => {
        if (append) return [...current, ...next];
        if (silent && drawRange === 'all') {
          const latestIds = new Set(next.map((record) => String(record.drawId)));
          const combined = [...next, ...current.filter((record) => !latestIds.has(String(record.drawId)))];
          return [...new Map(combined.map((record) => [String(record.drawId), record])).values()];
        }
        return next;
      });
      setTotal(Number(payload.total) || 0);
      setRangeStreaks(payload.worstLosingStreaks || {});
      setStreakDrawCount(Number(payload.streakDrawCount) || 0);
      setStreakResetAt(payload.historyStreakResetAt || null);
      setGeneratedAt(payload.generatedAt || null);
    } catch (err) {
      if (!silent && requestId === historyRequestId.current) setError('The history service could not be reached. Start the Balls49 bot and collector, then try again.');
    } finally {
      if (silent) silentRefreshInFlight.current = false;
      if (requestId === historyRequestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [drawRange]);

  useEffect(() => {
    setRangeStreaks(Object.fromEntries(markets.map(market => [market.id, 0])));
    setStreakDrawCount(0);
    loadHistory();
    return () => { historyRequestId.current++; };
  }, [loadHistory]);
  useEffect(() => {
    const refreshInterval = window.setInterval(() => loadHistory({ silent: true }), 5000);
    return () => window.clearInterval(refreshInterval);
  }, [loadHistory]);

  const visiblePredictions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return predictions.filter((record) => !normalizedQuery || String(record.drawId).toLowerCase().includes(normalizedQuery));
  }, [predictions, query]);

  const visibleMarkets = marketFilter === 'all' ? markets : markets.filter((market) => market.id === marketFilter);
  const summary = useMemo(() => {
    const outcomes = visiblePredictions.flatMap((record) => visibleMarkets.map((market) => getOutcome(record, market)));
    const wins = outcomes.filter((outcome) => outcome === 'WIN').length;
    const losses = outcomes.filter((outcome) => outcome === 'LOSS').length;
    const settled = wins + losses;
    const skipped = outcomes.filter((outcome) => outcome === 'SKIP').length;
    const pending = outcomes.filter((outcome) => outcome === 'PENDING').length;
    return { wins, losses, settled, skipped, pending, rate: settled ? Math.round((wins / settled) * 100) : null };
  }, [visiblePredictions, visibleMarkets]);
  const marketStats = useMemo(() => visibleMarkets.map((market) => {
    const outcomes = visiblePredictions.map((record) => getOutcome(record, market));
    const wins = outcomes.filter((outcome) => outcome === 'WIN').length;
    const losses = outcomes.filter((outcome) => outcome === 'LOSS').length;
    const settled = wins + losses;
    return {
      ...market,
      wins,
      losses,
      skipped: outcomes.filter((outcome) => outcome === 'SKIP').length,
      pending: outcomes.filter((outcome) => outcome === 'PENDING').length,
      settled,
      rate: settled ? Math.round((wins / settled) * 100) : null,
    };
  }), [visiblePredictions, visibleMarkets]);

  async function resetHistoryStreaks() {
    if (!window.confirm('Restart only the history worst losing streak from the next validated draw? Saved results, global steps and extension progression will be kept.')) return;
    setResettingStreaks(true);
    setResetNotice('');
    try {
      const result = await apiRequest('/admin/reset-history-streaks', { method: 'POST' });
      setStreakResetAt(result.resetAt);
      setRangeStreaks(Object.fromEntries(markets.map(market => [market.id, 0])));
      setStreakDrawCount(0);
      setResetNotice('History streak tracking restarted. Counting begins with the next validated draw result.');
      await loadHistory();
    } catch (err) { setResetNotice(err.message); }
    finally { setResettingStreaks(false); }
  }

  return (
    <main className="page-wrap history-page">
      {isOwner && <section className="content-card owner-tools" aria-label="Owner history controls"><div className="owner-stats-reset"><div><span className="overline">OWNER CONTROL</span><h2>History streak tracking</h2><p>Restart only the worst losing streak statistic. All draw records, win rates and automation progression are preserved.</p></div><button className="btn btn-secondary" type="button" disabled={resettingStreaks} onClick={resetHistoryStreaks}>{resettingStreaks ? 'Restarting...' : 'Restart history streak tracking'}</button></div>{resetNotice && <p role="status">{resetNotice}</p>}</section>}
      <section className="history-hero">
        <div>
          <span className="overline">BALLS49 · TRANSPARENT TRACK RECORD</span>
          <h1>Prediction history</h1>
          <p>Review recorded picks beside the actual draw. Wins, losses, and skipped markets are included.</p>
          <div className="ball-color-legend" aria-label="Ball color key">
            <span className="legend-label">BALL COLORS</span>
            <ColorTag color="Red" /><ColorTag color="Blue" /><ColorTag color="Green" />
            <span className="legend-special">49 is yellow</span>
          </div>
        </div>
        <button className="btn btn-secondary history-refresh" type="button" onClick={() => loadHistory()} disabled={loading}>
          <span aria-hidden="true">↻</span> Refresh history
        </button>
      </section>

      <section className="history-summary" aria-label="History summary">
        <article className="summary-card"><span>Settled picks</span><strong>{summary.settled.toLocaleString()}</strong><small>Within loaded history</small></article>
        <article className="summary-card"><span>Wins</span><strong className="summary-win">{summary.wins.toLocaleString()}</strong><small>Recorded as wins</small></article>
        <article className="summary-card"><span>Losses</span><strong className="summary-loss">{summary.losses.toLocaleString()}</strong><small>Recorded as losses</small></article>
        <article className="summary-card"><span>Win rate</span><strong>{summary.rate === null ? '—' : `${summary.rate}%`}</strong><small>Wins ÷ settled picks</small></article>
      </section>

      <section className="market-analytics" aria-labelledby="market-analytics-title">
        {streakResetAt && <p role="status">Worst losing streak tracking restarted {new Date(streakResetAt).toLocaleString()}. Only newer draws validated after this reset count toward streaks. Earlier results remain in history.</p>}
        <div className="analytics-heading">
          <div><span className="overline">RESULTS BY MARKET</span><h2 id="market-analytics-title">Market performance</h2></div>
          <p>{drawRange === 'all' ? `All time · ${predictions.length.toLocaleString()} of ${total.toLocaleString()} loaded` : `Last ${drawRange} draws`}{query.trim() ? ' · Search applied' : ''}{marketFilter !== 'all' ? ' · Market filter applied' : ''}</p>
        </div>
        <div className="market-analytics-grid">
          {marketStats.map((market) => {
            const winWidth = market.settled ? (market.wins / market.settled) * 100 : 0;
            return (
              <article className="market-analytics-card" key={market.id}>
                <div className="analytics-card-top"><strong>{market.label}</strong><span>{market.rate === null ? '—' : `${market.rate}%`}</span></div>
                <div className="analytics-progress" role="img" aria-label={`${market.wins} wins and ${market.losses} losses`}>
                  <span className="analytics-progress-win" style={{ width: `${winWidth}%` }} />
                  <span className="analytics-progress-loss" style={{ width: `${market.settled ? 100 - winWidth : 0}%` }} />
                </div>
                <div className="analytics-counts"><span><i className="analytics-dot win" />{market.wins} wins</span><span><i className="analytics-dot loss" />{market.losses} losses</span><span>{market.skipped} skipped</span>{market.pending > 0 && <span>{market.pending} pending</span>}</div>
                <small>{market.settled.toLocaleString()} settled picks</small>
                <p><strong>Worst losing streak{streakResetAt ? ' since reset' : ''}: {rangeStreaks[market.id] ?? '—'}</strong></p>
                <small>Across {streakDrawCount.toLocaleString()} draws{streakResetAt ? ' since reset' : ''} in the selected range. Skips do not reset a streak. Draw ID search does not change this statistic.</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="history-panel">
        <div className="history-toolbar">
          <div>
            <h2>Resolved draws</h2>
            <p>{total.toLocaleString()} resolved draws · {summary.skipped.toLocaleString()} skipped picks in loaded results</p>
          </div>
          <div className="history-controls">
            <label className="history-search">
              <span className="sr-only">Search by draw ID</span>
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search draw ID" inputMode="numeric" />
            </label>
            <label className="history-select-label">
              <span className="sr-only">Filter by number of draws</span>
              <select value={drawRange} onChange={(event) => setDrawRange(event.target.value)}>
                <option value="10">Last 10 draws</option>
                <option value="50">Last 50 draws</option>
                <option value="100">Last 100 draws</option>
                <option value="200">Last 200 draws</option>
                <option value="500">Last 500 draws</option>
                <option value="1000">Last 1,000 draws</option>
                <option value="all">All time</option>
              </select>
            </label>
            <label className="history-select-label">
              <span className="sr-only">Filter by market</span>
              <select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)}>
                <option value="all">All markets</option>
                {markets.map((market) => <option key={market.id} value={market.id}>{market.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {generatedAt && <p className="history-updated">Data refreshed {formatDate(generatedAt)}</p>}

        {error && (
          <div className="history-state history-error" role="alert">
            <span className="state-icon" aria-hidden="true">!</span>
            <div><strong>History is temporarily unavailable</strong><p>{error}</p></div>
            <button type="button" className="text-button" onClick={() => loadHistory()}>Try again</button>
          </div>
        )}

        {loading && !predictions.length && !error && <div className="history-state">Loading prediction history…</div>}

        {!loading && !error && predictions.length === 0 && (
          <div className="history-state history-empty">
            <span className="empty-icon" aria-hidden="true">▤</span>
            <strong>No resolved draws yet</strong>
            <p>Completed draw results will appear here after the bot records them.</p>
          </div>
        )}

        {!error && visiblePredictions.length > 0 && (
          <div className="history-list">
            {visiblePredictions.map((record) => (
              <article className="history-draw" key={record.drawId}>
                <header className="draw-heading">
                  <div><span className="draw-id-label">DRAW</span><h3>#{record.drawId}</h3>{record.status === 'PENDING' && <span className="draw-pending-label">LIVE · PENDING</span>}</div>
                  <time>{formatDate(record.drawDate)}</time>
                </header>
                <div className="actual-result">
                  <div className="actual-label"><span>Actual draw</span><strong>{record.status === 'PENDING' ? 'Awaiting draw result' : `${record.result?.total ?? '—'} total · ${record.result?.range || '—'}`}</strong></div>
                  <div className="ball-list" aria-label={`Drawn balls: ${(record.result?.balls || []).join(', ')}`}>
                    {(record.result?.balls || []).map((ball, index) => <span key={`${ball}-${index}`} className={`ball-number ball-${getBallColor(ball)}`}>{ball}</span>)}
                    {!record.result?.balls?.length && <span className="no-balls">{record.status === 'PENDING' ? 'Numbers appear after the draw' : 'Result numbers unavailable'}</span>}
                  </div>
                </div>
                <div className="market-history-list">
                  {visibleMarkets.map((market) => {
                    const outcome = getOutcome(record, market);
                    const summaryLabel = getSummaryLabel(record, market.id);
                    return (
                      <div className="market-history-row" key={market.id}>
                        <div className="market-history-name"><strong>{market.label}</strong><div className="market-pick"><MarketPick record={record} market={market} /></div>{summaryLabel && <span className={`summary-model-badge summary-model-${summaryLabel.toLowerCase()}`}>Summary · {summaryLabel}</span>}</div>
                        <span className={`outcome-badge ${outcome.toLowerCase()}`}>{outcome}</span>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}

        {query && !loading && !error && predictions.length > 0 && visiblePredictions.length === 0 && (
          <div className="history-state">No draws match “{query}”. Try a different draw ID.</div>
        )}

        {!error && drawRange === 'all' && predictions.length < total && (
          <div className="history-load-more">
            <button className="btn btn-secondary" type="button" onClick={() => loadHistory({ offset: predictions.length, append: true })} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load older results'}
            </button>
          </div>
        )}
      </section>

      <p className="history-disclaimer">Historical outcomes don’t predict future results. Skipped picks are shown for transparency and excluded from the win-rate calculation.</p>
    </main>
  );
}
