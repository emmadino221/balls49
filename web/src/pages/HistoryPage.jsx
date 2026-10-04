import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PAGE_SIZE = 200;
const HISTORY_API = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';

const markets = [
  { id: 'betzero', label: 'BetZero', resultKey: 'betzero' },
  { id: 'bet49', label: 'Bet49', resultKey: 'bet49' },
  { id: 'rainbow', label: 'Rainbow', resultKey: 'rainbow' },
  { id: 'totalColor', label: 'Total Color 3-way', resultKey: 'totalColor' },
  { id: 'totalColor2', label: 'Total Color 2-way', resultKey: 'totalColor2' },
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
  return <span className={`color-name color-${safeColor}`}><i aria-hidden="true" />{color}</span>;
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
    const colors = predicted.totalColor?.topColors || [];
    return predicted.totalColor?.status === 'ACTIVE' && colors.length
      ? <span className="pick-colors">{colors.map((color) => <ColorTag key={color} color={color} />)}<span className="color-name color-black"><i aria-hidden="true" />NO WIN</span></span>
      : <NoPick />;
  }
  if (market.id === 'totalColor2') {
    const colors = predicted.totalColor2?.top2 || [];
    return predicted.totalColor2?.status === 'ACTIVE' && colors.length
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
  const [generatedAt, setGeneratedAt] = useState(null);
  const [marketFilter, setMarketFilter] = useState('all');
  const [drawRange, setDrawRange] = useState('100');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const silentRefreshInFlight = useRef(false);

  const loadHistory = useCallback(async ({ offset = 0, append = false, silent = false } = {}) => {
    if (silent && silentRefreshInFlight.current) return;
    if (silent) silentRefreshInFlight.current = true;
    if (!silent) {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
    }
    if (!silent) setError('');
    try {
      const limit = drawRange === 'all' ? PAGE_SIZE : Number(drawRange);
      const response = await fetch(`${HISTORY_API}?limit=${limit}&offset=${offset}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`History request failed (${response.status}).`);
      const payload = await response.json();
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
      setGeneratedAt(payload.generatedAt || null);
    } catch (err) {
      if (!silent) setError('The history service could not be reached. Start the Balls49 bot and collector, then try again.');
    } finally {
      if (silent) silentRefreshInFlight.current = false;
      else {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [drawRange]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
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

  return (
    <main className="page-wrap history-page">
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
