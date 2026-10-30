'use strict';
const crypto = require('crypto');

// Website-side delivery: the worker never needs the Resend credential.
function createAutomationReports(db, bridge, getUser, email) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_automation_reports (
        account TEXT PRIMARY KEY, enabled INTEGER NOT NULL, interval_draws INTEGER NOT NULL,
        epoch TEXT NOT NULL, through_draws INTEGER NOT NULL, pending TEXT,
        last_sent INTEGER, last_attempt INTEGER, error TEXT
    )`);
    const read = account => db.prepare('SELECT * FROM site_automation_reports WHERE account=?').get(account);
    const eligible = account => { const user = getUser(account); return user?.emailVerified && user.extensionExpiresAt > Date.now(); };
    const epoch = status => `${status.clientId}:${status.control.resetAt || 0}`;
    let running = false;
    function view(account) {
        const row = read(account);
        return { enabled: !!row?.enabled, interval: row?.interval_draws || 10, lastSent: row?.last_sent || null, error: row?.error || '', pending: !!row?.pending, eligible: !!eligible(account), configured: email.configured };
    }
    async function configure(account, input) {
        const enabled = input.enabled === true, interval = Number(input.interval);
        if (!Number.isSafeInteger(interval) || interval < 1 || interval > 10000) throw Object.assign(new Error('Choose an interval from 1 to 10,000 settled draws.'), { status: 400 });
        if (enabled && (!eligible(account) || !email.configured)) throw Object.assign(new Error('Email reports need a verified member account, active extension access and configured email delivery.'), { status: 403 });
        const status = enabled ? await bridge.status(account) : null;
        if (enabled && !status?.control) throw Object.assign(new Error('Link your extension before enabling reports.'), { status: 409 });
        db.prepare(`INSERT INTO site_automation_reports VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL)
            ON CONFLICT(account) DO UPDATE SET enabled=excluded.enabled, interval_draws=excluded.interval_draws,
            epoch=excluded.epoch, through_draws=excluded.through_draws, pending=NULL, error=NULL`).run(account, enabled ? 1 : 0, interval, status ? epoch(status) : '', status?.control.settledDraws || 0);
        return view(account);
    }
    async function tick() {
        if (running) return; running = true;
        try {
            for (const original of db.prepare('SELECT account FROM site_automation_reports WHERE enabled=1').all()) {
                const account = original.account;
                if (!eligible(account)) continue;
                try {
                    const status = await bridge.status(account);
                    let row = read(account);
                    if (!row?.enabled || !eligible(account) || !status.control) continue;
                    const c = status.control, count = Number(c.settledDraws || 0), identity = epoch(status);
                    if (row.epoch !== identity || count < row.through_draws) {
                        db.prepare('UPDATE site_automation_reports SET epoch=?, through_draws=0, pending=NULL, error=NULL WHERE account=?').run(identity, account);
                        row = read(account);
                    }
                    if (row.last_attempt && Date.now() - row.last_attempt < 60000) continue;
                    let pending = row.pending ? JSON.parse(row.pending) : null;
                    if (!pending && count - row.through_draws >= row.interval_draws) {
                        pending = { id: crypto.randomUUID(), created: Date.now(), count, report: {
                            draws: count, since: count - row.through_draws, wins: c.wins, losses: c.losses,
                            profit: c.profit, balance: c.liveBalance, balanceAt: c.balanceAt,
                            currentLossStreak: c.currentLossStreak, maxLossStreak: c.maxLossStreak,
                            running: c.running, reason: c.reason
                        } };
                        db.prepare('UPDATE site_automation_reports SET pending=? WHERE account=?').run(JSON.stringify(pending), account);
                    }
                    if (!pending) continue;
                    // Stop retrying before the provider's idempotency window expires.
                    if (Date.now() - pending.created > 23 * 3600000) {
                        db.prepare('UPDATE site_automation_reports SET pending=NULL, through_draws=?, error=? WHERE account=?').run(pending.count, 'A report expired after delivery retries. Check email configuration.', account);
                        continue;
                    }
                    db.prepare('UPDATE site_automation_reports SET last_attempt=? WHERE account=?').run(Date.now(), account);
                    await email.report(account, pending.report, pending.id);
                    // A user may disable or change the schedule while delivery is in flight.
                    db.prepare('UPDATE site_automation_reports SET pending=NULL, through_draws=?, last_sent=?, error=NULL WHERE account=? AND pending=?').run(pending.count, Date.now(), account, JSON.stringify(pending));
                } catch {
                    db.prepare('UPDATE site_automation_reports SET error=? WHERE account=? AND enabled=1').run('Report delayed. Worker or email service unavailable; retrying automatically.', account);
                }
            }
        } finally { running = false; }
    }
    return { view, configure, start() { const timer = setInterval(() => tick().catch(() => {}), 30000); timer.unref(); } };
}
module.exports = { createAutomationReports };
