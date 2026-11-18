import React, {useRef,useState} from 'react';
import {suggestGap} from '../gap-suggestion';
import {apiRequest} from '../auth';
export default function GapSuggestion({records,market,label,loading,level}) {
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
   if(!window.confirm(`Apply ${label}: ${result.level}-loss spacing for continuous windows (estimated ${result.length} draws)? Play every eligible draw and recalculate at each window end, preserving recovery stakes. Only this game gap setting changes; its existing automatic gap selection preference is preserved. Existing stakes and other entry filters remain in force. Automation stays stopped. The server calculates the actual window from its latest history. Window boundaries do not reset martingale.`))return;
   const settings={...s,gapEntry:{...s.gapEntry,[market]:{...s.gapEntry?.[market],enabled:true,losses:result.level,policy:'CONTINUOUS_GAP_WINDOWS_V2'}}};
   await apiRequest('/account/automation/command',{method:'POST',body:JSON.stringify({action:'save',revision:c.revision,settings})});
   const next=await apiRequest('/account/automation');
   if(!next.control?.settings?.gapEntry?.[market]?.enabled||next.control.settings.gapEntry[market].losses!==result.level||next.control.settings.gapEntry[market].policy!=='CONTINUOUS_GAP_WINDOWS_V2')throw new Error('Save returned but readback differs. Review Automation before starting.');
   setMessage('Saved and confirmed. Review the applied gap on Automation; no start command was sent.');
  }catch(e){setMessage(e.message);}finally{lock.current=false;setBusy(false);}
 }
 return <section className="content-card gap-suggestion"><span className="overline">CONTINUOUS PLAYING WINDOWS</span><h2>Estimate a window for {label}</h2><p>Selected loss level: {level}. Its average spacing sets the window length, rounded up. Every eligible draw can be played; at the end the average is recalculated without resetting recovery. SKIPs consume a draw slot without a bet.</p>
 <button type="button" className="btn btn-primary" disabled={loading||busy} onClick={()=>{setResult(suggestGap(records,market,level));setMessage('');}}>Calculate playing window</button>
 {result&&<><p role="status">{result.reason}</p>{result.qualified&&<><h3>{result.length} draws per estimated window</h3><p>Average {result.average.toFixed(1)} draws from {result.samples} continuous gaps at loss level {result.level}. Data through #{result.last}. The live server may have a different history window.</p><button type="button" className="btn btn-secondary" disabled={busy||loading} onClick={apply}>{busy?'Checking / saving...':'Apply playing windows'}</button></>}</>}
 <p>There is no loss-count or average-gap entry wait once a window is available. Existing stake sizing, entry filters and safety checks still apply. This is not a prediction of when a win will happen. The previous one-bet-per-trigger performance suggestions do not describe this mode.</p>
 {message&&<p role="status">{message}</p>}<a href="automation.html">Review automation settings</a></section>;
}
