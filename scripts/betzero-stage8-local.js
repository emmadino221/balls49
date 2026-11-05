'use strict';
// Operates only on disposable copies beneath the supplied local evidence directory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync,backup}=require('node:sqlite');
const {performance}=require('node:perf_hooks');
const {createBetZeroLab}=require('../betzero-lab');
const {createJobStore}=require('../betzero-jobs');
const {planReconciliation}=require('../betzero-reconciliation');
const ONE='simple_smallest_number_add_10', FOUR='smallest_add10_step10_four';
const summary=s=>Object.fromEntries(['wins','losses','currentLosingStreak','worstLosingStreak','longestWinningStreak','provisional'].map(k=>[k,s[k]]));
const timed=fn=>{const start=performance.now();const value=fn();return {ms:performance.now()-start,value};};
async function main(directory) {
    directory=path.resolve(directory);
    const source=path.join(directory,'lab-snapshot.sqlite'),archive=JSON.parse(fs.readFileSync(path.join(directory,'collector-snapshot.json'),'utf8'));
    const folder=fs.mkdtempSync(path.join(directory,'verification-'));
    const file=path.join(folder,'migrated.sqlite');
    const ro=new DatabaseSync(source,{readOnly:true});await backup(ro,file);
    const original=ro.prepare("SELECT * FROM betzero_lab_forward_predictions ORDER BY prediction_id").all();
    const configs=ro.prepare('SELECT * FROM betzero_lab_strategy_configs ORDER BY strategy_id,version').all();
    const rawDry=timed(()=>planReconciliation(ro,archive,{target:'5890334'}));
    assert.equal(rawDry.value.decisions.length,1);assert.equal(rawDry.value.decisions[0].outcome,'WIN');
    const originalTarget=original.find(r=>r.target_draw_id==='5890334');assert.equal(originalTarget.status,'PENDING');
    ro.close();
    const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000');
    const migration=timed(()=>{const lab=createBetZeroLab(db);createJobStore(db);createBetZeroLab(db);return lab;});
    const lab=migration.value;
    assert.deepEqual(db.prepare('SELECT * FROM betzero_lab_forward_predictions ORDER BY prediction_id').all(),original);
    for(const c of configs) assert.deepEqual(db.prepare('SELECT * FROM betzero_lab_strategy_configs WHERE strategy_id=? AND version=?').get(c.strategy_id,c.version),c);
    assert.equal(lab.strategies().find(s=>s.id===ONE).enabled,true);
    assert.equal(lab.strategies().find(s=>s.id===FOUR).enabled,false);
    assert.ok(lab.strategies().filter(s=>s.status==='UNVERIFIED').every(s=>!s.enabled));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM betzero_lab_jobs').get().n,0);
    const before=summary(lab.stats()[ONE]);
    const blocker=new DatabaseSync(file);blocker.exec('PRAGMA busy_timeout=100; BEGIN IMMEDIATE');
    const readDuringWriter=timed(()=>lab.reconcileArchive(archive,{target:'5890334'}));
    const lockStart=performance.now();let lockError;
    try{lab.reconcileArchive(archive,{target:'5890334',dryRun:false});}catch(e){lockError=e.message;}
    const lockWait=performance.now()-lockStart;assert.match(lockError,/locked|busy/i);
    blocker.exec('ROLLBACK');blocker.close();
    assert.equal(db.prepare('SELECT status FROM betzero_lab_forward_predictions WHERE prediction_id=?').get(originalTarget.prediction_id).status,'PENDING');
    let began;const writeLockMs=[];const exec=db.exec.bind(db);
    db.exec=sql=>{const value=exec(sql);if(sql==='BEGIN IMMEDIATE')began=performance.now();if(sql==='COMMIT'&&began!==undefined){writeLockMs.push(performance.now()-began);began=undefined;}return value;};
    const apply=timed(()=>lab.reconcileArchive(archive,{target:'5890334',dryRun:false}));assert.equal(apply.value.applied,1);
    const after=summary(lab.stats()[ONE]);
    const target=db.prepare('SELECT * FROM betzero_lab_forward_predictions WHERE prediction_id=?').get(originalTarget.prediction_id);
    for(const key of Object.keys(originalTarget).filter(k=>!['status','actual_balls_json','validated_at'].includes(k)))assert.equal(target[key],originalTarget[key]);
    const repeats=[];for(let i=0;i<20;i++){const run=timed(()=>lab.reconcileArchive(archive,{target:'5890334',dryRun:false}));assert.equal(run.value.applied,0);repeats.push(run.ms);}
    assert.equal(db.prepare('SELECT COUNT(*) n FROM betzero_lab_reconciliations').get().n,1);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    // Code rollback: actual deployed legacy module must open the additive schema without altering records/settings.
    const currentRows=db.prepare('SELECT * FROM betzero_lab_forward_predictions ORDER BY prediction_id').all();
    const legacy=require(path.join(directory,'legacy-betzero-lab.cjs')).createBetZeroLab(db);
    legacy.overview();assert.deepEqual(db.prepare('SELECT * FROM betzero_lab_forward_predictions ORDER BY prediction_id').all(),currentRows);
    for(const c of configs)assert.deepEqual(db.prepare('SELECT * FROM betzero_lab_strategy_configs WHERE strategy_id=? AND version=?').get(c.strategy_id,c.version),c);
    db.close();
    // Database rollback: independent copy of the original snapshot, never overwrite the migrated copy.
    const restorePath=path.join(folder,'restored.sqlite'),snapshot=new DatabaseSync(source,{readOnly:true});await backup(snapshot,restorePath);snapshot.close();
    const restored=new DatabaseSync(restorePath,{readOnly:true});assert.deepEqual(restored.prepare('SELECT * FROM betzero_lab_forward_predictions ORDER BY prediction_id').all(),original);assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');restored.close();
    const report={sourceLabPredictionCount:original.length,archiveRows:archive.length,target:'5890334',predictedAt:originalTarget.predicted_at,archiveObservedAt:rawDry.value.decisions[0].observedAt,
        outcome:target.status,originalStatus:originalTarget.status,before,after,migrationMs:migration.ms,dryRunMs:rawDry.ms,dryRunDuringWriterMs:readDuringWriter.ms,
        writerContentionWaitMs:lockWait,writerContentionError:lockError,applyMs:apply.ms,writeLockMs,repeatedRuns:20,repeatedMinMs:Math.min(...repeats),repeatedMaxMs:Math.max(...repeats),
        preservedPredictionFields:true,preservedExistingConfigurations:true,fourDisabled:true,sixUnverifiedDisabled:true,oneEnabledPreserved:true,
        newQueueEmpty:true,legacyCodeRollbackReadCompatible:true,restoredSnapshotExact:true,integrity:'ok',isolatedDirectory:folder};
    fs.writeFileSync(path.join(directory,'verification-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main(process.argv[2]||'output/stage8').catch(e=>{console.error(e);process.exitCode=1;});
