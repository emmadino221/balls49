'use strict';
// Exact supported schemas: reject unknown columns, constraints and dependencies before DDL.
const SCHEMAS = {
    betzero_lab_backtest_runs: `CREATE TABLE betzero_lab_backtest_runs (
            run_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK(status IN ('COMPLETED', 'FAILED')),
            requested_window TEXT NOT NULL,
            seed TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            dataset_hash TEXT NOT NULL,
            data_json TEXT NOT NULL
        );`,
    betzero_lab_backtest_results: `CREATE TABLE betzero_lab_backtest_results (
            run_id TEXT NOT NULL,
            strategy_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            segment TEXT NOT NULL,
            result_json TEXT NOT NULL,
            PRIMARY KEY(run_id, strategy_id, segment),
            FOREIGN KEY(run_id) REFERENCES betzero_lab_backtest_runs(run_id)
        );`,
    betzero_lab_backtest_predictions: `CREATE TABLE betzero_lab_backtest_predictions (
            prediction_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            strategy_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            segment TEXT NOT NULL,
            source_draw_id TEXT NOT NULL,
            target_draw_id TEXT NOT NULL,
            predicted_at TEXT NOT NULL,
            strategy_config_json TEXT NOT NULL,
            selections_json TEXT NOT NULL,
            conditions_json TEXT NOT NULL,
            source_input_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('WIN', 'LOSS', 'SKIP')),
            actual_balls_json TEXT NOT NULL,
            validated_at TEXT NOT NULL,
            UNIQUE(run_id, strategy_id, target_draw_id),
            FOREIGN KEY(run_id) REFERENCES betzero_lab_backtest_runs(run_id)
        );`,
};
const TARGETS = ['betzero_lab_backtest_results', 'betzero_lab_backtest_predictions'];
const KEYS = [
    ['PRIMARY KEY(run_id, strategy_id, segment)', 'PRIMARY KEY(run_id, strategy_id, strategy_version, segment)'],
    ['UNIQUE(run_id, strategy_id, target_draw_id)', 'UNIQUE(run_id, strategy_id, strategy_version, target_draw_id)']
];
const REQUIRED_INDEX = 'CREATE INDEX betzero_lab_backtest_prediction_target_idx ON betzero_lab_backtest_predictions(run_id, target_draw_id, strategy_id)';
const quote = name => `"${name.replaceAll('"', '""')}"`;
// Ignore formatting and quoted identifiers, but preserve CHECK string literals exactly.
const normalized = sql => sql.replace(/;\s*$/, '').replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .match(/'(?:''|[^'])*'|"(?:""|[^"])*"|\s+|./gs)
    .map(token => token.startsWith("'") ? token : /^\s+$/.test(token) ? '' : token.replaceAll('"', '').toLowerCase()).join('');
const fail = detail => { throw new Error(`Unsafe BetZero version migration: ${detail}`); };

function inspectVersionSchema(db, { allowEmpty = false } = {}) {
    const objects = db.prepare('SELECT type,name,tbl_name,sql FROM main.sqlite_master').all();
    const existing = Object.keys(SCHEMAS).map(name => objects.find(o => o.type === 'table' && o.name === name));
    if (allowEmpty && existing.every(o => !o)) {
        if (objects.some(o => o.type === 'table' && o.name.startsWith('betzero_lab_') && !['betzero_lab_jobs','betzero_lab_protocols','betzero_lab_exposures'].includes(o.name)))
            fail('missing all historical tables in an existing lab');
        return null;
    }
    const plans = [];
    for (const [i, name] of Object.keys(SCHEMAS).entries()) {
        const object = existing[i];
        if (!object?.sql) fail(`missing required table ${name}`);
        const oldSql = SCHEMAS[name], target = TARGETS.indexOf(name);
        const newSql = target < 0 ? oldSql : oldSql.replace(...KEYS[target]);
        const actual = normalized(object.sql);
        if (actual !== normalized(oldSql) && actual !== normalized(newSql)) fail(`unexpected schema for ${name}`);
        if (target >= 0) {
            const temporary = `${name}_version_upgrade`;
            if (objects.some(o => o.name === temporary)) fail(`unexpected leftover object ${temporary}`);
            plans.push({ name, temporary, newSql, upgrade: actual !== normalized(newSql),
                columns: db.prepare(`PRAGMA main.table_xinfo(${quote(name)})`).all().map(c => c.name),
                indexes: objects.filter(o => o.type === 'index' && o.tbl_name === name && o.sql) });
        }
    }
    const required = objects.find(o => o.name === 'betzero_lab_backtest_prediction_target_idx');
    if (!required?.sql || normalized(required.sql) !== normalized(REQUIRED_INDEX)) fail('missing or unexpected historical target index');
    // DROP TABLE can perform FK actions even though this migration issues no DELETE.
    for (const table of objects.filter(o => o.type === 'table')) {
        for (const fk of db.prepare(`PRAGMA main.foreign_key_list(${quote(table.name)})`).all()) {
            if (TARGETS.includes(fk.table.toLowerCase())) fail(`inbound foreign key from ${table.name} to ${fk.table}`);
        }
    }
    const temporaryObjects = db.prepare('SELECT type,name,tbl_name,sql FROM temp.sqlite_master').all();
    if (temporaryObjects.some(o => [...Object.keys(SCHEMAS), ...TARGETS.map(name=>`${name}_version_upgrade`)].includes(o.name.toLowerCase())))
        fail('temporary object shadows a required historical table');
    for (const object of [...objects, ...temporaryObjects]) {
        if (!['view', 'trigger'].includes(object.type)) continue;
        if (TARGETS.includes(object.tbl_name.toLowerCase()) || TARGETS.some(name => new RegExp(`\\b${name}\\b`, 'i').test(object.sql || '')))
            fail(`dependent ${object.type} ${object.name} requires separate review`);
    }
    return plans;
}

function checkIntegrity(db) {
    if (db.prepare('PRAGMA main.foreign_key_check').get()) fail('foreign_key_check failed');
    const check = db.prepare('PRAGMA main.integrity_check').all();
    if (check.length !== 1 || check[0].integrity_check !== 'ok') fail('integrity_check failed');
}

function migrateVersionKeys(db) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const plans = inspectVersionSchema(db);
        const upgrades = plans.filter(p => p.upgrade);
        if (upgrades.length) checkIntegrity(db);
        for (const plan of upgrades) {
            const {name, temporary, columns, indexes} = plan;
            db.exec(plan.newSql.replace(name, temporary));
            const names = ['rowid', ...columns].map(quote).join(',');
            db.exec(`INSERT INTO ${quote(temporary)} (${names}) SELECT ${names} FROM ${quote(name)}`);
            // Compare both directions, including rowids and SQLite storage classes.
            const projection = ['rowid', ...columns].flatMap(c => [`typeof(${quote(c)})`, `${quote(c)} COLLATE BINARY`]).join(',');
            for (const [left, right] of [[name, temporary], [temporary, name]]) {
                if (db.prepare(`SELECT ${projection} FROM ${quote(left)} EXCEPT SELECT ${projection} FROM ${quote(right)} LIMIT 1`).get())
                    fail(`copied values differ for ${name}`);
            }
            if (db.prepare(`SELECT count(*) n FROM ${quote(name)}`).get().n !== db.prepare(`SELECT count(*) n FROM ${quote(temporary)}`).get().n)
                fail(`row count changed for ${name}`);
            db.exec(`DROP TABLE ${quote(name)}`);
            db.exec(`ALTER TABLE ${quote(temporary)} RENAME TO ${quote(name)}`);
            for (const index of indexes) db.exec(index.sql);
            const actual = db.prepare("SELECT name,sql FROM main.sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(name);
            const expected = indexes.map(({name,sql})=>({name,sql})).sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
            if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`index definitions changed for ${name}`);
        }
        inspectVersionSchema(db);
        if (upgrades.length) checkIntegrity(db);
        db.exec('COMMIT');
        return { upgraded: upgrades.map(p => p.name) };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { migrateVersionKeys, inspectVersionSchema };
