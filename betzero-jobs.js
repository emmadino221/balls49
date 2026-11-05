'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const MAX_PAIRS = 50000;
const TIMEOUT_MS = 600000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const rulesHash = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'betzero-lab.js'))).digest('hex');

function createJobStore(db, { now = Date.now } = {}) {
    db.exec(`CREATE TABLE IF NOT EXISTS betzero_lab_jobs (
      id TEXT PRIMARY KEY, state TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
      started_at INTEGER, heartbeat INTEGER, token TEXT, progress INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0, run_id TEXT, error TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS betzero_lab_one_running ON betzero_lab_jobs(state) WHERE state='RUNNING';
      CREATE TABLE IF NOT EXISTS betzero_lab_protocols (
      id TEXT PRIMARY KEY, first_draw INTEGER NOT NULL, last_draw INTEGER NOT NULL, created_at INTEGER NOT NULL,
      specification TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'SEALED', job_id TEXT);
      CREATE TABLE IF NOT EXISTS betzero_lab_exposures (first_draw INTEGER NOT NULL, last_draw INTEGER NOT NULL);`);
    const transaction = fn => {
        db.exec('BEGIN IMMEDIATE');
        try { const result = fn(); db.exec('COMMIT'); return result; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
    };
    const latest = () => db.prepare('SELECT MAX(sort_draw_id) AS id FROM public_prediction_history').get()?.id || 0;
    const frozen = strategies => ({ rulesHash: rulesHash(), strategies: strategies.map(s => ({ id: s.id, version: s.version, enabled: s.enabled, config: s.config, selectionCount: s.selectionCount })) });
    const seedValue = seed => { if (typeof seed !== 'string' || !seed.trim() || seed.length > 64) throw fail('Seed must contain 1–64 characters.'); return seed; };
    function assertExploratory(first, last) {
        if (db.prepare('SELECT id FROM betzero_lab_protocols WHERE first_draw <= ? AND last_draw >= ?').get(last, first)) throw fail('This range overlaps a sealed final-test cohort. Choose another range.', 409);
    }
    function seal(input, strategies) {
        const first = Number(input.firstDraw), last = Number(input.lastDraw);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 2 || last - first + 1 < 5 || last - first + 1 > MAX_PAIRS) throw fail('Choose 5–50,000 future target draws.');
        const specification = { ...frozen(strategies), seed: seedValue(input.seed), first, last, mode: 'SEALED_FINAL', sourceRule: 'target minus one', acceptance: 'Report all outcomes and matched baselines; no parameter tuning on this cohort.' };
        return transaction(() => {
            if (first <= latest()) throw fail('Final-test target draws must be in the future.');
            assertExploratory(first, last);
            if (db.prepare('SELECT 1 FROM betzero_lab_exposures WHERE first_draw <= ? AND last_draw >= ?').get(last, first)) throw fail('Previously explored ranges cannot be sealed.', 409);
            const id = crypto.randomUUID();
            db.prepare('INSERT INTO betzero_lab_protocols(id,first_draw,last_draw,created_at,specification) VALUES (?,?,?,?,?)').run(id, first, last, now(), JSON.stringify(specification));
            return { id, ...specification, state: 'SEALED' };
        });
    }
    function enqueue(input, strategies) {
        return transaction(() => {
            if (db.prepare("SELECT COUNT(*) AS n FROM betzero_lab_jobs WHERE state='QUEUED'").get().n >= 2) throw fail('Queue is full: at most two waiting jobs.', 429);
            let payload;
            let protocol;
            if (input.protocolId) {
                protocol = db.prepare('SELECT * FROM betzero_lab_protocols WHERE id=?').get(String(input.protocolId));
                if (!protocol || protocol.state !== 'SEALED') throw fail('Protocol is missing or has already been consumed. Reopen its saved job instead.', 409);
                if (latest() < protocol.last_draw) throw fail('The sealed cohort is not complete yet.', 409);
                payload = { ...JSON.parse(protocol.specification), protocolId: protocol.id, window: 'all' };
            } else {
                const window = String(input.window || '100');
                if (!['100', '500', '1000', 'all'].includes(window)) throw fail('Unsupported evaluation window.');
                const last = latest();
                const requested = window === 'all' ? MAX_PAIRS : Number(window);
                const first = window === 'all' ? (db.prepare('SELECT MIN(sort_draw_id) AS id FROM public_prediction_history').get()?.id || 0) + 1 : Math.max(2, last - requested + 1);
                if (last - first + 1 > MAX_PAIRS) throw fail('All history exceeds 50,000 target draws; choose a smaller window.', 413);
                if (last - first + 1 < 5) throw fail('At least five source/target pairs are required.', 422);
                assertExploratory(first - 1, last);
                payload = { ...frozen(strategies), first, last, window, seed: seedValue(input.seed), mode: 'EXPLORATORY' };
            }
            if (payload.rulesHash !== rulesHash()) throw fail('The frozen rule code differs from this installation. Do not reuse this protocol with changed code.', 409);
            const id = crypto.randomUUID();
            db.prepare("INSERT INTO betzero_lab_jobs(id,state,payload,created_at) VALUES (?,'QUEUED',?,?)").run(id, JSON.stringify(payload), now());
            if (protocol) db.prepare("UPDATE betzero_lab_protocols SET state='CONSUMED',job_id=? WHERE id=?").run(id, protocol.id);
            else db.prepare('INSERT INTO betzero_lab_exposures VALUES (?,?)').run(payload.first - 1, payload.last);
            return get(id);
        });
    }
    function get(id) {
        const row = db.prepare('SELECT * FROM betzero_lab_jobs WHERE id=?').get(id);
        if (!row) return null;
        return { id: row.id, state: row.state, progress: row.progress, createdAt: row.created_at, startedAt: row.started_at, cancelRequested: !!row.cancel_requested, runId: row.run_id, error: row.error, specification: JSON.parse(row.payload) };
    }
    function claim() {
        return transaction(() => {
            if (db.prepare("SELECT id FROM betzero_lab_jobs WHERE state='RUNNING'").get()) return null;
            const row = db.prepare("SELECT id FROM betzero_lab_jobs WHERE state='QUEUED' ORDER BY created_at,id LIMIT 1").get();
            if (!row) return null;
            const token = crypto.randomUUID();
            db.prepare("UPDATE betzero_lab_jobs SET state='RUNNING',started_at=?,heartbeat=?,token=? WHERE id=?").run(now(), now(), token, row.id);
            return { ...get(row.id), token };
        });
    }
    function cancel(id) {
        if (!get(id)) throw fail('Job not found.', 404);
        db.prepare("UPDATE betzero_lab_jobs SET cancel_requested=1,state=CASE WHEN state='QUEUED' THEN 'CANCELLED' ELSE state END WHERE id=? AND state IN ('QUEUED','RUNNING')").run(id);
        return get(id);
    }
    function heartbeat(id, token, progress) {
        return db.prepare("UPDATE betzero_lab_jobs SET heartbeat=?,progress=? WHERE id=? AND token=? AND state='RUNNING'").run(now(), Math.max(0, Math.min(99, Math.floor(progress))), id, token).changes;
    }
    function finish(id, token, state, error = null, runId = null) {
        if (!['COMPLETED','FAILED','CANCELLED','TIMED_OUT'].includes(state)) throw fail('Invalid completion state.');
        return db.prepare("UPDATE betzero_lab_jobs SET state=?,error=?,run_id=?,progress=CASE WHEN ?='COMPLETED' THEN 100 ELSE progress END WHERE id=? AND token=? AND state='RUNNING'").run(state,error,runId,state,id,token).changes;
    }
    function recover() {
        // Never replay a partially evaluated sealed test. A failed cohort stays consumed.
        return db.prepare("UPDATE betzero_lab_jobs SET state=CASE WHEN cancel_requested=1 THEN 'CANCELLED' ELSE 'FAILED' END,error='Worker heartbeat lost; evaluation was not automatically replayed.' WHERE state='RUNNING' AND heartbeat < ?").run(now() - 30000).changes;
    }
    function stopReason(job) {
        const current = get(job.id);
        if (!current || current.state !== 'RUNNING') return 'FAILED';
        if (current.cancelRequested) return 'CANCELLED';
        if (now() - current.startedAt >= TIMEOUT_MS) return 'TIMED_OUT';
        return null;
    }
    function reserveSync(records) {
        const ids = records.map(r => Number(r.drawId)).filter(Number.isSafeInteger);
        if (!ids.length) return;
        transaction(() => { const first = Math.min(...ids), last = Math.max(...ids); assertExploratory(first,last); db.prepare('INSERT INTO betzero_lab_exposures VALUES (?,?)').run(first,last); });
    }
    return { seal, enqueue, get, claim, cancel, heartbeat, finish, recover, stopReason, reserveSync,
        list: () => db.prepare('SELECT id FROM betzero_lab_jobs ORDER BY created_at DESC LIMIT 20').all().map(r => get(r.id)),
        protocols: () => db.prepare('SELECT * FROM betzero_lab_protocols ORDER BY created_at DESC LIMIT 20').all().map(r => ({ id:r.id, state:r.state, jobId:r.job_id, ...JSON.parse(r.specification) })) };
}
module.exports = { createJobStore, rulesHash, MAX_PAIRS, TIMEOUT_MS };
