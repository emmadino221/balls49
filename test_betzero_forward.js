'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createBetZeroLab}=require('./betzero-lab');
const {forwardWindows}=require('./betzero-forward-metrics');
const ONE='simple_smallest_number_add_10',FOUR='smallest_add10_step10_four';
function setup(t){const db=new DatabaseSync(':memory:');let time=1000;const lab=createBetZeroLab(db,{now:()=>time});t.after(()=>db.close());return{db,lab,setTime:n=>{time=n;}};}
function input(target=101){return{current:{drawId:String(target)},clock:{drawId:String(target),timeLeftSeconds:10,observedAt:1002},snapshotAt:1002,historyUpdates:[{drawId:String(target-1),settledAt:new Date(1001).toISOString(),result:{balls:[3,8,17,25,36,44]}}]};}
test('four-number forward pick is recorded before target deadline, settles once, and remains version-separated',t=>{
 const {db,lab,setTime}=setup(t);assert.equal(lab.strategies().find(s=>s.id===FOUR).enabled,false);
 lab.setStrategyEnabled(FOUR,true); // Isolated test DB only.
 setTime(1003);lab.ingestSnapshot(input());lab.ingestSnapshot(input());
 const picks=lab.listForwardPredictions({strategyId:FOUR});assert.equal(picks.length,1);assert.equal(picks[0].status,'PENDING');assert.deepEqual(picks[0].selections,[13,23,33,43]);
 assert.equal(Date.parse(picks[0].predictedAt),1003);assert.ok(Date.parse(picks[0].predictedAt)<picks[0].conditions.timing.expectedTargetAt);
 const before=forwardWindows(db,lab.strategies());assert.equal(before[FOUR].windows[100].pending,1);assert.equal(before[FOUR].windows[100].settled,0);
 setTime(12000);const settlement={snapshotAt:12000,historyUpdates:[{drawId:'101',settledAt:new Date(11002).toISOString(),result:{balls:[23,1,2,3,4,5]}}]};lab.ingestSnapshot(settlement);lab.ingestSnapshot(settlement);
 const after=forwardWindows(db,lab.strategies());assert.equal(after[ONE].windows[100].wins,1);assert.equal(after[FOUR].windows[100].losses,1);assert.equal(after[FOUR].windows[100].settled,1);
 assert.equal(lab.listForwardPredictions({strategyId:FOUR})[0].predictedAt,picks[0].predictedAt);
});
test('missing, expired, future or mismatched clock evidence never creates forward predictions',t=>{
 for(const kind of ['missing','old','expired','future','mismatch','settled']){
  const {lab,setTime}=setup(t);lab.setStrategyEnabled(FOUR,true);const snap=input();
  if(kind==='missing')delete snap.clock.observedAt;
  if(kind==='old'){snap.snapshotAt=40000;snap.clock.timeLeftSeconds=100;setTime(40000);}
  if(kind==='expired')setTime(12000);
  if(kind==='future')snap.clock.observedAt=1003;
  if(kind==='mismatch')snap.clock.drawId='102';
  if(kind==='settled')snap.historyUpdates.push({drawId:'101',result:{balls:[1,2,3,4,5,6]}});
  lab.ingestSnapshot(snap);assert.equal(lab.listForwardPredictions({strategyId:FOUR}).length,0,kind);
 }
});
test('rolling windows cap at 100/500/1000 and keep uncertainty, matching baselines and streaks independent',t=>{
 const {db,lab}=setup(t);
 const insert=db.prepare(`INSERT INTO betzero_lab_forward_predictions(prediction_id,strategy_id,strategy_version,source_draw_id,target_draw_id,predicted_at,strategy_config_json,selections_json,conditions_json,source_input_json,status,actual_balls_json,validated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 for(const id of [ONE,FOUR])for(let i=1;i<=1105;i++){
  const skip=i%10===0,loss=id===ONE?i%3===0:i%2===1;
  const status=skip?'SKIP':loss?'LOSS':'WIN';const predicted=1000+i*100;
  insert.run(`${id}-${i}`,id,'1.0.0',String(i),String(i+1),new Date(predicted).toISOString(),'{}',JSON.stringify(skip?[]:id===ONE?[13]:[13,23,33,43]),JSON.stringify({timing:{observedAt:predicted-1,snapshotAt:predicted,recordedAt:predicted,expectedTargetAt:predicted+50}}),'{}',status,skip?null:JSON.stringify(loss?[13,1,2,3,4,5]:[1,2,3,4,5,6]),skip?null:new Date(predicted+60).toISOString());
 }
 const result=forwardWindows(db,lab.strategies());
 for(const id of [ONE,FOUR])for(const n of [100,500,1000]){const r=result[id].windows[n];assert.equal(r.available,n);assert.equal(r.skipped,n/10);assert.equal(r.settled,n-r.skipped);assert.equal(r.randomBaseline.trials,r.settled);assert.ok(r.confidenceInterval95[0]<=r.winRate&&r.confidenceInterval95[1]>=r.winRate);assert.equal(r.chart.length,r.settled);assert.equal(r.chart.at(-1).targetDrawId,'1106');}
 assert.notEqual(result[ONE].windows[1000].wins,result[FOUR].windows[1000].wins);
 assert.deepEqual(forwardWindows(db,lab.strategies()),result);
 db.prepare("UPDATE betzero_lab_forward_predictions SET conditions_json='{}' WHERE prediction_id=?").run(`${ONE}-1105`);
 const updated=forwardWindows(db,lab.strategies());assert.equal(updated[ONE].windows[100].unverified,1);assert.equal(updated[ONE].windows[100].settled,89);assert.equal(updated[FOUR].windows[100].settled,90);
 assert.equal(lab.strategies().find(s=>s.id===FOUR).enabled,false);
 for(let i=1102;i<=1105;i++)db.prepare("UPDATE betzero_lab_forward_predictions SET status='LOSS',actual_balls_json='[13,1,2,3,4,5]' WHERE prediction_id=?").run(`${FOUR}-${i}`);
 const flagged=forwardWindows(db,lab.strategies())[FOUR].windows[100];assert.equal(flagged.currentLosingStreak,6);assert.match(flagged.streakFlag,/not a reversal signal/);
 assert.ok(lab.strategies().filter(s=>s.status==='UNVERIFIED').every(s=>!s.enabled));
});
test('empty samples do not display invented rates or confidence intervals',t=>{
 const {db,lab}=setup(t);const r=forwardWindows(db,lab.strategies())[FOUR].windows[1000];assert.equal(r.settled,0);assert.equal(r.winRate,null);assert.equal(r.confidenceInterval95,null);assert.equal(r.randomBaseline.winRate,null);
});
