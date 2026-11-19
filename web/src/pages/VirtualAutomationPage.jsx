import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../auth.js';
import './automation.css';

// Modes the virtual football extension can bet, with the round result key for each.
const MODES = [
  ['OU', 'Over 1.5 Double', 'ou'], ['O25', 'Over 2.5 Single', 'o25'], ['UN', 'Under 1.5 Single', 'un'],
  ['1X2', 'Win Single', '1x2'], ['GG', 'GG Single', 'gg'], ['NG', 'NG Single', 'ng'],
];
const modeName = id => MODES.find(m => m[0] === id)?.[1] || id || '--';
const resultKey = id => MODES.find(m => m[0] === id)?.[2];
const COMMAND_LABELS = { START: 'Start', STOP: 'Stop', STAKE: 'Base stake', TP: 'Take profit', SL: 'Stop loss', MODE: 'Mode', RESET: 'Reset session' };
const money = n => n == null || !Number.isFinite(Number(n)) ? '--' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(n);
const time = seconds => seconds ? new Date(seconds * 1000).toLocaleTimeString() : '--';
const describe = c => `${COMMAND_LABELS[c.type] || c.type}${c.value != null ? `: ${c.type === 'MODE' ? modeName(c.value) : money(c.value)}` : ''}`;
const POLL_MS = 3000;

export default function VirtualAutomationPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [key, setKey] = useState(''), [updated, setUpdated] = useState(null);
  const [form, setForm] = useState(null);
  const polling = useRef(false), alive = useRef(true);

  const load = useCallback(async () => {
    if (polling.current) return; polling.current = true;
    try {
      const next = await apiRequest('/account/virtual-automation');
      if (!alive.current) return;
      setData(next); setUpdated(Date.now()); setError('');
      const st = next.session?.state;
      // Fill the form once from what the extension reports; later polls never overwrite edits.
      if (st) setForm(current => current || { mode: st.bettingMode || 'OU', stake: st.baseStake ?? '', tp: st.takeProfit ?? 0, sl: Math.abs(st.stopLoss ?? 0) });
    } catch (e) { if (alive.current) setError(e.message); }
    finally { polling.current = false; }
  }, []);
  useEffect(() => { alive.current = true; load(); const timer = setInterval(load, POLL_MS); return () => { alive.current = false; clearInterval(timer); }; }, [load]);

  async function post(path, body, success) {
    setBusy(true); setError(''); setNotice('');
    try { await apiRequest(path, { method: 'POST', body: JSON.stringify(body) }); if (success) setNotice(success); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const send = (type, value, success) => post('/account/virtual-automation/command', { type, value }, success);

  async function link(event) {
    event.preventDefault();
    await post('/account/virtual-automation/link', { key }, 'Licence key linked.');
    setKey('');
  }
  function start() {
    if (!window.confirm('Start placing real virtual football bets in your connected Bet9ja tab? Starting clears the current loss streak, so the next bet uses your base stake.')) return;
    send('START', undefined, 'Start sent. It reaches your extension within a few seconds.');
  }
  function reset() {
    if (!window.confirm('Reset this extension session? This clears its profit, win and loss streaks and any recovery in progress. It does not stop automation.')) return;
    send('RESET', undefined, 'Reset sent.');
  }
  async function saveSettings(event) {
    event.preventDefault();
    const st = data.session.state;
    const changes = [];
    if (form.mode !== st.bettingMode) changes.push(['MODE', form.mode]);
    if (Number(form.stake) !== Number(st.baseStake)) changes.push(['STAKE', Number(form.stake)]);
    if (Number(form.tp) !== Number(st.takeProfit || 0)) changes.push(['TP', Number(form.tp)]);
    if (Number(form.sl) !== Math.abs(Number(st.stopLoss || 0))) changes.push(['SL', Number(form.sl)]);
    if (!changes.length) { setNotice('Nothing changed.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      for (const [type, value] of changes) await apiRequest('/account/virtual-automation/command', { method: 'POST', body: JSON.stringify({ type, value }) });
      setNotice(`${changes.length} ${changes.length === 1 ? 'change' : 'changes'} sent. They reach your extension within a few seconds.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const session = data?.session, st = session?.state || {}, stale = !!error || !updated || Date.now() - updated > 12000;
  const mode = st.bettingMode || 'OU';
  const picks = data?.round?.picks?.[mode] || [];
  const results = (data?.results || []).filter(r => ['WIN', 'LOSS'].includes(r[resultKey(mode)])).slice(0, 15);
  const reported = session?.lastSeen != null;

  return <main className="page-wrap automation-page">
    <section className="automation-hero"><div><span className="overline">VIRTUAL FOOTBALL AUTOMATION</span><h1>Your virtual bot.</h1><p>See what your extension is doing and control it from here.</p></div>
      <div className="automation-hero-meta"><span className="automation-live-label">{updated && !stale ? 'Status updated' : 'Waiting for status'}</span><strong>{updated ? new Date(updated).toLocaleTimeString() : '--'}</strong><a href="virtual-football.html">Virtual predictions ↗</a></div></section>
    {error && <div className="automation-warning" role="alert">{error} {/sign in/i.test(error) && <a href="login.html">Sign in</a>}</div>}
    {notice && <p className="automation-notice" role="status">{notice}</p>}
    {!data && !error && <p role="status">Connecting to your account...</p>}

    {data && !data.linked && <section className="content-card automation-connect"><span className="overline">ONE-TIME CONNECTION</span><h2>Link your virtual football extension</h2>
      <p>Enter the licence key you use in the virtual football extension popup. It is stored encrypted and links only your own extension session.</p>
      <form onSubmit={link}><label>Licence key<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" minLength="8" maxLength="200" required /></label>
        <button className="btn btn-primary" disabled={busy}>Link my extension</button></form></section>}

    {data?.linked && data.keyValid === false && <section className="content-card"><h2>Licence key no longer valid</h2><p>The licence key ending in {data.keyHint} is not accepted by the virtual football service. Contact the owner, or unlink it and link a new key.</p>
      <button className="btn btn-secondary" disabled={busy} onClick={() => post('/account/virtual-automation/unlink', {}, 'Licence key unlinked.')}>Unlink this key</button></section>}

    {data?.linked && data.keyValid && <>
      <section className="automation-control-bar content-card"><div>
        <span className={`automation-status ${session.online && !stale ? 'online' : ''}`}>{stale ? 'Status unavailable' : session.online ? 'Extension connected' : 'Extension offline'}</span>
        <h2>{!reported ? 'Waiting for your extension' : st.botEnabled ? 'Automation running' : 'Automation stopped'}</h2>
        <p>{!reported ? 'Open Bet9ja virtual football with the extension signed in using this licence key.' : `Mode: ${modeName(mode)} · Base stake ${money(st.baseStake)}`}</p>
        <small>Licence key ending {data.keyHint} / Last report: {reported ? time(session.lastSeen) : 'never'}{st.extensionVersion ? ` / Extension ${st.extensionVersion}` : ''}</small></div>
        <div className="automation-actions">
          <button className="btn btn-primary" disabled={busy || stale || !session.online || st.botEnabled} onClick={start}>Start automation</button>
          <button className="btn automation-stop" disabled={busy || stale} onClick={() => send('STOP', undefined, 'Stop sent. A bet already placed still settles.')}>Stop automation</button>
        </div></section>

      {session.pending.length > 0 && <p className="automation-notice" role="status">Waiting for your extension to pick up: {session.pending.map(describe).join(' · ')}{!session.online && '. Your extension is offline; these are delivered when it reconnects.'}</p>}

      <section className="automation-metrics">{[
        ['Session profit / loss', money(st.totalProfit)],
        ['Current loss streak', `${st.localLossStreak || 0} rounds`],
        ['Losses to recover', money(st.streakLoss || 0)],
        ['Worst loss streak', `${st.maxLossStreakRec || 0} rounds`],
        ['Current win streak', `${st.winStreak || 0} rounds`],
        ['Bet awaiting result', st.pendingBet ? `${money(st.pendingBet.stake)} · ${st.pendingBet.week || ''}` : 'None'],
      ].map(([label, value]) => <article className="content-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>

      <div className="automation-overview-grid">
        <section className="content-card automation-snapshot"><div className="automation-section-title"><h2>This round</h2><span className="automation-caption">{data.round?.week || 'Waiting for picks'}</span></div>
          {picks.length ? <ul>{picks.map(p => <li key={`${p.home}-${p.away}`}><strong>{p.home} v {p.away}</strong>{mode === '1X2' && p.prediction ? ` · ${p.prediction}` : ''}</li>)}</ul>
            : <p className="automation-help">{data.round?.week ? `No ${modeName(mode)} pick this round; the extension skips it.` : 'Picks appear when the next round opens.'}</p>}
          <p className="automation-help">Market loss streak for {modeName(mode)}: {data.lossStreaks?.[mode] ?? 0} rounds (all members).</p></section>

        <section className="content-card automation-snapshot"><div className="automation-section-title"><h2>Limits set in the extension</h2></div>
          <dl className="automation-limit-list">
            <div><dt>Take profit</dt><dd>{st.takeProfit ? money(st.takeProfit) : 'Off'}</dd></div>
            <div><dt>Stop loss</dt><dd>{st.stopLoss ? money(Math.abs(st.stopLoss)) : 'Off'}</dd></div>
            <div><dt>Max loss streak</dt><dd>{st.maxLossStreak ? `${st.maxLossStreak} rounds` : 'Not reported'}</dd></div>
            <div><dt>Max stake</dt><dd>{st.maxStake ? money(st.maxStake) : 'Off'}</dd></div>
            <div><dt>Min total odds</dt><dd>{st.minOdds ? Number(st.minOdds).toFixed(2) : 'Not reported'}</dd></div>
          </dl><p className="automation-help">Max loss streak, max stake and minimum odds are changed in the extension popup.</p></section>
      </div>

      {form && <form className="content-card automation-settings" onSubmit={saveSettings}>
        <div className="automation-section-title"><div><span className="overline">CHANGE YOUR SETUP</span><h2>Mode, stake and limits</h2></div></div>
        <fieldset disabled={busy || stale}><div className="automation-fields">
          <label>Betting mode<select value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}>{MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Base stake (NGN)<input type="number" min="1" max="1000000" step="1" value={form.stake} onChange={e => setForm(f => ({ ...f, stake: e.target.value }))} required /></label>
          <label>Take profit (NGN, 0 = off)<input type="number" min="0" max="100000000" step="1" value={form.tp} onChange={e => setForm(f => ({ ...f, tp: e.target.value }))} /></label>
          <label>Stop loss (NGN, 0 = off)<input type="number" min="0" max="100000000" step="1" value={form.sl} onChange={e => setForm(f => ({ ...f, sl: e.target.value }))} /></label>
        </div>
          <button className="btn btn-primary">Send changes to my extension</button>
          <button type="button" className="btn btn-secondary" onClick={() => setForm({ mode: st.bettingMode || 'OU', stake: st.baseStake ?? '', tp: st.takeProfit ?? 0, sl: Math.abs(st.stopLoss ?? 0) })}>Reload from extension</button>
        </fieldset>
        <p className="automation-help">Changes apply on the extension's next check, within a few seconds, and also update its popup. A bet already placed is not changed.</p></form>}

      <section className="content-card automation-history"><div className="automation-section-title"><div><span className="overline">RECENT ROUNDS</span><h2>{modeName(mode)} results</h2></div><span className="automation-caption">Published picks, newest first</span></div>
        {!results.length ? <div className="automation-empty"><h3>No settled {modeName(mode)} rounds yet</h3><p>Results appear here after each round finishes.</p></div>
          : <div className="automation-table" tabIndex="0" role="region" aria-label="Recent results"><table><thead><tr><th>Week</th><th>Result</th></tr></thead><tbody>
            {results.map(r => <tr key={r.round_id || r.week}><td data-label="Week">{r.week}</td><td data-label="Result"><span className={`outcome-badge ${r[resultKey(mode)].toLowerCase()}`}>{r[resultKey(mode)]}</span></td></tr>)}</tbody></table></div>}
        <p className="automation-help">These are the published picks' results, not your own bets: skipped rounds and odds below your minimum were not bet.</p></section>

      {session.delivered.length > 0 && <section className="content-card"><h2>Recently delivered commands</h2><ul>{session.delivered.map(c => <li key={c.id}>{describe(c)} · {c.source === 'telegram' ? 'Telegram' : 'Dashboard'} · delivered {time(c.deliveredAt)}</li>)}</ul></section>}

      <section className="content-card"><h2>Reset session</h2><p>Clears the extension's profit, win and loss streaks and any recovery in progress. Mode, stakes and limits stay the same.</p>
        <button type="button" className="btn btn-secondary" disabled={busy || stale || !!st.pendingBet} onClick={reset}>Reset extension session</button>
        {st.pendingBet && <p className="automation-help">Wait for the bet awaiting its result to settle first; a reset would stop it being counted.</p>}</section>
      <button className="text-button automation-unlink" disabled={busy} onClick={() => { if (window.confirm('Unlink this licence key from your account? Your extension keeps running.')) post('/account/virtual-automation/unlink', {}, 'Licence key unlinked.'); }}>Unlink licence key</button>
    </>}
    <p className="automation-help">Keep Bet9ja and the extension open; this page can be closed. Virtual results are random and past results do not predict the next round.</p>
  </main>;
}
