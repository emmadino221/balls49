'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const mm=require('./betzero-minmax');
const {createBetZeroLab,normalizeHistoricalDraws,makeOpportunities}=require('./betzero-lab');
const {migrateVersionKeys}=require('./betzero-version-migration');
const {handleCutoverApi}=require('./betzero-cutover-api');
const a=[3,8,17,23,36,44],b=[4,10,18,24,35,40],c=[7,12,19,25,32,38];
const request={fromVersion:'1.0.0',toVersion:'2.0.0',confirmed:true};
function fixture(t) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-v2-')),file=path.join(dir,'isolated.sqlite');
    let db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000');
    let time=10000,lab=createBetZeroLab(db,{now:()=>time});
    t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
    const result={get db(){return db;},get lab(){return lab;},set time(n){time=n;},
        reopen(){db.close();db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=1000');lab=createBetZeroLab(db,{now:()=>time});}};
    lab.setStrategyConfig(mm.ID,{version:'1.0.0',enabled:true,alertThresholds:[2,8]});
    for(let i=1;i<=6;i++) db.prepare('INSERT INTO betzero_lab_minmax_draws(draw_id,balls_json,observed_at) VALUES(?,?,?)').run(i,JSON.stringify(i===6?b:a),i*1000);
    return result;
}
const settings=s=>s.lab.strategies().filter(x=>x.id===mm.ID);
const state=(s,v)=>JSON.parse(s.db.prepare('SELECT state_json FROM betzero_lab_minmax_state WHERE strategy_id=? AND version=?').get(mm.ID,v)?.state_json||'{}');
const setState=(s,v,data)=>s.db.prepare('INSERT OR REPLACE INTO betzero_lab_minmax_state VALUES(?,?,?)').run(mm.ID,v,JSON.stringify(data));
function ingest(s,target,balls,time) {
    s.time=time;
    s.lab.ingestSnapshot({current:{drawId:String(target)},clock:{drawId:String(target),observedAt:time,timeLeftSeconds:60},snapshotAt:time,
        historyUpdates:[{drawId:String(target-1),result:{balls},settledAt:new Date(time-1).toISOString()}]});
}
for(const method of ['MIN','MAX']) for(const result of ['WIN','LOSS']) test(`v2 ${method} ${result}; v1 unchanged; duplicate/unresolved settlement`,()=>{
    const before={method,pending:7};const other=method==='MIN'?'MAX':'MIN';
    const v2=mm.settle(before,7,result,'2.0.0');
    assert.equal(v2.method,result==='WIN'?method:other);
    assert.equal(mm.settle(before,7,result,'1.0.0').method,result==='WIN'?other:method);
    assert.deepEqual(mm.settle(v2,7,result,'2.0.0'),v2);
    assert.deepEqual(mm.settle(before,8,result,'2.0.0'),before);
    assert.deepEqual(mm.settle(before,7,'PENDING','2.0.0'),before);
    assert.deepEqual(mm.settle({...before,paused:true},7,result,'2.0.0'),{...before,paused:true});
});
test('v2 boundaries, ties and initial five opportunities retain v1 rules and pending blocks',()=>{
    const h=Array.from({length:5},(_,i)=>({source:{id:i+1,balls:a},target:{id:i+2,balls:b}}));
    for(const [src,history,initial] of [[{id:6,balls:a},h,{}],[{id:6,balls:[1,8,17,23,36,49]},h,{method:'MIN'}],[{id:6,balls:a},h.map(p=>({...p,target:{...p.target,balls:c}})),{}],[{id:6,balls:a},h,{pending:6}]]) {
        const v1=mm.decide(src,7,history,initial),v2=mm.decide(src,7,history,initial,'2.0.0');
        assert.equal(v2.status,v1.status);assert.deepEqual(v2.selections,v1.selections);
        assert.equal(v2.conditions.reason,v1.conditions.reason);assert.equal(v2.conditions.method,v1.conditions.method);
        if(v2.status==='SKIP') assert.deepEqual(mm.afterDecision(initial,v2,7),mm.afterDecision(initial,v1,7));
    }
});
test('atomic cutover preserves old state/config/history, initializes separately, gates subsequent draws and survives restart',t=>{
    const s=fixture(t);setState(s,'1.0.0',{method:'MAX',lastSettled:6});
    const others=s.lab.strategies().filter(x=>x.id!==mm.ID),old=state(s,'1.0.0');
    const cut=s.lab.cutoverMinmax(request);assert.equal(cut.afterTargetId,7);
    assert.equal(state(s,'2.0.0').method,'MIN');assert.deepEqual(state(s,'1.0.0'),old);
    assert.equal(settings(s).find(x=>x.version==='1.0.0').enabled,false);
    assert.equal(settings(s).find(x=>x.version==='2.0.0').enabled,true);
    assert.deepEqual(settings(s).find(x=>x.version==='1.0.0').config.alertThresholds,[2,8]);
    assert.deepEqual(s.lab.strategies().filter(x=>x.id!==mm.ID),others);
    assert.equal(s.lab.listForwardPredictions().length,0);
    ingest(s,7,b,11000);assert.equal(s.lab.listForwardPredictions({strategyId:mm.ID,strategyVersion:'2.0.0'}).length,0);
    ingest(s,8,c,12000);let row=s.lab.listForwardPredictions({strategyId:mm.ID,strategyVersion:'2.0.0'})[0];
    assert.equal(row.status,'PENDING');assert.equal(row.targetDrawId,'8');assert.equal(state(s,'2.0.0').pending,8);
    s.reopen();assert.equal(state(s,'2.0.0').pending,8);
    const snapshot=JSON.stringify(row);ingest(s,8,c,13000);assert.equal(JSON.stringify(s.lab.listForwardPredictions({strategyId:mm.ID,strategyVersion:'2.0.0'})[0]),snapshot);
    // Settle MIN [6,7,8] with b (WIN), then same MIN method on new source.
    ingest(s,9,b,14000);assert.equal(state(s,'2.0.0').method,'MIN');
    const overview=s.lab.overview();assert.equal(overview.strategyVersions[`${mm.ID}@2.0.0`].wins,1);
    assert.equal(overview.strategyVersions[`${mm.ID}@1.0.0`].wins,0);
    assert.deepEqual(state(s,'1.0.0'),old);
    ingest(s,10,b,15000);assert.equal(state(s,'2.0.0').method,'MAX');
    ingest(s,11,b,16000);assert.equal(state(s,'2.0.0').method,'MIN');
    let metrics=s.lab.statsForVersion(mm.ID,'2.0.0');assert.equal(metrics.currentLosingStreak,2);assert.equal(metrics.worstLosingStreak,2);
    ingest(s,12,c,17000);metrics=s.lab.statsForVersion(mm.ID,'2.0.0');
    assert.equal(metrics.currentLosingStreak,0);assert.equal(metrics.worstLosingStreak,2);assert.equal(metrics.wins,2);
    assert.equal(s.lab.statsForVersion(mm.ID,'1.0.0').worstLosingStreak,0);
    const originalResult=s.lab.listForwardPredictions({strategyId:mm.ID,strategyVersion:'2.0.0'}).find(r=>r.targetDrawId==='8');
    ingest(s,9,a,18000); // Conflicting correction pauses v2, never reinterprets its saved result.
    assert.equal(state(s,'2.0.0').paused,true);
    assert.deepEqual(s.lab.listForwardPredictions({strategyId:mm.ID,strategyVersion:'2.0.0'}).find(r=>r.targetDrawId==='8'),originalResult);
    assert.throws(()=>s.lab.cutoverMinmax(request),/blocked|initialized/);
});
test('cutover requires confirmation, history, exact config version and cannot be bypassed',t=>{
    const s=fixture(t),before=settings(s);
    assert.throws(()=>s.lab.cutoverMinmax({...request,confirmed:false}),/confirmation/);
    assert.throws(()=>s.lab.setStrategyConfig(mm.ID,{enabled:false}),/version/i);
    assert.throws(()=>s.lab.setStrategyConfig(mm.ID,{version:'2.0.0',enabled:true}),/cutover/i);
    s.db.exec('DELETE FROM betzero_lab_minmax_draws WHERE draw_id=1');
    assert.throws(()=>s.lab.cutoverMinmax(request),/five/);assert.deepEqual(settings(s),before);
});
test('pending, paused and invalid records block cutover without writes',t=>{
    const s=fixture(t),before=settings(s);
    for(const blocked of [{pending:7},{paused:true}]) {setState(s,'1.0.0',blocked);assert.throws(()=>s.lab.cutoverMinmax(request),/blocked/);assert.deepEqual(settings(s),before);assert.deepEqual(state(s,'2.0.0'),{});}
    setState(s,'1.0.0',{});
    s.db.exec(`INSERT INTO betzero_lab_forward_predictions(prediction_id,strategy_id,strategy_version,source_draw_id,target_draw_id,predicted_at,strategy_config_json,selections_json,conditions_json,source_input_json,status) VALUES('invalid','minimum_maximum_three','1.0.0','6','7','original','{}','[2,3,4]','{}','{}','INVALID')`);
    assert.throws(()=>s.lab.cutoverMinmax(request),/blocked/);assert.deepEqual(settings(s),before);
    assert.equal(s.db.prepare("SELECT predicted_at FROM betzero_lab_forward_predictions WHERE prediction_id='invalid'").get().predicted_at,'original');
});
test('database failure rolls back both enablement changes and new state',t=>{
    const s=fixture(t),before=settings(s);
    s.db.exec("CREATE TRIGGER fail_v2 BEFORE UPDATE ON betzero_lab_strategy_configs WHEN NEW.version='2.0.0' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    assert.throws(()=>s.lab.cutoverMinmax(request),/injected/);assert.deepEqual(settings(s),before);assert.deepEqual(state(s,'2.0.0'),{});
});
test('competing database writer prevents partial cutover and successful retry is not repeated',t=>{
    const s=fixture(t),before=settings(s),other=new DatabaseSync(s.db.location());
    s.db.exec('PRAGMA busy_timeout=30');other.exec('BEGIN IMMEDIATE');
    try {assert.throws(()=>s.lab.cutoverMinmax(request),/locked|busy/);assert.deepEqual(settings(s),before);}
    finally {other.exec('ROLLBACK');other.close();}
    s.lab.cutoverMinmax(request);const after=settings(s),decision=state(s,'2.0.0');
    assert.throws(()=>s.lab.cutoverMinmax(request),/already been initialized/);
    assert.deepEqual(settings(s),after);assert.deepEqual(state(s,'2.0.0'),decision);
    assert.throws(()=>s.lab.setStrategyConfig(mm.ID,{version:'1.0.0',enabled:true}),/rollback|review/i);
});
test('historical version selection, simultaneous versions, no future lookahead or saved enablement mutation',t=>{
    const s=fixture(t),before=settings(s);const records=Array.from({length:106},(_,i)=>({drawId:String(i+1),result:{balls:[a,b,c][i%3]}}));
    for(const version of ['1.0.0','2.0.0']) {
        const run=s.lab.runBacktest(records,{window:'100',strategyId:mm.ID,strategyVersion:version});
        assert.equal(run.results.length,3);assert.ok(run.results.every(r=>r.strategyVersion===version));
        assert.ok(s.lab.getBacktestRun(run.runId).predictions.every(r=>r.strategyVersion===version));
        assert.equal(run.data.overall.strategyVersion,version);
    }
    const frozen=s.lab.strategies().filter(x=>x.id===mm.ID).map(x=>({...x,enabled:true}));
    const both=s.lab.runBacktest(records,{window:'100',frozenStrategies:frozen});assert.equal(both.results.length,6);
    assert.equal(s.lab.getBacktestRun(both.runId).predictions.length,200);assert.deepEqual(settings(s),before);
    const pairs=makeOpportunities(normalizeHistoricalDraws(records).draws).opportunities;
    const original=mm.simulate(pairs,pairs,()=>{},'2.0.0');records[50].result.balls=[1,2,3,4,5,6];
    const changed=makeOpportunities(normalizeHistoricalDraws(records).draws).opportunities;
    const later=mm.simulate(changed,changed,()=>{},'2.0.0');
    for(const [id,pick] of original) if(id<=51)assert.deepEqual(pick,later.get(id));
});
test('migration rejects incomplete historical schemas explicitly',()=>{
    const db=new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE betzero_lab_backtest_runs(run_id TEXT PRIMARY KEY)');
        assert.throws(()=>migrateVersionKeys(db),/unexpected schema/);
        assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    } finally {db.close();}
});
test('cutover API requires admin; rejects unconfirmed requests; never calls lab for unauthorized users',async()=>{
    let calls=0;const lab={cutoverMinmax(input){calls++;assert.deepEqual(input,request);return {ok:true};}};
    const invoke=session=>handleCutoverApi({req:{method:'POST'},res:{},session,lab,readJson:async()=>request,sendJson:(_,status,body)=>({status,body})});
    assert.equal((await invoke(null)).status,401);assert.equal((await invoke({admin:false})).status,401);assert.equal(calls,0);
    assert.equal((await invoke({admin:true})).status,200);assert.equal(calls,1);
});
test('isolated worker honors frozen v2 selection, leaves settings untouched and preserves incompatible hashes',async t=>{
    const s=fixture(t),before=settings(s);
    const {createJobStore}=require('./betzero-jobs');const {executeJob}=require('./betzero-worker');
    s.db.exec('CREATE TABLE public_prediction_history(draw_id TEXT,sort_draw_id INTEGER,record_json TEXT)');
    for(let i=1;i<=106;i++)s.db.prepare('INSERT INTO public_prediction_history VALUES(?,?,?)').run(String(i),i,JSON.stringify({drawId:String(i),result:{balls:[a,b,c][i%3]}}));
    const store=createJobStore(s.db);
    assert.throws(()=>store.enqueue({window:'100',strategyId:mm.ID,strategyVersion:'3.0.0'},s.lab.strategies()),/Unknown/);
    const job=store.enqueue({window:'100',seed:'v2-worker',strategyId:mm.ID,strategyVersion:'2.0.0'},s.lab.strategies());
    assert.equal(job.specification.strategies.length,1);assert.equal(job.specification.strategies[0].version,'2.0.0');
    const prior=process.env.SITE_DB_PATH;
    process.env.SITE_DB_PATH=s.db.location();
    try {
        await executeJob(s.db,store,store.claim(),{pollMs:10});
        const done=store.get(job.id);assert.equal(done.state,'COMPLETED',done.error);
        assert.ok(s.lab.getBacktestRun(done.runId).results.every(r=>r.strategyVersion==='2.0.0'));
        assert.deepEqual(settings(s),before);
        const old=store.enqueue({window:'100',seed:'old-hash',strategyId:mm.ID,strategyVersion:'1.0.0'},s.lab.strategies());
        const claim=store.claim();claim.specification.rulesHash='incompatible-old-code';
        await executeJob(s.db,store,claim,{pollMs:10});
        assert.equal(store.get(old.id).state,'FAILED');assert.match(store.get(old.id).error,/Frozen rules/);
        assert.equal(store.get(old.id).specification.rulesHash,old.specification.rulesHash);
    } finally {if(prior===undefined)delete process.env.SITE_DB_PATH;else process.env.SITE_DB_PATH=prior;}
});
test('HIGH/LOW follows the v2 method for the same draw and is graded by the draw total',t=>{
    const {gradeStrategy,strategyProbability,HIGH_LOW_ID}=require('./betzero-lab');
    const hl={id:HIGH_LOW_ID,version:'1.0.0',selectionCount:1};
    // b totals 131 (LOW), [20,22,24,26,28,30] totals 150 (MID), [30,32,34,36,38,40] totals 210 (HIGH).
    assert.equal(gradeStrategy(hl,['LOW'],b),'WIN');assert.equal(gradeStrategy(hl,['HIGH'],b),'LOSS');
    assert.equal(gradeStrategy(hl,['HIGH'],[30,32,34,36,38,40]),'WIN');
    for(const pick of ['HIGH','LOW']) assert.equal(gradeStrategy(hl,[pick],[20,22,24,26,28,30]),'LOSS');
    for(const bad of [[],[3],['MID'],['HIGH','LOW']]) assert.equal(gradeStrategy(hl,bad,b),'INVALID');
    assert.ok(strategyProbability(hl)>0.47 && strategyProbability(hl)<0.5);
    const s=fixture(t),rows=()=>s.lab.listForwardPredictions({strategyId:HIGH_LOW_ID}),row=target=>rows().find(r=>r.targetDrawId===String(target));
    assert.equal(s.lab.strategies().find(x=>x.id===HIGH_LOW_ID).enabled,false);
    s.lab.setStrategyEnabled(HIGH_LOW_ID,true);s.lab.cutoverMinmax(request);
    ingest(s,7,b,11000); // v2 does not predict the cutover draw, so HIGH/LOW has nothing to follow.
    assert.equal(row(7).status,'SKIP');assert.equal(row(7).conditions.reason,'MINMAX_V2_HAS_NO_PREDICTION');
    ingest(s,8,c,12000); // v2 predicts with MIN -> LOW.
    assert.equal(row(8).status,'PENDING');assert.deepEqual(row(8).selections,['LOW']);assert.equal(row(8).conditions.followsMethod,'MIN');
    ingest(s,9,b,14000);assert.equal(row(8).status,'WIN'); // draw 8 totals 131
    assert.deepEqual(row(9).selections,['LOW']);
    ingest(s,10,b,15000); // v2 lost draw 9 and switches to MAX -> HIGH for draw 10.
    assert.equal(row(9).status,'WIN');assert.deepEqual(row(10).selections,['HIGH']);assert.equal(row(10).conditions.followsMethod,'MAX');
    ingest(s,11,b,16000);assert.equal(row(10).status,'LOSS');
    const stats=s.lab.overview().strategyVersions[`${HIGH_LOW_ID}@1.0.0`];
    assert.equal(stats.wins,2);assert.equal(stats.losses,1);assert.equal(stats.market,'HIGH_LOW');
    const records=Array.from({length:60},(_,i)=>({drawId:String(i+1),result:{balls:[a,b,c][(i*i+i)%3]}}));
    const run=s.lab.runBacktest(records,{window:'all',strategyId:HIGH_LOW_ID,strategyVersion:'1.0.0'});
    const tested=s.lab.getBacktestRun(run.runId),made=tested.predictions.filter(p=>p.status!=='SKIP');
    assert.ok(made.length>0);
    for(const p of made) {assert.deepEqual(p.selections,[p.conditions.followsMethod==='MAX'?'HIGH':'LOW']);assert.equal(p.status,p.selections[0]==='LOW'?'WIN':'LOSS');} // every fixture draw totals LOW
    const totals=tested.results.reduce((sum,r)=>sum+r.result.wins+r.result.losses,0);assert.equal(totals,made.length);
});
