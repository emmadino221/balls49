'use strict';
// Explicit local research harness. Never imports the production bot or writes its database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { performance } = require('node:perf_hooks');
const { createBetZeroLab, validBalls, wilsonInterval, probabilityAllAbsent } = require('../betzero-lab');
const { createJobStore } = require('../betzero-jobs');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const ids = ['simple_smallest_number_add_10', 'smallest_add10_step10_four'];

async function main() {
    const folder = path.join(root, 'output', 'betzero-stage3', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(folder, { recursive: true });
    const sourcePath = path.join(root, 'predictions.json');
    const sourceBytes = fs.readFileSync(sourcePath);
    const source = new DatabaseSync(path.join(root, 'site_users.sqlite'), { readOnly: true });
    source.exec('PRAGMA busy_timeout=1000');
    const tableExists = name => !!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const protectedRows = tableExists('betzero_lab_protocols') ? source.prepare('SELECT * FROM betzero_lab_protocols').all() : [];
    const sourceState = () => sha(JSON.stringify(['betzero_lab_protocols','betzero_lab_strategy_configs','betzero_lab_forward_predictions'].map(name => tableExists(name) ? source.prepare(`SELECT * FROM ${name}`).all() : [])));
    const originalState = sourceState();
    const records = JSON.parse(sourceBytes);
    const byId = new Map(), conflicts = new Set();
    let invalid = 0, duplicates = 0, protectedDraws = 0;
    for (const row of records) {
        const id = Number(row.drawId), balls = row.result?.balls;
        if (!Number.isSafeInteger(id) || !validBalls(balls)) { invalid++; continue; }
        if (protectedRows.some(p => id >= p.first_draw && id <= p.last_draw)) { protectedDraws++; continue; }
        const signature = balls.slice().sort((a,b) => a-b).join(',');
        if (byId.has(id)) { duplicates++; if (byId.get(id).signature !== signature) conflicts.add(id); }
        else byId.set(id, { id, signature, row: { drawId: String(id), result: { balls }, settledAt: row.settledAt || null } });
    }
    for (const id of conflicts) byId.delete(id);
    const ordered = [...byId.values()].sort((a,b) => a.id-b.id);
    const blocks = [];
    for (const draw of ordered) {
        if (!blocks.length || blocks.at(-1).at(-1).id + 1 !== draw.id) blocks.push([]);
        blocks.at(-1).push(draw);
    }
    // Selection uses continuity and recency only, never strategy outcomes.
    const block = blocks.filter(b => b.length >= 1001).at(-1) || blocks.slice().sort((a,b) => b.length-a.length || b.at(-1).id-a.at(-1).id)[0];
    if (!block || block.length < 101) throw new Error('Insufficient unprotected real consecutive historical data for a 100-opportunity run.');
    const selected = block.slice(-1001);
    const filename = path.join(folder, 'research.sqlite');
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=100; CREATE TABLE public_prediction_history(draw_id TEXT PRIMARY KEY,sort_draw_id INTEGER,record_json TEXT)');
    const lab = createBetZeroLab(db), store = createJobStore(db);
    for (const p of protectedRows) db.prepare('INSERT INTO betzero_lab_protocols VALUES (?,?,?,?,?,?,?)').run(p.id,p.first_draw,p.last_draw,p.created_at,p.specification,p.state,p.job_id);
    const insert = db.prepare('INSERT INTO public_prediction_history VALUES (?,?,?)');
    db.exec('BEGIN');
    for (const d of selected) insert.run(String(d.id), d.id, JSON.stringify(d.row));
    db.exec('COMMIT');
    const configsBefore = JSON.stringify(lab.strategies());
    // Override the frozen BACKTEST specification only; no setStrategyEnabled/config writes.
    const research = lab.strategies().map(s => ({ ...s, enabled: ids.includes(s.id) }));
    let worker, exitPromise;
    const states = [], results = [], timings = [];
    const start = async () => {
        worker = fork(path.join(root, 'betzero-worker.js'), [], { env: { PATH:process.env.PATH, SystemRoot:process.env.SystemRoot, TEMP:process.env.TEMP, TMP:process.env.TMP, SITE_DB_PATH:filename, BETZERO_WORKER_HEAP_MB:'512' }, stdio:['ignore','ignore','pipe','ipc'] });
        let errors = ''; worker.stderr.on('data', d => { errors += d; });
        exitPromise = new Promise(resolve => worker.once('exit', (code,signal) => resolve({code,signal,errors})));
        await new Promise((resolve,reject) => { const timeout=setTimeout(()=>reject(new Error('Worker readiness timed out')),10000); worker.once('message',m=>{clearTimeout(timeout); if(m.type==='ready') resolve(); else reject(new Error('Unexpected worker response'));}); });
    };
    const waitJob = async (job, until = j => !['QUEUED','RUNNING'].includes(j.state)) => {
        const deadline=Date.now()+650000; let last='';
        while (Date.now()<deadline) {
            const before=performance.now(); const current=store.get(job.id); timings.push(performance.now()-before);
            const marker=`${current.state}:${current.progress}`;
            if(marker!==last) {states.push({jobId:job.id,state:current.state,progress:current.progress});last=marker;}
            if(until(current)) return current;
            await pause(25);
        }
        throw new Error('Job observation timed out');
    };
    const shutdown = async () => {
        worker.send({command:'shutdown'});
        let timer;
        try { return await Promise.race([exitPromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Worker shutdown timed out')),10000);})]); }
        finally { clearTimeout(timer); }
    };
    try {
        await start();
        for (const window of [100,500,1000]) {
            if (selected.length <= window) {results.push({window,unavailable:true});continue;}
            const job=store.enqueue({window:String(window),seed:'emmy-betzero-stage3-fixed-v1'},research);
            const completed=await waitJob(job);
            if(completed.state!=='COMPLETED') throw new Error(JSON.stringify(completed));
            const run=lab.getBacktestRun(completed.runId);
            for (const id of ids) {
                const rows=db.prepare('SELECT status,target_draw_id FROM betzero_lab_backtest_predictions WHERE run_id=? AND strategy_id=? ORDER BY CAST(target_draw_id AS INTEGER)').all(completed.runId,id);
                let wins=0,losses=0,skipped=0,currentLoss=0,worstLoss=0,currentWin=0,longestWin=0;
                for(const row of rows) {
                    if(row.status==='WIN'){wins++;currentLoss=0;longestWin=Math.max(longestWin,++currentWin);}
                    else if(row.status==='LOSS'){losses++;currentWin=0;worstLoss=Math.max(worstLoss,++currentLoss);}
                    else skipped++;
                }
                const segments=db.prepare('SELECT segment,result_json FROM betzero_lab_backtest_results WHERE run_id=? AND strategy_id=?').all(completed.runId,id).map(r=>({segment:r.segment,...JSON.parse(r.result_json)}));
                const randomWins=segments.reduce((s,r)=>s+r.randomBaseline.wins,0),randomTrials=segments.reduce((s,r)=>s+r.randomBaseline.trials,0);
                results.push({strategy:id,window,runId:completed.runId,datasetHash:run.datasetHash,firstTarget:run.data.firstTargetDrawId,lastTarget:run.data.lastTargetDrawId,eligible:rows.length,skipped,settled:wins+losses,wins,losses,winRate:wins/(wins+losses),currentLosingStreak:currentLoss,worstLosingStreak:worstLoss,longestWinningStreak:longestWin,theoretical:probabilityAllAbsent(id===ids[0]?1:4),randomWins,randomTrials,randomRate:randomWins/randomTrials,confidence95:wilsonInterval(wins,wins+losses),segments});
            }
        }
        const cancelJob=store.enqueue({window:'1000',seed:'emmy-betzero-stage3-cancel'},research);
        await waitJob(cancelJob,j=>j.state==='RUNNING'); store.cancel(cancelJob.id);
        const cancelled=await waitJob(cancelJob);
        if(cancelled.state!=='CANCELLED'||cancelled.runId) throw new Error('Cancellation did not suppress result publication');
        const stopJob=store.enqueue({window:'1000',seed:'emmy-betzero-stage3-shutdown'},research);
        await waitJob(stopJob,j=>j.state==='RUNNING');
        const stopped=await shutdown();
        if(stopped.code!==0||store.get(stopJob.id).state!=='CANCELLED') throw new Error('Active shutdown was not clean');
        await start(); const idleStop=await shutdown();
        if(idleStop.code!==0) throw new Error('Idle shutdown was not clean');
        if(JSON.stringify(lab.strategies())!==configsBefore||sourceState()!==originalState||sha(fs.readFileSync(sourcePath))!==sha(sourceBytes)) throw new Error('Source/configuration preservation failed');
        if(db.prepare('SELECT count(*) AS n FROM betzero_lab_forward_predictions').get().n!==0) throw new Error('Unexpected forward records');
        const sorted=timings.slice().sort((a,b)=>a-b);
        const report={source:'predictions.json',sourceSha256:sha(sourceBytes),inputRecords:records.length,invalid,duplicates,conflictingIds:conflicts.size,protectedProtocols:protectedRows.length,protectedDraws,validDraws:ordered.length,selectedSourceRange:[selected[0].id,selected.at(-1).id],selectionRule:'Latest contiguous block supporting 1000 opportunities; trailing nested windows. No outcome-based selection.',seed:'emmy-betzero-stage3-fixed-v1',results,worker:{states,cancellation:cancelled.state,activeShutdown:stopped,idleShutdown:idleStop,readLatencyMs:{samples:sorted.length,p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)},savedConfigsUnchanged:true,sourceStateUnchanged:true,forwardRows:0}};
        fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));
        console.log(JSON.stringify({folder,results:results.map(({segments,...r})=>r),worker:report.worker},null,2));
    } finally {
        if(worker?.connected) {try{await shutdown();}catch{worker.kill();}}
        db.close(); source.close();
    }
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
