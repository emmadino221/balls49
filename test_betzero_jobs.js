'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBetZeroLab } = require('./betzero-lab');
const { createJobStore, TIMEOUT_MS } = require('./betzero-jobs');
const { executeJob } = require('./betzero-worker');
const { handleJobApi, smallBacktestRecords } = require('./betzero-job-api');
function setup(t) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(),'betzero-queue-test-'));
    const filename = path.join(folder,'site.sqlite');
    const db = new DatabaseSync(filename); db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=50');
    const lab = createBetZeroLab(db);
    db.exec('CREATE TABLE public_prediction_history (draw_id TEXT PRIMARY KEY,sort_draw_id INTEGER,record_json TEXT)');
    const add = (start,end) => { for(let id=start;id<=end;id++) db.prepare('INSERT INTO public_prediction_history VALUES (?,?,?)').run(String(id),id,JSON.stringify({ drawId:String(id),result:{balls:[3,8,17,23,36,44]} })); };
    add(1,21);
    let time = Date.now();
    const store = createJobStore(db,{now:()=>time});
    t.after(()=>{ db.close(); const resolved=path.resolve(folder); assert.equal(path.dirname(resolved),path.resolve(os.tmpdir())); fs.rmSync(resolved,{recursive:true,force:true}); });
    return {db,lab,store,filename,add,advance:ms=>{time+=ms;},enqueue:()=>store.enqueue({window:'all',seed:'queue-test'},lab.strategies())};
}
test('queue bounds, duplicate claims and immutable strategy snapshots', t=>{
    const s=setup(t); const first=s.enqueue(); s.enqueue(); assert.throws(()=>s.enqueue(),/Queue is full/);
    const other=new DatabaseSync(s.filename);
    const secondStore=createJobStore(other);
    const claim=s.store.claim(); assert.ok(claim); assert.equal(secondStore.claim(),null);
    other.close();
    s.enqueue(); assert.throws(()=>s.enqueue(),/Queue is full/);
    s.lab.setStrategyEnabled('simple_smallest_number_add_10',false);
    assert.equal(first.specification.strategies.find(x=>x.id==='simple_smallest_number_add_10').enabled,true);
    assert.equal(first.specification.strategies.find(x=>x.id==='smallest_add10_step10_four').enabled,false);
});
test('queued cancellation and crash recovery leave consumed cohorts consumed', t=>{
    const s=setup(t); const p=s.store.seal({firstDraw:22,lastDraw:30,seed:'sealed'},s.lab.strategies());
    s.add(22,30); const job=s.store.enqueue({protocolId:p.id},s.lab.strategies());
    s.store.claim(); s.advance(31000); assert.equal(s.store.recover(),1); assert.equal(s.store.get(job.id).state,'FAILED');
    assert.throws(()=>s.store.enqueue({protocolId:p.id},s.lab.strategies()),/consumed/);
    assert.throws(()=>s.store.enqueue({window:'100',seed:'outside'},s.lab.strategies()),/overlaps/);
});
test('final protocols reserve future boundaries globally, reject reuse and historical sealing', t=>{
    const s=setup(t);
    assert.throws(()=>s.store.seal({firstDraw:1,lastDraw:10,seed:'x'},s.lab.strategies()));
    assert.throws(()=>s.store.seal({firstDraw:15,lastDraw:25,seed:'x'},s.lab.strategies()),/future/);
    const p=s.store.seal({firstDraw:22,lastDraw:30,seed:'x'},s.lab.strategies());
    assert.throws(()=>s.store.seal({firstDraw:25,lastDraw:35,seed:'another'},s.lab.strategies()),/overlaps/);
    assert.throws(()=>s.store.enqueue({protocolId:p.id},s.lab.strategies()),/not complete/);
    s.add(22,30);
    assert.throws(()=>s.enqueue(),/overlaps/);
    assert.throws(()=>s.store.reserveSync([{drawId:'22'},{drawId:'23'}]),/overlaps/);
    const job=s.store.enqueue({protocolId:p.id},s.lab.strategies());
    s.store.cancel(job.id); assert.equal(s.store.get(job.id).state,'CANCELLED');
    assert.throws(()=>s.store.enqueue({protocolId:p.id},s.lab.strategies()),/consumed/);
});
test('database contention is bounded and cannot leave a half-enqueued job', t=>{
    const s=setup(t); const other=new DatabaseSync(s.filename);
    other.exec('BEGIN IMMEDIATE');
    try { const start=Date.now(); assert.throws(()=>s.enqueue(),/locked|busy/); assert.ok(Date.now()-start<1000); }
    finally { other.exec('ROLLBACK'); other.close(); }
    assert.equal(s.store.list().length,0); assert.ok(s.enqueue());
});
function fakeChild(onSend) {
    const child=new EventEmitter(); child.send=()=>onSend(child); child.kill=()=>{queueMicrotask(()=>child.emit('exit',1));}; return child;
}
test('supervisor terminates running jobs after the ten-minute deadline', async t=>{
    const s=setup(t); s.enqueue(); const job=s.store.claim();
    await executeJob(s.db,s.store,job,{pollMs:1,forkProcess:()=>fakeChild(()=>s.advance(TIMEOUT_MS))});
    assert.equal(s.store.get(job.id).state,'TIMED_OUT'); assert.equal(s.store.claim(),null);
});
test('supervisor terminates cancelled running jobs and does not publish a result', async t=>{
    const s=setup(t); s.enqueue(); const job=s.store.claim();
    await executeJob(s.db,s.store,job,{pollMs:1,forkProcess:()=>fakeChild(()=>s.store.cancel(job.id))});
    assert.equal(s.store.get(job.id).state,'CANCELLED'); assert.equal(s.store.get(job.id).runId,null);
});
test('real child process produces isolated results without altering strategies or forward records', async t=>{
    const s=setup(t); const previous=process.env.SITE_DB_PATH; process.env.SITE_DB_PATH=s.filename;
    t.after(()=>{if(previous===undefined)delete process.env.SITE_DB_PATH;else process.env.SITE_DB_PATH=previous;});
    const settings=s.lab.strategies(); s.enqueue(); const job=s.store.claim();
    await executeJob(s.db,s.store,job,{pollMs:20});
    const result=s.store.get(job.id); assert.equal(result.state,'COMPLETED',result.error);
    assert.equal(result.progress,100); assert.ok(s.lab.getBacktestRun(result.runId));
    assert.deepEqual(s.lab.strategies(),settings); assert.equal(s.lab.listForwardPredictions().length,0);
    assert.equal(s.lab.getBacktestRun(result.runId).data.evaluationMode,'EXPLORATORY');
});
test('size cap and synchronous legacy contract remain explicit', t=>{
    const s=setup(t); s.add(50002,50002); assert.throws(()=>s.enqueue(),/50,000/);
    const records=Array.from({length:200},(_,i)=>({drawId:String(200-i)}));
    assert.equal(smallBacktestRecords(records,'100').length,101);
    assert.throws(()=>smallBacktestRecords(records,'all'),error=>error.status===413);
    assert.equal(smallBacktestRecords(records.slice(0,10),'all').length,10);
});
test('all queue and protocol endpoints enforce owner authorization before data access', async()=>{
    for(const route of ['jobs','job-cancel','protocols']) for(const method of ['GET','POST']) for(const session of [null,{admin:false,user:{}}]) {
        let status;
        await handleJobApi({req:{method},res:{},url:new URL('http://localhost/admin/betzero-lab/'+route),session,
            store:new Proxy({},{get(){throw new Error('Unauthorized storage access');}}),lab:{},readJson:()=>{throw new Error('Unauthorized body read');},sendJson:(_,s)=>{status=s;}});
        assert.equal(status,401);
    }
});

test('sealed worker evaluation uses one frozen cohort and cannot be submitted a second time', async t=>{
    const s=setup(t); const previous=process.env.SITE_DB_PATH; process.env.SITE_DB_PATH=s.filename;
    t.after(()=>{if(previous===undefined)delete process.env.SITE_DB_PATH;else process.env.SITE_DB_PATH=previous;});
    const protocol=s.store.seal({firstDraw:22,lastDraw:30,seed:'frozen-final'},s.lab.strategies());
    s.add(22,30);
    s.lab.setStrategyEnabled('simple_smallest_number_add_10',false);
    s.store.enqueue({protocolId:protocol.id},s.lab.strategies());
    const job=s.store.claim(); await executeJob(s.db,s.store,job,{pollMs:20});
    const saved=s.store.get(job.id); assert.equal(saved.state,'COMPLETED',saved.error);
    const run=s.lab.getBacktestRun(saved.runId);
    assert.equal(run.data.evaluationMode,'SEALED_FINAL'); assert.equal(run.data.protocolId,protocol.id);
    assert.equal(run.data.split.finalTest,9); assert.equal(run.data.split.development,0);
    assert.ok(run.results.find(r=>r.strategyId==='simple_smallest_number_add_10').result.predictions>0);
    assert.equal(s.lab.strategies().find(s=>s.id==='simple_smallest_number_add_10').enabled,false);
    assert.equal(s.lab.strategies().find(s=>s.id==='smallest_add10_step10_four').enabled,false);
    assert.throws(()=>s.store.enqueue({protocolId:protocol.id},s.lab.strategies()),/consumed/);
});

test('recovered claims are fenced and waiting jobs can subsequently run', t=>{
    const s=setup(t); s.enqueue(); s.enqueue(); const claim=s.store.claim(); s.advance(31000);
    assert.equal(s.store.recover(),1);
    assert.equal(s.store.heartbeat(claim.id,claim.token,99),0);
    assert.equal(s.store.finish(claim.id,claim.token,'COMPLETED',null,'fake-run'),0);
    const next=s.store.claim(); assert.ok(next); assert.notEqual(next.id,claim.id);
});

test('separate supervisor shuts down cleanly while idle and cancels its active child', async t=>{
    const s=setup(t); s.add(22,1021);
    const launch=async()=>{
        const child=fork(path.join(__dirname,'betzero-worker.js'),[],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,SITE_DB_PATH:s.filename},stdio:['ignore','ignore','ignore','ipc']});
        t.after(()=>{if(child.exitCode===null)child.kill();});
        const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No worker readiness')),10000);child.once('message',m=>{clearTimeout(timer);assert.equal(m.type,'ready');resolve();});});
        return {child,exit};
    };
    const stop=async worker=>{
        worker.child.send({command:'shutdown'});
        let timer;
        try {const result=await Promise.race([worker.exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shutdown timed out')),10000);})]);assert.deepEqual(result,{code:0,signal:null});}
        finally{clearTimeout(timer);}
    };
    await stop(await launch());
    const job=s.enqueue(), worker=await launch();
    const deadline=Date.now()+10000;
    while(s.store.get(job.id).state==='QUEUED'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
    assert.equal(s.store.get(job.id).state,'RUNNING');
    await stop(worker);
    assert.equal(s.store.get(job.id).state,'CANCELLED');
    assert.equal(s.store.get(job.id).runId,null);
});

test('owner API returns asynchronous 202 jobs, status and cancellation without changing sync result shape', async t=>{
    const s=setup(t);
    const call=async(method,route,body)=>{
        let response;
        await handleJobApi({req:{method},res:{},url:new URL('http://localhost/admin/betzero-lab/'+route),session:{admin:true},store:s.store,lab:s.lab,readJson:async()=>body,sendJson:(_,status,payload)=>{response={status,payload};}});
        return response;
    };
    const created=await call('POST','jobs',{window:'100',seed:'api'});
    assert.equal(created.status,202); assert.equal(created.payload.state,'QUEUED');
    assert.equal((await call('GET','jobs?id='+created.payload.id)).payload.id,created.payload.id);
    assert.equal((await call('POST','job-cancel',{id:created.payload.id})).payload.state,'CANCELLED');
    assert.equal((await call('DELETE','jobs')).status,405);
    const records=s.db.prepare('SELECT record_json FROM public_prediction_history ORDER BY sort_draw_id DESC').all().map(r=>JSON.parse(r.record_json));
    const result=s.lab.runBacktest(smallBacktestRecords(records,'all'),{window:'all'});
    assert.equal(result.status,'COMPLETED'); assert.ok(result.runId); assert.ok(Array.isArray(result.results)); assert.ok(result.data);
});
