import { losingStreakGaps } from './losing-streak-gaps';
export function suggestGap(records, market, level) {
 if(market==='unified') return {reason:'Unified is not supported by individual gap windows.'};
 const report=losingStreakGaps(records,market,'levels',market === 'betzeroSingle' ? 'WIN' : 'LOSS');
 // Match the server sampler: only use the latest continuous, fully resolved prefix.
 const sorted=[...records].sort((a,b)=>Number(a.drawId)-Number(b.drawId));
 let segment=[],previous=null;
 for(const r of sorted) {
  const id=Number(r.drawId);
  if(!Number.isSafeInteger(id)||id<1)continue;
  if(previous===id) return {reason:'Duplicate draw records: refresh history before estimating a window.'};
  if(!['WIN','LOSS','SKIP'].includes(r.result?.[market]))break;
  if(previous!==null && id!==previous+1)segment=[];
  segment.push(r);previous=id;
 }
 const row=losingStreakGaps(segment,market,'levels',market === 'betzeroSingle' ? 'WIN' : 'LOSS').rows.find(r=>r.level===level);
 const gaps=(row?.gaps||[]).slice(-100);
 if(gaps.length<2)return {reason:'Not enough history: choose another streak level or load more draws. Two continuous historical gaps are required.'};
 const average=gaps.reduce((a,b)=>a+b,0)/gaps.length;
 return {qualified:true,level,average,length:Math.ceil(average),samples:gaps.length,first:report.first,last:previous,
 reason:'Window estimate only. All streak levels play every eligible draw after initialization; none is a more profitable entry filter.'};
}
