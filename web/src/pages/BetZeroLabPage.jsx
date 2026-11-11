import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../auth.js';
import { useBetZeroLive } from './useBetZeroLive';
import './betzero-lab.css';

const strategyKey = strategy => `${strategy?.id}@${strategy?.version}`;
const RANGE_OPTIONS = [100, 500, 1000];
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
  return <span className={`betzero-status betzero-status-${status.toLowerCase().replaceAll('_', '-')}`}>{status === 'PENDING' ? 'WAITING' : status === 'SKIP' ? 'SKIPPED' : status.replaceAll('_', ' ')}</span>;
}

function MetricCard({ label, value, note, tone }) {
  return <article className={`betzero-metric${tone ? ` is-${tone}` : ''}`}>
    <span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}
  </article>;
}

function OutcomeChart({ rows, title, historical = false }) {
  const evaluated = rows.filter(row => row.status === 'WIN' || row.status === 'LOSS');
  let wins = 0;
  const points = evaluated.map((row, index) => {
    if (row.status === 'WIN') wins++;
    return { x: 36 + (index / Math.max(1, evaluated.length - 1)) * 664, y: 170 - (wins / (index + 1)) * 130 };
  });
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const rate = evaluated.length ? wins / evaluated.length : null;
  return <div className="betzero-chart-card">
    <div className="betzero-section-heading"><div><span className="overline">{historical ? 'HISTORICAL RESULTS' : 'FORWARD RESULTS'}</span><h3>{title}</h3></div>
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

const SKIP_REASONS = {
  'Strategy is disabled.': 'this strategy was switched off',
  UNRESOLVED_PREDICTION: 'still waiting for the result of an earlier prediction',
  RESULT_CONFLICT_REVIEW_REQUIRED: 'paused because a draw was reported with two different results',
  INSUFFICIENT_HISTORY: 'needs five completed draws in a row before it can choose a starting method',
  BOTH_METHODS_WIN: 'both MIN and MAX won on the latest evidence draw, so no starting method was chosen',
  NO_STARTING_METHOD: 'neither MIN nor MAX won in the last five draws, so no starting method was chosen',
  BOUNDARY: 'the previous draw contained 1 or 49, so three adjacent numbers were not possible',
  INVALID_SOURCE: 'the previous draw result was not usable',
  MISSING_STATISTICS_SNAPSHOTS: 'two statistics snapshots in a row were not available yet',
  NONCONSECUTIVE_STATISTICS_SNAPSHOTS: 'the two latest statistics snapshots were not from consecutive draws',
  CONFLICTING_STATISTICS_SNAPSHOTS: 'a statistics snapshot was reported with two different values',
  STATISTICS_NOT_AVAILABLE_BEFORE_TARGET: 'the statistics arrived too late for this draw',
  FEWER_THAN_FOUR_TRANSITIONS: 'fewer than four numbers dropped from streak 2 or 3 to 1',
  FEWER_THAN_THREE_TRANSITIONS: 'fewer than three numbers dropped from streak 2 or 3 to 1',
};
function skipText(row) {
  const reason = row?.conditions?.reason;
  const qualified = row?.conditions?.qualified;
  const text = SKIP_REASONS[reason] || reason || 'no eligible prediction';
  return Array.isArray(qualified) ? `${text} (${qualified.length} qualified${qualified.length ? `: ${qualified.join(', ')}` : ''})` : text;
}
const STATISTICS_REASONS = {
  WRONG_MARKET_OR_PERIOD: 'the sample was not the 100-draw number statistics',
  NO_PROVIDER_RESPONSE: 'Bet9ja returned no statistics response',
  NO_STATS_ARRAY: 'the Bet9ja response had no statistics list',
  ROW_COUNT_NOT_49: 'the Bet9ja response did not list exactly 49 numbers',
  INVALID_ROW: 'a statistics row had a missing or non-numeric number or streak',
  DUPLICATE_NUMBER: 'a number was listed twice',
  INVALID_TIMING: 'the capture timing was not valid',
  RECEIVED_IN_FUTURE: 'the worker and website clocks disagree',
  ARRIVED_AFTER_DRAW_DEADLINE: 'it reached the website after the draw closed',
  DIFFERENT_VALUES_FOR_SAME_DRAW: 'two different sets of values were reported for the same draw',
};
function statisticsStatus(statistics) {
  const last = statistics?.lastIngest;
  if (!last) return 'No statistics input has been checked yet (this appears after the update is running on both the worker and the website).';
  const when = last.at ? ` (${dateTime(last.at)})` : '';
  if (last.outcome === 'STORED' || last.outcome === 'DUPLICATE') return `Latest statistics input: saved for draw #${last.sourceDrawId}${when}.`;
  if (last.outcome === 'NOT_PROVIDED') return `Latest statistics input: the worker sent none${when}. It captures one at the start of each draw.`;
  const shape = last.shape ? ` Response seen: ${last.shape.rows ?? 'no'} rows; fields ${(last.shape.firstRowKeys || last.shape.dataKeys || last.shape.responseKeys || []).join(', ') || 'none'}.` : '';
  return `Latest statistics input was not usable${when}: ${STATISTICS_REASONS[last.reason] || last.reason || 'unknown reason'}.${shape}`;
}

function PredictionCard({ strategy, count, title, name, onToggle, saving, controlsBusy, live, statistics, onResolveReview }) {
  const records = strategy?.last100 || [];
  // Newest prediction first: an old record that never received a result must not hide newer ones.
  const displayed = records.find(row => ['PENDING', 'WIN', 'LOSS'].includes(row.status));
  const pending = displayed?.status === 'PENDING' ? displayed : null;
  const settled = records.find(row => ['WIN', 'LOSS'].includes(row.status));
  const clockDraw = Number(live?.clock?.drawId);
  const resultMissing = Boolean(pending && Number.isFinite(clockDraw) && clockDraw > Number(pending.targetDrawId) + 1);
  const isStreakDrop = Boolean(strategy?.id?.startsWith('statistics_streak_drop_'));
  const decision = strategy?.decisionState;
  const selections = displayed?.selections || [];
  const valid = (Array.isArray(count) ? count.includes(selections.length) : selections.length === count) && new Set(selections).size === selections.length && selections.every(n => Number.isInteger(n) && n >= 1 && n <= 49);
  return <article className="betzero-simple-pick">
    <div className="betzero-pick-title"><span>{title}</span><StatusBadge value={strategy ? (strategy.enabled ? 'ACTIVE' : 'DISABLED') : 'UNAVAILABLE'} /></div>
    <h3>{name}</h3>
    <div className="betzero-enablement">
      <span className="betzero-enablement-caption">Research Predictions Only — No Automatic Betting</span>
      <button type="button" role="switch" aria-checked={Boolean(strategy?.enabled)}
        aria-label={`${title} research predictions`} aria-busy={saving}
        disabled={!strategy || !['1.0.0','2.0.0'].includes(strategy.version) || controlsBusy}
        className="betzero-enable-switch" onClick={() => onToggle(strategy, title)}>
        <span className="betzero-switch-track" aria-hidden="true"><span /></span>
        <span>{saving ? 'Saving…' : strategy?.enabled ? 'Enabled — switch off' : 'Disabled — switch on'}</span>
      </button>
    </div>
    <p className="betzero-pick-caption">{strategy?.market === 'BET49' ? 'Single-number appearance research: WIN when selected number appears' : count === 1 ? 'Single-number absence research experiment' : `${Array.isArray(count) ? count.join(' or ') : count}-number research experiment`}</p>
    {count === 4 && strategy && !strategy.enabled && !records.some(r => r.selections?.length === 4) && <p className="betzero-empty">4-number research predictions are disabled.</p>}
    {count === 3 && <>
      <p className="betzero-pick-caption">Method: {displayed?.conditions?.method || strategy?.decisionState?.method || 'Awaiting analysis'}</p>
      {!strategy?.enabled && <p className="betzero-empty">3-number research predictions are disabled. Switch on to start; the first prediction needs five completed draws in a row.</p>}
      {strategy?.enabled && records[0]?.status === 'SKIP' && <p className="betzero-warning">Latest draw skipped: {skipText(records[0])}.</p>}
      {decision?.paused && <div className="betzero-warning"><p>Paused: draw #{decision.conflictDrawId ?? '?'} was reported with two different results, so no new predictions are made until this is reviewed.</p>
        {onResolveReview && <button type="button" className="btn btn-secondary" disabled={controlsBusy} onClick={onResolveReview}>Resolve review and resume</button>}</div>}
      {!decision?.paused && decision?.pending && <p className="betzero-pick-caption">Waiting for the result of draw #{decision.pending} before the next prediction.</p>}
      {!decision?.paused && !decision?.pending && decision?.released && <p className="betzero-pick-caption">The result of draw #{decision.released.targetDrawId} never arrived, so that prediction was set aside ({dateTime(decision.released.at)}) and the method restarts from the latest five draws.</p>}
    </>}
    {isStreakDrop && <>
      <p className="betzero-warning">{strategy.enabled
        ? `Enabled. A prediction appears only when at least ${strategy.version === '2.0.0' ? 'three' : 'four'} numbers drop from streak 2 or 3 to 1 between two consecutive draws; most draws are skipped.`
        : `Disabled, so it makes no predictions. Switch on to start. It then predicts only when at least ${strategy.version === '2.0.0' ? 'three' : 'four'} numbers drop from streak 2 or 3 to 1 between two consecutive draws, so most draws are skipped.`} Results are provisional because Bet9ja statistics carry no draw ID.</p>
      <p className="betzero-pick-caption">{statisticsStatus(statistics)}</p>
      {strategy.enabled && records[0]?.status === 'SKIP' && <p className="betzero-pick-caption">Latest draw #{records[0].targetDrawId} skipped: {skipText(records[0])}.</p>}
    </>}
    {displayed ? <>
      <p className="betzero-pick-caption">{resultMissing ? 'Latest prediction - its result was not received' : pending ? 'Latest pending record - draw timing not verified' : 'Last completed prediction'}</p>
      {valid ? <div className="betzero-number-balls" aria-label="Recorded selected numbers">{selections.map(n => <span key={n}>{n}</span>)}</div> : <p>No valid saved selection available.</p>}
      <div className="betzero-pick-target"><strong>Draw #{displayed.targetDrawId}</strong><StatusBadge value={resultMissing ? 'NO_RESULT' : pending ? 'WAITING' : displayed.status} /></div>
      <p className="betzero-pick-caption">Recorded {dateTime(displayed.predictedAt)}. This is not a confirmed upcoming draw.</p>
    </> : <p className="betzero-empty">No recorded prediction yet.</p>}
    {pending && !resultMissing && live?.clock && <p className="betzero-pick-caption">
      Saved pending target #{pending.targetDrawId}; latest clock draw #{live.clock.drawId}.
      {String(pending.targetDrawId) !== live.clock.drawId ? ' These are different draws; this record is not the current upcoming prediction.' : !live.reliable ? ' Clock timing is unavailable; this is not a verified upcoming draw.' : ' Draw IDs match; this does not independently verify the saved prediction timestamp.'}
    </p>}
    <div className="betzero-last-result"><span>Last completed</span>{settled ? <><strong>#{settled.targetDrawId}</strong><StatusBadge value={settled.status} /></> : <span>No settled result in recent history</span>}</div>
    <dl className="betzero-pick-stats">
      <div><dt>Wins / losses</dt><dd>{strategy?.wins ?? '-'} / {strategy?.losses ?? '-'}</dd></div>
      <div><dt>Win rate</dt><dd>{percentage(strategy?.winRate)}</dd></div>
      <div><dt>Current losing streak</dt><dd>{strategy?.currentLosingStreak ?? '-'}</dd></div>
      <div><dt>Worst losing streak</dt><dd>{strategy?.worstLosingStreak ?? '-'}</dd></div>
    </dl>
    <p className="betzero-section-note">All recorded outcomes; includes timing-unverified history. Win rate is not profit.</p>
    {strategy?.provisional && <p className="betzero-warning" role="status">Provisional: {strategy.provisionalReason}</p>}
  </article>;
}

export default function BetZeroLabPage({ session }) {
  const [performanceView, setPerformanceView] = useState('forward');
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
  const [savingStrategyId, setSavingStrategyId] = useState('');
  const strategySaveLock = useRef(false);
  const overviewRevision = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [jobs, setJobs] = useState([]);
  const [protocols, setProtocols] = useState([]);
  const [queueError, setQueueError] = useState('');
  const [firstDraw, setFirstDraw] = useState('');
  const [lastDraw, setLastDraw] = useState('');
  const requestInFlight = useRef(false);

  const strategies = useMemo(() => Object.values(overview?.strategyVersions || overview?.strategies || {}), [overview]);
  const selectedStrategy = strategies.find(strategy => strategyKey(strategy) === selectedStrategyId) || strategies.find(strategy => strategy.id === 'simple_smallest_number_add_10') || strategies[0] || null;

  const refreshJobs = useCallback(async () => {
    if (!session?.admin) return;
    try {
      const [queue, frozen] = await Promise.all([apiRequest('/admin/betzero-lab/jobs'), apiRequest('/admin/betzero-lab/protocols')]);
      setJobs(queue.jobs); setProtocols(frozen.protocols); setQueueError('');
    } catch (failure) { setQueueError(failure.message); }
  }, [session?.admin]);

  async function jobAction(path, body) {
    setBusy(true); setError('');
    try {
      const result = await apiRequest(`/admin/betzero-lab/${path}`, { method: 'POST', body: JSON.stringify(body) });
      setNotice(path === 'protocols' ? 'Protocol sealed. Rules, seed and future target boundaries are frozen.' : path === 'job-cancel' ? 'Cancellation requested.' : `Evaluation queued: ${result.id}`);
      await refreshJobs();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  const cachedRun = useRef('');
  const loadOverview = useCallback(async (signal) => {
    if (!session?.admin || requestInFlight.current || strategySaveLock.current) return false;
    const revision = overviewRevision.current;
    requestInFlight.current = true;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ limit:'500' });
      if (historyStrategyId !== 'all') { const [id,version]=historyStrategyId.split('@'); params.set('strategyId',id); params.set('strategyVersion',version); };
      const requests = await Promise.allSettled([
        apiRequest('/admin/betzero-lab',{signal}),
        apiRequest('/admin/betzero-lab/jobs',{signal}),
        apiRequest('/admin/betzero-lab/protocols',{signal}),
        apiRequest(`/admin/betzero-lab/predictions?${params}`,{signal})
      ]);
      if (signal.aborted || revision !== overviewRevision.current) return false;
      const failures = requests.filter(r=>r.status==='rejected').map(r=>r.reason);
      const failure = failures.find(e=>[401,403].includes(e.status)) || failures[0];
      if (failure) throw failure;
      const [next,queue,frozen,history] = requests.map(r=>r.value);
      if (!next?.strategies || !Array.isArray(history.predictions) || !Array.isArray(queue.jobs) || !Array.isArray(frozen.protocols))
        throw new Error('The lab returned incomplete data. Existing records have been kept.');
      setOverview(next);setJobs(queue.jobs);setProtocols(frozen.protocols);setHistoryRecords(history.predictions);
      setError('');setHistoryError('');setQueueError('');
      const runId = selectedRunId || next.backtestRuns?.[0]?.runId || '';
      if (!selectedRunId && runId) setSelectedRunId(runId);
      if (performanceView === 'historical' && runId && cachedRun.current !== runId) {
        const detail = await apiRequest(`/admin/betzero-lab/backtests?runId=${encodeURIComponent(runId)}&limit=1000`,{signal});
        if (!signal.aborted && revision === overviewRevision.current) {setBacktest(detail);cachedRun.current=runId;}
      }
      return true;
    } catch (loadError) {
      if (!signal.aborted) setError(loadError.message || 'Lab refresh failed; existing predictions are retained.');
      throw loadError;
    } finally {
      requestInFlight.current = false;
      if (!signal.aborted) {setLoading(false);setHistoryLoading(false);}
    }
  }, [selectedRunId, historyStrategyId, performanceView, session?.admin]);

  const live = useBetZeroLive(Boolean(session?.admin),loadOverview);
  const viewSelection = useRef({historyStrategyId,historyRefreshKey,performanceView});
  useEffect(() => {
    const old=viewSelection.current;
    viewSelection.current={historyStrategyId,historyRefreshKey,performanceView};
    if (old.historyStrategyId!==historyStrategyId || old.historyRefreshKey!==historyRefreshKey || old.performanceView!==performanceView) live.refresh();
  }, [historyStrategyId,historyRefreshKey,performanceView]);

  useEffect(() => {
    if (!strategies.length) return;
    const selected = strategies.find(strategy => strategyKey(strategy) === selectedStrategyId) || strategies.find(strategy => strategy.id === 'simple_smallest_number_add_10') || strategies[0];
    if (strategyKey(selected) !== selectedStrategyId) setSelectedStrategyId(strategyKey(selected));
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

  const forwardWindow = overview?.forwardVersionWindows?.[`${selectedStrategy?.id}:${selectedStrategy?.version}`]?.windows?.[recentRange];
  const chartRows = forwardWindow?.chart || [];

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
      const detail = await apiRequest(`/admin/betzero-lab/backtests?runId=${encodeURIComponent(runId)}&limit=1000`);
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
    if (!selectedStrategy || selectedStrategy.status !== 'RESEARCH_ONLY') { setError('Choose a supported research strategy.'); return; }
    if (windowSize !== '100') {
      await jobAction('jobs', { window: windowSize, seed, strategyId: selectedStrategy.id, strategyVersion: selectedStrategy.version });
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest('/admin/betzero-lab/backtests', { method:'POST', body:JSON.stringify({window:windowSize,seed,strategyId:selectedStrategy.id,strategyVersion:selectedStrategy.version}) });
      setSelectedRunId(result.runId);
      setBacktest(await apiRequest(`/admin/betzero-lab/backtests?runId=${encodeURIComponent(result.runId)}&limit=1000`));
      setPerformanceView('historical');
      setNotice('Historical research test completed. Forward settings were not changed.');
    } catch (failure) { setError(failure.message || 'Historical test failed.'); }
    finally { setBusy(false); }
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
        body: JSON.stringify({ strategyId: selectedStrategy.id, strategyVersion: selectedStrategy.version, enabled: enabledInput, alertThresholds }),
      });
      setOverview(await apiRequest('/admin/betzero-lab'));
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

  async function toggleResearchStrategy(strategy, title) {
    if (!session?.admin || busy || strategySaveLock.current || !strategy || !['1.0.0','2.0.0'].includes(strategy.version)
      || !['simple_smallest_number_add_10', 'smallest_add10_step10_four', 'minimum_maximum_three', 'statistics_streak_drop_betzero', 'statistics_streak_drop_bet49'].includes(strategy.id)) return;
    // The first time v2 is switched on it must go through the confirmed cutover.
    if (strategy.id === 'minimum_maximum_three' && strategy.version === '2.0.0' && !strategy.enabled && !strategy.decisionState?.cutoverAt) return cutoverMinmax();
    strategySaveLock.current = true;
    const enabled = !strategy.enabled;
    const confirmed = window.confirm(`${enabled ? 'Enable' : 'Disable'} ${title} (${strategy.label}, version ${strategy.version})?\n\n${enabled ? 'Future eligible research predictions will start. Missed draws will not be backfilled.' : 'New research selections will stop. Existing pending predictions can still settle.'}\n\nExisting history and alert thresholds are preserved. Other strategies are unchanged.\n\nResearch Predictions Only — No Automatic Betting. This does not start the backtesting worker.`);
    if (!confirmed) { strategySaveLock.current = false; return; }
    overviewRevision.current++;
    setSavingStrategyId(strategy.id); setBusy(true); setError(''); setNotice('');
    let saved = false;
    try {
      const result = await apiRequest('/admin/betzero-lab/strategy-config', {
        method: 'POST', body: JSON.stringify({ strategyId: strategy.id, strategyVersion: strategy.version, enabled }),
      });
      saved = true;
      const next = await apiRequest('/admin/betzero-lab');
      setOverview(next); setHistoryRefreshKey(value => value + 1);
      if (strategyKey(selectedStrategy) === strategyKey(strategy)) setEnabledInput(Boolean(next.strategyVersions[strategyKey(strategy)]?.enabled));
      const actualEnabled = next.strategyVersions[strategyKey(strategy)]?.enabled;
      setNotice(`${title}: server confirms research predictions are ${actualEnabled ? 'enabled' : 'disabled'}. Existing history is preserved.`);
    } catch (failure) {
      setError(saved
        ? `${title} was saved, but refreshing its status failed. Refresh the lab to confirm the latest settings. ${failure.message}`
        : `${title} could not be confirmed saved. The switch retains its previous status; refresh before retrying if the connection failed. ${failure.message}`);
    } finally {
      strategySaveLock.current = false; setSavingStrategyId(''); setBusy(false);
    }
  }

  async function cutoverMinmax() {
    if (!session?.admin || busy || strategySaveLock.current) return;
    strategySaveLock.current = true;
    if (!window.confirm('Switch Minimum/Maximum from v1.0.0 to v2.0.0?\n\nThis atomically stops future v1 predictions and initializes v2 independently. v2 keeps its method after WIN and switches after LOSS. Pending results or correction conflicts block this change. History is preserved; no missed draws are backfilled. Research only - no automatic betting.')) { strategySaveLock.current=false; return; }
    overviewRevision.current++; setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/admin/betzero-lab/minmax-cutover',{method:'POST',body:JSON.stringify({fromVersion:'1.0.0',toVersion:'2.0.0',confirmed:true})});
      setOverview(await apiRequest('/admin/betzero-lab'));
      setNotice('Cutover confirmed: v1 stopped, v2 initialized independently for subsequent eligible draws.');
    } catch(failure) { setError(`Cutover not confirmed. ${failure.message}`); }
    finally {strategySaveLock.current=false;setBusy(false);}
  }

  async function resolveMinmaxReview() {
    if (!session?.admin || busy || strategySaveLock.current) return;
    strategySaveLock.current = true;
    if (!window.confirm('Resolve the Minimum/Maximum review and resume predictions?\n\nThe draw with two different reported results stays excluded from the method history, any prediction waiting on it is set aside, and the method restarts from the latest five clean draws. Saved history is not changed. Research only - no automatic betting.')) { strategySaveLock.current=false; return; }
    overviewRevision.current++; setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/admin/betzero-lab/minmax-review',{method:'POST',body:JSON.stringify({confirmed:true})});
      setOverview(await apiRequest('/admin/betzero-lab'));
      setNotice('Review resolved: Minimum/Maximum can make predictions again from the next eligible draw.');
    } catch(failure) { setError(`Review not resolved. ${failure.message}`); }
    finally {strategySaveLock.current=false;setBusy(false);}
  }

  if (session?.checking) return <main className="page-wrap betzero-lab-page"><section className="content-card" role="status">Checking owner session…</section></main>;
  if (!session?.admin || live.expired) return <main className="page-wrap betzero-lab-page">
    <section className="betzero-access-card"><span className="overline">PRIVATE RESEARCH WORKSPACE</span>
      <h1>Owner sign-in required</h1>{live.expired && <p role="alert">Your session expired. Sign in again to resume live updates.</p>}<p>The experimental BetZero lab is restricted to authorized administrators.</p>
      <a className="btn btn-primary" href="predictions.html">Open owner controls</a>
    </section>
  </main>;

  const runResults = backtest?.results || [];
  const finalTestResults = runResults.filter(row => row.segment === 'final_test');
  const latestPredictions = (overview?.predictions || []).filter(row => row.strategyId === selectedStrategy?.id && row.strategyVersion === selectedStrategy?.version).slice(0, 5);
  const selectedRun = overview?.backtestRuns?.find(run => run.runId === selectedRunId);
  const selectedOverall = backtest?.data?.overallByVersion?.[strategyKey(selectedStrategy)] || (backtest?.data?.overall && selectedStrategy && backtest.data.overall.strategyId === selectedStrategy.id && (backtest.data.overall.strategyVersion || '1.0.0') === selectedStrategy.version ? backtest.data.overall : null);

  return <main className="page-wrap betzero-lab-page">
    <section className="betzero-hero">
      <div><span className="overline">OWNER-ONLY · ISOLATED RESEARCH</span>
        <h1>BetZero Strategy Lab</h1>
        <p>Your predictions, results and research tests in one place.</p></div>

    </section>

    <div className="betzero-warning" role="note"><strong>EXPERIMENTAL — NOT FOR REAL-MONEY BETTING</strong>
      <span>No bets are placed here. Research results do not guarantee profit.</span></div>
    {error && <div className="betzero-message is-error" role="alert">{error}</div>}
    {notice && <div className="betzero-message is-success" role="status">{notice}</div>}

    {loading && !overview && <section className="content-card" role="status">Loading isolated lab data…</section>}
    <section className="betzero-live-monitor" aria-labelledby="live-draw-title" aria-busy={live.refreshing}>
      <div className="betzero-live-heading"><div><span className="overline">AUTHORITATIVE DRAW CLOCK</span><h2 id="live-draw-title">Live Draw Monitor</h2></div>
        <span className={`betzero-live-status is-${live.status.toLowerCase()}`} role="status">{live.refreshing && live.status === 'LIVE' ? 'UPDATING' : live.status}</span>
      </div>
      <div className="betzero-live-body">
        <div><p>{live.reliable ? `Next draw #${live.clock.drawId}` : live.clock ? `Last reported draw #${live.clock.drawId}` : 'Next draw unavailable'}</p>
          <div className="betzero-live-countdown" role="timer" aria-label="Time remaining" aria-live="off">{live.seconds === null ? '--:--' : `${String(Math.floor(live.seconds / 60)).padStart(2,'0')}:${String(live.seconds % 60).padStart(2,'0')}`}</div>
        </div>
        <button className="btn btn-secondary" type="button" disabled={live.refreshing || busy} onClick={live.refresh}>{live.refreshing ? 'Refreshing...' : 'Refresh Now'}</button>
      </div>
      <div className="betzero-live-freshness"><span>Clock received: {live.clock ? dateTime(live.clock.wall) : 'Not yet received'}</span><span>Lab data updated: {live.updatedAt ? dateTime(live.updatedAt) : 'Waiting for data'}</span></div>
      {!live.reliable && <p className="betzero-warning" role="status">{live.clockError || (live.status === 'UPDATING' ? 'Waiting for the server to publish the next draw clock. No next draw ID has been inferred.' : 'No recent reliable clock is available. Countdown and upcoming-draw timing cannot be confirmed.')}</p>}
      {live.refreshError && <p className="betzero-message is-error" role="alert">{live.refreshError}</p>}
      <p className="betzero-section-note">Clock follows server observations. Research generation and settlement remain on the server. Updates pause when this tab is hidden.</p>
    </section>
    {overview && <>
      <section className="betzero-section betzero-my-predictions" aria-labelledby="my-predictions-title">
        <div className="betzero-section-heading"><div><span className="overline">YOUR RESEARCH PICKS</span><h2 id="my-predictions-title">My Predictions</h2></div></div>
        <div className="betzero-simple-picks">
          <PredictionCard strategy={overview.strategies.simple_smallest_number_add_10} count={1} title="1-Number BetZero" name="Smallest +10" onToggle={toggleResearchStrategy} saving={savingStrategyId === 'simple_smallest_number_add_10'} controlsBusy={busy} live={live} />
          <PredictionCard strategy={overview.strategies.smallest_add10_step10_four} count={4} title="4-Number BetZero" name="Smallest +10 / Step-10" onToggle={toggleResearchStrategy} saving={savingStrategyId === 'smallest_add10_step10_four'} controlsBusy={busy} live={live} />
          <p className="betzero-section-note">Statistics snapshots collected: {overview.numberStatistics?.snapshots ?? 0}. Conflicts: {overview.numberStatistics?.conflicts ?? 0}. Streak-drop research skips unavailable snapshot pairs.</p>
          <PredictionCard strategy={overview.strategyVersions?.['statistics_streak_drop_betzero@1.0.0']} count={4} title="BetZero - Streak drop v1" name="strk 2 or 3 to 1; first four ascending" onToggle={toggleResearchStrategy} saving={savingStrategyId === 'statistics_streak_drop_betzero'} controlsBusy={busy} live={live} statistics={overview.numberStatistics} />
          <PredictionCard strategy={overview.strategyVersions?.['statistics_streak_drop_bet49@1.0.0']} count={1} title="Bet49 - Streak drop v1" name="One seeded random number from the same four" onToggle={toggleResearchStrategy} saving={savingStrategyId === 'statistics_streak_drop_bet49'} controlsBusy={busy} live={live} statistics={overview.numberStatistics} />
          <PredictionCard strategy={overview.strategyVersions?.['statistics_streak_drop_betzero@2.0.0']} count={[3,4]} title="BetZero - Streak drop v2" name="Use three qualifiers, or first four when more qualify" onToggle={toggleResearchStrategy} saving={savingStrategyId === 'statistics_streak_drop_betzero'} controlsBusy={busy} live={live} statistics={overview.numberStatistics} />
          <PredictionCard strategy={overview.strategyVersions?.['statistics_streak_drop_bet49@2.0.0']} count={1} title="Bet49 - Streak drop v2" name="One seeded random number from the same three or four" onToggle={toggleResearchStrategy} saving={savingStrategyId === 'statistics_streak_drop_bet49'} controlsBusy={busy} live={live} statistics={overview.numberStatistics} />
          <p className="betzero-section-note">Streak-drop v1 and v2 have separate history and settings. V2 starts disabled; enabling it does not disable v1 or backfill missed draws.</p>
          {!overview.strategyVersions?.['minimum_maximum_three@2.0.0']?.decisionState?.cutoverAt && <PredictionCard strategy={overview.strategyVersions?.['minimum_maximum_three@1.0.0']} count={3}
            title="Minimum/Maximum v1.0.0"
            name="After WIN: switch / After LOSS: keep"
            onToggle={toggleResearchStrategy} saving={savingStrategyId === 'minimum_maximum_three'} controlsBusy={busy} live={live} onResolveReview={resolveMinmaxReview} />}
          <PredictionCard strategy={overview.strategyVersions?.['minimum_maximum_three@2.0.0']} count={3}
            title="Minimum/Maximum v2.0.0 - New switching strategy"
            name="After WIN: keep / After LOSS: switch"
            onToggle={toggleResearchStrategy} saving={savingStrategyId === 'minimum_maximum_three'} controlsBusy={busy} live={live} onResolveReview={resolveMinmaxReview} />
        </div>
        <div className="betzero-warning"><strong>Minimum/Maximum version cutover</strong>
          <p>v2 starts independently from five eligible historical opportunities. Unresolved predictions or conflicts block cutover. Existing history is preserved.</p>
          <button type="button" className="btn btn-secondary" disabled={busy || Boolean(overview.strategyVersions?.['minimum_maximum_three@2.0.0']?.decisionState?.cutoverAt)} onClick={cutoverMinmax}>Review v1 to v2 cutover</button>
          <p>Before the first cutover, this action (or the v2 switch, which runs the same confirmed cutover) initializes v2. Returning to v1 after cutover requires a separate reviewed rollback.</p>
        </div>
      </section>
      <section className="betzero-section" aria-labelledby="test-strategy-title">
        <div className="betzero-section-heading"><div><span className="overline">EXPLORE PAST DRAWS</span><h2 id="test-strategy-title">Test My Strategy</h2></div></div>
        <p className="betzero-section-note">Test only the selected research strategy against recorded draws, without changing forward settings. Tests of 100 opportunities run here; larger tests queue and wait while the worker is unavailable.</p>
        <form className="betzero-backtest-form" onSubmit={runBacktest}>
          <label>Historical window<select value={windowSize} onChange={event => setWindowSize(event.target.value)}>
            <option value="100">Last 100 opportunities</option><option value="500">Last 500 opportunities</option>
            <option value="1000">Last 1,000 opportunities</option><option value="all">All available opportunities</option>
          </select></label>
          <label>Strategy to test<select value={selectedStrategy ? strategyKey(selectedStrategy) : ''} onChange={event => setSelectedStrategyId(event.target.value)}>
            {strategies.map(strategy => <option key={strategyKey(strategy)} value={strategyKey(strategy)}>{strategy.selectionCount === 1 ? '1-Number BetZero' : strategy.selectionCount === 3 ? `3-Number Minimum/Maximum v${strategy.version}` : strategy.selectionCount === 4 ? '4-Number BetZero' : `Advanced: ${strategy.label}`}</option>)}
          </select></label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Working…' : windowSize === '100' ? 'Run Historical Test' : 'Queue Historical Test'}</button>
        </form>
        <p className="betzero-section-note">Research strategies can be tested while forward predictions remain disabled. Unverified tutorial strategies cannot be tested. Larger jobs wait while the worker is unavailable; this page never starts it.</p>
        {selectedStrategy?.status === 'UNVERIFIED' && <p className="betzero-warning">This tutorial strategy has incomplete rules and cannot be evaluated.</p>}
        <p className="betzero-section-note">Exploratory evaluation uses seed <strong>{seed}</strong>. Forward settings remain unchanged. Queue status and advanced settings remain below.</p>
      </section>
      <section className="betzero-section betzero-simple-performance" aria-labelledby="performance-title">
        <div className="betzero-section-heading"><div><span className="overline">UNDERSTAND YOUR RESULTS</span><h2 id="performance-title">Results &amp; Performance</h2></div></div>
        <div className="betzero-view-switch" aria-label="Performance view">
          <button type="button" className="btn btn-secondary" aria-pressed={performanceView === 'forward'} onClick={() => setPerformanceView('forward')}>Forward predictions</button>
          <button type="button" className="btn btn-secondary" aria-pressed={performanceView === 'historical'} onClick={() => setPerformanceView('historical')}>Historical backtests</button>
        </div>
        {performanceView === 'forward' ? <>
          <p className="betzero-section-note">All recorded outcomes for {selectedStrategy?.label}. These totals include legacy timing-unverified records; the verified chart below uses a separate sample.</p>
          {selectedStrategy?.provisional && <p className="betzero-warning">Provisional: {selectedStrategy.provisionalReason}</p>}
          <div className="betzero-simple-totals">
            <MetricCard label="Evaluated predictions" value={(selectedStrategy?.wins || 0) + (selectedStrategy?.losses || 0)} />
            <MetricCard label="Wins / losses" value={`${selectedStrategy?.wins || 0} / ${selectedStrategy?.losses || 0}`} />
            <MetricCard label="Recorded win rate" value={percentage(selectedStrategy?.winRate)} />
            <MetricCard label="Current / worst losing streak" value={`${selectedStrategy?.currentLosingStreak || 0} / ${selectedStrategy?.worstLosingStreak || 0}`} />
            <MetricCard label="Pending / skipped" value={`${selectedStrategy?.pending || 0} / ${selectedStrategy?.skipped || 0}`} />
          </div>
      <section className="betzero-section">
        <div className="betzero-section-heading betzero-chart-controls"><div><span className="overline">RECORDED FORWARD RESULTS</span><h2>Forward-testing trend</h2></div>
          <div className="betzero-control-row"><label>Strategy<select value={selectedStrategy ? strategyKey(selectedStrategy) : ''} onChange={event => setSelectedStrategyId(event.target.value)}>
            {strategies.map(strategy => <option value={strategyKey(strategy)} key={strategyKey(strategy)}>{strategy.label} - v{strategy.version}</option>)}
          </select></label><label>Recent completed records<select value={recentRange} onChange={event => setRecentRange(Number(event.target.value))}>
            {RANGE_OPTIONS.map(range => <option key={range} value={range}>{range}</option>)}
          </select></label></div>
        </div>
        <p className="betzero-section-note">Each strategy version has its own rolling window. Skips and invalid records occupy window slots; pending predictions do not. Collector observation times alone do not prove the actual draw deadline. Older records without timing evidence remain in history but are excluded from these verified rates. Win rates do not measure profit.</p>
        {forwardWindow && <>
          {forwardWindow.provisional && <p className="betzero-warning" role="status">Provisional results: {forwardWindow.provisionalReason}</p>}
          <div className="betzero-stage4-metrics">
            <MetricCard label="Sample collected" value={`${forwardWindow.available} / ${recentRange}`} note={`${forwardWindow.settled} settled · ${forwardWindow.pending} pending`} />
            <MetricCard label="Wins / losses" value={`${forwardWindow.wins} / ${forwardWindow.losses}`} note={`${forwardWindow.skipped} skipped · ${forwardWindow.invalid} invalid · ${forwardWindow.unverified} timing-unverified`} />
            <MetricCard label="Win rate · 95% interval" value={percentage(forwardWindow.winRate)} note={forwardWindow.confidenceInterval95 ? forwardWindow.confidenceInterval95.map(v => percentage(v)).join(' – ') : 'Waiting for verified settled results'} />
            <MetricCard label="Current / worst loss streak" value={`${forwardWindow.currentLosingStreak} / ${forwardWindow.worstLosingStreak}`} note={`Longest win streak: ${forwardWindow.longestWinningStreak} · within this window`} />
            <MetricCard label="Theoretical baseline" value={percentage(forwardWindow.theoreticalBaseline)} note="Assumes independent, uniform six-ball draws" />
            <MetricCard label="Matched seeded random" value={percentage(forwardWindow.randomBaseline.winRate)} note={`${forwardWindow.randomBaseline.repetitions} simulations per settled entry · same targets and skips`} />
          </div>
          {forwardWindow.streakFlag && <p className="betzero-warning" role="status">{forwardWindow.streakFlag}</p>}
          <p className="betzero-section-note">95% Wilson intervals describe the settled sample. Repeated monitoring and serial dependence limit inference. A loss-streak alert does not predict the next draw. Random seed: {forwardWindow.randomBaseline.seed}.</p>
        </>}
        {selectedStrategy && <OutcomeChart rows={chartRows} title={`${selectedStrategy.label} · last ${recentRange} records`} />}
      </section>

      <section className="betzero-section">
        <div className="betzero-section-heading"><div><span className="overline">FORWARD HISTORY</span><h2>Prediction records</h2></div>
          <span className="betzero-muted">{forwardRows.length} matching records</span></div>
        <div className="betzero-history-filters">
          <label>Strategy<select value={historyStrategyId} onChange={event => setHistoryStrategyId(event.target.value)}>
            <option value="all">All strategies</option>{strategies.map(strategy => <option key={strategyKey(strategy)} value={strategyKey(strategy)}>{strategy.label} - v{strategy.version}</option>)}
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
          <tbody>{forwardRows.map(row => <tr key={row.predictionId}><td data-label="Draw">#{row.targetDrawId}<small>From #{row.sourceDrawId}</small></td>
            <td data-label="Strategy">{overview.strategyVersions?.[`${row.strategyId}@${row.strategyVersion}`]?.label || row.strategyId}<small>v{row.strategyVersion}</small></td>
            <td data-label="Selections">{row.selections.length ? row.selections.join(', ') : '—'}</td>
            <td data-label="Actual six numbers">{row.actualBalls?.join(', ') || '—'}</td><td data-label="Result"><StatusBadge value={row.status} /></td>
            <td data-label="Predicted at">{dateTime(row.predictedAt)}</td><td data-label="Validated at">{dateTime(row.validatedAt)}</td></tr>)}
            {!forwardRows.length && <tr><td className="betzero-empty-cell" colSpan="7">No predictions match these filters.</td></tr>}
          </tbody>
        </table></div>
        <p className="betzero-section-note">History is limited to the latest 500 records overall or for the selected strategy. SKIP, PENDING, and INVALID outcomes are not counted as losses.</p>
      </section>

        </> : <div className="betzero-historical-view">
          <p>Historical simulations are separate from forward predictions. Select saved runs and inspect their development, validation and holdout results in the existing research tools below.</p>
          {backtest ? <>
            <h3>{selectedStrategy?.label} - saved historical run</h3>
            <p className="betzero-section-note">{backtest.data.evaluationMode === 'SEALED_FINAL' ? 'Sealed final evaluation' : 'Exploratory historical evaluation'} - {dateTime(backtest.createdAt)}</p>
            {runResults.filter(row => row.strategyId === selectedStrategy?.id && row.strategyVersion === selectedStrategy?.version).map(row => <article className="betzero-historical-segment" key={row.segment}>
              <h4>{row.segment === 'final_test' ? (backtest.data.evaluationMode === 'SEALED_FINAL' ? 'Sealed final test' : 'Exploratory holdout') : row.segment}</h4>
              {Number.isFinite(row.result.winRate) && <meter className="betzero-historical-rate" min="0" max="1" value={row.result.winRate} aria-label={`${row.segment} historical win rate: ${percentage(row.result.winRate)}`} />}
              <p>{row.result.wins || 0} wins / {row.result.losses || 0} losses / Win rate {percentage(row.result.winRate)}</p>
              <p>Matching random baseline: {percentage(row.result.randomBaseline?.winRate)} / Theoretical: {percentage(row.result.theoreticalBaseline?.expectedWinRate)}</p>
              {row.result.reason && <p>{row.result.reason}</p>}
            </article>)}
          </> : <p className="betzero-empty">No saved historical result available. Queued jobs are not completed tests.</p>}
        </div>}
      </section>
      <div className="betzero-technical-heading"><h2>Research tools</h2><p>Existing technical features remain available here. Their collapsible layout is reserved for Phase 4.</p></div>
      <section className="betzero-section">
        {performanceView === 'historical' && backtest && <section className="betzero-section">
          <h2>Recorded historical selections</h2>
          {selectedOverall && <div className="betzero-simple-pick">
            <h3>Full historical test</h3>
            <p>{selectedOverall.predictions} evaluated | {selectedOverall.wins} wins | {selectedOverall.losses} losses | {selectedOverall.skipped} skipped</p>
            <p>Win rate: {percentage(selectedOverall.winRate)} | Current losing streak: {selectedOverall.currentLosingStreak} | Worst: {selectedOverall.worstLosingStreak}</p>
            <p>Matched random: {percentage(selectedOverall.randomBaseline?.winRate)} | Theoretical: {percentage(selectedOverall.theoreticalBaseline?.expectedWinRate)}</p>
            <p>Difference from random: {selectedOverall.winRate == null ? 'Unavailable' : `${((selectedOverall.winRate - selectedOverall.randomBaseline.winRate)*100).toFixed(2)} percentage points`}. Historical performance does not guarantee future results.</p>
          </div>}
          <p>Saved simulated results, separate from forward predictions. Up to 1,000 rows shown.</p>
          <div className="betzero-historical-picks">{(backtest.predictions || []).filter(r => r.strategyId === selectedStrategy?.id && r.strategyVersion === selectedStrategy?.version).map(row => <article key={row.predictionId} className="betzero-simple-pick">
            <strong>Draw #{row.targetDrawId} | {row.conditions?.method || 'No method'}</strong>
            <StatusBadge value={row.status} />
            <p>Selections: {row.selections?.join(', ') || 'None'}</p>
            <p>Result: {row.actualBalls?.join(', ') || 'Unavailable'}</p>
            {row.conditions?.reason && <p>{row.conditions.reason}</p>}
          </article>)}</div>
        </section>}
        <div className="betzero-section-heading"><div><span className="overline">STRATEGY OVERVIEW</span><h2>Research status</h2></div>
          <span className="betzero-muted">{strategies.length} registered strategies</span></div>
        <div className="betzero-strategy-grid">
          {strategies.map(strategy => <article className="betzero-strategy-card" key={strategyKey(strategy)}>
            <div className="betzero-card-top"><StatusBadge value={strategy.status} /><span>{strategy.enabled ? 'Enabled' : 'Disabled'}</span></div>
            <h3>{strategy.label}</h3>
            {strategy.selectionCount && <p><strong>{strategy.market === 'BET49' ? 'One-number appearance research: selected number must occur.' : strategy.selectionCount === 1 ? 'One-number absence experiment — not a four-number BetZero prediction.' : strategy.selectionCount === 3 ? 'Exactly three distinct numbers - MIN/MAX research.' : 'Exactly four distinct numbers — newly designed research, not instructor-verified.'}</strong></p>}
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
        <div className="betzero-section-heading"><div><span className="overline">STRATEGY COMPARISON</span><h2>Forward vs. matched backtest</h2></div>
          {selectedRun && <span className="betzero-muted">Run {selectedRun.runId.slice(0, 8)} · {selectedRun.requestedWindow} draws</span>}</div>
        <p className="betzero-section-note">Forward records and historical backtest segments are different samples. Each strategy version is tracked separately. Win rate alone is not a ranking; sample size, skip frequency, pick count, and uncertainty matter.</p>
        <div className="betzero-table-scroll"><table className="betzero-table">
          <thead><tr><th>Strategy</th><th>Forward opportunities</th><th>Forward W/L</th><th>Forward win rate</th><th>Current / worst losses</th><th>{backtest?.data?.evaluationMode === 'SEALED_FINAL' ? 'Sealed final W/L' : 'Exploratory holdout W/L'}</th><th>Random baseline</th><th>95% CI</th></tr></thead>
          <tbody>{strategies.map(strategy => {
            const result = finalTestResults.find(row => row.strategyId === strategy.id && row.strategyVersion === strategy.version)?.result;
            const trials = (result?.wins || 0) + (result?.losses || 0);
            return <tr key={strategyKey(strategy)}><th scope="row">{strategy.label}<small><StatusBadge value={strategy.status} /></small></th>
              <td>{(strategy.totalPredictions || 0) + (strategy.skipped || 0) + (strategy.invalid || 0)}<small>{strategy.totalPredictions ?? 0} picks · {strategy.skipped ?? 0} skipped · {strategy.invalid ?? 0} invalid</small></td>
              <td>{strategy.wins ?? 0} / {strategy.losses ?? 0}</td>
              <td>{percentage(strategy.winRate)}</td>
              <td>{strategy.currentLosingStreak ?? 0} / {strategy.worstLosingStreak ?? 0}</td>
              <td>{result && trials ? `${result.wins} / ${result.losses}` : '—'}<small>{result ? `${trials} picks · ${result.skipped} skipped` : ''}</small></td>
              <td>{percentage(result?.randomBaseline?.winRate)}<small>{result?.randomBaseline ? `${result.randomBaseline.trials.toLocaleString()} matched random trials` : ''}</small><small>Theoretical: {percentage(result?.theoreticalBaseline?.expectedWinRate)} · {strategy.selectionCount || '—'} selections</small></td>
              <td>{result?.confidenceInterval95 ? `${percentage(result.confidenceInterval95[0])}–${percentage(result.confidenceInterval95[1])}` : '—'}</td>
            </tr>;
          })}</tbody>
        </table></div>
        {backtest && <div className="betzero-segment-tabs" aria-label="Backtest segment results">
          {SEGMENTS.map(segment => {
            const entries = runResults.filter(row => row.segment === segment && row.strategyId === selectedStrategy?.id && row.strategyVersion === selectedStrategy?.version);
            const totalPicks = entries.reduce((sum, item) => sum + (item.result.predictions || 0), 0);
            const totalWins = entries.reduce((sum, item) => sum + (item.result.wins || 0), 0);
            return <div key={segment}><span>{segment === 'final_test' ? (backtest.data.evaluationMode === 'SEALED_FINAL' ? 'sealed final test' : 'exploratory holdout') : segment} · {selectedStrategy?.label} v{selectedStrategy?.version}</span><strong>{totalPicks ? `${totalWins} / ${totalPicks} wins` : 'No eligible picks'}</strong></div>;
          })}
        </div>}
      </section>

      <section className="betzero-section">
        <div className="betzero-section-heading"><div><span className="overline">HISTORICAL SIMULATION</span><h2>Research job management</h2></div></div>
        <p className="betzero-section-note">Exploratory simulations use development, validation, and reused holdout segments. They are not untouched final tests or genuine forward predictions. Sealed evaluations use future draw ranges frozen below.</p>
          <label>Reproducibility seed<input value={seed} maxLength={64} required onChange={event => setSeed(event.target.value)} /></label>
        {busy && <p className="betzero-progress" role="status">{busyAction || 'Lab operation in progress'}…</p>}
        {queueError && <p role="alert" className="betzero-message is-error">{queueError}</p>}
        <div className="betzero-job-list" aria-label="Backtest jobs">
          <p>One running job, two waiting jobs; at most 50,000 pairs and ten minutes per job. Queued jobs wait until the separate worker is running.</p>
          {jobs.map(job => <article className="betzero-job" key={job.id}>
            <strong>{job.specification.mode === 'SEALED_FINAL' ? 'Sealed final-test evaluation' : 'Exploratory historical evaluation'}</strong>
            <span>{job.state} · {job.progress}% · {dateTime(job.createdAt)}</span>
            <progress max="100" value={job.progress} aria-label={`Job ${job.id} progress`} />
            {job.error && <p>{job.error}</p>}
            {['QUEUED','RUNNING'].includes(job.state) && <button className="btn btn-secondary" disabled={busy || job.cancelRequested} onClick={() => jobAction('job-cancel', { id:job.id })}>{job.cancelRequested ? 'Cancellation requested' : 'Cancel job'}</button>}
            {job.state === 'COMPLETED' && <button className="btn btn-secondary" disabled={busy} onClick={() => chooseBacktest(job.runId)}>View results</button>}
          </article>)}
          {!jobs.length && <p>No queued or saved jobs yet.</p>}
        </div>
        <details className="betzero-protocol-controls"><summary>Seal a future final-test protocol</summary>
          <p>Freeze the current strategy versions, enablement, rules and seed before these target draws occur. A cohort can be submitted only once, including after cancellation or failure. This does not enable strategies. Raw draws may still be visible elsewhere; this control prevents lab reuse, not outside inspection.</p>
          <form className="betzero-backtest-form" onSubmit={event => { event.preventDefault(); jobAction('protocols', { firstDraw, lastDraw, seed }); }}>
            <label>First future target draw<input type="number" min="2" required value={firstDraw} onChange={e => setFirstDraw(e.target.value)} /></label>
            <label>Last future target draw<input type="number" min="6" required value={lastDraw} onChange={e => setLastDraw(e.target.value)} /></label>
            <span>Frozen seed: {seed}</span><button className="btn btn-secondary" disabled={busy}>Seal protocol</button>
          </form>
          {protocols.map(protocol => <article className="betzero-job" key={protocol.id}>
            <strong>Targets {protocol.first}–{protocol.last} · {protocol.state}</strong>
            <span>Seed: {protocol.seed} · Rule hash: {protocol.rulesHash.slice(0,12)}</span>
            {protocol.state === 'SEALED' && <button className="btn btn-secondary" disabled={busy} onClick={() => jobAction('jobs', { protocolId:protocol.id })}>Queue sealed evaluation</button>}
          </article>)}
        </details>
        {backtest && <p className="betzero-section-note">{backtest.data.evaluationMode === 'SEALED_FINAL' ? 'Sealed final-test evaluation — consumed protocol; not a live forward test.' : 'Exploratory historical evaluation — holdout results can have been inspected before.'}</p>}
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
            <label>Strategy<select value={strategyKey(selectedStrategy)} onChange={event => setSelectedStrategyId(event.target.value)}>
              {strategies.map(strategy => <option key={strategyKey(strategy)} value={strategyKey(strategy)}>{strategy.label} · {strategy.status}</option>)}
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

    </>}
  </main>;
}
