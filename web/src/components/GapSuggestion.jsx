import React, {useEffect,useRef,useState} from 'react';
import {suggestGap} from '../gap-suggestion';
import {apiRequest} from '../auth';
export default function GapSuggestion({records,market,label,loading,level,snapshotAt,autoRefresh,onBusy}) {
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false), alive=useRef(true), lastSnapshot=useRef(null);
 const [savedWindow,setSavedWindow]=useState(null),[windowNote,setWindowNote]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onBusy?.(busy);return()=>onBusy?.(false);},[busy,onBusy]);
 useEffect(()=>{
  const changed=snapshotAt!==lastSnapshot.current;
  lastSnapshot.current=snapshotAt;
  if(snapshotAt && !loading && (autoRefresh || (changed && result))) calculate(true);
 },[snapshotAt,autoRefresh]);
 async function calculate(background=false) {
  if(lock.current)return;
  lock.current=true;setBusy(true);if(!background)setMessage('');setWindowNote('');
  const estimate=suggestGap(records,market,level);
  setResult(estimate);
  try {
   const next=await apiRequest('/account/automation');
   if(!alive.current)return;
   const status=next.control?.gapEntry?.[market];
   if(status) setSavedWindow({...status,running:next.control.running,at:new Date().toLocaleTimeString()});
   else {setSavedWindow(null);setWindowNote('No saved automation gap window for this game. The preview below does not start or schedule bets.');}
  } catch(e) { if(alive.current)setWindowNote('Saved automation window unavailable. Sign in with your linked account to see its status. The estimate remains read-only.'); }
  finally {lock.current=false;if(alive.current)setBusy(false);}
 }

 async function apply() {
  if(lock.current||!result?.qualified)return;
  lock.current=true;setBusy(true);setMessage('');
  try {
   const {control:c}=await apiRequest('/account/automation');
   if(!c)throw new Error('Link your extension on Automation first.');
   if(c.controller!=='website'||c.running||c.busy)throw new Error('Use website control, stop automation, and wait for outstanding execution/recovery to finish.');
   const s=c.settings;
   if(c.suggestionStrategy||s.unifiedMode||s.shadowMode||s.bzRbRollover||s.hiloRollover||s.tc3Rollover)throw new Error('Review manual individual settings on Automation first. Automatic suggestions, legacy combined mode, shadow and rollover are incompatible.');
   if(!s.enabledGames?.[market]||!(s.stakes?.[market]>0))throw new Error('Enable this game and save its stake on Automation first.');
   if(!window.confirm(`Apply ${label}: ${result.level}-loss spacing for continuous windows (estimated ${result.length} draws)? Play every eligible draw and recalculate at each window end, preserving recovery stakes. Only this game gap setting changes; its existing automatic gap selection preference is preserved. Existing stakes and other entry filters remain in force. Automation stays stopped. The server calculates the actual window from its latest history. Window boundaries do not reset martingale.`))return;
   const settings={...s,gapEntry:{...s.gapEntry,[market]:{...s.gapEntry?.[market],enabled:true,losses:result.level,policy:'CONTINUOUS_GAP_WINDOWS_V2'}}};
   await apiRequest('/account/automation/command',{method:'POST',body:JSON.stringify({action:'save',revision:c.revision,settings})});
   const next=await apiRequest('/account/automation');
   if(!next.control?.settings?.gapEntry?.[market]?.enabled||next.control.settings.gapEntry[market].losses!==result.level||next.control.settings.gapEntry[market].policy!=='CONTINUOUS_GAP_WINDOWS_V2')throw new Error('Save returned but readback differs. Review Automation before starting.');
   if(alive.current){setSavedWindow(null);setWindowNote('Settings saved. Calculate again to fetch the new saved window.');}
   setMessage('Saved and confirmed. Review the applied gap on Automation; no start command was sent.');
  }catch(e){setMessage(e.message);}finally{lock.current=false;setBusy(false);}
 }
 return <section className="content-card gap-suggestion"><span className="overline">CONTINUOUS PLAYING WINDOWS</span><h2>Estimate a window for {label}</h2><p>Selected loss level: {level}. Its average spacing sets the window length, rounded up. Every eligible draw can be played; at the end the average is recalculated without resetting recovery. SKIPs consume a draw slot without a bet.</p>
 <button type="button" className="btn btn-primary" disabled={loading||busy} onClick={()=>calculate(false)}>{busy?'Loading / saving...':'Calculate playing window'}</button>
 {result&&<><p role="status">{result.reason}</p>{result.qualified&&<><h3>{result.length} draws per estimated window</h3><p>Average {result.average.toFixed(1)} draws from {result.samples} continuous gaps at loss level {result.level}. Data through #{result.last}. The live server may have a different history window.</p><div className="gap-window-preview" aria-label="Estimated playing window"><h3>Preview from loaded history</h3><div className="gap-selected-stats"><div><span>Estimated length</span><strong>{result.length} <small>draws</small></strong></div><div><span>Selected loss level</span><strong>{result.level}</strong></div><div><span>Would start after history at</span><strong>#{Number(result.last)+1}</strong></div><div><span>Would recalculate after</span><strong>#{Number(result.last)+result.length}</strong></div></div><p>This is a hypothetical range following the last completed draw in the loaded history, not a confirmed upcoming draw or scheduled bet. If that history is old, these draw IDs may already have passed. Saving uses the server's latest history and may produce a different range.</p><p><strong>Window end means recalculate and continue, not stop.</strong> SKIPs count as draws, not bets. Recovery carries into the next window.</p></div><button type="button" className="btn btn-secondary" disabled={busy||loading} onClick={apply}>{busy?'Checking / saving...':'Apply playing windows'}</button></>}</>}
 {savedWindow&&<div className="gap-window-preview" aria-label="Saved automation window"><h3>{label}: saved automation window</h3><p><strong>{savedWindow.running?'Automation running':'Automation stopped'}</strong> | Auto gap: {savedWindow.autoSelect?'ON':'OFF'} | Selected level: {savedWindow.threshold}</p><p>{savedWindow.phase}</p><p>{savedWindow.selection?.reason || 'No automatic review yet'}</p>{Number.isSafeInteger(savedWindow.windowStart)&&Number.isSafeInteger(savedWindow.windowEnd)&&savedWindow.windowLength>0?<><div className="gap-selected-stats"><div><span>Average gap</span><strong>{savedWindow.averageGap?.toFixed(1)??'--'} <small>draws</small></strong></div><div><span>Draws completed</span><strong>{savedWindow.completedDraws}/{savedWindow.windowLength}</strong></div><div><span>Window starts</span><strong>#{savedWindow.windowStart}</strong></div><div><span>Recalculate after</span><strong>#{savedWindow.windowEnd}</strong></div></div><progress aria-label="Completed draws in saved window" value={savedWindow.completedDraws||0} max={savedWindow.windowLength}/><p>{savedWindow.gapSamples} prior gaps. {Math.max(0,savedWindow.windowLength-(savedWindow.completedDraws||0))} draw slots remain in this snapshot; this is not a count of bets.</p></>:<p>No sized window is available yet.</p>}<p>Status fetched at {savedWindow.at}. {autoRefresh?'Auto refresh is ON.':'Click Calculate playing window again to refresh.'} This saved window is separate from your selected preview level.</p></div>}
 {windowNote&&<p role="status">{windowNote}</p>}
 <p>There is no loss-count or average-gap entry wait once a window is available. Existing stake sizing, entry filters and safety checks still apply. This is not a prediction of when a win will happen. The previous one-bet-per-trigger performance suggestions do not describe this mode.</p>
 {message&&<p role="status">{message}</p>}<a href="automation.html">Review automation settings</a></section>;
}
