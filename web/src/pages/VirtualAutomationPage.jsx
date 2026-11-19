import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../auth.js';
import { teamInfo } from '../virtual-teams.js';
import './virtual-automation.css';

// Modes the virtual football extension can bet, with the round result key for each.
const MODES = [
  ['OU', 'Over 1.5 Double', 'ou'], ['O25', 'Over 2.5 Single', 'o25'], ['UN', 'Under 1.5 Single', 'un'],
  ['1X2', 'Win Single', '1x2'], ['GG', 'GG Single', 'gg'], ['NG', 'NG Single', 'ng'],
];
const modeName = id => MODES.find(m => m[0] === id)?.[1] || id || '--';
const resultKey = id => MODES.find(m => m[0] === id)?.[2];
const COMMAND_LABELS = { START: 'Start', STOP: 'Stop', STAKE: 'Base stake', TP: 'Take profit', SL: 'Stop loss', MODE: 'Mode', RESET: 'Reset session' };
const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 });
const money = n => n == null || !Number.isFinite(Number(n)) ? '--' : naira.format(n);
const signed = n => !Number.isFinite(Number(n)) ? '--' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${naira.format(Math.abs(n))}`;
const clock = seconds => seconds ? new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
const describe = c => `${COMMAND_LABELS[c.type] || c.type}${c.value != null ? `: ${c.type === 'MODE' ? modeName(c.value) : money(c.value)}` : ''}`;
const scoreText = score => typeof score === 'string' && /\d+\s*-\s*\d+/.test(score) ? score.replace(/\s*-\s*/, '–') : null;
const TABS = [['match', 'Match centre'], ['setup', 'Game setup'], ['activity', 'Activity'], ['licence', 'Licence']];
const POLL_MS = 3000;

function Crest({ code, size = 'md' }) {
  const team = teamInfo(code);
  return <span className={`va-crest va-crest-${size}`} title={team.name}>
    {team.crest ? <img src={team.crest} alt="" loading="lazy" decoding="async" /> : <b aria-hidden="true">{team.code.slice(0, 1)}</b>}
  </span>;
}

// One match as a broadcast ticker line: crest, code, score (or v), code, crest.
function Fixture({ pick, large }) {
  const home = teamInfo(pick.home), away = teamInfo(pick.away), score = scoreText(pick.score);
  return <div className={`va-fixture${large ? ' is-large' : ''}`} aria-label={`${home.name} ${score ? `${score.replace('–', ' to ')}` : 'versus'} ${away.name}`}>
    <span className="va-side"><Crest code={pick.home} size={large ? 'lg' : 'md'} /><span className="va-team"><b>{home.code}</b>{large && <small>{home.name}</small>}</span></span>
    <span className={`va-score${score ? '' : ' is-pending'}`}>{score || 'v'}</span>
    <span className="va-side is-away"><span className="va-team"><b>{away.code}</b>{large && <small>{away.name}</small>}</span><Crest code={pick.away} size={large ? 'lg' : 'md'} /></span>
  </div>;
}

const pickLabel = (pick, mode) => mode === '1X2' ? (pick.pick === 'HOME' ? `${pick.home} to win` : pick.pick === 'AWAY' ? `${pick.away} to win` : 'Winner') : (pick.pick || modeName(mode).replace(/ (Single|Double)$/, ''));

export default function VirtualAutomationPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [key, setKey] = useState(''), [updated, setUpdated] = useState(null);
  const [form, setForm] = useState(null), [licenceKey, setLicenceKey] = useState('');
  const [tab, setTab] = useState('match'), [filter, setFilter] = useState('ALL');
  const polling = useRef(false), alive = useRef(true), tabRefs = useRef([]);

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
  async function link(event) { event.preventDefault(); await post('/account/virtual-automation/link', { key }, 'Licence key linked.'); setKey(''); }
  async function revealKey() {
    if (licenceKey) { setLicenceKey(''); return; }
    try { setLicenceKey((await apiRequest('/account/virtual-automation/key', { method: 'POST', body: '{}' })).key); }
    catch (e) { setNotice(e.message); }
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
  function tabKey(event, index) {
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : moves[event.key] != null ? (index + moves[event.key] + TABS.length) % TABS.length : null;
    if (next == null) return;
    event.preventDefault(); setTab(TABS[next][0]); tabRefs.current[next]?.focus();
  }

  const session = data?.session, st = session?.state || {}, stale = !!error || !updated || Date.now() - updated > 12000;
  const mode = st.bettingMode || 'OU';
  const picks = data?.round?.picks?.[mode] || [];
  const reported = session?.lastSeen != null;
  const running = !!st.botEnabled && reported;
  const ready = data?.linked && data.keyValid;
  const licence = data?.licence;
  const history = Array.isArray(st.betHistory) ? st.betHistory : [];
  const shown = history.filter(b => filter === 'ALL' || b.outcome === filter);
  const settled = history.filter(b => b.outcome === 'WIN' || b.outcome === 'LOSS');
  const wins = settled.filter(b => b.outcome === 'WIN').length;
  const net = settled.reduce((sum, b) => sum + (Number(b.profit) || 0), 0);
  const marketResults = (data?.results || []).filter(r => ['WIN', 'LOSS'].includes(r[resultKey(mode)])).slice(0, 12);
  const status = !ready ? 'Not linked' : stale ? 'No signal' : !session.online ? 'Extension offline' : running ? 'Live' : 'Stopped';

  const licencePanel = <section className="va-panel" aria-labelledby="va-licence-title">
    <h3 id="va-licence-title">Your licence</h3>
    <p className="va-licence-state">{licence?.status === 'active' ? `Active until ${new Date(licence.expiresAt).toLocaleDateString()}` : licence?.status === 'expired' ? 'Expired' : licence?.status === 'revoked' ? 'Revoked' : 'Not issued'}</p>
    {licence?.status === 'active'
      ? <><p>Enter this key in the virtual football extension popup. Keep it private.</p>
        <button type="button" className="va-button is-quiet" onClick={revealKey}>{licenceKey ? 'Hide my licence key' : 'Show my licence key'}</button>
        {licenceKey && <label className="va-field">Licence key<input type="text" readOnly value={licenceKey} onFocus={e => e.target.select()} /></label>}</>
      : <p>{licence ? 'Your virtual football licence is no longer active. Contact the owner to renew it.' : 'Contact the owner to get a virtual football licence.'}</p>}
  </section>;

  return <main className="page-wrap va-page">
    {/* The stadium: the one bold element. Everything below stays quiet. */}
    <section className={`va-stadium${running && !stale ? ' is-live' : ''}`} aria-labelledby="va-title">
      <svg className="va-pitch" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <defs><linearGradient id="va-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f4a32" /><stop offset="1" stopColor="#167048" /></linearGradient></defs>
        <polygon points="230,150 970,150 1200,420 0,420" fill="url(#va-grass)" />
        {[0, 1, 2, 3, 4, 5].map(i => <polygon key={i} points={`${230 + i * 123.3},150 ${230 + (i + 1) * 123.3},150 ${(i + 1) * 200},420 ${i * 200},420`} fill={i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)'} />)}
        <g fill="none" stroke="rgba(238,243,234,.55)" strokeWidth="2">
          <polygon points="230,150 970,150 1200,420 0,420" />
          <line x1="600" y1="150" x2="600" y2="420" />
          <ellipse cx="600" cy="262" rx="118" ry="44" />
          <polygon points="470,150 730,150 760,196 440,196" />
          <polygon points="355,420 845,420 800,348 400,348" />
        </g>
        <circle cx="600" cy="262" r="4" fill="rgba(238,243,234,.7)" />
      </svg>
      <span className="va-beam is-left" aria-hidden="true" /><span className="va-beam is-right" aria-hidden="true" />
      <div className="va-stadium-copy">
        <h1 id="va-title">Your virtual bot</h1>
        <p>{!data ? 'Connecting to your account...' : !ready ? 'Link your licence to bring your bot onto the pitch.' : !reported ? 'Open Bet9ja virtual football with the extension signed in using your licence key.' : `${modeName(mode)} at ${money(st.baseStake)} a bet. Last report ${clock(session.lastSeen)}.`}</p>
      </div>
      <div className="va-scoreboard" role="status" aria-label={`Bot status: ${status}`}>
        <span className={`va-onair${running && !stale ? ' is-on' : ''}`}><i aria-hidden="true" />{status}</span>
        <span className="va-board-cell"><small>Mode</small><b>{ready ? modeName(mode) : '--'}</b></span>
        <span className="va-board-cell is-score"><small>Session</small><b>{ready && reported ? signed(st.totalProfit || 0) : '--'}</b></span>
        <span className="va-board-cell"><small>Loss streak</small><b>{ready && reported ? st.localLossStreak || 0 : '--'}</b></span>
      </div>
      {ready && <div className="va-controls">
        <button type="button" className="va-button is-go" disabled={busy || stale || !session.online || st.botEnabled} onClick={start}>Start automation</button>
        <button type="button" className="va-button is-stop" disabled={busy || stale} onClick={() => send('STOP', undefined, 'Stop sent. A bet already placed still settles.')}>Stop automation</button>
      </div>}
    </section>

    {error && <div className="va-alert" role="alert">{error} {/sign in/i.test(error) && <a href="login.html">Sign in</a>}</div>}
    {notice && <p className="va-note" role="status">{notice}</p>}

    {data && !data.linked && <div className="va-grid">
      <section className="va-panel va-connect" aria-labelledby="va-link-title"><h2 id="va-link-title">Link your virtual football extension</h2>
        <p>Enter the licence key you use in the virtual football extension popup. It is stored encrypted and links only your own extension session.</p>
        <form onSubmit={link}><label className="va-field">Licence key<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" minLength="8" maxLength="200" required /></label>
          <button className="va-button is-go" disabled={busy}>Link my extension</button></form></section>
      {licencePanel}
    </div>}

    {data?.linked && data.keyValid === false && <section className="va-panel"><h2>Licence key no longer valid</h2><p>The licence key ending in {data.keyHint} is not accepted by the virtual football service. Contact the owner, or unlink it and link a new key.</p>
      <button type="button" className="va-button is-quiet" disabled={busy} onClick={() => post('/account/virtual-automation/unlink', {}, 'Licence key unlinked.')}>Unlink this key</button></section>}

    {ready && <>
      {session.pending.length > 0 && <p className="va-note" role="status">Waiting for your extension to pick up: {session.pending.map(describe).join(', ')}{!session.online && '. Your extension is offline; these are delivered when it reconnects.'}</p>}

      <div className="va-tabs" role="tablist" aria-label="Virtual automation sections">
        {TABS.map(([id, label], index) => <button key={id} type="button" role="tab" id={`va-tab-${id}`} aria-controls={`va-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
          ref={el => { tabRefs.current[index] = el; }} onKeyDown={e => tabKey(e, index)} onClick={() => setTab(id)}>{label}{id === 'activity' && history.length > 0 && <span className="va-count">{history.length}</span>}</button>)}
      </div>

      <section id="va-panel-match" role="tabpanel" aria-labelledby="va-tab-match" hidden={tab !== 'match'} className="va-tabpanel">
        <div className="va-grid">
          <section className="va-panel va-round" aria-labelledby="va-round-title">
            <h2 id="va-round-title">{data.round?.week ? `${data.round.week}: your ${modeName(mode)} pick` : 'Waiting for the next round'}</h2>
            {picks.length ? picks.map(p => <div key={`${p.home}-${p.away}`} className="va-round-pick"><Fixture pick={p} large /><p className="va-pick-label">{pickLabel({ ...p, pick: mode === '1X2' ? p.prediction : null }, mode)}</p></div>)
              : <p className="va-empty">{data.round?.week ? `No ${modeName(mode)} pick this round, so the extension sits it out.` : 'Picks appear when the next round opens.'}</p>}
            {st.pendingBet && <div className="va-inplay"><h3>Bet in play</h3><p>{money(st.pendingBet.stake)}{st.pendingBet.odds ? ` at ${Number(st.pendingBet.odds).toFixed(2)}` : ''}, {st.pendingBet.week}. Waiting for the result.</p>
              {(st.pendingBet.picks || []).map(p => <Fixture key={`${p.home}-${p.away}`} pick={p} />)}</div>}
          </section>
          <section className="va-panel" aria-labelledby="va-numbers-title"><h2 id="va-numbers-title">This session</h2>
            <dl className="va-stats">
              <div><dt>Profit or loss</dt><dd className={st.totalProfit > 0 ? 'va-pos' : st.totalProfit < 0 ? 'va-neg' : ''}>{signed(st.totalProfit || 0)}</dd></div>
              <div><dt>Losses to recover</dt><dd>{money(st.streakLoss || 0)}</dd></div>
              <div><dt>Current loss streak</dt><dd>{st.localLossStreak || 0}</dd></div>
              <div><dt>Worst loss streak</dt><dd>{st.maxLossStreakRec || 0}</dd></div>
              <div><dt>Current win streak</dt><dd>{st.winStreak || 0}</dd></div>
              <div><dt>Bets won in your log</dt><dd>{settled.length ? `${wins} of ${settled.length}` : '--'}</dd></div>
            </dl>
            <h3>Recent {modeName(mode)} rounds</h3>
            {marketResults.length ? <ol className="va-form" aria-label="Recent rounds, newest first">{marketResults.map(r => <li key={r.round_id || r.week} className={r[resultKey(mode)] === 'WIN' ? 'va-w' : 'va-l'} title={`${r.week}: ${r[resultKey(mode)] === 'WIN' ? 'won' : 'lost'}`}>{r[resultKey(mode)] === 'WIN' ? 'W' : 'L'}</li>)}</ol>
              : <p className="va-empty">No finished rounds yet.</p>}
            <p className="va-help">Published picks for all members, newest first. Market loss streak: {data.lossStreaks?.[mode] ?? 0}.</p>
          </section>
        </div>
      </section>

      <section id="va-panel-setup" role="tabpanel" aria-labelledby="va-tab-setup" hidden={tab !== 'setup'} className="va-tabpanel">
        <div className="va-grid">
          {form && <form className="va-panel va-settings" onSubmit={saveSettings} aria-labelledby="va-setup-title">
            <h2 id="va-setup-title">Mode, stake and limits</h2>
            <fieldset disabled={busy || stale}>
              <div className="va-modes" role="radiogroup" aria-label="Betting mode">{MODES.map(([id, label]) => <label key={id} className={`va-mode${form.mode === id ? ' is-selected' : ''}`}><input type="radio" name="va-mode" value={id} checked={form.mode === id} onChange={() => setForm(f => ({ ...f, mode: id }))} />{label}</label>)}</div>
              <div className="va-fields">
                <label className="va-field">Base stake (NGN)<input type="number" min="1" max="1000000" step="1" value={form.stake} onChange={e => setForm(f => ({ ...f, stake: e.target.value }))} required /></label>
                <label className="va-field">Take profit (NGN, 0 = off)<input type="number" min="0" max="100000000" step="1" value={form.tp} onChange={e => setForm(f => ({ ...f, tp: e.target.value }))} /></label>
                <label className="va-field">Stop loss (NGN, 0 = off)<input type="number" min="0" max="100000000" step="1" value={form.sl} onChange={e => setForm(f => ({ ...f, sl: e.target.value }))} /></label>
              </div>
              <div className="va-actions"><button className="va-button is-go">Send changes to my extension</button>
                <button type="button" className="va-button is-quiet" onClick={() => setForm({ mode: st.bettingMode || 'OU', stake: st.baseStake ?? '', tp: st.takeProfit ?? 0, sl: Math.abs(st.stopLoss ?? 0) })}>Reload from extension</button></div>
            </fieldset>
            <p className="va-help">Changes apply on the extension's next check, within a few seconds, and also update its popup. A bet already placed is not changed.</p>
          </form>}
          <div className="va-stack">
            <section className="va-panel" aria-labelledby="va-limits-title"><h2 id="va-limits-title">Set in the extension popup</h2>
              <dl className="va-stats is-compact">
                <div><dt>Max loss streak</dt><dd>{st.maxLossStreak ? st.maxLossStreak : 'Not reported'}</dd></div>
                <div><dt>Max stake</dt><dd>{st.maxStake ? money(st.maxStake) : 'Off'}</dd></div>
                <div><dt>Min total odds</dt><dd>{st.minOdds ? Number(st.minOdds).toFixed(2) : 'Not reported'}</dd></div>
              </dl></section>
            <section className="va-panel" aria-labelledby="va-reset-title"><h2 id="va-reset-title">Reset session</h2>
              <p>Clears the extension's profit, win and loss streaks and any recovery in progress. Mode, stakes and limits stay the same.</p>
              <button type="button" className="va-button is-quiet" disabled={busy || stale || !!st.pendingBet} onClick={reset}>Reset extension session</button>
              {st.pendingBet && <p className="va-help">Wait for the bet awaiting its result to settle first; a reset would stop it being counted.</p>}</section>
          </div>
        </div>
      </section>

      <section id="va-panel-activity" role="tabpanel" aria-labelledby="va-tab-activity" hidden={tab !== 'activity'} className="va-tabpanel">
        <section className="va-panel" aria-labelledby="va-activity-title">
          <div className="va-panel-head"><h2 id="va-activity-title">Games your bot played</h2>
            <div className="va-filter" role="group" aria-label="Show">{[['ALL', 'All'], ['WIN', 'Won'], ['LOSS', 'Lost']].map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
          {settled.length > 0 && <p className="va-summary">{settled.length} settled {settled.length === 1 ? 'bet' : 'bets'}, {wins} won, net <strong className={net > 0 ? 'va-pos' : net < 0 ? 'va-neg' : ''}>{signed(net)}</strong></p>}
          {!shown.length ? <p className="va-empty">{history.length ? 'No bets match this filter.' : 'Bets appear here after your extension places them. Extension 3.6 or newer reports them.'}</p>
            : <ol className="va-log">{shown.map(b => <li key={`${b.roundId}-${b.mode}-${b.placedAt}`} className={`va-log-row is-${(b.outcome || 'unknown').toLowerCase()}`}>
                <div className="va-log-meta"><b>{b.week || 'Round'}</b><span>{modeName(b.mode)}</span></div>
                <div className="va-log-games">{(b.picks || []).length ? b.picks.map(p => <div key={`${p.home}-${p.away}`} className="va-log-game"><Fixture pick={p} /><small>{pickLabel(p, b.mode)}</small></div>) : <span className="va-help">Matches not recorded</span>}</div>
                <div className="va-log-money"><span>{money(b.stake)}{b.odds ? ` at ${Number(b.odds).toFixed(2)}` : ''}</span>
                  <b>{b.outcome === 'WIN' ? `Won ${signed(b.profit)}` : b.outcome === 'LOSS' ? `Lost ${money(b.stake)}` : 'Result unknown'}</b></div>
              </li>)}</ol>}
          <p className="va-help">The last 30 bets your extension reports, newest first. Scores come from the virtual match feed. Unknown results were not counted in your profit; check them on Bet9ja.</p>
        </section>
      </section>

      <section id="va-panel-licence" role="tabpanel" aria-labelledby="va-tab-licence" hidden={tab !== 'licence'} className="va-tabpanel">
        <div className="va-grid">
          {licencePanel}
          <div className="va-stack">
            <section className="va-panel" aria-labelledby="va-connection-title"><h2 id="va-connection-title">Connection</h2>
              <dl className="va-stats is-compact"><div><dt>Licence key</dt><dd>Ends in {data.keyHint}</dd></div><div><dt>Extension</dt><dd>{st.extensionVersion || 'Not reported'}</dd></div><div><dt>Last report</dt><dd>{reported ? clock(session.lastSeen) : 'Never'}</dd></div></dl>
              {session.delivered.length > 0 && <><h3>Recently delivered commands</h3><ul className="va-delivered">{session.delivered.map(c => <li key={c.id}>{describe(c)}, from {c.source === 'telegram' ? 'Telegram' : 'this dashboard'} at {clock(c.deliveredAt)}</li>)}</ul></>}
              <button type="button" className="va-link-button" disabled={busy} onClick={() => { if (window.confirm('Unlink this licence key from your account? Your extension keeps running.')) post('/account/virtual-automation/unlink', {}, 'Licence key unlinked.'); }}>Unlink licence key</button>
            </section>
          </div>
        </div>
      </section>
    </>}
    <p className="va-footnote">Keep Bet9ja and the extension open; this page can be closed. Virtual results are random and past results do not predict the next round.</p>
  </main>;
}
