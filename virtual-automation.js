'use strict';
// Website side of the virtual football automation dashboard. Each account links its own
// virtual licence key once; it is stored encrypted with the site vault and sent only to the
// virtual service on this machine, together with the secret the two services already share.
const crypto = require('crypto');

const KEY_PATTERN = /^[\x21-\x7e]{8,200}$/;
const COMMANDS = ['START', 'STOP', 'STAKE', 'TP', 'SL', 'MODE', 'RESET'];

function createVirtualAutomation(db, vault, options = {}) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_virtual_automation_links (
        account TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, encrypted_key TEXT NOT NULL, linked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site_virtual_licences (
        account TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, encrypted_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL, issued_at INTEGER NOT NULL, revoked_at INTEGER
    )`);
    const DAY_MS = 86400000;
    const baseUrl = options.baseUrl || process.env.VIRTUAL_API_URL || 'http://127.0.0.1:5000';
    const secret = () => options.secret ?? process.env.VIRTUAL_DASHBOARD_SECRET ?? process.env.VIRTUAL_FEED_SECRET ?? '';
    const doFetch = options.fetch || fetch;
    const failure = (message, status = 400) => Object.assign(new Error(message), { status });
    const hashKey = key => crypto.createHash('sha256').update(`virtual-licence-v1:${key}`).digest('hex');
    const linkOf = account => db.prepare('SELECT * FROM site_virtual_automation_links WHERE account = ?').get(account);

    async function call(route, body) {
        if (secret().length < 32) throw failure('Virtual automation is not configured on this server.', 503);
        let response;
        try {
            response = await doFetch(`${baseUrl}/dashboard/${route}`, {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
                headers: { 'Content-Type': 'application/json', 'X-Dashboard-Secret': secret() },
                body: JSON.stringify(body)
            });
        } catch { throw failure('The virtual football service is unavailable. Try again shortly.', 503); }
        const result = await response.json().catch(() => ({}));
        if (response.status === 403) throw failure('The virtual football service rejected this website. Check that both services share the same secret.', 503);
        return { status: response.status, result };
    }
    function keyFor(account) {
        const link = linkOf(account);
        if (!link) return null;
        try { return vault.open(link.encrypted_key); }
        catch { throw failure('Your saved licence key cannot be read. Unlink and link it again.', 409); }
    }

    const licenceOf = account => db.prepare('SELECT * FROM site_virtual_licences WHERE account = ?').get(account);
    const activeLicence = account => {
        const row = licenceOf(account);
        return row && !row.revoked_at && row.expires_at > Date.now() ? row : null;
    };
    function linkKey(account, key) {
        db.prepare('DELETE FROM site_virtual_automation_links WHERE key_hash = ? AND account <> ?').run(hashKey(key), account);
        db.prepare(`INSERT INTO site_virtual_automation_links VALUES (?,?,?,?)
            ON CONFLICT(account) DO UPDATE SET key_hash=excluded.key_hash, encrypted_key=excluded.encrypted_key, linked_at=excluded.linked_at`)
            .run(account, hashKey(key), vault.seal(key), Date.now());
    }

    return {
        // Owner: issue (or renew) a licence key for an account, valid for `months` x 30 days from today.
        // An account keeps the same key when renewed, so the member does not need to re-enter it.
        async issueLicence(account, months) {
            months = Number.parseInt(months, 10);
            if (!Number.isInteger(months) || months < 1 || months > 12) throw failure('Choose 1 to 12 months.');
            const current = licenceOf(account);
            const key = current && !current.revoked_at ? vault.open(current.encrypted_key) : `vf_${crypto.randomBytes(24).toString('base64url')}`;
            const expiresAt = Date.now() + months * 30 * DAY_MS;
            const { status, result } = await call('licence', { action: 'grant', key, account, expiresAt });
            if (status !== 200) throw failure(result.error || 'The virtual football service did not accept the licence.', 503);
            db.exec('BEGIN IMMEDIATE');
            try {
                db.prepare(`INSERT INTO site_virtual_licences VALUES (?,?,?,?,?,NULL)
                    ON CONFLICT(account) DO UPDATE SET key_hash=excluded.key_hash, encrypted_key=excluded.encrypted_key,
                    expires_at=excluded.expires_at, issued_at=excluded.issued_at, revoked_at=NULL`)
                    .run(account, hashKey(key), vault.seal(key), expiresAt, Date.now());
                linkKey(account, key);       // the member's dashboard works without pasting the key
                db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
            return { key, expiresAt };
        },
        // Owner: revoke an account's licence. Its extension stops on the next check.
        async revokeLicence(account) {
            const row = licenceOf(account);
            if (!row || row.revoked_at) return { revoked: false };
            const key = vault.open(row.encrypted_key);
            const { status, result } = await call('licence', { action: 'revoke', key });
            if (status !== 200) throw failure(result.error || 'The virtual football service did not confirm the revocation.', 503);
            db.prepare('UPDATE site_virtual_licences SET revoked_at = ? WHERE account = ?').run(Date.now(), account);
            db.prepare('DELETE FROM site_virtual_automation_links WHERE account = ? AND key_hash = ?').run(account, row.key_hash);
            return { revoked: true };
        },
        licences() {
            const now = Date.now();
            return db.prepare('SELECT account, encrypted_key, expires_at, issued_at, revoked_at FROM site_virtual_licences ORDER BY expires_at DESC').all()
                .map(row => {
                    let hint = '';
                    try { hint = vault.open(row.encrypted_key).slice(-4); } catch { /* unreadable key: no hint */ }
                    return { email: row.account, expiresAt: row.expires_at, issuedAt: row.issued_at, revokedAt: row.revoked_at || null,
                        status: row.revoked_at ? 'revoked' : row.expires_at > now ? 'active' : 'expired', keyHint: hint };
                });
        },
        // Member: their own active issued key, to paste into the extension.
        memberKey(account) {
            const row = activeLicence(account);
            return row ? { key: vault.open(row.encrypted_key), expiresAt: row.expires_at } : null;
        },
        licenceSummary(account) {
            const row = licenceOf(account);
            return row ? { expiresAt: row.expires_at, status: row.revoked_at ? 'revoked' : row.expires_at > Date.now() ? 'active' : 'expired' } : null;
        },
        async status(account) {
            const key = keyFor(account);
            if (!key) return { linked: false };
            const { status, result } = await call('status', { key });
            if (status === 404) return { linked: true, keyValid: false, keyHint: key.slice(-4) };
            if (status !== 200) throw failure(result.error || 'Virtual automation status is unavailable.', 503);
            return { linked: true, keyValid: true, keyHint: key.slice(-4), ...result };
        },
        async link(account, key) {
            key = String(key || '').trim();
            if (!KEY_PATTERN.test(key)) throw failure('Enter the licence key from your virtual football extension.');
            const existing = db.prepare('SELECT account FROM site_virtual_automation_links WHERE key_hash = ?').get(hashKey(key));
            if (existing && existing.account !== account) throw failure('This licence key is already linked to another account.', 409);
            const { status } = await call('status', { key });
            if (status !== 200) throw failure('That licence key is not recognised by the virtual football service.');
            db.prepare(`INSERT INTO site_virtual_automation_links VALUES (?,?,?,?)
                ON CONFLICT(account) DO UPDATE SET key_hash=excluded.key_hash, encrypted_key=excluded.encrypted_key, linked_at=excluded.linked_at`)
                .run(account, hashKey(key), vault.seal(key), Date.now());
            return { linked: true };
        },
        unlink(account) {
            db.prepare('DELETE FROM site_virtual_automation_links WHERE account = ?').run(account);
            return { linked: false };
        },
        async command(account, input = {}) {
            const type = String(input.type || '').toUpperCase();
            if (!COMMANDS.includes(type)) throw failure('Unknown command.');
            const key = keyFor(account);
            if (!key) throw failure('Link your virtual football licence key first.', 409);
            const { status, result } = await call('command', { key, type, value: input.value });
            if (status !== 200) throw failure(result.error || 'The command was not accepted.', status === 404 ? 409 : 400);
            return result;
        }
    };
}

module.exports = { createVirtualAutomation };
