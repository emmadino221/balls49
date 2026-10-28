'use strict';
const net = require('net');
// Only an explicitly configured proxy may supply the single client address.
function clientAddress(req, env = process.env) {
    const peer = req.socket.remoteAddress || 'unknown';
    const trusted = (env.SITE_TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean);
    const address = req.headers['x-real-ip'];
    if (trusted.includes(peer) && typeof address === 'string' && net.isIP(address)) return address;
    return peer;
}
module.exports = { clientAddress };
