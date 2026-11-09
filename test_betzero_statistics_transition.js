'use strict';
// Synthetic fixtures verify mechanics only; they are not reported performance.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const t = require('./betzero-statistics-transition');
const {createBetZeroLab,gradeStrategy,strategyProbability,predictionFromStrategy} = require('./betzero-lab');
const zero=t.definitions[0], hit=t.definitions[1];
const balls=[10,20,30,40,45,49];
function sample(source,values={}) {
    return {btc:11090,period:'100',sourceDrawId:source,targetDrawId:source+1,
        requestedAt:source*1000+100,receivedAt:source*1000+110,deadline:(source+1)*1000,
        response:{status:1,data:{stats:Array.from({length:49},(_,i)=>({sel:String(i+1),strk:String(values[i+1] ?? 0)}))}}};
}
const previous=()=>sample(10,{1:2,2:3,3:2,4:3,5:2,6:4});
const current=()=>sample(11,{1:1,2:1,3:1,4:1,5:1,6:1});
function fixture(ctx) {
    const db=new DatabaseSync(':memory:');let time=1;
    const lab=createBetZeroLab(db,{now:()=>time});
    ctx.after(()=>db.close());
    return {db,lab,store:t.createStore(db),setTime(value){time=value;}};
}
test('exact transitions, ascending first four, no 4-to-1, no carryover',()=>{
    const a=t.normalize(previous()), b=t.normalize(current());
    const pick=t.pick(zero,a,b,12);
    assert.deepEqual(pick.selections,[1,2,3,4]);
    assert.deepEqual(pick.conditions.qualified,[1,2,3,4,5]);
    assert.equal(t.pick(zero,a,t.normalize(sample(11,{1:1,2:1,3:1,6:1})),12).conditions.reason,'FEWER_THAN_FOUR_TRANSITIONS');
    assert.equal(t.pick(zero,b,t.normalize(sample(12,{1:1,2:1,3:1,4:1})),13).status,'SKIP');
});
test('Bet49 is deterministic and always comes from the same four',()=>{
    const a=t.normalize(previous()),b=t.normalize(current());
    const seen=new Set();
    for(let i=0;i<100;i++) {
        const p=t.pick(hit,a,b,12,`seed${i}`);
        assert.deepEqual(p,t.pick(hit,a,b,12,`seed${i}`));
        assert.equal(p.selections.length,1); assert.ok([1,2,3,4].includes(p.selections[0]));
        assert.ok(p.conditions.randomSeed); seen.add(p.selections[0]);
    }
    assert.equal(seen.size,4);
});
test('missing, gapped, conflicting snapshots skip and invalid inputs are rejected',()=>{
    const a=t.normalize(previous()),b=t.normalize(current());
    assert.equal(t.pick(zero,null,b,12).status,'SKIP');
    assert.equal(t.pick(zero,a,{...b,conflicted:true},12).status,'SKIP');
    assert.equal(t.pick(zero,a,b,13).status,'SKIP');
    assert.equal(t.pick(zero,{...a,targetDrawId:9},b,12).status,'SKIP');
    const invalid=[null,{...previous(),period:'24HRS'},{...previous(),receivedAt:12000}, {...previous(),targetDrawId:15}];
    const malformed=previous();malformed.response.data.stats[0]=null;invalid.push(malformed);
    const duplicate=previous();duplicate.response.data.stats[1].sel='1';invalid.push(duplicate);
    const incomplete=previous();incomplete.response.data.stats.pop();invalid.push(incomplete);
    for(const raw of invalid) assert.equal(t.normalize(raw),null);
});
test('opposite settlement contracts and matched theoretical baselines',()=>{
    assert.equal(gradeStrategy(zero,[1,2,3,4],balls),'WIN');
    assert.equal(gradeStrategy(zero,[1,2,3,10],balls),'LOSS');
    assert.equal(gradeStrategy(hit,[10],balls),'WIN');
    assert.equal(gradeStrategy(hit,[1],balls),'LOSS');
    assert.equal(gradeStrategy(hit,[1,2],balls),'INVALID');
    assert.equal(strategyProbability(hit),6/49);
    assert.ok(strategyProbability(zero)>0.58 && strategyProbability(zero)<0.59);
});
test('snapshot persistence is immutable/idempotent; late data and conflicts fail closed',ctx=>{
    const f=fixture(ctx);
    assert.equal(f.store.remember(previous(),10120),true);
    assert.equal(f.store.remember(current(),11120),true);
    const original=f.store.read(10);
    assert.equal(f.store.remember(previous(),10130),false);
    assert.deepEqual(f.store.read(10),original);
    assert.equal(t.createStore(f.db).predict(zero,12,'seed',12000).status,'PENDING');
    assert.equal(f.store.predict(zero,12,'seed',11115).status,'SKIP');
    assert.equal(f.store.remember(sample(12),13000),false);
    f.store.remember(sample(10,{1:3}),10150);
    assert.equal(f.store.read(10).signature,original.signature);
    assert.equal(f.store.read(10).conflicted,true);
    assert.equal(f.store.predict(zero,12,'seed',12000).status,'SKIP');
    assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('disabled defaults and old algorithms remain separate',ctx=>{
    const f=fixture(ctx);
    for(const id of [t.ZERO,t.HIT]) assert.equal(f.lab.strategies().find(s=>s.id===id).enabled,false);
    assert.equal(f.lab.strategies().filter(s=>s.status==='UNVERIFIED' && s.enabled).length,0);
    const single=f.lab.strategies().find(s=>s.id==='simple_smallest_number_add_10');
    assert.deepEqual(predictionFromStrategy(single,{balls:[1,2,3,4,5,6]}).selections,[11]);
    const four=f.lab.strategies().find(s=>s.id==='smallest_add10_step10_four');
    assert.deepEqual(predictionFromStrategy({...four,enabled:true},{balls:[1,2,3,4,5,6]}).selections,[11,21,31,41]);
    assert.equal(f.lab.strategies().find(s=>s.id===four.id).enabled,false);
});
test('historical selection uses saved snapshots, persists independent results, never enables forward',ctx=>{
    const f=fixture(ctx);
    for(let id=10;id<=16;id++) f.store.remember(sample(id,id%2===0?{1:2,2:3,3:2,4:3}:{1:1,2:1,3:1,4:1}),id*1000+120);
    const records=Array.from({length:8},(_,i)=>({drawId:String(10+i),result:{balls},settledAt:new Date((10+i)*1000+50).toISOString()}));
    f.setTime(20000);
    const config=JSON.stringify(f.lab.strategies());
    const a=f.lab.runBacktest(records,{window:'100',strategyId:t.ZERO,seed:'stable'});
    const b=f.lab.runBacktest(records,{window:'100',strategyId:t.HIT,seed:'stable'});
    assert.notEqual(a.runId,b.runId);
    const outcomes=id=>f.db.prepare('SELECT status FROM betzero_lab_backtest_predictions WHERE strategy_id=?').all(id).map(r=>r.status);
    assert.ok(outcomes(t.ZERO).includes('WIN'));assert.ok(!outcomes(t.ZERO).includes('LOSS'));
    assert.ok(outcomes(t.HIT).includes('LOSS'));assert.ok(!outcomes(t.HIT).includes('WIN'));
    assert.ok(outcomes(t.ZERO).includes('SKIP'));
    assert.equal(JSON.stringify(f.lab.strategies()),config);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM betzero_lab_forward_predictions').get().n,0);
    const altered=records.map(r=>({...r,result:{balls:[1,2,3,4,5,6]}}));
    f.lab.runBacktest(altered,{window:'100',strategyId:t.ZERO,seed:'stable'});
    const selections=f.db.prepare("SELECT DISTINCT selections_json FROM betzero_lab_backtest_predictions WHERE strategy_id=? AND status IN ('WIN','LOSS')").all(t.ZERO);
    assert.equal(selections.length,1);assert.equal(selections[0].selections_json,'[1,2,3,4]');
});
test('forward snapshots, repeated settlement and independent streaks',ctx=>{
    const f=fixture(ctx);
    f.lab.setStrategyEnabled(t.ZERO,true); f.lab.setStrategyEnabled(t.HIT,true);
    function ingest(raw) {
        f.setTime(raw.receivedAt+10);
        f.lab.ingestSnapshot({current:{drawId:raw.targetDrawId},clock:{drawId:raw.targetDrawId,timeLeftSeconds:.9,observedAt:raw.requestedAt},
            snapshotAt:raw.receivedAt+10,numberStatistics:raw,
            historyUpdates:[{drawId:String(raw.sourceDrawId),result:{balls},settledAt:new Date(raw.sourceDrawId*1000+50).toISOString()}]});
    }
    ingest(previous()); ingest(current());
    const pending=f.lab.listForwardPredictions({strategyId:t.ZERO}).find(p=>p.targetDrawId==='12');
    assert.equal(pending.status,'PENDING');assert.deepEqual(pending.selections,[1,2,3,4]);
    assert.equal(f.lab.listForwardPredictions({strategyId:t.HIT}).find(p=>p.targetDrawId==='12').status,'PENDING');
    const input={current:null,clock:{},historyUpdates:[{drawId:'12',result:{balls},settledAt:new Date(12050).toISOString()}],snapshotAt:12100};
    f.setTime(12100);f.lab.ingestSnapshot(input);
    const after=JSON.stringify(f.lab.listForwardPredictions());
    f.lab.ingestSnapshot(input);assert.equal(JSON.stringify(f.lab.listForwardPredictions()),after);
    assert.equal(f.lab.statsForVersion(t.ZERO,'1.0.0').wins,1);
    const stats=f.lab.statsForVersion(t.HIT,'1.0.0');
    assert.equal(stats.losses,1);assert.equal(stats.currentLosingStreak,1);assert.equal(stats.worstLosingStreak,1);
    assert.equal(stats.provisional,true);
    assert.equal(f.lab.listForwardPredictions({strategyId:t.ZERO}).find(p=>p.targetDrawId==='12').predictedAt,pending.predictedAt);
});
test('historical missing timestamps, late capture and absent snapshots cannot create outcomes',ctx=>{
    const f=fixture(ctx);
    for(let id=10;id<=16;id++) f.store.remember(sample(id,id%2===0?{1:2,2:3,3:2,4:3}:{1:1,2:1,3:1,4:1}),id*1000+120);
    const records=Array.from({length:8},(_,i)=>({drawId:String(10+i),result:{balls}}));
    const a=f.lab.runBacktest(records,{window:'100',strategyId:t.ZERO});
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM betzero_lab_backtest_predictions WHERE run_id=? AND status!='SKIP'").get(a.runId).n,0);
    records.forEach(r=>r.settledAt=new Date(Number(r.drawId)*1000-950).toISOString());
    const b=f.lab.runBacktest(records,{window:'100',strategyId:t.ZERO});
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM betzero_lab_backtest_predictions WHERE run_id=? AND status!='SKIP'").get(b.runId).n,0);
});
test('protected cohorts include the earlier snapshot and sealed statistics tests are rejected',ctx=>{
    const f=fixture(ctx), {createJobStore}=require('./betzero-jobs');
    f.db.exec('CREATE TABLE public_prediction_history(sort_draw_id INTEGER PRIMARY KEY, record_json TEXT)');
    const jobs=createJobStore(f.db,{now:()=>1});
    assert.throws(()=>jobs.seal({firstDraw:100,lastDraw:110,seed:'x'},f.lab.strategies().map(s=>({...s,enabled:s.id===t.ZERO}))),/exploratory/);
    f.db.prepare("INSERT INTO betzero_lab_protocols(id,first_draw,last_draw,created_at,specification) VALUES ('protected',9,9,1,'{}')").run();
    const records=Array.from({length:8},(_,i)=>({drawId:String(10+i),result:{balls},settledAt:new Date((10+i)*1000+50).toISOString()}));
    assert.throws(()=>f.lab.runBacktest(records,{window:'100',strategyId:t.ZERO}),/protected cohort/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM betzero_lab_backtest_runs').get().n,0);
});

test('disk restart preserves snapshots, saved settings and predictions',ctx=>{
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'streak-restart-')),file=path.join(dir,'lab.sqlite');
    let db=new DatabaseSync(file);
    ctx.after(()=>{db.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
    let lab=createBetZeroLab(db,{now:()=>1});const store=t.createStore(db);
    store.remember(previous(),10120);store.remember(current(),11120);
    const pick=store.predict(hit,12,'restart',12000),settings=lab.strategies();
    db.close();db=new DatabaseSync(file);lab=createBetZeroLab(db,{now:()=>2});
    assert.deepEqual(t.createStore(db).predict(hit,12,'restart',12000),pick);
    assert.deepEqual(lab.strategies(),settings);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('real queued worker copies frozen statistics and rejects changes after enqueue',async ctx=>{
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    const {createJobStore}=require('./betzero-jobs'),{executeJob}=require('./betzero-worker');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'streak-worker-')),file=path.join(dir,'lab.sqlite');
    const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000');
    const previousPath=process.env.SITE_DB_PATH;process.env.SITE_DB_PATH=file;
    ctx.after(()=>{if(previousPath===undefined)delete process.env.SITE_DB_PATH;else process.env.SITE_DB_PATH=previousPath;
        db.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
    const lab=createBetZeroLab(db),store=t.createStore(db);
    db.exec('CREATE TABLE public_prediction_history(sort_draw_id INTEGER PRIMARY KEY,record_json TEXT)');
    for(let id=10;id<=17;id++) {
        db.prepare('INSERT INTO public_prediction_history VALUES(?,?)').run(id,JSON.stringify({drawId:String(id),result:{balls},settledAt:new Date(id*1000+50).toISOString()}));
        if(id<17)store.remember(sample(id,id%2===0?{1:2,2:3,3:2,4:3}:{1:1,2:1,3:1,4:1}),id*1000+120);
    }
    const jobs=createJobStore(db),settings=lab.strategies();
    const queued=jobs.enqueue({window:'all',strategyId:t.HIT,seed:'worker'},settings);
    assert.ok(queued.specification.statisticsHash);
    await executeJob(db,jobs,jobs.claim(),{pollMs:10});
    const completed=jobs.get(queued.id);assert.equal(completed.state,'COMPLETED',completed.error);
    assert.ok(db.prepare("SELECT 1 FROM betzero_lab_backtest_predictions WHERE run_id=? AND strategy_id=? AND status='LOSS'").get(completed.runId,t.HIT));
    assert.deepEqual(lab.strategies(),settings);assert.equal(lab.listForwardPredictions().length,0);
    const another=jobs.enqueue({window:'all',strategyId:t.HIT,seed:'worker'},settings);
    store.remember(sample(10,{1:3}),10150);
    await executeJob(db,jobs,jobs.claim(),{pollMs:10});
    assert.equal(jobs.get(another.id).state,'FAILED');
    assert.equal(jobs.get(another.id).runId,null);
});
