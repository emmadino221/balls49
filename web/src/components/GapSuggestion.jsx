import React, {useRef,useState} from 'react';
import {suggestGap} from '../gap-suggestion';
import {apiRequest} from '../auth';
export default function GapSuggestion({records,market,label,loading}) {
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false);
 async function apply() {
  if(lock.current||!result?.qualified)return;
  lock.current=true;setBusy(true);setMessage('');
  try {
   const {control:c}=await apiRequest('/account/automation');
   if(!c)throw new Error('Link your extension on Automation first.');
   if(c.controller!=='website'||c.running||c.busy)throw new Error('Use website control, stop automation, and wait for outstanding execution/recovery to finish.');
   const s=c.settings;
   if(c.suggestionStrategy||s.unifiedMode||s.shadowMode||s.bzRbRollover||s.hiloRollover||s.tc3Rollover)throw new Error('Review manual individual settings on Automation first. Automatic suggestions, Unified, shadow and rollover are incompatible.');
   if(!s.enabledGames?.[market]||!(s.stakes?.[market]>0))throw new Error('Enable this game and save its stake on Automation first.');
   if(!window.confirm(`Apply ${label}: ${result.level} losses plus the prior-average gap condition? Only this game gap setting changes. Existing stakes and other entry filters remain in force. Automation stays stopped. Historical flat-stake results do not represent your recovery staking or guarantee future wins.`))return;
   const settings={...s,gapEntry:{...s.gapEntry,[market]:{enabled:true,losses:result.level}}};
   await apiRequest('/account/automation/command',{method:'POST',body:JSON.stringify({action:'save',revision:c.revision,settings})});
   const next=await apiRequest('/account/automation');
   if(!next.control?.settings?.gapEntry?.[market]?.enabled||next.control.settings.gapEntry[market].losses!==result.level)throw new Error('Save returned but readback differs. Review Automation before starting.');
   setMessage('Saved and confirmed. Review the applied gap on Automation; no start command was sent.');
  }catch(e){setMessage(e.message);}finally{lock.current=false;setBusy(false);}
 }
 return <section className="content-card gap-suggestion"><span className="overline">EXPLORATORY DEMO RESEARCH</span><h2>Suggest a gap for {label}</h2><p>Compare loss levels 1-100 using the older 60% of loaded draws. Freeze the best older-window flat-stake return, then evaluate it on the newer 40%. Minimum 20 older and 10 newer bets. One bet per qualifying trigger.</p>
 <button type="button" className="btn btn-primary" disabled={loading||busy} onClick={()=>{setResult(suggestGap(records,market));setMessage('');}}>Find suggested gap</button>
 {result&&<><p role="status"><strong>{result.reason}</strong></p>{result.training&&<><h3>{result.qualified?'Suggested demo candidate':'Candidate reviewed'}: {result.level} losses</h3><p>Current sampled average: {result.average?.toFixed(1)??'Unavailable'} draws ({result.samples} gaps). This updates from prior history at each future trigger; it is not a countdown.</p><div className="gap-selected-stats">{[['Older selection window',result.training],['Newer validation window',result.validation]].map(([name,s])=><article key={name}><h3>{name}</h3><p>{s.bets} bets / {s.wins} wins / {s.losses} losses</p><p>Win rate: {s.bets?(s.wins/s.bets*100).toFixed(1):'N/A'}%</p><p>Net: NGN {s.net.toFixed(2)} / Staked: NGN {s.cost.toFixed(2)}</p></article>)}</div><p>Draws #{result.first} to #{result.last}; validation begins at #{result.boundary}. {result.candidates} eligible levels compared. Flat NGN 100 per selection using existing simulator odds.</p><button type="button" className="btn btn-secondary" disabled={!result.qualified||busy||loading} onClick={apply}>{busy?'Checking / saving...':'Apply to automation'}</button></>}
 <p>Repeated analysis is exploratory, not an untouched final test. Selection across many levels can overfit. Replay assumes execution on the next eligible draw; live delays, safety filters and staking may produce different results. Missing records break continuity. No statistically proven edge is claimed.</p></>}
 {message&&<p role="status">{message}</p>}<a href="automation.html">Review automation settings</a></section>;
}
