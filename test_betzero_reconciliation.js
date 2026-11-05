'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
const {createBetZeroLab}=require('./betzero-lab');
const {planReconciliation}=require('./betzero-reconciliation');
const ONE='simple_smallest_number_add_10', FOUR='smallest_add10_step10_four';
const now=Date.parse('2026-11-04T23:20:00Z');
function fixture(t) {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'betzero-reconcile-'));
    const file=path.join(directory,'lab.sqlite');let db=new DatabaseSync(file),lab=createBetZeroLab(db,{now:()=>now});
    t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
    function add(target,status='PENDING',strategy=ONE,selections=strategy===ONE?[11]:[11,21,31,41]) {
        db.prepare(`INSERT INTO betzero_lab_forward_predictions(prediction_id,strategy_id,strategy_version,source_draw_id,target_draw_id,predicted_at,
            strategy_config_json,selections_json,conditions_json,source_input_json,status,actual_balls_json,validated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(`${strategy}:${target}`,strategy,'1.0.0',String(target-1),String(target),'2026-11-04T22:59:34.021Z','{}',JSON.stringify(selections),'{}','{}',status,
                status==='LOSS'?'[11,2,3,4,5,6]':status==='WIN'?'[1,2,3,4,5,6]':null,status==='PENDING'?null:'2026-11-04T23:00:19.465Z');
    }
    return {get db(){return db;},get lab(){return lab;},directory,file,add,reopen(){db.close();db=new DatabaseSync(file);lab=createBetZeroLab(db,{now:()=>now});}};
}
const result=(id=5890334,dr='1,2,3,4,5,6')=>({id:String(id),dr,timestamp:'2026-11-04T23:00:19.465Z'});
test('Nigeria midnight: missing publication, dry-run, provenance and idempotent restart preserve predictions and production state',t=>{
    const f=fixture(t);f.add(5890334);
    f.db.exec("CREATE TABLE production_sentinel(value TEXT); INSERT INTO production_sentinel VALUES('unchanged');");
    const before=f.db.prepare('SELECT * FROM betzero_lab_forward_predictions').get();
    const configs=f.db.prepare('SELECT * FROM betzero_lab_strategy_configs').all();
    const state=f.db.prepare('SELECT * FROM betzero_lab_state').all();
    assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',hour:'2-digit',hourCycle:'h23'}).format(new Date(result().timestamp)),'00');
    assert.equal(f.lab.reconcileArchive([]).decisions[0].reason,'MISSING_ARCHIVE_RESULT');
    assert.equal(f.lab.stats()[ONE].provisional,true);
    assert.equal(f.lab.overview().forwardWindows[ONE].windows[100].provisional,true);
    assert.equal(f.lab.reconcileArchive([result()]).decisions[0].outcome,'WIN');
    assert.deepEqual(f.db.prepare('SELECT * FROM betzero_lab_forward_predictions').get(),before);
    assert.equal(f.lab.reconcileArchive([result()],{dryRun:false}).applied,1);
    f.reopen();assert.equal(f.lab.reconcileArchive([result()],{dryRun:false}).applied,0);
    const after=f.db.prepare('SELECT * FROM betzero_lab_forward_predictions').get();
    for(const key of Object.keys(before).filter(k=>!['status','actual_balls_json','validated_at'].includes(k)))assert.equal(after[key],before[key]);
    assert.equal(after.status,'WIN');assert.equal(f.lab.stats()[ONE].provisional,false);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM betzero_lab_reconciliations').get().n,1);
    assert.deepEqual(f.db.prepare('SELECT * FROM betzero_lab_strategy_configs').all(),configs);
    assert.deepEqual(f.db.prepare('SELECT * FROM betzero_lab_state').all(),state);
    assert.equal(f.db.prepare('SELECT value FROM production_sentinel').get().value,'unchanged');
    assert.equal(f.lab.strategies().find(s=>s.id===FOUR).enabled,false);
    assert.ok(f.lab.strategies().filter(s=>s.status==='UNVERIFIED').every(s=>!s.enabled));
});
test('conflicting, malformed and mismatched archive results fail closed',t=>{
    const f=fixture(t);f.add(5890334);
    for(const records of [[result(),result(5890334,'7,2,3,4,5,6')],[result(5890334,'1,1,3,4,5,6')],
        [result(5890334,'0,2,3,4,5,6')],[result(5890334,'50,2,3,4,5,6')],[result(5890334,'1,2,3')],
        [result(),result(5890334,'1e0,2,3,4,5,6')],[{...result(),timestamp:'invalid'}],[{...result(),id:'05890334'}]]) {
        assert.equal(f.lab.reconcileArchive(records,{dryRun:false}).applied,0);
    }
    assert.equal(f.db.prepare('SELECT status FROM betzero_lab_forward_predictions').get().status,'PENDING');
    assert.equal(f.lab.reconcileArchive([result(5890335)]).decisions[0].action,'WAIT');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM betzero_lab_forward_predictions').get().n,1);
});
test('late win splits loss streak chronologically, independent versions and four-number grading',t=>{
    const f=fixture(t);f.add(5890333,'LOSS');f.add(5890334);f.add(5890335,'LOSS');f.add(5890336,'LOSS');f.add(5890334,'PENDING',FOUR);
    assert.equal(f.lab.stats()[ONE].worstLosingStreak,3);
    assert.equal(f.lab.reconcileArchive([result(5890334,'21,2,3,4,5,6')],{dryRun:false}).applied,2);
    assert.equal(f.lab.stats()[ONE].worstLosingStreak,2);assert.equal(f.lab.stats()[ONE].currentLosingStreak,2);
    assert.equal(f.lab.stats()[FOUR].losses,1);assert.equal(f.lab.stats()[ONE].wins,1);
    assert.equal(f.db.prepare('SELECT current_loss_streak n FROM betzero_lab_streak_events WHERE strategy_id=? ORDER BY CAST(target_draw_id AS INTEGER) DESC LIMIT 1').get(ONE).n,2);
});
test('settled conflicting result, wrong selection count, unknown version and fresh pending are not repaired',t=>{
    const f=fixture(t);f.add(5890334);f.add(5890334,'LOSS',FOUR);
    assert.equal(f.lab.reconcileArchive([result()]).decisions[0].reason,'CONFLICTING_SAVED_RESULT');
    f.db.exec("DELETE FROM betzero_lab_forward_predictions WHERE status='LOSS'; UPDATE betzero_lab_forward_predictions SET selections_json='[11,21]'");
    assert.equal(f.lab.reconcileArchive([result()]).decisions[0].reason,'INVALID_STRATEGY_OR_SELECTIONS');
    f.db.exec("UPDATE betzero_lab_forward_predictions SET selections_json='[11]',strategy_version='old'");
    assert.equal(f.lab.reconcileArchive([result()]).decisions[0].reason,'INVALID_STRATEGY_OR_SELECTIONS');
    f.db.exec("UPDATE betzero_lab_forward_predictions SET predicted_at='2026-11-04T23:19:59Z'");
    assert.equal(f.lab.reconcileArchive([result()]).decisions.length,0);
});
test('archive duplicates with reordered identical balls are idempotent and lab loss grading is correct',t=>{
    const f=fixture(t);f.add(5890334);
    assert.equal(f.lab.reconcileArchive([result(5890334,'11,2,3,4,5,6'),result(5890334,'6,5,4,3,2,11')],{dryRun:false}).applied,1);
    assert.equal(f.lab.stats()[ONE].losses,1);assert.equal(f.lab.stats()[ONE].currentLosingStreak,1);
});
test('database-copy additive migration preserves history, enablement and restart recovery',async t=>{
    const f=fixture(t);f.add(5890334);f.db.exec('DROP TABLE betzero_lab_reconciliations');
    const rows=f.db.prepare('SELECT * FROM betzero_lab_forward_predictions').all(),configs=f.db.prepare('SELECT * FROM betzero_lab_strategy_configs').all();
    const copy=path.join(f.directory,'copy.sqlite');await backup(f.db,copy);
    const db=new DatabaseSync(copy);try {
        const lab=createBetZeroLab(db,{now:()=>now});createBetZeroLab(db,{now:()=>now});
        assert.deepEqual(db.prepare('SELECT * FROM betzero_lab_forward_predictions').all(),rows);
        assert.deepEqual(db.prepare('SELECT * FROM betzero_lab_strategy_configs').all(),configs);
        assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
        assert.equal(lab.reconcileArchive([result()],{dryRun:false}).applied,1);
    }finally{db.close();}
    assert.deepEqual(f.db.prepare('SELECT * FROM betzero_lab_forward_predictions').all(),rows);
    const ro=new DatabaseSync(f.file,{readOnly:true});try {assert.equal(planReconciliation(ro,[result()],{now}).decisions[0].outcome,'WIN');}finally{ro.close();}
});
test('worker service has bounded audited resource settings',()=>{
    const service=fs.readFileSync(path.join(__dirname,'deploy/balls49-betzero-worker.service'),'utf8');
    for(const line of ['CPUQuota=25%','CPUWeight=10','MemoryHigh=768M','MemoryMax=1G','TimeoutStopSec=15','RestartSec=30','StartLimitIntervalSec=600','StartLimitBurst=3','KillMode=control-group',
        'ExecStart=/home/balls49/.nvm/versions/node/v24.21.0/bin/node --max-old-space-size=512 /home/balls49/balls49-site/betzero-worker.js'])assert.ok(service.includes(line));
});
test('failed audit write rolls back settlement and streaks; restart permits safe retry',t=>{
    const f=fixture(t);f.add(5890334);
    f.db.exec("CREATE TRIGGER fail_reconcile BEFORE INSERT ON betzero_lab_reconciliations BEGIN SELECT RAISE(ABORT,'simulated interrupted write'); END;");
    assert.throws(()=>f.lab.reconcileArchive([result()],{dryRun:false}),/simulated interrupted write/);
    assert.equal(f.db.prepare('SELECT status FROM betzero_lab_forward_predictions').get().status,'PENDING');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM betzero_lab_streak_events').get().n,0);
    f.reopen();f.db.exec('DROP TRIGGER fail_reconcile');
    assert.equal(f.lab.reconcileArchive([result()],{dryRun:false}).applied,1);
});
test('CLI defaults to read-only dry-run, omits saved selections and rejects contradictory modes',t=>{
    const f=fixture(t);f.add(5890334);const archive=path.join(f.directory,'draws.json');fs.writeFileSync(archive,JSON.stringify([result()]));
    const {spawnSync}=require('node:child_process');
    const args=[path.join(__dirname,'scripts/reconcile-betzero-lab.js'),'--db',f.file,'--archive',archive,'--target','5890334'];
    const run=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
    const report=JSON.parse(run.stdout);assert.equal(report.dryRun,true);assert.equal(report.decisions[0].outcome,'WIN');
    assert.equal(report.decisions[0].original,undefined);assert.equal(report.decisions[0].balls,undefined);
    assert.equal(f.db.prepare('SELECT status FROM betzero_lab_forward_predictions').get().status,'PENDING');
    assert.notEqual(spawnSync(process.execPath,[...args,'--apply','--dry-run']).status,0);
});
