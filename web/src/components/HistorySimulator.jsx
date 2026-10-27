import React, { useEffect, useRef, useState } from 'react';
import { simulateHistory, simulationGames } from '../history-simulator.js';
import './history-simulator.css';
const API = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';
const cash = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(n);

export default function HistorySimulator() {
  const [game, setGame] = useState('betzero'), [base, setBase] = useState('100'), [range, setRange] = useState('100'), [mode, setMode] = useState('fixed');
  const [report, setReport] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [shown, setShown] = useState(50);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(event) {
    event.preventDefault(); controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setReport(null); setShown(50);
    try {
      const records = []; let offset = 0, total = Infinity, anchor = null;
      const requested = range === 'all' ? Infinity : Number(range);
      while (offset < Math.min(total, requested)) {
        const limit = Math.min(1000, requested - offset);
        const response = await fetch(`${API}?limit=${limit}&offset=${offset}&range=all`, { cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('History could not be loaded. Please try again.');
        const data = await response.json();
        if (!Array.isArray(data.predictions) || !Number.isFinite(Number(data.total))) throw new Error('History returned an incomplete response.');
        total = Number(data.total);
        if (!data.predictions.length) break;
        if (anchor === null) anchor = Number(data.predictions[0].drawId);
        records.push(...data.predictions.filter(r => Number(r.drawId) <= anchor));
        offset += data.predictions.length;
      }
      if (request.signal.aborted) return;
      if (!records.length) throw new Error('No recorded draws are available for simulation yet.');
      const result = simulateHistory(records, game, Number(base), mode);
      setReport({ ...result, game: simulationGames.find(g => g[0] === game)[1], base: Number(base), range, mode, odds: simulationGames.find(g => g[0] === game)[2] });
    } catch (e) { if (!request.signal.aborted) setError(e.message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <details className="history-simulator content-card">
    <summary><span><span className="overline">REPLAY YOUR HISTORY</span><strong>Stake simulator</strong><small>Choose a game. See how your stake would have progressed.</small></span><span aria-hidden="true">+</span></summary>
    <div className="simulator-body">
      <form onSubmit={run} className="simulator-form">
        <label>Game<select disabled={busy} value={game} onChange={e => { setGame(e.target.value); setMode('fixed'); }}>{simulationGames.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Base stake (NGN){['bet49','totalColor','totalColor2'].includes(game) && <small>Per {game === 'bet49' ? 'number' : 'selection'}</small>}<input disabled={busy} type="number" inputMode="decimal" min="1" max="1000000" step="0.01" required value={base} onChange={e => setBase(e.target.value)} /></label>
        <label>Draws to replay<select disabled={busy} value={range} onChange={e => setRange(e.target.value)}>{[10,50,100,200,500,1000].map(n => <option key={n} value={n}>Last {n} draws</option>)}<option value="all">All available draws</option></select></label>
        <label>Recovery mode<select disabled={busy} value={mode} onChange={e => setMode(e.target.value)}>{game === 'totalColor1' ? <><option value="fixed">Same base profit</option><option value="accumulating">Accumulating profit</option></> : game === 'hilo' ? <><option value="fixed">2x progression</option><option value="1.4">1.4x progression</option></> : <option value="fixed">{game === 'totalColor' ? 'Recover losses' : game === 'totalColor2' ? 'Recover + base stake' : 'Same base profit'}</option>}</select></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Loading history...' : 'Run simulation'}</button>
        {busy && <button type="button" className="btn btn-secondary" onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancel</button>}
      </form>
      <p className="simulator-note">Replays oldest to newest, starting at your base stake. A recorded win resets the sequence; skips preserve it. Uses calculator recovery rules and current odds. No sniper, summary gates, rollover, stop limits or live bets. Unified is not included.</p>
      {error && <p role="alert" className="simulator-warning">{error}</p>}
      {report && <section aria-label="Simulation results">
        <header className="simulator-report-heading"><div><span className="overline">SIMULATION SNAPSHOT</span><h2>{report.game}</h2><p>{cash(report.base)} base / {report.odds.toFixed(2)} odds / {report.available} available draws / {report.mode === 'accumulating' ? 'Accumulating profit' : report.mode === '1.4' ? '1.4x progression' : 'Standard recovery'}</p></div><div className={`simulator-net ${report.net < 0 ? 'negative' : ''}`}><span>Net profit / loss</span><strong>{cash(report.net)}</strong></div></header>
        {report.stop && <p role="status" className="simulator-warning">{report.stop} Totals below cover only the replayed rows.</p>}
        {report.range !== 'all' && report.available < Number(report.range) && <p className="simulator-warning">Only {report.available} of the requested {report.range} draws are stored. Older deleted history cannot be replayed.</p>}
        <div className="simulator-metrics">{[['Total staked',cash(report.staked)],['Total returns',cash(report.returned)],['Largest draw stake',cash(report.largest)],['Maximum drawdown',cash(report.maxDrawdown)],['Starting funds needed',cash(report.funding)],['Worst losing streak',`${report.worst} losses`]].map(([label,value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
        <p className="simulator-result-line">{report.wins} wins / {report.losses} losses / {report.skipped} skipped / {report.rows.length} draws replayed</p>
        <p className="simulator-note">Starting funds needed is the minimum to place each simulated stake before receiving returns. Drawdown is the largest drop from a previous balance peak. Results assume every selection was placed successfully at the stated odds; fees and bookmaker limits are not modeled. Historical outcomes do not guarantee future returns.</p>
        {report.unrecovered > 0 && <p className="simulator-warning">The replay ends with an unfinished losing sequence: {cash(report.unrecovered)} staked in that sequence.</p>}
        <div className="simulator-table-wrap" tabIndex="0" role="region" aria-label="Draw by draw simulation, scroll horizontally"><table><caption>Draw-by-draw replay (oldest first)</caption><thead><tr><th>Draw</th><th>Step</th><th>Unit stake</th><th>Selections</th><th>Total stake</th><th>Return</th><th>Result</th><th>Net so far</th></tr></thead><tbody>{report.rows.slice(0,shown).map(row => <tr key={row.id}><td>#{row.id}</td><td>{row.step}</td><td>{cash(row.stake)}</td><td>{row.count}</td><td>{cash(row.cost)}</td><td>{cash(row.payout)}</td><td><span className={`outcome-badge ${row.outcome.toLowerCase()}`}>{row.outcome}</span></td><td>{cash(row.net)}</td></tr>)}</tbody></table></div>
        {shown < report.rows.length && <button type="button" className="btn btn-secondary" onClick={() => setShown(n => n + 50)}>Show 50 more draws ({shown} of {report.rows.length})</button>}
      </section>}
    </div>
  </details>;
}
