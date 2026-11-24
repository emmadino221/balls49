import GapSuggestion from '../components/GapSuggestion';
import BetZeroSingleGapPreview from '../components/BetZeroSingleGapPreview';
import React, { useEffect, useMemo, useState } from 'react';
import { losingStreakGaps } from '../losing-streak-gaps';
import './gap-analysis.css';
const API = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';
const games = [['betzero','BetZero'],['bet49','Bet49'],['betzeroSingle','BetZero Single'],['rainbow','Rainbow'],['hilo','High / Low'],['totalColor','Total Color 3-way'],['totalColor1','Winning Color'],];
const colors = ['#267cce','#b56b19','#398361','#9658cc','#d34e6a','#53858f','#818590'];
const fmt = n => n == null ? 'N/A' : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
function Bars({ rows, field, selected, onSelect, unit, wins = false }) {
  const max = Math.max(1,...rows.map(r => r[field] || 0));
  return <div className="gap-bars">{rows.map(row => <button type="button" key={row.level} aria-pressed={selected===row.level} onClick={()=>onSelect(row.level)} aria-label={`${row.level} ${wins ? 'wins' : 'losses'}: ${fmt(row[field])} ${unit}`}>
    <span>{row.level}{wins ? 'W' : 'L'}</span><span className="gap-bar-track"><i style={{width:`${(row[field] || 0)/max*100}%`}} /></span><strong>{fmt(row[field])}</strong>
  </button>)}</div>;
}
function Pie({ rows, wins = false }) {
  const positive = rows.filter(r=>r.count>0), first = positive.slice(0,6);
  const slices = [...first.map(r=>({label:`${r.level} ${wins ? 'wins' : 'losses'}`,count:r.count})), ...(positive.length>6?[{label:'Other lengths',count:positive.slice(6).reduce((a,r)=>a+r.count,0)}]:[])];
  const total = slices.reduce((a,r)=>a+r.count,0);let offset=0;
  if (!total) return <p className="gap-empty">No confirmed completed streaks in this window.</p>;
  return <div className="gap-pie"><svg viewBox="0 0 160 160" role="img" aria-label={`Distribution of ${total} completed ${wins ? 'winning' : 'losing'} streaks; values in adjacent legend`}>
    {slices.map((r,i)=>{const fraction=r.count/total*100,start=offset;offset+=fraction;return <circle key={r.label} cx="80" cy="80" r="55" fill="none" stroke={colors[i]} strokeWidth="24" pathLength="100" strokeDasharray={`${fraction} ${100-fraction}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"><title>{r.label}: {r.count} ({fraction.toFixed(1)}%)</title></circle>;})}
    <text x="80" y="78" textAnchor="middle" className="gap-pie-number">{total}</text><text x="80" y="96" textAnchor="middle" className="gap-pie-caption">streaks</text></svg>
    <ul>{slices.map((r,i)=><li key={r.label}><i style={{background:colors[i]}}/><span>{r.label}</span><strong>{r.count} / {(r.count/total*100).toFixed(1)}%</strong></li>)}</ul></div>;
}
export default function GapAnalysisPage() {
  const [market,setMarket]=useState('bet49'),[range,setRange]=useState('1000'),[view,setView]=useState('levels'),[level,setLevel]=useState(3);
  const [snapshot,setSnapshot]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [autoRefresh,setAutoRefresh]=useState(false),[windowBusy,setWindowBusy]=useState(false);
  useEffect(()=>{
    if(!autoRefresh || loading || windowBusy)return;
    const tick=()=>{if(!document.hidden)setRefresh(n=>n+1);};
    const timer=setTimeout(tick,10000);
    document.addEventListener('visibilitychange',tick);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',tick);};
  },[autoRefresh,loading,windowBusy,refresh]);
  useEffect(()=>{
    let active=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    setLoading(true);setError('');
    (async()=>{try {
      const response=await fetch(`${API}?limit=${range}&offset=0&range=${range}`,{cache:'no-store',credentials:'include',signal:controller.signal});
      if(!response.ok)throw new Error('History could not be loaded.');
      const data=await response.json();if(!Array.isArray(data.predictions))throw new Error('History returned an incomplete response.');
      if(active)setSnapshot({records:data.predictions,range,at:new Date().toISOString()});
    }catch(e){if(active)setError('Unable to refresh history. Retry when your connection is available.');}finally{clearTimeout(timer);if(active)setLoading(false);}})();
    return()=>{active=false;controller.abort();clearTimeout(timer);};
  },[range,refresh]);
  const wins = market === 'betzeroSingle';
  const streakWord = wins ? 'win' : 'loss';
  const records=snapshot?.records || [];
  const report=useMemo(()=>losingStreakGaps(records,market,view,wins ? 'WIN' : 'LOSS'),[records,market,view]);
  const completed=useMemo(()=>losingStreakGaps(records,market,'completed',wins ? 'WIN' : 'LOSS'),[records,market]);
  const chosen=report.rows.find(r=>r.level===level) || null;
  const selected=chosen || {level,count:0,gaps:[],ids:[],average:null,minimum:null,maximum:null,since:null};
  const recent=selected.gaps.slice(-30), maxGap=Math.max(1,...recent,selected.average||0);
  const label=games.find(g=>g[0]===market)[1];
  const provisional=report.breaks>0||report.unresolved>0||report.boundaryRuns>0||report.lowerBound;
  return <main className="page-wrap gap-page">
    <header className="gap-hero content-card"><div><span className="overline">PATTERNS IN YOUR HISTORY</span><h1>See the space between streaks.</h1><p>Explore streak frequency, draw gaps and recent occurrences for each game.</p></div><a className="btn btn-secondary" href="history.html">Prediction history</a></header>
    <section className="content-card gap-controls" aria-label="Analysis controls">
      <label>History window<select value={range} onChange={e=>setRange(e.target.value)}>{[100,200,500,1000].map(n=><option key={n} value={n}>Last {n} draws</option>)}</select></label>
      <label>Counting method<select value={view} onChange={e=>setView(e.target.value)}><option value="levels">{wins ? 'Win' : 'Loss'} levels reached</option><option value="completed">Completed streaks: exact length</option></select></label>
      <label>Explore {streakWord} level<input type="number" min="1" max={Math.max(100,report.worst)} value={level} onChange={e=>setLevel(Math.max(1,Math.min(Math.max(100,report.worst),Math.floor(Number(e.target.value))||1)))} /></label>
      <button type="button" className="btn btn-primary" disabled={loading||windowBusy} onClick={()=>setRefresh(n=>n+1)}>{loading?'Loading history...':'Refresh charts'}</button>
      <button type="button" className="btn btn-secondary" aria-pressed={autoRefresh} onClick={()=>setAutoRefresh(v=>!v)}>Auto refresh: {autoRefresh?'ON':'OFF'}</button>
      <p className="gap-refresh-help">{autoRefresh?'Refreshes every 10 seconds after requests finish; pauses while this tab is hidden or settings are saving.':'Automatic refresh is off. Use Refresh charts or Calculate playing window for a manual update.'} Refreshing never applies settings or starts automation.</p>
    </section>
    <nav className="gap-games" aria-label="Select prediction market">{games.map(([id,name])=><button type="button" key={id} aria-pressed={market===id} onClick={()=>setMarket(id)}>{name}</button>)}</nav>
    {market === 'betzeroSingle'
      ? <BetZeroSingleGapPreview onBusy={setWindowBusy} key={`${market}:${level}`} records={records} level={level} loading={loading || !!error} autoRefresh={autoRefresh} snapshotAt={snapshot?.at} />
      : <GapSuggestion key={`${market}:${level}`} snapshotAt={snapshot?.at} autoRefresh={autoRefresh} onBusy={setWindowBusy} level={level} records={records} market={market} label={label} loading={loading || !!error} />}
    {error&&<p role="alert" className="content-card">{error} {snapshot?'Charts retain the previous snapshot.':''}</p>}
    <p className="gap-coverage" role="status">{snapshot?`${label} | ${report.count} loaded / ${snapshot.range} requested draws | #${report.first || '?'} to #${report.latest || '?'} | Refreshed ${new Date(snapshot.at).toLocaleTimeString()}`:'Loading your first history snapshot...'} {provisional?'Partial / provisional coverage.':''}</p>
    <section className="gap-kpis" aria-label="Market overview">{[[report.pending?`Last known ${streakWord} run`:`Current ${streakWord} run`,`${report.lowerBound?'At least ':''}${report.run}`],['Largest observed run',report.worst],['Selected level',`${level} ${wins ? 'wins' : 'losses'}`],['Occurrences',selected.count]].map(([name,value])=><article className="content-card" key={name}><span>{name}</span><strong>{value}</strong></article>)}</section>
    <div className="gap-chart-grid">
      <section className="content-card"><span className="overline">HOW OFTEN?</span><h2>{wins ? 'Winning' : 'Losing'}-streak frequency</h2><p>Click a bar to explore that {streakWord} level. Values are occurrence counts.</p>{report.rows.length?<Bars wins={wins} rows={report.rows} field="count" selected={level} onSelect={setLevel} unit="occurrences"/>:<p className="gap-empty">No {wins ? 'winning' : 'losing'} streaks observed.</p>}</section>
      <section className="content-card"><span className="overline">SHARE OF COMPLETED STREAKS</span><h2>Streak-length distribution</h2><p>This pie always uses completed exact-length streaks, so categories do not overlap.</p><Pie wins={wins} rows={completed.rows}/></section>
      <section className="content-card"><span className="overline">HOW FAR APART?</span><h2>Average draw gap by {streakWord} level</h2><p>Each bar shows the average distance between confirmed occurrences.</p>{report.rows.length?<Bars wins={wins} rows={report.rows} field="average" selected={level} onSelect={setLevel} unit="draws"/>:<p className="gap-empty">More continuous history is needed.</p>}</section>
      <section className="content-card"><span className="overline">YOUR SELECTED LEVEL: {level} {wins ? 'WINS' : 'LOSSES'}</span><h2>Gap at a glance</h2><div className="gap-selected-stats">{[['Average gap',selected.average],['Shortest gap',selected.minimum],['Longest gap',selected.maximum],['Draws since last',selected.since]].map(([name,n])=><div key={name}><span>{name}</span><strong>{fmt(n)} <small>draws</small></strong></div>)}</div><p>{selected.gaps.length} valid consecutive-occurrence gaps. {selected.ids.length?`Latest occurrence: #${selected.ids.at(-1)}.`:'No confirmed occurrence at this level.'}</p><a className="btn btn-secondary" href="automation.html">Open automation settings</a></section>
    </div>
    <section className="content-card gap-trend"><span className="overline">GAP VARIATION: {level} {wins ? 'WINS' : 'LOSSES'}</span><h2>Most recent observed gaps</h2><p>Oldest to newest, up to 30 gaps. Dashed line: average across all valid gaps in this snapshot.</p>
      {recent.length?<><svg viewBox="0 0 720 250" role="img" aria-label={`Recent draw gaps: ${recent.join(', ')}. Average ${fmt(selected.average)} draws.`}>
        {[0,.5,1].map(t=><g key={t}><line x1="45" y1={210-t*170} x2="705" y2={210-t*170} className="gap-gridline"/><text x="38" y={214-t*170} textAnchor="end">{Math.round(t*maxGap)}</text></g>)}
        {recent.map((gap,i)=><rect key={i} x={50+i*650/recent.length} y={210-gap/maxGap*170} width={Math.max(3,650/recent.length-5)} height={gap/maxGap*170} rx="3" className="gap-trend-bar"><title>Gap {selected.gaps.length-recent.length+i+1}: {gap} draws</title></rect>)}
        <line x1="45" x2="705" y1={210-(selected.average||0)/maxGap*170} y2={210-(selected.average||0)/maxGap*170} className="gap-average-line"/><text x="45" y="240">Older</text><text x="705" y="240" textAnchor="end">Newer</text></svg><details><summary>Read chart values and occurrence draw IDs</summary><p>Recent gaps: {recent.join(', ')} draws.</p><p>Occurrence IDs: {selected.ids.map(n=>`#${n}`).join(', ')}</p></details></>:<p className="gap-empty">At least two confirmed occurrences in continuous history are needed to show a gap.</p>}
    </section>
    <details className="content-card gap-method"><summary>How to read these charts</summary><p>In level mode, four consecutive {wins ? 'wins' : 'losses'} count once at levels 1, 2, 3 and 4, dated at the result reaching each level. In completed mode, they count only at length 4 when the opposite result ends the streak. Unfinished streaks are separate.</p><p>Gaps are differences between draw IDs, including skipped draws. SKIPs neither add to nor reset a streak. Missing or unresolved records break continuity. Initial streaks with unknown beginnings are excluded from occurrence counts.</p><p>Coverage: {report.breaks} continuity breaks, {report.unresolved} unresolved/conflicting rows, {report.boundaryRuns} closed/interrupted boundary streaks excluded. Values describe this loaded window, independently of owner streak resets, not all-time history.</p><p>{wins ? 'Single rollover waits for its own fresh WIN and uses winning-streak gaps or a manually saved draw count. A loss ends its run; collection also ends it. Other gap automation follows its own window rules.' : ''} Automation uses up to 100 continuous gaps to set each playing window, rounded up to whole draws. {!wins && 'It plays every eligible draw and recalculates at each window end without resetting recovery.'} The chart may use a different history window; its average may differ from the live window average. Charts do not change settings or place bets. A long gap does not make a win due.</p></details>
  </main>;
}
