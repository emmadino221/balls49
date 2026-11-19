"use strict";
const retired = new Set(['totalColor2','unified']);
const fields = new Set(['totalColor2','totalColor2Pred','unified','unifiedPick','tc2Pred','tc2Step','tc2Result','umPred','umStep','umResult','umCurrentStreak','umMaxLoss']);
// Scoped to prediction/history payloads, not credentials, raw draw archives or research protocols.
function clean(value) {
 if(Array.isArray(value)) return value.filter(v=>!retired.has(v) && !(v && typeof v==='object' && [v.market,v.game,v.id,v.key].some(k=>retired.has(k)))).map(clean);
 if(!value || typeof value!=='object') return value;
 return Object.fromEntries(Object.entries(value).filter(([k])=>!fields.has(k)).map(([k,v])=>[k,clean(v)]));
}
function guard(session) {
 const c=session.config;
 if(c.unifiedMode || c.enabledGames?.totalColor2 || c.suggestionStrategy?.request?.games?.some(k=>retired.has(k))) {
   session.stats.isHalted=true;session.stats.haltReason='A saved market has been removed. Review supported games and save settings before restarting.';
   if(!session.betExecutionClaim)session.pendingBetPayload=null;
   if(c.suggestionStrategy)c.suggestionStrategy.needsReview=true;
 }
 c.unifiedMode=false;
 if(c.enabledGames)c.enabledGames.totalColor2=false;
 if(c.initialStakes)c.initialStakes.totalColor2=0;
}
function restoreRanking(value) {
 if(Array.isArray(value)) { value.forEach(restoreRanking); return value; }
 if(value && typeof value==='object') {
  if(value.totalColor2Pred && !value.colorRanking)value.colorRanking=value.totalColor2Pred;
  Object.values(value).forEach(restoreRanking);
 }
 return value;
}
module.exports={clean,guard,retired,restoreRanking};
