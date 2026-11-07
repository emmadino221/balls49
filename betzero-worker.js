'use strict';
// This program is an opt-in lab process. It never imports bot.js or messaging/betting code.
const { DatabaseSync } = require('node:sqlite');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createJobStore, rulesHash } = require('./betzero-jobs');
const { createBetZeroLab } = require('./betzero-lab');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function connect(file) { const db = new DatabaseSync(file); db.exec('PRAGMA busy_timeout=100'); return db; }
function childRun(sitePath, temporary, job) {
    if (job.specification.rulesHash !== rulesHash()) throw new Error('Frozen rules do not match worker code.');
    const site = new DatabaseSync(sitePath, { readOnly: true });
    site.exec('PRAGMA busy_timeout=1000');
    const spec = job.specification;
    const records = site.prepare('SELECT record_json FROM public_prediction_history WHERE sort_draw_id BETWEEN ? AND ? ORDER BY sort_draw_id LIMIT 50007').all(Math.min(spec.contextFirst ?? spec.first - 1, spec.first - 1), spec.last).map(r => JSON.parse(r.record_json));
    const observe = site.prepare('SELECT state,token,cancel_requested,started_at FROM betzero_lab_jobs WHERE id=?');
    let lastCheck = 0;
    const report = progress => {
        if (Date.now() - lastCheck >= 500) {
            lastCheck = Date.now();
            process.kill(process.ppid, 0);
            const current = observe.get(job.id);
            if (!current || current.state !== 'RUNNING' || current.token !== job.token || current.cancel_requested || Date.now() - current.started_at >= 600000) throw new Error('Simulation lease expired or cancelled.');
        }
        process.send?.({ progress });
    };
    if (records.length > 50006) throw new Error('Dataset exceeds 50,000 pairs.');
    if (spec.mode === 'SEALED_FINAL') {
        const valid = new Map(records.map(r => [Number(r.drawId), r.result?.balls]));
        for (let id = Math.min(spec.contextFirst ?? spec.first - 1, spec.first - 1); id <= spec.last; id++) {
            const balls = valid.get(id);
            if (!Array.isArray(balls) || balls.length !== 6 || new Set(balls).size !== 6 || balls.some(n => !Number.isInteger(n) || n < 1 || n > 49)) throw new Error('Sealed cohort has missing or invalid draws; protocol remains consumed.');
        }
    }
    const privateDb = connect(temporary);
    const lab = createBetZeroLab(privateDb);
    for (const strategy of spec.strategies) {
        const actual = lab.strategies().find(s => s.id === strategy.id && s.version === strategy.version);
        if (!actual) throw new Error('Frozen strategy version is unavailable.');
        if (spec.researchStrategyId) continue;
        // Frozen research settings are passed to the isolated runner, never applied as forward enablement.
    }
    const run = lab.runBacktest(records, { window: 'all', seed: spec.seed, mode: spec.mode, protocolId: spec.protocolId || null, firstTarget: spec.first, strategyId: spec.researchStrategyId || null, strategyVersion: spec.researchStrategyVersion || '1.0.0', frozenStrategies:spec.strategies, onProgress: report });
    run.data.frozenSpecification = spec;
    privateDb.prepare('UPDATE betzero_lab_backtest_runs SET data_json=? WHERE run_id=?').run(JSON.stringify(run.data), run.runId);
    privateDb.close();
    site.close();
    process.send?.({ runId: run.runId });
}

async function importResult(db, privatePath, runId, check) {
    const source = new DatabaseSync(privatePath, { readOnly: true });
    const copy = async (table, rows) => {
        if (!rows.length) return;
        const columns = Object.keys(rows[0]);
        const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        for (let index = 0; index < rows.length; index += 100) {
            await check();
            let saved = false;
            for (let retry = 0; retry < 20 && !saved; retry++) {
                let began = false;
                try {
                    db.exec('BEGIN IMMEDIATE'); began = true;
                    for (const row of rows.slice(index,index + 100)) insert.run(...columns.map(c => row[c]));
                    db.exec('COMMIT'); saved = true;
                } catch (error) {
                    if (began) db.exec('ROLLBACK');
                    if (!/locked|busy/i.test(error.message) || retry === 19) throw error;
                    await sleep(100); await check();
                }
            }
            await sleep(0);
        }
    };
    try {
        const run = source.prepare('SELECT * FROM betzero_lab_backtest_runs WHERE run_id=?').get(runId);
        run.status = 'FAILED'; // Hidden staging run until every row is copied and the job completes.
        await copy('betzero_lab_backtest_runs', [run]);
        await copy('betzero_lab_backtest_results', source.prepare('SELECT * FROM betzero_lab_backtest_results WHERE run_id=?').all(runId));
        let lastRow = 0;
        while (true) {
            const rows = source.prepare('SELECT rowid AS copy_rowid,* FROM betzero_lab_backtest_predictions WHERE run_id=? AND rowid>? ORDER BY rowid LIMIT 100').all(runId,lastRow);
            if (!rows.length) break;
            lastRow = rows.at(-1).copy_rowid;
            await copy('betzero_lab_backtest_predictions', rows.map(({copy_rowid,...row})=>row));
        }
    } finally { source.close(); }
}

async function executeJob(db, store, job, { forkProcess = fork, pollMs = 250 } = {}) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'betzero-job-'));
    const temporary = path.join(folder, 'simulation.sqlite');
    let child, progress = 0, runId, childError, finished = false;
    const check = async () => {
        const reason = store.stopReason(job);
        if (reason) throw Object.assign(new Error(reason), { jobState: reason });
        if (!store.heartbeat(job.id,job.token,progress)) throw new Error('Worker claim lost.');
    };
    try {
        const heap = Math.max(128, Math.min(512, Number(process.env.BETZERO_WORKER_HEAP_MB) || 512));
        child = forkProcess(__filename, ['--child', process.env.SITE_DB_PATH, temporary], {
            execArgv: [`--max-old-space-size=${heap}`],
            env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
            stdio: ['ignore','ignore','ignore','ipc']
        });
        child.on('message', message => { if (Number.isFinite(message.progress)) progress = message.progress; if (message.runId) runId = message.runId; if (message.error) childError = message.error; });
        child.on('error', error => { childError = error.message; finished = true; });
        child.on('exit', code => { if (code !== 0) childError ||= 'Simulation process failed.'; finished = true; });
        child.send(job);
        while (!finished) { await sleep(pollMs); await check(); }
        if (childError || !runId) throw new Error(childError || 'Missing simulation result.');
        progress = 95;
        await importResult(db,temporary,runId,check);
        await check();
        db.exec('BEGIN IMMEDIATE');
        try {
            if (store.stopReason(job)) throw new Error('Job cancelled before completion.');
            if (!store.finish(job.id,job.token,'COMPLETED',null,runId)) throw new Error('Worker claim lost.');
            db.prepare("UPDATE betzero_lab_backtest_runs SET status='COMPLETED' WHERE run_id=?").run(runId);
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (error) {
        if (child && !finished) {
            await new Promise(resolve => { child.once('exit',resolve); child.kill('SIGKILL'); setTimeout(resolve,2000); });
        }
        store.finish(job.id,job.token,error.jobState || store.stopReason(job) || 'FAILED',String(error.message).slice(0,500));
    } finally {
        // Only the exact directory just created by mkdtemp is removed.
        const resolved = path.resolve(folder);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('betzero-job-')) throw new Error('Unexpected temporary folder.');
        fs.rmSync(resolved,{recursive:true,force:true});
    }
}

async function main() {
    const filename = process.env.SITE_DB_PATH;
    if (!filename || !fs.existsSync(filename)) throw new Error('SITE_DB_PATH must name the existing website database.');
    const db = connect(filename);
    createBetZeroLab(db);
    const store = createJobStore(db);
    let stopping = false, activeJob = null;
    const stop = () => { stopping = true; };
    const message = value => { if (value?.command === 'shutdown') stop(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('message', message);
    const cancelOnStop = setInterval(() => {
        if (stopping && activeJob) {
            try { store.cancel(activeJob.id); } catch (_) { /* Retry after a short SQLite lock. */ }
        }
    }, 100);
    process.send?.({ type: 'ready' });
    try {
        while (!stopping) {
            try { store.recover(); activeJob = store.claim(); if (activeJob) await executeJob(db,store,activeJob); }
            catch (error) { console.error('[BetZeroWorker]', error.message); }
            finally { activeJob = null; }
            if (!stopping) await sleep(1000);
        }
    } finally {
        clearInterval(cancelOnStop);
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        process.off('message', message);
        db.close();
        if (process.connected) process.disconnect();
    }
}
if (require.main === module) {
    if (process.argv[2] === '--child') process.once('message', job => {
        try { childRun(process.argv[3],process.argv[4],job); process.disconnect(); }
        catch (error) { process.send?.({ error: error.message }); process.exitCode = 1; process.disconnect(); }
    });
    else main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { executeJob, importResult, childRun };
