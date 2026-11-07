'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {migrateVersionKeys}=require('./betzero-version-migration');
const {createBetZeroLab}=require('./betzero-lab');
const legacy=fs.readFileSync(path.join(__dirname,'tests/fixtures/betzero-pre-v2-schema.sql'),'utf8');
const tables=['betzero_lab_backtest_results','betzero_lab_backtest_predictions'];
function data(db) {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map(({name})=>[name,db.prepare(`SELECT rowid,* FROM "${name}" ORDER BY rowid`).all()]));
}
const schema=db=>db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function setup(t,foreignKeys=true) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'betzero-migration-review-'));
    const original=path.join(dir,'original.sqlite'),file=path.join(dir,'copy.sqlite');
    const source=new DatabaseSync(original);source.exec('PRAGMA foreign_keys=ON');source.exec(legacy);
    require('./betzero-jobs').createJobStore(source);
    source.exec(`INSERT INTO betzero_lab_jobs(id,state,payload,created_at) VALUES('queued','QUEUED','{"rulesHash":"original-frozen-hash","strategies":[{"id":"minimum_maximum_three","version":"1.0.0"}]}',123456);
      INSERT INTO betzero_lab_protocols(id,state,first_draw,last_draw,created_at,specification) VALUES('sealed','SEALED',6000001,6000100,123456,'{"seed":"original-seed","first":6000001,"last":6000100}');
      CREATE INDEX custom_prediction_status ON betzero_lab_backtest_predictions(status,target_draw_id DESC) WHERE status='WIN';
      CREATE UNIQUE INDEX custom_result_identity ON betzero_lab_backtest_results(run_id,strategy_id,strategy_version,segment);
      CREATE INDEX custom_result_expression ON betzero_lab_backtest_results(length(result_json));`);
    const ids=['simple_smallest_number_add_10','smallest_add10_step10_four','minimum_maximum_three'];
    for(const id of ids) for(const version of id===ids[2]?['1.0.0','2.0.0']:['1.0.0']) {
        source.prepare('INSERT INTO betzero_lab_strategies VALUES(?,?,?,?,?,?,?)').run(id,version,id,'RESEARCH_ONLY','research','preserved','');
        source.prepare('INSERT INTO betzero_lab_strategy_configs VALUES(?,?,?,?,?)').run(id,version,version==='2.0.0'?0:1,'{ "alertThresholds": [2, 7] }',123456);
        source.prepare('INSERT INTO betzero_lab_minmax_state VALUES(?,?,?)').run(id,version,JSON.stringify({method:version==='1.0.0'?'MIN':'MAX',pending:null}));
        source.prepare(`INSERT INTO betzero_lab_forward_predictions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            `${id}-${version}`,id,version,'5899999','5900000','2026-11-01T00:00:00.000Z','{"alertThresholds":[2,7]}',id===ids[0]?'[13]':id===ids[1]?'[13,23,33,43]':'[2,3,4]',
            '{"method":"MIN"}','{"balls":[3,8,17,23,36,44]}','WIN','[7,8,9,10,11,12]','2026-11-01T00:00:30.000Z');
    }
    source.exec('BEGIN');
    for(let run=0;run<12;run++) {
        const runId=`run-${run}`,version=run%2?'2.0.0':'1.0.0';
        source.prepare('INSERT INTO betzero_lab_backtest_runs VALUES(?,?,?,?,?,?,?,?)').run(runId,'COMPLETED','100','seed-'+run,'2026-11-01T00:00:00.000Z',run===0?null:'2026-11-01T00:00:01.000Z','hash-'+run,'{ "mode": "EXPLORATORY", "note":"preserve spacing / unicode \u20a6" }');
        for(const [index,id] of ids.entries()) {
            const v=index===2?version:'1.0.0',numbers=index===0?[13]:index===1?[13,23,33,43]:[2,3,4];
            for(const segment of ['development','validation','final_test']) source.prepare('INSERT INTO betzero_lab_backtest_results VALUES(?,?,?,?,?)').run(runId,id,v,segment,'{ "wins": 20, "losses": 10, "nullable": null }');
            for(let n=0;n<100;n++) {
                const target=5900001+n,status=n%10===0?'SKIP':n%3===0?'LOSS':'WIN';
                source.prepare('INSERT INTO betzero_lab_backtest_predictions(rowid,prediction_id,run_id,strategy_id,strategy_version,segment,source_draw_id,target_draw_id,predicted_at,strategy_config_json,selections_json,conditions_json,source_input_json,status,actual_balls_json,validated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    .run(10+(run*300+index*100+n)*3,`${runId}-${id}-${n}`,runId,id,v,n<60?'development':n<80?'validation':'final_test',String(target-1),String(target),'2026-11-01T00:00:00.000Z','{ "alertThresholds": [2,7] }',JSON.stringify(status==='SKIP'?[]:numbers),'{ "method": "MIN" }','{"balls":[3,8,17,23,36,44]}',status,'[4,10,18,24,35,40]','2026-11-01T00:00:01.000Z');
            }
        }
    }
    source.exec('COMMIT');
    source.prepare('VACUUM INTO ?').run(file);source.close(); // Consistent local copy; no live file involved.
    const db=new DatabaseSync(file);db.exec(`PRAGMA foreign_keys=${foreignKeys?'ON':'OFF'}`);
    t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
    return {db,file,original};
}
for(const fk of [true,false]) test(`actual legacy schema copy: rows, indexes, jobs, protocols and idempotence (FK ${fk})`,t=>{
    const {db,file,original}=setup(t,fk),before=data(db),objects=schema(db),originalHash=digest(original);
    const metadata=Object.fromEntries([...tables,'betzero_lab_backtest_runs'].map(name=>[name,{
        columns:db.prepare(`PRAGMA table_info(${name})`).all().map(({pk,...column})=>column),
        foreignKeys:db.prepare(`PRAGMA foreign_key_list(${name})`).all()
    }]));
    assert.equal(before.betzero_lab_backtest_predictions.length,3600);assert.equal(before.betzero_lab_backtest_results.length,108);
    const start=performance.now();const result=migrateVersionKeys(db);t.diagnostic(`Migration only: ${(performance.now()-start).toFixed(1)} ms; 3600 predictions / 108 summaries`);assert.deepEqual(result.upgraded,tables);
    assert.deepEqual(data(db),before);assert.equal(digest(original),originalHash);
    for(const [name,expected] of Object.entries(metadata)) {
        assert.deepEqual(db.prepare(`PRAGMA table_info(${name})`).all().map(({pk,...column})=>column),expected.columns);
        assert.deepEqual(db.prepare(`PRAGMA foreign_key_list(${name})`).all(),expected.foreignKeys);
    }
    assert.deepEqual(db.prepare('PRAGMA index_info(sqlite_autoindex_betzero_lab_backtest_results_1)').all().map(r=>r.name),['run_id','strategy_id','strategy_version','segment']);
    assert.deepEqual(db.prepare('PRAGMA index_info(sqlite_autoindex_betzero_lab_backtest_predictions_1)').all().map(r=>r.name),['prediction_id']);
    assert.deepEqual(db.prepare('PRAGMA index_info(sqlite_autoindex_betzero_lab_backtest_predictions_2)').all().map(r=>r.name),['run_id','strategy_id','strategy_version','target_draw_id']);
    for(const object of objects.filter(o=>o.type!=='table'||!tables.includes(o.name)))
        assert.deepEqual(schema(db).find(o=>o.name===object.name&&o.type===object.type),object);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    const migrated=data(db),migratedSchema=schema(db),schemaVersion=db.prepare('PRAGMA schema_version').get(),hash=digest(file);
    assert.deepEqual(migrateVersionKeys(db).upgraded,[]);
    assert.deepEqual(data(db),migrated);assert.deepEqual(schema(db),migratedSchema);
    assert.deepEqual(db.prepare('PRAGMA schema_version').get(),schemaVersion);assert.equal(digest(file),hash);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,fk?1:0);
    db.exec('PRAGMA foreign_keys=ON');
    const originalResult=before.betzero_lab_backtest_results.find(r=>r.strategy_id==='minimum_maximum_three'&&r.run_id==='run-0');
    const insertResult=db.prepare('INSERT INTO betzero_lab_backtest_results VALUES(?,?,?,?,?)');
    insertResult.run(originalResult.run_id,originalResult.strategy_id,'2.0.0',originalResult.segment,originalResult.result_json);
    assert.throws(()=>insertResult.run(originalResult.run_id,originalResult.strategy_id,'2.0.0',originalResult.segment,'{}'),/UNIQUE/);
    assert.throws(()=>insertResult.run('missing','x','1.0.0','development','{}'),/FOREIGN KEY/);
    assert.throws(()=>insertResult.run('run-0','x','1.0.0','development',null),/NOT NULL/);
    assert.throws(()=>db.exec("UPDATE betzero_lab_backtest_predictions SET status='PENDING' WHERE rowid=10"),/CHECK/);
    const columns=db.prepare('PRAGMA table_info(betzero_lab_backtest_predictions)').all().map(c=>c.name);
    const row=before.betzero_lab_backtest_predictions.find(r=>r.strategy_id==='minimum_maximum_three'&&r.run_id==='run-0');
    const other={...row,prediction_id:'v2-new',strategy_version:'2.0.0'};
    const insert=db.prepare(`INSERT INTO betzero_lab_backtest_predictions (${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
    insert.run(...columns.map(c=>other[c]));
    assert.throws(()=>insert.run(...columns.map(c=>({...other,prediction_id:'v2-duplicate'})[c])),/UNIQUE/);
});
for(const stage of ['first drop','second drop','index recreation','commit']) test(`injected ${stage} failure restores all data and schema`,t=>{
    const {db}=setup(t),before=data(db),objects=schema(db);let drops=0;
    const proxy={prepare:db.prepare.bind(db),exec(sql){
        if(sql.startsWith('DROP TABLE')) drops++;
        db.exec(sql === 'COMMIT' && stage==='commit' ? 'SELECT 1' : sql);
        if((stage==='first drop'&&drops===1&&sql.startsWith('DROP TABLE')) || (stage==='second drop'&&drops===2&&sql.startsWith('DROP TABLE')) || (stage==='index recreation'&&drops===2&&sql.startsWith('CREATE INDEX')) || (stage==='commit'&&sql==='COMMIT')) throw Error('injected migration failure');
    }};
    assert.throws(()=>migrateVersionKeys(proxy),/injected/);
    assert.deepEqual(data(db),before);assert.deepEqual(schema(db),objects);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(migrateVersionKeys(db).upgraded,tables);
});
for(const dependent of ['cascade','restrict','view','trigger','external trigger','temp trigger']) test(`reject ${dependent} dependency before destructive DDL`,t=>{
    const {db}=setup(t);
    if(['cascade','restrict'].includes(dependent)) {
        db.exec(`CREATE TABLE dependent_child(id INTEGER PRIMARY KEY,prediction TEXT REFERENCES betzero_lab_backtest_predictions(prediction_id) ON DELETE ${dependent.toUpperCase()}); INSERT INTO dependent_child VALUES(1,'run-0-simple_smallest_number_add_10-0')`);
    } else if(dependent==='view')db.exec('CREATE VIEW prediction_view AS SELECT * FROM betzero_lab_backtest_predictions');
    else if(dependent==='trigger')db.exec('CREATE TRIGGER prediction_trigger AFTER DELETE ON betzero_lab_backtest_predictions BEGIN SELECT 1; END');
    else if(dependent==='external trigger')db.exec("CREATE TRIGGER run_trigger AFTER INSERT ON betzero_lab_backtest_runs BEGIN DELETE FROM betzero_lab_backtest_predictions WHERE run_id=NEW.run_id; END");
    else db.exec('CREATE TEMP TRIGGER temporary_trigger AFTER DELETE ON main.betzero_lab_backtest_results BEGIN SELECT 1; END');
    const before=data(db),objects=schema(db);
    assert.throws(()=>migrateVersionKeys(db),/inbound foreign key|dependent/);
    assert.deepEqual(data(db),before);assert.deepEqual(schema(db),objects);
});
for(const change of ['missing table','extra column','missing index','changed parent','orphan','staging object']) test(`fail explicitly on ${change}`,t=>{
    const {db}=setup(t);
    if(change==='missing table')db.exec('DROP TABLE betzero_lab_backtest_results');
    if(change==='extra column')db.exec('ALTER TABLE betzero_lab_backtest_results ADD COLUMN extra TEXT');
    if(change==='missing index')db.exec('DROP INDEX betzero_lab_backtest_prediction_target_idx');
    if(change==='changed parent')db.exec('ALTER TABLE betzero_lab_backtest_runs ADD COLUMN extra INTEGER');
    if(change==='orphan'){db.exec('PRAGMA foreign_keys=OFF');db.exec("UPDATE betzero_lab_backtest_results SET run_id='missing' WHERE run_id='run-0'");}
    if(change==='staging object')db.exec('CREATE TABLE betzero_lab_backtest_results_version_upgrade(stale TEXT)');
    const before=data(db),objects=schema(db);
    assert.throws(()=>migrateVersionKeys(db),/Unsafe BetZero version migration/);
    assert.deepEqual(data(db),before);assert.deepEqual(schema(db),objects);
    if(change==='missing table'||change==='missing index') {
        assert.throws(()=>createBetZeroLab(db),/missing/);
        assert.deepEqual(data(db),before);assert.deepEqual(schema(db),objects);
    }
});
test('SQLite write contention leaves the original schema untouched',t=>{
    const {db,file}=setup(t),other=new DatabaseSync(file),before=data(db),objects=schema(db);
    db.exec('PRAGMA busy_timeout=30');other.exec('BEGIN IMMEDIATE');
    try {assert.throws(()=>migrateVersionKeys(db),/locked|busy/);assert.deepEqual(data(db),before);assert.deepEqual(schema(db),objects);}
    finally {other.exec('ROLLBACK');other.close();}
});
test('temporary table shadow is rejected without changing either schema',t=>{
    const {db}=setup(t);db.exec('CREATE TEMP TABLE betzero_lab_backtest_results(sentinel TEXT); INSERT INTO temp.betzero_lab_backtest_results VALUES(\'keep\')');
    const objects=schema(db),temp=db.prepare('SELECT * FROM temp.betzero_lab_backtest_results').all();
    assert.throws(()=>migrateVersionKeys(db),/shadows/);
    assert.deepEqual(schema(db),objects);assert.deepEqual(db.prepare('SELECT * FROM temp.betzero_lab_backtest_results').all(),temp);
});
test('copy verification detects a simulated missing copy and rolls back both tables',t=>{
    const {db}=setup(t),before=data(db),objects=schema(db);
    const proxy={prepare:db.prepare.bind(db),exec(sql){if(sql.startsWith('INSERT INTO "betzero_lab_backtest_predictions_version_upgrade"'))return;return db.exec(sql);}};
    assert.throws(()=>migrateVersionKeys(proxy),/copied values differ/);
    assert.deepEqual(data(db),before);assert.deepEqual(schema(db),objects);
});
test('startup cannot recreate all missing historical tables in an existing lab',t=>{
    const {db}=setup(t);db.exec('DROP TABLE betzero_lab_backtest_results; DROP TABLE betzero_lab_backtest_predictions; DROP TABLE betzero_lab_backtest_runs');
    const before=data(db),objects=schema(db);
    assert.throws(()=>createBetZeroLab(db),/missing all historical tables/);
    assert.deepEqual(data(db),before);assert.deepEqual(schema(db),objects);
});
