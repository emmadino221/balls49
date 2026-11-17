import { simulateHistory, simulationGames } from './history-simulator';
const empty = () => ({ bets:0,wins:0,losses:0,net:0,cost:0 });
// Replay observations chronologically. A decision is frozen before adding its gap.
function replay(rows, market, level, split) {
  let run=0,known=false,last=null,gaps=[],ready=false,previous=null;
  const training=empty(),validation=empty();
  for(let i=0;i<rows.length;i++) {
    const r=rows[i],id=Number(r.drawId),outcome=r.result?.[market];
    if(previous!==null && id!==previous+1) {run=0;known=false;last=null;gaps=[];ready=false;}
    previous=id;
    if(!['WIN','LOSS','SKIP'].includes(outcome)) {run=0;known=false;last=null;gaps=[];ready=false;continue;}
    // Do not carry an older-window execution into validation.
    if(i===split) ready=false;
    if(ready && outcome!=='SKIP') {
      const sim=simulateHistory([r],market,100,'flat');
      if(sim.stop || sim.rows.length!==1) return null;
      const stat=i<split?training:validation;
      stat.bets++;stat.wins+=sim.wins;stat.losses+=sim.losses;stat.net+=sim.net;stat.cost+=sim.staked;
      ready=false;
    }
    if(outcome==='WIN') {run=0;known=true;ready=false;}
    if(outcome==='LOSS') {
      run++;
      if(known && run===level) {
        const gap=last===null?null:id-last;
        const avg=gaps.length>=2?gaps.reduce((a,b)=>a+b,0)/gaps.length:null;
        ready=gap!==null && avg!==null && gap>=avg;
        if(gap!==null) gaps=[...gaps,gap].slice(-100);
        last=id;
      }
    }
  }
  return {level,training,validation,average:gaps.length?gaps.reduce((a,b)=>a+b,0)/gaps.length:null,samples:gaps.length};
}
export function suggestGap(records,market) {
  if(!simulationGames.some(g=>g[0]===market)) return {reason:'Unified is not supported by individual gap automation.'};
  const grouped=new Map();
  for(const r of records) {
    const id=Number(r.drawId);if(!Number.isSafeInteger(id)||id<1)continue;
    if(grouped.has(id) && JSON.stringify(grouped.get(id))!==JSON.stringify(r)) return {reason:'Conflicting duplicate draws: refresh history before analysis.'};
    grouped.set(id,r);
  }
  const rows=[...grouped.values()].sort((a,b)=>Number(a.drawId)-Number(b.drawId));
  const split=Math.floor(rows.length*.6);
  if(rows.length<100) return {reason:'Load at least 100 chronological draws; larger windows usually provide more triggers.'};
  // Candidate selection uses only the older portion. Validation cannot choose a runner-up.
  const candidates=Array.from({length:100},(_,i)=>replay(rows.slice(0,split),market,i+1,split)).filter(r=>r && r.training.bets>=20);
  candidates.sort((a,b)=>(b.training.net/b.training.cost)-(a.training.net/a.training.cost)||b.training.bets-a.training.bets||a.level-b.level);
  if(!candidates.length) return {reason:'Not enough evidence: no loss level has 20 evaluable older-window triggers.'};
  const selected=replay(rows,market,candidates[0].level,split);
  if(!selected) return {reason:'Selected strategy has incomplete selections or results; performance cannot be evaluated safely.'};
  const qualified=selected.training.net>0 && selected.validation.bets>=10 && selected.validation.net>0;
  return {...selected,qualified,reason:qualified?'Exploratory demo candidate; no statistically established advantage.':'Not enough evidence: require positive flat-stake results in both portions and at least 10 newer-window bets.',first:rows[0].drawId,boundary:rows[split].drawId,last:rows.at(-1).drawId,candidates:candidates.length};
}
