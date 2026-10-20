'use strict';

const crypto = require('crypto');
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
    const clientId = env.EXTENSION_CLIENT_ID || '';
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(key)
        || !/^user_[A-Za-z0-9_-]{1,80}$/.test(clientId)) {
        return { status: 503, error: 'Remote extension access is not configured.' };
    }
    const supplied = String(req.headers.authorization || '');
    const expectedHash = crypto.createHash('sha256').update(`Bearer ${key}`).digest();
    const receivedHash = crypto.createHash('sha256').update(supplied).digest();
    if (!crypto.timingSafeEqual(expectedHash, receivedHash)) {
        return { status: 401, error: 'Invalid extension access key.' };
    }
    // Bind the credential to the owner's existing automation state, even when
    // the extension is installed in a new browser. Never trust a remote ID.
    url.pathname = route;
    url.searchParams.set('clientId', clientId);
    url.searchParams.delete('key');
    return null;
}

module.exports = { authorizeExtensionRequest };
