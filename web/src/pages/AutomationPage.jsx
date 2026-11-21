import AutomationEmailReports from '../components/AutomationEmailReports';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../auth.js';
import './automation.css';
import './balls49-automation.css';
import AutomationSuggestion from '../components/AutomationSuggestion';
import AutomationRollover from '../components/AutomationRollover';
const games = [['betzero','BetZero','u4'],['bet49','Bet49','bet49'],['rainbow','Rainbow','color'],['hilo','High / Low','sum'],['totalColor','Total Color 3-way','totalColor'],['totalColor1','Winning Color','totalColor1']];
const money = n => n == null ? '--' : new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(n);
const copy = value => JSON.parse(JSON.stringify(value));
const ballColor = n => Number(n) === 49 ? 'yellow' : Number(n) % 3 === 1 ? 'red' : Number(n) % 3 === 2 ? 'blue' : 'green';
const COLOR_NAMES = { red: 'Red', blue: 'Blue', green: 'Green', black: 'No winning colour', yellow: 'Gold' };
const gameName = id => games.find(g => g[0] === id)?.[1] || (id === 'betzeroSingle' ? 'BetZero Single' : id);
const isBallNumber = v => /^\d{1,2}$/.test(String(v).trim()) && Number(v) >= 1 && Number(v) <= 49;
function Ball({ n, color, size }) {
  const shade = color || ballColor(n);
  return <span className={`ba-ball is-${shade}${size ? ` is-${size}` : ''}`} title={n != null ? `Ball ${n}` : COLOR_NAMES[shade]}>{n != null ? n : ''}</span>;
}
function selectionItems(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value.topColors || value.top2 || value.top1 || (value.key ? [value.key] : []);
  return [value];
}
// A pick as it appears in the game: numbered balls, colour chips, or a High/Low badge.
function Selection({ value }) {
  const items = selectionItems(value);
  if (!items.length) return <span className="ba-muted">--</span>;
  return <span className="ba-selection">{items.map((item, i) => isBallNumber(item) ? <Ball key={i} n={Number(item)} size="sm" />
    : COLOR_NAMES[String(item).toLowerCase()] ? <span key={i} className={`ba-chip is-${String(item).toLowerCase()}`}><i aria-hidden="true" />{COLOR_NAMES[String(item).toLowerCase()]}</span>
    : <span key={i} className="ba-tag">{String(item)}</span>)}</span>;
}
// The last played draw's picks, resting in the glass draw tube.
function DrawTube({ row }) {
  const balls = row ? row.games.flatMap(g => selectionItems(g.selections).map(item => isBallNumber(item) ? { n: Number(item) } : COLOR_NAMES[String(item).toLowerCase()] ? { color: String(item).toLowerCase() } : null).filter(Boolean)).slice(0, 7) : [];
  return <figure className="ba-tube-wrap" aria-label={row ? `Your last pick, draw ${row.drawId}` : 'No picks played yet'}>
    <div className="ba-tube">{balls.length ? balls.map((b, i) => <span key={i} className="ba-tube-slot" style={{ '--i': i }}><Ball n={b.n} color={b.color} size="lg" /></span>)
      : <span className="ba-tube-empty">Your picks land here after the first bet.</span>}</div>
    <figcaption>{row ? `Your last pick, draw #${row.drawId}` : 'Waiting for the first draw'}</figcaption>
  </figure>;
}

export default function AutomationPage() {
 const [data,setData]=useState(null), [draft,setDraft]=useState(null), [draftRevision,setDraftRevision]=useState(null), [key,setKey]=useState('');
 const [error,setError]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false), [updated,setUpdated]=useState(null);
 const [accessKey,setAccessKey]=useState('');
 const [setupOpen,setSetupOpen]=useState(false);
 const [section,setSection]=useState(()=>new URLSearchParams(window.location.search).has('suggestion')?'strategies':window.location.hash==='#rollover'?'rollover':'overview');
 const [historyQuery,setHistoryQuery]=useState(''), [historyOutcome,setHistoryOutcome]=useState('ALL');
 async function revealKey() {
  try { const result=await apiRequest('/account/automation/key',{method:'POST'}); setAccessKey(result.key||''); if(!result.key) setNotice('Contact the owner to issue your extension access.'); }
  catch(e){setNotice(e.message);}
 }
 const polling=useRef(false), alive=useRef(true), loadedSettings=useRef(null), draftRef=useRef(null);
 useEffect(()=>{draftRef.current=draft;},[draft]);
 // The form follows the saved settings (including saves made from the extension while it has
 // control) unless you have unsaved edits here; then "Reload saved settings" brings them in.
 const load=useCallback(async () => {
  if (polling.current) return; polling.current=true;
  try { const next=await apiRequest('/account/automation'); if (!alive.current) return; setData(next); setUpdated(Date.now()); setError('');
   if (next.control) {
    const saved=JSON.stringify(next.control.settings);
    const current=draftRef.current;
    if (!current || JSON.stringify(current)===loadedSettings.current) { loadedSettings.current=saved; setDraft(copy(next.control.settings)); setDraftRevision(next.control.revision); }
   } }
  catch(e) { if(alive.current) setError(e.message); } finally { polling.current=false; }
 },[]);
 useEffect(()=>{ alive.current=true; load(); const timer=setInterval(load,3000); return()=>{alive.current=false;clearInterval(timer);}; },[load]);
 async function link(event) { event.preventDefault(); setBusy(true); setError(''); try { await apiRequest('/account/automation/link',{method:'POST',body:JSON.stringify({key})}); setKey(''); await load(); } catch(e){setError(e.message);} finally{setBusy(false);} }
 // Start runs the saved settings. Changes still only in the form (such as ticking gap windows
 // without pressing Save) are saved first, so Start never silently drops them.
 const unsavedChanges=!!draft && loadedSettings.current!==null && JSON.stringify(draft)!==loadedSettings.current;
 const settingsPayload=()=>({...draft,unifiedMode:false,weightedStaking:false,gapEntry:Object.fromEntries(Object.entries(draft.gapEntry||{}).map(([id,v])=>[id,{...v,policy:'CONTINUOUS_GAP_WINDOWS_V2'}]))});
 async function command(action) {
  const saveFirst=action==='start'&&unsavedChanges;
  if(action==='start' && !window.confirm(saveFirst?'Save your changes in Game setup, then start placing real bets in your connected Bet9ja tab with them?':'Start placing real bets in your connected Bet9ja tab using these saved settings?')) return;
  if(action==='reset' && !window.confirm('Reset this execution session? This clears martingale and sniper progression, stop-loss/take-profit session totals and recent session activity. Saved games, stakes and limits stay unchanged. Automation stays stopped.')) return;
  if((action==='save'||saveFirst) && Object.values(draft.gapEntry||{}).some(v=>v.enabled) && !window.confirm('Save continuous gap playing windows? Play every eligible draw, recalculate the window at its end, and preserve recovery stakes across windows. SKIPs count as draws without advancing stakes. If automatic gap selection is checked, a better-supported level may replace the current level at a window boundary.')) return;
  setBusy(true); setNotice(''); setError('');
  let saved=false;
  const reloadSaved=async()=>{const next=await apiRequest('/account/automation'); setData(next); setUpdated(Date.now()); loadedSettings.current=next.control?JSON.stringify(next.control.settings):null; setDraft(next.control?copy(next.control.settings):null); setDraftRevision(next.control?.revision??null);};
  try {
   let revision=action==='save'?draftRevision:data.control.revision;
   if(saveFirst){
    await apiRequest('/account/automation/command',{method:'POST',body:JSON.stringify({action:'save',revision:draftRevision,settings:settingsPayload()})});
    saved=true;
    revision=(await apiRequest('/account/automation')).control.revision;
   }
   await apiRequest('/account/automation/command',{method:'POST',body:JSON.stringify({action,revision,settings:action==='save'?settingsPayload():undefined})});
   setNotice(action==='reset'?'Execution session reset. Saved settings are kept. Press Start when ready.':action==='save'?'Settings saved. Automation remains stopped.':action==='start'?`${saveFirst?'Your changes were saved and start':'Start'} accepted. Keep Bet9ja and the extension connected. You can close this dashboard.`:action==='stop'?'Stopped. Already submitted bets can still settle.':'Control updated. Automation is paused.');
   await reloadSaved();
  }catch(e){
   // Saved but not started: the form now shows the saved settings; say so with the reason.
   if(saved){setError(`Your changes were saved, but automation did not start: ${e.message}`); await reloadSaved().catch(()=>{});}
   else setError(e.message);
  }finally{setBusy(false);}
 }
 function field(name,value){setDraft(d=>({...d,[name]:value}));}
 // An old saved rollover has maxDoublings (doublings before a pause), which is loss steps - 1.
 function rolloverDraft(){const{maxDoublings,...rest}=draft.rollover||{};return{enabled:false,baseStake:0,...rest,lossSteps:rest.lossSteps??(maxDoublings!=null?Number(maxDoublings)+1:4)};}
 function nested(name,id,value){setDraft(d=>({...d,[name]:{...d[name],[id]:value}}));}
 function gap(id,name,value){setDraft(d=>({...d,gapEntry:{...d.gapEntry,[id]:{enabled:false,losses:3,...d.gapEntry?.[id],[name]:value}}}));}
 function sniper(id,name,value){setDraft(d=>({...d,sniperSettings:{...d.sniperSettings,[id]:{...d.sniperSettings?.[id],[name]:value}}}));}
 const c=data?.control, web=c?.controller==='website', stale=!!error || !updated || Date.now()-updated>12000;
 const selectedGames=games.filter(([id])=>c?.settings?.enabledGames?.[id]);
 const rolloverOn=!!c?.settings?.rollover?.enabled;
 const canStart=selectedGames.length>0||rolloverOn;
 const historyRows=(c?.history||[]).flatMap(row=>row.games.map((game,index)=>({...game,drawId:row.drawId,index}))).filter(row=>(historyOutcome==='ALL'||row.result===historyOutcome)&&`${row.drawId} ${gameName(row.game)}`.toLowerCase().includes(historyQuery.toLowerCase().trim()));
 const gapStatuses=Object.entries(c?.gapEntry||{});
 const nextStep=stale?'Waiting for a fresh connection.':!web?'Choose Use website control to manage this session here.':!c?.online?'Open Bet9ja with the extension connected.':c?.suggestionStrategy?.needsReview?'Review and reapply your strategy before starting.':!canStart?'Choose a strategy, enable a game in Settings or turn on the Rollover.':c?.running?'Your saved setup is running.':c?.busy?'An execution or recovery sequence is in progress.':'Your saved setup is ready. Press Start when you want to begin.';
 const sections=[['overview','Overview'],['strategies','Strategies'],['rollover','Rollover'],['activity','Activity'],['reports','Email reports'],['settings','Settings']];
 const tabRefs=useRef([]);
 function tabKey(event,index){const moves={ArrowRight:1,ArrowLeft:-1};const next=event.key==='Home'?0:event.key==='End'?sections.length-1:moves[event.key]!=null?(index+moves[event.key]+sections.length)%sections.length:null;if(next==null)return;event.preventDefault();setSection(sections[next][0]);tabRefs.current[next]?.focus();}

 return <main className="page-wrap automation-page ba-page">
  {gapStatuses.length>0 && <section className="content-card" aria-label="Gap entry status"><h2>Continuous gap windows</h2>{gapStatuses.map(([id,status])=><p key={id}><strong>{games.find(g=>g[0]===id)?.[1]||id}:</strong> {status.phase} | Auto gap: {status.autoSelect ? "ON" : "OFF"} | Selected level: {status.threshold} | {status.selection?.reason || "No automatic review yet"} | {status.losses}/{status.threshold} losses · Average gap: {status.averageGap == null ? "Waiting for history" : `${status.averageGap.toFixed(1)} draws`} ({status.gapSamples || 0} prior gaps) · Window: {status.completedDraws ?? 0}/{status.windowLength ?? "--"} draws | #{status.windowStart ?? "--"} to #{status.windowEnd ?? "--"}</p>)}</section>}
   <section className={`ba-studio${c?.running&&!stale?' is-live':''}`} aria-labelledby="ba-title">
    <div className="ba-studio-copy"><h1 id="ba-title">Your 49ja bot</h1>
     <p>{!data?'Connecting to your account...':!data.linked?'Link your extension to bring your bot into the studio.':c?.reason}</p>
     <small>{updated?`Status updated at ${new Date(updated).toLocaleTimeString()}`:'Waiting for status'}. <a href="guide.html">Automation guide</a></small></div>
    <DrawTube row={c?.history?.[0]} />
    {c && <div className="ba-board" role="status" aria-label="Session board">
     <span className={`ba-board-state${c.running&&!stale?' is-live':''}`}><i aria-hidden="true" />{stale?'No signal':!c.online?'Extension offline':c.running?'Live':'Paused'}</span>
     <span className="ba-board-cell is-profit"><small>Session</small><b className={c.profit>0?'ba-pos':c.profit<0?'ba-neg':''}>{money(c.profit)}</b></span>
     <span className="ba-board-cell"><small>Record</small><b>{c.wins} W {c.losses} L</b></span>
     <span className="ba-board-cell"><small>Losing streak</small><b>{c.currentLossStreak || 0}</b></span>
     <span className="ba-board-cell"><small>Control</small><b>{web?'Website':'Extension'}</b></span>
    </div>}
    {c && <div className="ba-controls"><button className="btn btn-primary" disabled={busy||stale||!web||!c.online||c.running||!canStart||!!c.suggestionStrategy?.needsReview} onClick={()=>command('start')}>Start automation</button><button className="btn automation-stop" disabled={busy} onClick={()=>command('stop')}>Stop automation</button><button className="btn btn-secondary" disabled={busy||stale} onClick={()=>command(web?'extension':'website')}>{web?'Use extension control':'Use website control'}</button></div>}
   </section>
  {error && <div className="automation-warning" role="alert">{error} <a href="login.html">Sign in</a></div>}
  {notice && <p className="automation-notice" role="status">{notice}</p>}

  {!c && <details className="content-card automation-account"><summary>Extension access <span>Membership &amp; private access key</span></summary><h2>Extension membership</h2><p>The Elite + Extension bundle is NGN 120,000 for 30 days and includes all prediction markets. After the owner approves extension access, retrieve your key here to unlock the extension.</p><button className="btn btn-secondary" onClick={()=>accessKey?setAccessKey(''):revealKey()}>{accessKey?'Hide my access key':'Show my extension access key'}</button>{accessKey&&<label>Keep this key private<input type="text" readOnly value={accessKey} onFocus={e=>e.target.select()} /></label>}</details>}
  {!data && !error && <p role="status">Connecting to your account...</p>}
  {data && !data.linked && <section className="content-card automation-connect"><span className="overline">ONE-TIME CONNECTION</span><h2>Link your extension</h2><p>Enter your own extension access key. This links the same session you already use in the extension. It is not your Bet9ja password or the site admin key.</p><form onSubmit={link}><label>Extension access key<input type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" minLength="32" maxLength="256" required /></label><button className="btn btn-primary" disabled={busy}>Connect my extension</button></form><p>Your key is stored encrypted. Keep it private.</p></section>}
  {c && <>
   <div className="automation-next-step"><span>SESSION STATUS</span><p>{nextStep}</p></div>
   <p className="automation-session-note">Keep Bet9ja and the extension open. You can close this dashboard.</p>
    <div className="ba-tabs" role="tablist" aria-label="Automation sections">{sections.map(([id,label],index)=><button type="button" key={id} role="tab" id={`automation-tab-${id}`} aria-selected={section===id} tabIndex={section===id?0:-1} aria-controls={`automation-${id}`} ref={el=>{tabRefs.current[index]=el;}} onKeyDown={e=>tabKey(e,index)} onClick={()=>setSection(id)}>{label}{id==='activity'&&c.history.length>0&&<span className="ba-count">{c.history.length}</span>}</button>)}</div>
   <section id="automation-overview" role="tabpanel" aria-labelledby="automation-tab-overview" hidden={section!=='overview'}>
   <div className="automation-section-title"><div><span className="overline">AT A GLANCE</span><h2>Session performance</h2></div><span className="automation-caption">Since your last execution reset</span></div>

   <section className="automation-metrics">{[['Reported Bet9ja balance',money(c.liveBalance)],['Calculated balance',money(c.virtualBalance)],['Session profit / loss',money(c.profit)],['Session record',`${c.wins} wins / ${c.losses} losses`],['Current losing streak',`${c.currentLossStreak || 0} draws`],['Worst losing streak',`${c.maxLossStreak || 0} draws`]].map(([label,value])=><article className="content-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
   <p className="automation-help">Balance reported {c.balanceAt?new Date(c.balanceAt).toLocaleString():'not yet'}. {(!c.balanceAt||Date.now()-c.balanceAt>15000||stale)&&'Balance data is stale.'} Calculated balance is the bot ledger, not a confirmed bookmaker balance.</p>
   <p className="automation-help">Streaks count consecutive settled played draws with no winning game. Skipped draws are excluded; a mixed draw with a win breaks the losing streak. Worst streak covers this execution session.</p>
   <div className="automation-overview-grid">
    <section className="content-card automation-snapshot"><div className="automation-section-title"><h2>Saved strategy</h2><button type="button" className="text-button" onClick={()=>setSection('strategies')}>Manage strategies &rarr;</button></div><div className="automation-pills"><span>Individual games</span><span>{c.suggestionStrategy?.request.autoUpdate?'Auto updates ON':'Auto updates OFF'}</span></div>
    {selectedGames.length?<div className="automation-saved-games">{selectedGames.map(([id,label])=><div key={id}><div><strong>{label}</strong><small>Step {c.steps?.[id]||1}{c.settings.gameSteps?.[id]?` of ${c.settings.gameSteps[id]}`:''}</small></div><div><strong>{money(c.settings.stakes?.[id])}</strong><small>Base per selection</small></div></div>)}</div>:<div className="automation-empty"><h3>No games enabled</h3><p>Choose a strategy or configure your games to get started.</p><button type="button" className="btn btn-secondary" onClick={()=>setSection('strategies')}>Choose a strategy</button></div>}
    {c.suggestionStrategy&&<p className="automation-help">{c.suggestionStrategy.message}</p>}</section>
    <section className="content-card automation-snapshot"><div className="automation-section-title"><h2>Session limits</h2><button type="button" className="text-button" onClick={()=>{setSection('settings');setSetupOpen(true);}}>Edit limits &rarr;</button></div><dl className="automation-limit-list"><div><dt>Take profit</dt><dd>{c.settings.takeProfit?money(c.settings.takeProfit):'Not set'}</dd></div><div><dt>Stop loss</dt><dd>{c.settings.stopLoss?money(Math.abs(c.settings.stopLoss)):'Not set'}</dd></div><div><dt>Allocated capital</dt><dd>{c.suggestionStrategy?.capital!=null?money(c.suggestionStrategy.capital):'Manual stakes'}</dd></div><div><dt>Recovery status</dt><dd>{c.busy?'Execution or recovery in progress':'Ready for a new sequence'}</dd></div><div><dt>Email reports</dt><dd>{data.emailReports?.enabled?`Every ${data.emailReports.interval} played draws`:'Off'}</dd></div></dl><p className="automation-help">Limits use saved settings. A pending bet can still settle after you press Stop.</p></section>
   </div>
   </section>
   <section id="automation-reports" role="tabpanel" aria-labelledby="automation-tab-reports" hidden={section!=='reports'}>
   {data.emailReports && <AutomationEmailReports settings={data.emailReports} onSaved={emailReports=>setData(d=>({...d,emailReports}))} />}
   </section>
   <section id="automation-strategies" role="tabpanel" aria-labelledby="automation-tab-strategies" hidden={section!=='strategies'}>
   <AutomationSuggestion control={c} disabled={busy||stale} onUseWebsite={()=>command('website')} onSaved={async()=>{const next=await apiRequest('/account/automation');setData(next);loadedSettings.current=JSON.stringify(next.control.settings);setDraft(copy(next.control.settings));setDraftRevision(next.control.revision);setNotice('Suggested plans saved. Review the setup and press Start when ready.');}} />
   </section>
   <section id="automation-rollover" role="tabpanel" aria-labelledby="automation-tab-rollover" hidden={section!=='rollover'}>
   <AutomationRollover control={c} draft={draft} onChange={value=>field('rollover',value)} onSave={()=>command('save')} disabled={busy||!web||c.running||stale||!draft} draftStale={draftRevision!==c.revision} />
   {!web&&<p className="automation-help">Choose Use website control to change the rollover here.</p>}
   </section>
   <section id="automation-settings" role="tabpanel" aria-labelledby="automation-tab-settings" hidden={section!=='settings'}>
   <div className="automation-section-title"><div><span className="overline">CONFIGURE YOUR SESSION</span><h2>Settings &amp; access</h2></div></div>
  <details className="content-card automation-account"><summary>Extension access <span>Membership &amp; private access key</span></summary><h2>Extension membership</h2><p>The Elite + Extension bundle is NGN 120,000 for 30 days and includes all prediction markets. After the owner approves extension access, retrieve your key here to unlock the extension.</p><button className="btn btn-secondary" onClick={()=>accessKey?setAccessKey(''):revealKey()}>{accessKey?'Hide my access key':'Show my extension access key'}</button>{accessKey&&<label>Keep this key private<input type="text" readOnly value={accessKey} onFocus={e=>e.target.select()} /></label>}</details>
   {draft && <details className="automation-setup-panel" open={setupOpen} onToggle={e=>setSetupOpen(e.currentTarget.open)}><summary>Game setup <span>Games, stakes, sniper &amp; limits</span></summary><form className="automation-settings" onSubmit={e=>{e.preventDefault();command('save');}}>
    <div className="automation-section-title"><div><span className="overline">YOUR GAME SETUP</span><h2>Games &amp; stakes</h2></div><button type="button" className="btn btn-secondary" disabled={busy||stale} onClick={()=>{loadedSettings.current=JSON.stringify(c.settings);setDraft(copy(c.settings));setDraftRevision(c.revision);}}>Reload saved settings</button></div>
    {unsavedChanges && draftRevision===c.revision && <p className="automation-warning" role="status">You have unsaved changes. Press Save settings, or Start automation (it saves them first).</p>}
    {draftRevision!==c.revision && <p className="automation-help">The settings were saved again (in another tab) while you were editing. Reload saved settings to see them, then make your change.</p>}
    {c.suggestionStrategy && <p className="automation-warning">Saving this manual setup replaces the suggested plan and disables automatic strategy updates. Use the Strategies section to keep capital sizing.</p>}
    <fieldset disabled={busy||!web||c.running||stale}>
    <div className="automation-game-grid">{games.map(([id,label,internal])=><article className="content-card automation-game" key={id}><label className="automation-check"><input type="checkbox" checked={!!draft.enabledGames?.[id]} onChange={e=>nested('enabledGames',id,e.target.checked)} /><strong>{label}</strong><small>Step {c.steps?.[id] || 1}</small></label><div className="automation-fields"><label>Base stake{['bet49','totalColor'].includes(id)?' per selection':''}<input type="number" min="0" max="50000" step="1" value={draft.stakes?.[id]??0} onChange={e=>nested('stakes',id,Number(e.target.value))} /></label><label>Max steps (0 = off)<input type="number" min="0" max="1000" value={draft.gameSteps?.[id]??0} onChange={e=>nested('gameSteps',id,Number(e.target.value))} /></label></div><details><summary>Gap playing windows</summary><label className="automation-check"><input type="checkbox" checked={!!draft.gapEntry?.[id]?.enabled} onChange={e=>gap(id,'enabled',e.target.checked)} />Enable continuous gap windows</label><label className="automation-check"><input type="checkbox" checked={!!draft.gapEntry?.[id]?.autoSelect} onChange={e=>gap(id,'autoSelect',e.target.checked)} />Automatically choose a better-supported gap for the next window</label><label>Initial loss level used to measure average spacing<input type="number" min="1" max="100" step="1" value={draft.gapEntry?.[id]?.losses??3} onChange={e=>gap(id,'losses',Number(e.target.value))} /></label><p className="automation-help">Use the selected loss level to measure historical spacing, not to wait for losses. The average of up to 100 continuous gaps is rounded up to whole draws (minimum two gaps). Play every eligible draw in that window, then recalculate and immediately open another. SKIPs count toward the window but place no bet and do not advance martingale. A window ending after a LOSS preserves the next recovery stake. Existing entry filters, execution checks and safety limits still apply. Automatic review uses the last 30 gaps per level: at least 10 gaps, variation no greater than the mean, and no more than 35% drift between sample halves. A supported current level is replaced only with at least as many samples and a 25% stronger support score. This does not predict wins.</p>{c.gapEntry?.[id] && <p role="status"><strong>{c.gapEntry[id].phase}</strong> | {c.gapEntry[id].selection?.reason || "No automatic level change yet"} | {c.gapEntry[id].losses}/{c.gapEntry[id].threshold} losses · Average gap: {c.gapEntry[id].averageGap == null ? "Waiting for history" : `${c.gapEntry[id].averageGap.toFixed(1)} draws`} ({c.gapEntry[id].gapSamples || 0} prior gaps) · Window: {c.gapEntry[id].completedDraws ?? 0}/{c.gapEntry[id].windowLength ?? "--"} draws</p>}<p className="automation-help">Individual mode only (set from the website or the extension, whichever is in control); incompatible with automatic suggestions, shadow mode and rollover. This is not a demo-account lock: select Demo in Bet9ja before testing. Historical gaps do not make a win due.</p></details><details><summary>Sniper &amp; entry</summary><label className="automation-check"><input type="checkbox" checked={!!draft.sniperSettings?.[id]?.enabled} onChange={e=>sniper(id,'enabled',e.target.checked)} />Enable sniper</label><div className="automation-fields"><label>Entry step<input type="number" min="0" max="10" value={draft.sniperSettings?.[id]?.step??0} onChange={e=>sniper(id,'step',Number(e.target.value))} /></label><label>Pause after losses<input type="number" min="0" max="50" value={draft.sniperSettings?.[id]?.resetLosses??0} onChange={e=>sniper(id,'resetLosses',Number(e.target.value))} /></label></div>{['u4','color','sum','totalColor'].includes(internal)&&<label>Summary entry<select value={draft.summaryModelMarkets?.[internal]?draft.summaryModelTargets?.[internal]||'ENTER':'ANY'} onChange={e=>{nested('summaryModelMarkets',internal,e.target.value!=='ANY');nested('summaryModelTargets',internal,e.target.value==='HOLD'?'HOLD':'ENTER');}}><option value="ANY">Any summary</option><option>ENTER</option><option>HOLD</option></select></label>}</details></article>)}<article className="content-card automation-game" key="rollover"><label className="automation-check"><input type="checkbox" checked={!!draft.rollover?.enabled} onChange={e=>field('rollover',{...rolloverDraft(),enabled:e.target.checked})} /><strong>BZ Single Rollover</strong><small>BetZero 1.10</small></label><div className="automation-fields"><label>Base stake<input type="number" min="0" max="50000" step="1" value={draft.rollover?.baseStake??0} onChange={e=>field('rollover',{...rolloverDraft(),baseStake:Number(e.target.value)})} /></label><label>Loss steps (1-20)<input type="number" min="1" max="20" step="1" value={rolloverDraft().lossSteps} onChange={e=>field('rollover',{...rolloverDraft(),lossSteps:Number(e.target.value)})} /></label></div><p className="automation-help">The Bet49 number on BetZero, rolled over for the Bet49 gap window after each Bet49 win. <button type="button" className="text-button" onClick={()=>setSection('rollover')}>Open the Rollover tab &rarr;</button></p></article></div>
    <section className="content-card automation-risk"><h2>Limits &amp; progression</h2><div className="automation-fields"><label>Take profit (NGN, 0 = off)<input type="number" min="0" max="10000000" value={draft.takeProfit||0} onChange={e=>field('takeProfit',Number(e.target.value))} /></label><label>Stop loss (NGN, 0 = off)<input type="number" min="0" max="10000000" value={Math.abs(draft.stopLoss||0)} onChange={e=>field('stopLoss',-Number(e.target.value))} /></label><label>High / Low progression<select value={draft.hiloMultiplier||2} onChange={e=>field('hiloMultiplier',Number(e.target.value))}><option value="2">2x</option><option value="1.4">1.4x</option></select></label><label>Bet49 profit (7.80 odds; next recovery cycle)<select value={draft.bet49ProfitMode||'fixed'} onChange={e=>field('bet49ProfitMode',e.target.value)}><option value="fixed">Same profit</option><option value="accumulating">Accumulating profit</option></select></label><label>Winning Color profit<select value={draft.tc1ProfitMode||'fixed'} onChange={e=>field('tc1ProfitMode',e.target.value)}><option value="fixed">Same base profit</option><option value="accumulating">Accumulating profit</option></select></label></div><label className="automation-check"><input type="checkbox" checked={!!draft.flatBetting} onChange={e=>field('flatBetting',e.target.checked)} />Flat betting</label>
    <details><summary>Expert settings</summary>{[['bzRbRollover','BetZero / Rainbow rollover'],['hiloRollover','High / Low rollover'],['tc3Rollover','3-way rollover'],['shadowMode','Shadow mode'],].map(([id,label])=><label className="automation-check" key={id}><input type="checkbox" checked={!!draft[id]} onChange={e=>field(id,e.target.checked)} />{label}</label>)}<div className="automation-fields">{[['tc3RolloverTarget','3-way rollover target',2,10],['cbMaxLosses','Circuit-breaker losses',0,50],['cbCooldown','Cooldown draws',0,300]].map(([id,label,min,max])=><label key={id}>{label}<input type="number" min={min} max={max} value={draft[id]??min} onChange={e=>field(id,Number(e.target.value))} /></label>)}</div></details></section>
    <button className="btn btn-primary" disabled={draftRevision!==c.revision}>Save settings (keep paused)</button>
    </fieldset><p className="automation-help">Settings can be saved while automation is stopped and no placed bet is waiting to settle. Start saves any unsaved changes first. Martingale and sniper progression (such as a game at step 2) are kept.</p>
   </form></details>}
   <section className="content-card"><h2>Reset execution session</h2><p>Start a fresh session after hitting stop loss or take profit. Clears session profit/loss, win rate, trade counts, progression and overlay runtime; keeps saved games, stakes and limits. Calculated balance restarts from the reported Bet9ja balance. Automation stays stopped until you start it again.</p><button type="button" className="btn btn-secondary" disabled={busy||stale||c.running} onClick={()=>command('reset')}>Reset execution session</button>{c.running&&<p>Stop automation before resetting.</p>}</section>
   <details className="content-card automation-account"><summary>Connection help</summary><p>Closing this dashboard does not stop automation. Keep Bet9ja and the extension connected. A disconnect longer than 15 seconds pauses new bets. Reconnect, review your session and press Start again. Switching controllers pauses automation and preserves progression.</p></details>
   <button className="text-button automation-unlink" disabled={busy} onClick={()=>{if(window.confirm('Stop automation and unlink this extension session?'))command('unlink');}}>Stop and unlink extension</button>
   </section>
   <section id="automation-activity" role="tabpanel" aria-labelledby="automation-tab-activity" hidden={section!=='activity'}>
   <section className="content-card automation-history"><div className="automation-section-title"><div><span className="overline">YOUR PLAYED GAMES</span><h2>Session activity</h2></div><span className="automation-caption">Latest {c.history.length} draws &middot; newest first</span></div><div className="automation-history-filters"><label>Find a draw or game<input type="search" value={historyQuery} placeholder="Draw ID or game name" onChange={e=>setHistoryQuery(e.target.value)} /></label><label>Result<select value={historyOutcome} onChange={e=>setHistoryOutcome(e.target.value)}><option value="ALL">All results</option><option value="WIN">Wins</option><option value="LOSS">Losses</option><option value="PENDING">Pending</option><option value="UNKNOWN">Unknown</option></select></label></div>
   {!historyRows.length?<div className="automation-empty"><h3>{c.history.length?'No matching activity':'Your activity will appear here'}</h3><p>{c.history.length?'Try another game, draw ID or result filter.':'Placed bets appear once reported by your extension.'}</p></div>:<div className="automation-table" tabIndex="0" role="region" aria-label="Recent played games"><table><thead><tr><th>Draw</th><th>Game</th><th>Selections</th><th>Total stake</th><th>Result</th></tr></thead><tbody>{historyRows.map(row=><tr key={`${row.drawId}-${row.index}`}><td data-label="Draw">#{row.drawId}</td><td data-label="Game">{gameName(row.game)}</td><td data-label="Selections"><Selection value={row.selections} /></td><td data-label="Total stake">{money(row.stake)}</td><td data-label="Result"><span className={`outcome-badge ${row.result.toLowerCase()}`}>{row.result}</span></td></tr>)}</tbody></table></div>}<p className="automation-help">Up to 100 draws. Check pending and partial submissions against your Bet9ja slip.</p></section>
   </section>
  </>}
 </main>;
}
