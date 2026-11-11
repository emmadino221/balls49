'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mm = require('./betzero-minmax');
const {createBetZeroLab,validSelections,validateBetZeroPrediction,probabilityAllAbsent,normalizeHistoricalDraws,makeOpportunities} = require('./betzero-lab');
const {createJobStore} = require('./betzero-jobs');
const {executeJob} = require('./betzero-worker');
const {smallBacktestRecords} = require('./betzero-job-api');
const a = [3,8,17,23,36,44], b = [4,10,18,24,35,40], c = [7,12,19,25,32,38];
const history = result => Array.from({length:5},(_,i)=>({source:{id:i+1,balls:a},target:{id:i+2,balls:result}}));
const record = (id,balls=a) => ({drawId:String(id), result:{balls}, settledAt:new Date(id*1000+100).toISOString()});
function setup(t) {
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'betzero-minmax-'));
    const file=path.join(folder,'test.sqlite');
    let db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=100');let lab=createBetZeroLab(db,{now:()=>1});
    t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
    return {get db(){return db;},get lab(){return lab;},file,
        reopen(){db.close();db=new DatabaseSync(file);lab=createBetZeroLab(db,{now:()=>1});}};
}
function ingest(s,target,records) {
    s.lab.ingestSnapshot({current:{drawId:String(target)},clock:{drawId:String(target),timeLeftSeconds:60,observedAt:target*1000},snapshotAt:target*1000,historyUpdates:records});
}
test('MIN/MAX calculation, strict three-number validation, boundary skips and absence grading',()=>{
    assert.deepEqual(mm.candidate(a,'MIN'),[2,3,4]);assert.deepEqual(mm.candidate(a,'MAX'),[43,44,45]);
    assert.equal(mm.candidate([1,8,17,23,36,44],'MIN'),null);
    assert.equal(mm.candidate([3,8,17,23,36,49],'MAX'),null);
    assert.equal(mm.candidate([3,3,17,23,36,44],'MIN'),null);
    assert.equal(validSelections([2,3,4],3),true);assert.equal(validSelections([2,3,3],3),false);
    assert.equal(validateBetZeroPrediction([2,3,4],c,3),'WIN');assert.equal(validateBetZeroPrediction([2,3,4],b,3),'LOSS');
    assert.ok(Math.abs(probabilityAllAbsent(3)-.6698)<.0001);
});
test('five opportunities: sole winner, newest tie, neither winner, boundary ineligibility and no lookahead',()=>{
    const src={id:6,balls:a};
    assert.equal(mm.decide(src,7,history(b)).conditions.method,'MIN'); // MAX alone wins
    assert.equal(mm.decide(src,7,history([8,12,20,30,43,48])).conditions.method,'MAX');
    assert.equal(mm.decide(src,7,history(c)).conditions.reason,'BOTH_METHODS_WIN');
    assert.equal(mm.decide(src,7,history([3,8,17,23,36,44])).conditions.reason,'NO_STARTING_METHOD');
    assert.equal(mm.decide(src,7,history(b).slice(1)).conditions.reason,'INSUFFICIENT_HISTORY');
    const h=history(b); h.push({source:src,target:{id:7,balls:c}});
    assert.deepEqual(mm.decide(src,7,h),mm.decide(src,7,history(b)));
    h[4]={source:{id:5,balls:[1,8,17,23,36,44]},target:{id:6,balls:c}};
    assert.equal(mm.decide(src,7,h).conditions.method,'MIN');
    h[4].target.id=8; assert.equal(mm.decide(src,7,h).conditions.reason,'INSUFFICIENT_HISTORY');
});
test('WIN switches, LOSS repeats, boundaries reassess, unresolved and duplicate settlements do not advance',()=>{
    const pick=mm.decide({id:6,balls:a},7,history(b));
    const pending=mm.afterDecision({},pick,7);
    assert.equal(mm.decide({id:7,balls:b},8,history(b),pending).conditions.reason,'UNRESOLVED_PREDICTION');
    assert.deepEqual(mm.settle(pending,7,null),pending);
    const won=mm.settle(pending,7,'WIN');assert.equal(won.method,'MAX');
    assert.deepEqual(mm.settle(won,7,'WIN'),won);
    assert.equal(mm.settle(pending,7,'LOSS').method,'MIN');
    const skipped=mm.decide({id:7,balls:[1,8,17,23,36,44]},8,[],{method:'MIN'});
    assert.equal(skipped.conditions.reason,'BOUNDARY');assert.equal(mm.afterDecision({method:'MIN'},skipped,8).method,null);
});
test('disabled by default; historical override is reproducible, independently stored, chronological and baseline matched',t=>{
    const s=setup(t);const before=s.lab.strategies();
    const records=Array.from({length:1106},(_,i)=>record(i+1,[a,b,c][i%3]));
    for(const window of ['100','500','1000']) {
        const r=s.lab.runBacktest(records,{window,seed:'fixed',strategyId:mm.ID});
        assert.equal(r.data.eligibleOpportunities,Number(window));assert.equal(r.results.length,3);
        const rows=s.lab.getBacktestRun(r.runId,{limit:1000}).predictions;
        assert.equal(rows.length,Number(window));assert.ok(rows.every(p=>p.strategyId===mm.ID));
        for(const segment of r.results) {
            const matching=rows.filter(p=>p.segment===segment.segment);
            assert.equal(segment.result.wins,matching.filter(p=>p.status==='WIN').length);
            assert.equal(segment.result.losses,matching.filter(p=>p.status==='LOSS').length);
            assert.equal(segment.result.randomBaseline.trials,segment.result.predictions*64);
        }
        const repeated=s.lab.runBacktest(records,{window,seed:'fixed',strategyId:mm.ID});
        assert.deepEqual(r.results.map(x=>x.result),repeated.results.map(x=>x.result));
    }
    assert.deepEqual(s.lab.strategies(),before);assert.equal(s.lab.listForwardPredictions().length,0);
    assert.equal(before.find(x=>x.id===mm.ID).enabled,false);assert.equal(before.find(x=>x.id==='maximum_minimum'),undefined);
    const subset=smallBacktestRecords(records.slice().reverse(),'100',mm.ID);
    assert.equal(makeOpportunities(normalizeHistoricalDraws(subset).draws).opportunities.length,105);
    assert.throws(()=>s.lab.runBacktest(records,{strategyId:'maximum_minimum'}),/Unknown research/);
});
test('future result mutation cannot change earlier decisions or its own selection',()=>{
    const records=Array.from({length:40},(_,i)=>record(i+1,[a,b,c][i%3]));
    const pairs=makeOpportunities(normalizeHistoricalDraws(records).draws).opportunities;
    const first=mm.simulate(pairs,pairs);
    records[29]=record(30,[1,2,3,4,5,6]);
    const changed=makeOpportunities(normalizeHistoricalDraws(records).draws).opportunities;
    const second=mm.simulate(changed,changed);
    for(const [id,pick] of first) if(id<=30) assert.deepEqual(pick,second.get(id));
});
test('forward state survives restart, missing settlement, disable/re-enable and correction review without history rewriting',t=>{
    const s=setup(t);s.lab.setStrategyEnabled(mm.ID,true);
    const oldConfig=s.lab.strategies().filter(x=>x.id!==mm.ID);
    ingest(s,7,Array.from({length:6},(_,i)=>record(i+1,i===5?b:a)));
    let pick=s.lab.listForwardPredictions({strategyId:mm.ID})[0];
    assert.equal(pick.status,'PENDING');assert.equal(pick.conditions.method,'MIN');
    const original=JSON.stringify(pick);
    s.reopen();assert.equal(JSON.stringify(s.lab.listForwardPredictions({strategyId:mm.ID})[0]),original);
    ingest(s,9,[record(8,c)]);
    assert.equal(s.lab.listForwardPredictions({strategyId:mm.ID})[0].conditions.reason,'UNRESOLVED_PREDICTION');
    s.lab.setStrategyEnabled(mm.ID,false);
    ingest(s,10,[record(7,c),record(9,b)]);
    assert.equal(s.lab.statsForVersion(mm.ID,'1.0.0').decisionState.method,'MAX');
    s.lab.setStrategyEnabled(mm.ID,true);s.reopen();
    ingest(s,11,[record(10,b)]);
    pick=s.lab.listForwardPredictions({strategyId:mm.ID})[0];assert.equal(pick.conditions.method,'MAX');
    const settled=s.lab.listForwardPredictions({strategyId:mm.ID}).find(x=>x.targetDrawId==='7');
    assert.equal(settled.status,'WIN');
    ingest(s,12,[record(7,a),record(11,c)]);
    assert.equal(s.lab.statsForVersion(mm.ID,'1.0.0').decisionState.paused,true);
    assert.deepEqual(s.lab.listForwardPredictions({strategyId:mm.ID}).find(x=>x.targetDrawId==='7'),settled);
    assert.deepEqual(s.lab.strategies().filter(x=>x.id!==mm.ID),oldConfig);
});
test('queue freezes disabled research override and context; sealed warm-up cannot be exposed; isolated child completes',async t=>{
    const s=setup(t);s.db.exec('CREATE TABLE public_prediction_history(draw_id TEXT PRIMARY KEY,sort_draw_id INTEGER,record_json TEXT)');
    for(let id=1;id<=110;id++)s.db.prepare('INSERT INTO public_prediction_history VALUES(?,?,?)').run(String(id),id,JSON.stringify(record(id,[a,b,c][id%3])));
    const store=createJobStore(s.db);const settings=s.lab.strategies();
    const job=store.enqueue({window:'100',seed:'fixed',strategyId:mm.ID},settings);
    assert.equal(job.specification.strategies.length,1);assert.equal(job.specification.contextFirst,5);
    const previous=process.env.SITE_DB_PATH;process.env.SITE_DB_PATH=s.file;
    t.after(()=>{if(previous===undefined)delete process.env.SITE_DB_PATH;else process.env.SITE_DB_PATH=previous;});
    const claim=store.claim();await executeJob(s.db,store,claim,{pollMs:10});
    assert.equal(store.get(job.id).state,'COMPLETED',store.get(job.id).error);
    assert.deepEqual(s.lab.strategies(),settings);assert.equal(s.lab.listForwardPredictions().length,0);
    const protocol=store.seal({firstDraw:120,lastDraw:130,seed:'sealed'},settings.map(x=>x.id===mm.ID?{...x,enabled:true}:x));
    assert.equal(protocol.contextFirst,114);
    assert.throws(()=>store.reserveSync([record(114)]),/sealed/);
    assert.throws(()=>store.enqueue({protocolId:protocol.id,strategyId:mm.ID},settings),/override/);
});

test('prediction and decision state commit atomically; malformed results and duplicates preserve pending state',t=>{
    const s=setup(t);s.lab.setStrategyEnabled(mm.ID,true);
    const records=Array.from({length:6},(_,i)=>record(i+1,i===5?b:a));
    s.db.exec(`CREATE TRIGGER fail_minmax BEFORE INSERT ON betzero_lab_forward_predictions
        WHEN NEW.strategy_id='minimum_maximum_three' BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
    assert.throws(()=>ingest(s,7,records),/injected failure/);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM betzero_lab_minmax_state').get().n,0);
    assert.equal(s.lab.listForwardPredictions({strategyId:mm.ID}).length,0);
    s.db.exec('DROP TRIGGER fail_minmax');ingest(s,7,records);
    const state=s.lab.statsForVersion(mm.ID,'1.0.0').decisionState;
    ingest(s,7,records);assert.deepEqual(s.lab.statsForVersion(mm.ID,'1.0.0').decisionState,state);
    ingest(s,8,[record(7,[1,1,2,3,4,5])]);
    assert.deepEqual(s.lab.statsForVersion(mm.ID,'1.0.0').decisionState,state);
    assert.equal(s.lab.listForwardPredictions({strategyId:mm.ID})[0].status,'PENDING');
    s.reopen();assert.deepEqual(s.lab.statsForVersion(mm.ID,'1.0.0').decisionState,state);
});

test('new strategy full-run streaks match saved rows across reporting boundaries',t=>{
    const s=setup(t);const records=Array.from({length:506},(_,i)=>record(i+1,[a,b,c][i%3]));
    const run=s.lab.runBacktest(records,{window:'500',strategyId:mm.ID,seed:'streak'});
    const rows=s.lab.getBacktestRun(run.runId,{limit:1000}).predictions;
    let current=0,worst=0;
    for(const row of rows){if(row.status==='WIN')current=0;if(row.status==='LOSS'){current++;worst=Math.max(worst,current);}}
    assert.equal(run.data.overall.currentLosingStreak,current);assert.equal(run.data.overall.worstLosingStreak,worst);
    assert.equal(run.data.overall.wins,rows.filter(x=>x.status==='WIN').length);
    assert.ok(rows.every(x=>x.status==='SKIP'||x.selections.length===3));
});
