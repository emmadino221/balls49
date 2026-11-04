import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../auth.js';
import './betzero-lab.css';

const RANGE_OPTIONS = [10, 50, 100];
const STATUS_OPTIONS = ['ALL', 'WIN', 'LOSS', 'PENDING', 'SKIP', 'INVALID'];
const SEGMENTS = ['development', 'validation', 'final_test'];

function percentage(value, digits = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function StatusBadge({ value }) {
  const status = String(value || 'UNKNOWN').toUpperCase();
  return <span className={`betzero-status betzero-status-${status.toLowerCase().replaceAll('_', '-')}`}>{status}</span>;
}

function MetricCard({ label, value, note, tone }) {
  return <article className={`betzero-metric${tone ? ` is-${tone}` : ''}`}>
    <span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}
  </article>;
}

function OutcomeChart({ rows, title }) {
  const evaluated = rows.filter(row => row.status === 'WIN' || row.status === 'LOSS');
  let wins = 0;
  const points = evaluated.map((row, index) => {
    if (row.status === 'WIN') wins++;
    return { x: 36 + (index / Math.max(1, evaluated.length - 1)) * 664, y: 170 - (wins / (index + 1)) * 130 };
  });
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const rate = evaluated.length ? wins / evaluated.length : null;
  return <div className="betzero-chart-card">
    <div className="betzero-section-heading"><div><span className="overline">FORWARD RESULTS</span><h3>{title}</h3></div>
      <span className="betzero-chart-rate">{percentage(rate)} · {evaluated.length} evaluated</span></div>
    {evaluated.length
      ? <svg className="betzero-chart" viewBox="0 0 720 205" role="img"
        aria-label={`${title} cumulative win rate chart. Final rate ${percentage(rate)} over ${evaluated.length} evaluated predictions.`}>
        {[0, 0.5, 1].map(value => {
          const y = 170 - value * 130;
          return <g key={value}><line x1="36" x2="700" y1={y} y2={y} className="betzero-chart-grid" />
            <text x="0" y={y + 4} className="betzero-chart-label">{Math.round(value * 100)}%</text></g>;
        })}
        <path d={path} className="betzero-chart-line" />
        {points.length === 1 && <circle cx={points[0].x} cy={points[0].y} r="4" className="betzero-chart-dot" />}
        <text x="36" y="196" className="betzero-chart-label">Older</text>
        <text x="700" y="196" textAnchor="end" className="betzero-chart-label">Latest</text>
      </svg>
      : <p className="betzero-empty">No forward WIN/LOSS results are available for this range yet.</p>}
  </div>;
}

export default function BetZeroLabPage({ session }) {
  const [overview, setOverview] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [backtest, setBacktest] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [historyStrategyId, setHistoryStrategyId] = useState('all');
  const [historyStatus, setHistoryStatus] = useState('ALL');
  const [historyQuery, setHistoryQuery] = useState('');
  const [recentRange, setRecentRange] = useState(100);
  const [windowSize, setWindowSize] = useState('100');
  const [seed, setSeed] = useState('betzero-lab-v1');
  const [thresholdInput, setThresholdInput] = useState('3, 5, 7, 10');
  const [enabledInput, setEnabledInput] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestInFlight = useRef(false);

  const strategies = useMemo(() => Object.values(overview?.strategies || {}), [overview]);
  const selectedStrategy = strategies.find(strategy => strategy.id === selectedStrategyId) || strategies[0] || null;

  const loadOverview = useCallback(async (silent = false) => {
    if (!session?.admin || requestInFlight.current) return;
    requestInFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const next = await apiRequest('/admin/betzero-lab');
      setOverview(next);
      setHistoryRefreshKey(value => value + 1);
      setError('');
      const runId = selectedRunId || next.backtestRuns?.[0]?.runId || '';
      if (!selectedRunId && runId) setSelectedRunId(runId);
      if (runId) {
        const detail = await apiRequest(`/admin/betzero-lab/backtests?runId=${encodeURIComponent(runId)}&limit=1`);
        setBacktest(detail);
      } else {
        setBacktest(null);
      }
    } catch (loadError) {
      setError(loadError.message || 'The BetZero lab could not be loaded.');
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [selectedRunId, session?.admin]);

  useEffect(() => {
    if (!session?.admin || !overview) return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '500' });
    if (historyStrategyId !== 'all') params.set('strategyId', historyStrategyId);
    setHistoryLoading(true);
    setHistoryError('');
    apiRequest(`/admin/betzero-lab/predictions?${params}`, { signal: controller.signal })
      .then(result => setHistoryRecords(result.predictions))
      .catch(loadError => {
        if (loadError.name !== 'AbortError') setHistoryError(loadError.message || 'Prediction history could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [historyRefreshKey, historyStrategyId, overview, session?.admin]);

  useEffect(() => {
    if (!session?.admin) {
      setLoading(false);
      return undefined;
    }
    loadOverview();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadOverview(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadOverview, session?.admin]);

  useEffect(() => {
    if (!strategies.length) return;
    const selected = strategies.find(strategy => strategy.id === selectedStrategyId) || strategies[0];
    if (selected.id !== selectedStrategyId) setSelectedStrategyId(selected.id);
    setThresholdInput((selected.config?.alertThresholds || [3, 5, 7, 10]).join(', '));
    setEnabledInput(Boolean(selected.enabled));
  }, [strategies.length, selectedStrategyId]);

  const forwardRows = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return historyRecords.filter(row => {
      const matchesStatus = historyStatus === 'ALL' || row.status === historyStatus;
      const matchesQuery = !query || [row.targetDrawId, row.sourceDrawId, row.selections.join(' ')]
        .some(value => String(value).toLowerCase().includes(query));
      return matchesStatus && matchesQuery;
    });
  }, [historyQuery, historyStatus, historyRecords]);

  const chartRows = useMemo(() => (selectedStrategy?.last100 || []).slice()
    .reverse().filter(row => row.status === 'WIN' || row.status === 'LOSS').slice(-recentRange), [recentRange, selectedStrategy]);

  async function chooseBacktest(runId) {
    setSelectedRunId(runId);
    if (!runId) {
      setBacktest(null);
      return;
    }
    setBusy(true);
    setBusyAction('Loading saved backtest');
    setError('');
    try {
      const detail = await apiRequest(`/admin/betzero-lab/backtests?runId=${encodeURIComponent(runId)}&limit=1`);
      setBacktest(detail);
    } catch (loadError) {
      setError(loadError.message || 'The saved backtest could not be loaded.');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  }

  async function runBacktest(event) {
    event.preventDefault();
    setBusy(true);
    setBusyAction('Running backtest');
    setError('');
    setNotice('');
    try {
      const result = await apiRequest('/admin/betzero-lab/backtests', {
        method: 'POST',
        body: JSON.stringify({ window: windowSize, seed }),
      });
      setSelectedRunId(result.runId);
      const detail = await apiRequest(`/admin/betzero-lab/backtests?runId=${encodeURIComponent(result.runId)}&limit=1`);
      setBacktest(detail);
      const next = await apiRequest('/admin/betzero-lab');
      setOverview(next);
      setNotice(`Backtest completed · ${result.data.validDraws.toLocaleString()} valid historical draws · seed ${result.seed}.`);
    } catch (runError) {
      setError(runError.message || 'The backtest could not be completed.');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  }

  async function saveStrategyConfig(event) {
    event.preventDefault();
    if (!selectedStrategy) return;
    setBusy(true);
    setBusyAction('Saving configuration');
    setError('');
    setNotice('');
    try {
      const alertThresholds = thresholdInput.split(',').map(value => Number(value.trim()));
      const result = await apiRequest('/admin/betzero-lab/strategy-config', {
        method: 'POST',
        body: JSON.stringify({ strategyId: selectedStrategy.id, enabled: enabledInput, alertThresholds }),
      });
      setOverview(current => current ? {
        ...current,
        strategies: {
          ...current.strategies,
          [selectedStrategy.id]: { ...current.strategies[selectedStrategy.id], ...result.strategy },
        },
      } : current);
      setThresholdInput((result.strategy.config?.alertThresholds || []).join(', '));
      setEnabledInput(Boolean(result.strategy.enabled));
      setNotice(`${selectedStrategy.label} configuration saved. No production settings were changed.`);
    } catch (saveError) {
      setError(saveError.message || 'The strategy configuration could not be saved.');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  }

  if (session?.checking) return <main className="page-wrap betzero-lab-page"><section className="content-card" role="status">Checking owner session…</section></main>;
  if (!session?.admin) return <main className="page-wrap betzero-lab-page">
    <section className="betzero-access-card"><span className="overline">PRIVATE RESEARCH WORKSPACE</span>
      <h1>Owner sign-in required</h1><p>The experimental BetZero lab is restricted to authorized administrators.</p>
      <a className="btn btn-primary" href="predictions.html">Open owner controls</a>
    </section>
  </main>;

  const runResults = backtest?.results || [];
  const finalTestResults = runResults.filter(row => row.segment === 'final_test');
  const latestPredictions = (overview?.predictions || []).filter(row => row.strategyId === selectedStrategy?.id).slice(0, 5);
  const selectedRun = overview?.backtestRuns?.find(run => run.runId === selectedRunId);

  return <main className="page-wrap betzero-lab-page">
    <section className="betzero-hero">
      <div><span className="overline">OWNER-ONLY · ISOLATED RESEARCH</span>
        <h1>BetZero Strategy Lab</h1>
        <p>Experimental backtests and forward monitoring, kept separate from production picks and staking.</p></div>
      <button className="btn btn-secondary" type="button" onClick={() => loadOverview()} disabled={loading || busy}>
        {loading ? 'Refreshing…' : 'Refresh lab'}
      </button>
    </section>

    <div className="betzero-warning" role="note"><strong>EXPERIMENTAL — NOT FOR REAL-MONEY BETTING</strong>
      <span>Nothing here places bets, changes subscriber predictions, or affects production statistics.</span></div>
    {error && <div className="betzero-message is-error" role="alert">{error}</div>}
    {notice && <div className="betzero-message is-success" role="status">{notice}</div>}

    {loading && !overview && <section className="content-card" role="status">Loading isolated lab data…</section>}
    {overview && <>
      <section className="betzero-section">
        <div className="betzero-section-heading"><div><span className="overline">STRATEGY OVERVIEW</span><h2>Research status</h2></div>
          <span className="betzero-muted">{strategies.length} registered strategies</span></div>
        <div className="betzero-strategy-grid">
          {strategies.map(strategy => <article className="betzero-strategy-card" key={strategy.id}>
            <div className="betzero-card-top"><StatusBadge value={strategy.status} /><span>{strategy.enabled ? 'Enabled' : 'Disabled'}</span></div>
            <h3>{strategy.label}</h3>
            <p>{strategy.status === 'UNVERIFIED' ? strategy.missingInformation : strategy.description}</p>
            <div className="betzero-card-metrics">
              <span><small>Forward picks</small><strong>{strategy.totalPredictions ?? 0}</strong></span>
              <span><small>Win rate</small><strong>{percentage(strategy.winRate)}</strong></span>
              <span><small>Current / worst loss run</small><strong>{strategy.currentLosingStreak ?? 0} / {strategy.worstLosingStreak ?? 0}</strong></span>
            </div>
            <div className="betzero-card-footer"><span>Version {strategy.version}</span>
              {strategy.status === 'UNVERIFIED' && <span className="betzero-unverified-label">Rule not verified</span>}</div>
          </article>)}
        </div>
      </section>

      <section className="betzero-section">
        <div className="betzero-section-heading"><div><span className="overline">FORWARD MONITOR</span><h2>Live experimental predictions</h2></div>
          <span className="betzero-muted">Auto-refreshes every 30 seconds while visible</span></div>
        {selectedStrategy && <div className="betzero-forward-layout">
          <div className="betzero-forward-primary">
            <div className="betzero-forward-heading"><div><StatusBadge value={selectedStrategy.status} /><h3>{selectedStrategy.label}</h3></div>
              <span className="betzero-streak-indicator">Loss streak <strong>{selectedStrategy.currentLosingStreak ?? 0}</strong></span></div>
            <p>{selectedStrategy.status === 'UNVERIFIED' ? selectedStrategy.missingInformation : selectedStrategy.description}</p>
            <div className="betzero-prediction-list">
              {latestPredictions.length ? latestPredictions.map(prediction => <article className="betzero-prediction" key={prediction.predictionId}>
                <div><strong>Target #{prediction.targetDrawId}</strong><small>Source #{prediction.sourceDrawId} · {dateTime(prediction.predictedAt)}</small></div>
                <span className="betzero-selections">{prediction.selections.length ? prediction.selections.join(', ') : 'No selection'}</span>
                <StatusBadge value={prediction.status} />
              </article>) : <p className="betzero-empty">No forward prediction has been recorded for this strategy yet.</p>}
            </div>
          </div>
          <div className="betzero-streak-grid">
            <MetricCard label="Current losing streak" value={selectedStrategy.currentLosingStreak ?? 0} tone="loss" />
            <MetricCard label="Worst losing streak" value={selectedStrategy.worstLosingStreak ?? 0} tone="loss" />
            <MetricCard label="Current winning streak" value={selectedStrategy.currentWinningStreak ?? 0} tone="win" />
            <MetricCard label="Longest winning streak" value={selectedStrategy.longestWinningStreak ?? 0} tone="win" />
          </div>
        </div>}
      </section>

      <section className="betzero-section">
        <div className="betzero-section-heading betzero-chart-controls"><div><span className="overline">HISTORICAL PERFORMANCE</span><h2>Forward-testing trend</h2></div>
          <div className="betzero-control-row"><label>Strategy<select value={selectedStrategy?.id || ''} onChange={event => setSelectedStrategyId(event.target.value)}>
            {strategies.map(strategy => <option value={strategy.id} key={strategy.id}>{strategy.label}</option>)}
          </select></label><label>Last evaluated<select value={recentRange} onChange={event => setRecentRange(Number(event.target.value))}>
            {RANGE_OPTIONS.map(range => <option key={range} value={range}>{range}</option>)}
          </select></label></div>
        </div>
        {selectedStrategy && <OutcomeChart rows={chartRows} title={`${selectedStrategy.label} · last ${recentRange}`} />}
      </section>

      <section className="betzero-section">
        <div className="betzero-section-heading"><div><span className="overline">STRATEGY COMPARISON</span><h2>Forward vs. matched backtest</h2></div>
          {selectedRun && <span className="betzero-muted">Run {selectedRun.runId.slice(0, 8)} · {selectedRun.requestedWindow} draws</span>}</div>
        <p className="betzero-section-note">Compare all strategies on the same recorded forward sample and the same final-test segment. Win rate alone is not a ranking; sample size, skip frequency, pick count, and uncertainty matter.</p>
        <div className="betzero-table-scroll"><table className="betzero-table">
          <thead><tr><th>Strategy</th><th>Forward opportunities</th><th>Forward W/L</th><th>Forward win rate</th><th>Current / worst losses</th><th>Final test W/L</th><th>Random baseline</th><th>95% CI</th></tr></thead>
          <tbody>{strategies.map(strategy => {
            const result = finalTestResults.find(row => row.strategyId === strategy.id)?.result;
            const trials = (result?.wins || 0) + (result?.losses || 0);
            return <tr key={strategy.id}><th scope="row">{strategy.label}<small><StatusBadge value={strategy.status} /></small></th>
              <td>{(strategy.totalPredictions || 0) + (strategy.skipped || 0) + (strategy.invalid || 0)}<small>{strategy.totalPredictions ?? 0} picks · {strategy.skipped ?? 0} skipped · {strategy.invalid ?? 0} invalid</small></td>
              <td>{strategy.wins ?? 0} / {strategy.losses ?? 0}</td>
              <td>{percentage(strategy.winRate)}</td>
              <td>{strategy.currentLosingStreak ?? 0} / {strategy.worstLosingStreak ?? 0}</td>
              <td>{result && trials ? `${result.wins} / ${result.losses}` : '—'}<small>{result ? `${trials} picks · ${result.skipped} skipped` : ''}</small></td>
              <td>{percentage(result?.randomBaseline?.winRate)}<small>{result?.randomBaseline ? `${result.randomBaseline.trials.toLocaleString()} matched random trials` : ''}</small></td>
              <td>{result?.confidenceInterval95 ? `${percentage(result.confidenceInterval95[0])}–${percentage(result.confidenceInterval95[1])}` : '—'}</td>
            </tr>;
          })}</tbody>
        </table></div>
        {backtest && <div className="betzero-segment-tabs" aria-label="Backtest segment results">
          {SEGMENTS.map(segment => {
            const entries = runResults.filter(row => row.segment === segment);
            const totalPicks = entries.reduce((sum, item) => sum + (item.result.predictions || 0), 0);
            const totalWins = entries.reduce((sum, item) => sum + (item.result.wins || 0), 0);
            return <div key={segment}><span>{segment.replace('_', ' ')}</span><strong>{totalPicks ? `${totalWins} / ${totalPicks} wins` : 'No eligible picks'}</strong></div>;
          })}
        </div>}
      </section>

      <section className="betzero-section">
        <div className="betzero-section-heading"><div><span className="overline">HISTORICAL SIMULATION</span><h2>Backtest strategies</h2></div></div>
        <p className="betzero-section-note">Chronological walk-forward simulation with a 60/20/20 development, validation, and final-test split. Historical simulations are not proof of predictions available live.</p>
        <form className="betzero-backtest-form" onSubmit={runBacktest}>
          <label>Historical window<select value={windowSize} onChange={event => setWindowSize(event.target.value)}>
            <option value="100">Last 100 opportunities</option><option value="500">Last 500 opportunities</option>
            <option value="1000">Last 1,000 opportunities</option><option value="all">All available opportunities</option>
          </select></label>
          <label>Reproducibility seed<input value={seed} maxLength={64} required onChange={event => setSeed(event.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Working…' : 'Run backtest'}</button>
        </form>
        {busy && <p className="betzero-progress" role="status">{busyAction || 'Lab operation in progress'}…</p>}
        <div className="betzero-run-list"><label>Saved run<select value={selectedRunId} onChange={event => chooseBacktest(event.target.value)} disabled={busy}>
          {!overview.backtestRuns?.length && <option value="">No saved runs</option>}
          {(overview.backtestRuns || []).map(run => <option key={run.runId} value={run.runId}>{dateTime(run.createdAt)} · {run.requestedWindow} · {run.runId.slice(0, 8)}</option>)}
        </select></label>
          {backtest && <div className="betzero-run-meta"><StatusBadge value={backtest.status} /><span>Dataset {backtest.datasetHash?.slice(0, 12)}</span><span>{backtest.data.validDraws.toLocaleString()} valid draws</span><span>{backtest.predictionTotal.toLocaleString()} saved simulations</span></div>}
        </div>
      </section>

      <section className="betzero-section betzero-two-column">
        <div className="betzero-panel">
          <div className="betzero-section-heading"><div><span className="overline">STRATEGY CONFIGURATION</span><h2>Research controls</h2></div></div>
          {selectedStrategy && <form className="betzero-config-form" onSubmit={saveStrategyConfig}>
            <label>Strategy<select value={selectedStrategy.id} onChange={event => setSelectedStrategyId(event.target.value)}>
              {strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.label} · {strategy.status}</option>)}
            </select></label>
            <div className="betzero-config-status"><StatusBadge value={selectedStrategy.status} /><span>{selectedStrategy.enabled ? 'Currently enabled' : 'Currently disabled'}</span></div>
            {selectedStrategy.status === 'UNVERIFIED'
              ? <p className="betzero-unverified-copy"><strong>Cannot be enabled.</strong> {selectedStrategy.missingInformation}</p>
              : <label className="betzero-checkbox"><input type="checkbox" checked={enabledInput} onChange={event => setEnabledInput(event.target.checked)} /> Enable this research-only strategy for forward testing</label>}
            <label>Loss-streak alert thresholds<input value={thresholdInput} onChange={event => setThresholdInput(event.target.value)} placeholder="3, 5, 7, 10" />
              <small>Comma-separated unique whole numbers from 1 to 100. New worst streaks always alert.</small></label>
            <button className="btn btn-secondary" type="submit" disabled={busy}>Save lab configuration</button>
            <p className="betzero-section-note">Configuration only affects the isolated lab. Unverified tutorial strategies remain disabled.</p>
          </form>}
        </div>
        <div className="betzero-panel">
          <div className="betzero-section-heading"><div><span className="overline">LAB ALERTS</span><h2>Loss-streak alerts</h2></div><span>{overview.alerts.length}</span></div>
          <div className="betzero-alert-list">
            {overview.alerts.length ? overview.alerts.slice(0, 12).map((alert, index) => <article className="betzero-alert" key={`${alert.strategyId}-${alert.targetDrawId}-${alert.type}-${index}`}>
              <StatusBadge value={alert.type === 'NEW_WORST_LOSS_STREAK' ? 'NEW WORST' : `LOSS STREAK ${alert.type.replace('LOSS_STREAK_', '')}`} />
              <div><strong>{alert.message}</strong><small>{dateTime(alert.createdAt)} · target #{alert.targetDrawId}</small></div>
            </article>) : <p className="betzero-empty">No lab loss-streak alerts have been recorded.</p>}
          </div>
        </div>
      </section>

      <section className="betzero-section">
        <div className="betzero-section-heading"><div><span className="overline">FORWARD HISTORY</span><h2>Prediction records</h2></div>
          <span className="betzero-muted">{forwardRows.length} matching records</span></div>
        <div className="betzero-history-filters">
          <label>Strategy<select value={historyStrategyId} onChange={event => setHistoryStrategyId(event.target.value)}>
            <option value="all">All strategies</option>{strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}
          </select></label>
          <label>Outcome<select value={historyStatus} onChange={event => setHistoryStatus(event.target.value)}>
            {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status === 'ALL' ? 'All outcomes' : status}</option>)}
          </select></label>
          <label>Find draw or selection<input value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="Draw ID or number" /></label>
        </div>
        {historyLoading && <p className="betzero-progress" role="status">Loading prediction history…</p>}
        {historyError && <p className="betzero-message is-error" role="alert">{historyError}</p>}
        <div className="betzero-table-scroll"><table className="betzero-table betzero-history-table">
          <thead><tr><th>Target draw</th><th>Strategy</th><th>Selected numbers</th><th>Actual result</th><th>Status</th><th>Predicted at</th><th>Validated at</th></tr></thead>
          <tbody>{forwardRows.map(row => <tr key={row.predictionId}><td>#{row.targetDrawId}<small>From #{row.sourceDrawId}</small></td>
            <td>{overview.strategies[row.strategyId]?.label || row.strategyId}<small>v{row.strategyVersion}</small></td>
            <td>{row.selections.length ? row.selections.join(', ') : '—'}</td>
            <td>{row.actualBalls?.join(', ') || '—'}</td><td><StatusBadge value={row.status} /></td>
            <td>{dateTime(row.predictedAt)}</td><td>{dateTime(row.validatedAt)}</td></tr>)}
            {!forwardRows.length && <tr><td className="betzero-empty-cell" colSpan="7">No predictions match these filters.</td></tr>}
          </tbody>
        </table></div>
        <p className="betzero-section-note">History is limited to the latest 500 records overall or for the selected strategy. SKIP, PENDING, and INVALID outcomes are not counted as losses.</p>
      </section>
    </>}
  </main>;
}
