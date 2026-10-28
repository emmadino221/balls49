'use strict';

const crypto = require('crypto');
const { readStore, hashKey } = require('./extension-key-store');
const ROUTES = new Set([
    'GET /stats', 'GET /stream', 'GET /backtest',
    'POST /config', 'POST /ack', 'POST /reset', 'POST /update-balance'
]);

// Only the /extension/ namespace is published by the HTTPS reverse proxy.
// Existing loopback collector, website and SSH-tunnel routes stay local.
function authorizeExtensionRequest(req, url, env = process.env) {
    if (!url.pathname.startsWith('/extension/')) return null;
    const route = url.pathname.slice('/extension'.length);
    if (!ROUTES.has(`${req.method} ${route}`)) {
        return { status: 404, error: 'Not found.' };
    }
    const key = env.EXTENSION_ACCESS_KEY || '';
    let clientId = env.EXTENSION_CLIENT_ID || '';
    const supplied = String(req.headers.authorization || '');
    const expectedHash = crypto.createHash('sha256').update(`Bearer ${key}`).digest();
    const receivedHash = crypto.createHash('sha256').update(supplied).digest();
    const owner = /^[A-Za-z0-9_-]{32,256}$/.test(key)
        && /^user_[A-Za-z0-9_-]{1,80}$/.test(clientId)
        && crypto.timingSafeEqual(expectedHash, receivedHash);
    if (!owner) {
        const bearer = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(supplied);
        if (!bearer) return { status: 401, error: 'Invalid extension access key.' };
        let users;
        try { users = readStore(env).users; }
        catch { return { status: 503, error: 'Extension access is temporarily unavailable.' }; }
        const digest = Buffer.from(hashKey(bearer[1]), 'hex');
        const user = users.find(record => crypto.timingSafeEqual(Buffer.from(record.keyHash, 'hex'), digest));
        if (!user || user.revokedAt) return { status: 401, error: 'Invalid or revoked extension access key.' };
        if (user.expiresAt !== undefined && !(user.expiresAt > Date.now())) {
            // Permit settlement receipts and stopping after expiry, but never new execution.
            const settlementOnly = req.method === 'POST' && ['/ack', '/update-balance'].includes(route);
            if (!settlementOnly) return { status: 403, error: 'Extension subscription expired. Contact the owner to renew.' };
        }
        clientId = user.clientId;
        // Backtests consume the shared worker; only the owner may run them remotely.
        if (route === '/backtest') return { status: 403, error: 'Backtesting is available to the owner only.' };
    }
    req.extensionAccess = { role: owner ? 'owner' : 'member', clientId };
    // Always derive the session from the credential, never from browser input.
    url.pathname = route;
    url.searchParams.set('clientId', clientId);
    url.searchParams.delete('key');
    return null;
}

module.exports = { authorizeExtensionRequest };
