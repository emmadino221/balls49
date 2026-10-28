'use strict';
const crypto = require('crypto');
const { updateStore, hashKey } = require('./extension-key-store');

function signature(secret, timestamp, body) {
    return crypto.createHmac('sha256', secret).update(`extension-subscription.${timestamp}.${body}`).digest('hex');
}
function validRequest(req, data, secret) {
    if (Buffer.byteLength(secret) < 32 || req.headers.origin
        || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
    const timestamp = String(req.headers['x-subscription-time'] || '');
    const supplied = String(req.headers['x-subscription-signature'] || '');
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
    return crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(secret, timestamp, JSON.stringify(data)), 'hex'));
}
function manage(data) {
    if (data.action === 'bind-account') {
        if (!/^\S+@\S+\.\S+$/.test(data.email || '') || !/^[A-Za-z0-9_-]{32,256}$/.test(data.key || '')) throw new Error('Invalid binding.');
        if (data.key === process.env.EXTENSION_ACCESS_KEY) throw new Error('Owner keys cannot be linked to member accounts.');
        return updateStore(store => {
            const user = store.users.find(record => record.keyHash === hashKey(data.key));
            if (!user || user.revokedAt || (user.expiresAt !== undefined && user.expiresAt <= Date.now())) throw new Error('Inactive key.');
            if (user.accountEmail && user.accountEmail !== data.email) throw new Error('Key belongs to another account.');
            user.accountEmail = data.email;
            return { clientId: user.clientId };
        });
    }
    if (data.action === 'revoke-account') {
        const email = String(data.email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254
            || (data.clientId && !/^user_[A-Za-z0-9_-]{1,80}$/.test(data.clientId))) throw new Error('Invalid account.');
        return updateStore(store => {
            const ids = [];
            for (const user of store.users) {
                if (user.clientId === process.env.EXTENSION_CLIENT_ID) continue;
                if (user.accountEmail === email || user.clientId === data.clientId) {
                    user.revokedAt = new Date().toISOString();
                    user.expiresAt = 0;
                    ids.push(user.clientId);
                }
            }
            return { revokedClientIds: ids };
        });
    }
    if (data.key === process.env.EXTENSION_ACCESS_KEY) throw new Error('The owner key cannot be assigned to a subscriber.');
    const email = String(data.email || '').trim().toLowerCase();
    const expiresAt = Number(data.expiresAt);
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254
        || !Number.isSafeInteger(expiresAt) || expiresAt < 0 || expiresAt > Date.now() + 367 * 86400000
        || !/^[A-Za-z0-9_-]{32,256}$/.test(data.key || '')) throw new Error('Invalid extension subscription.');
    return updateStore(store => {
        let user = store.users.find(record => record.accountEmail === email);
        const existing = store.users.find(record => record.keyHash === hashKey(data.key));
        if (!user && existing && !existing.accountEmail) { user = existing; user.accountEmail = email; }
        if (existing && existing !== user) throw new Error('Key belongs to another session.');
        if (!user) {
            const id = `user_ext_${crypto.randomBytes(16).toString('hex')}`;
            user = { id, clientId: id, name: email, accountEmail: email, createdAt: new Date().toISOString() };
            store.users.push(user);
        }
        Object.assign(user, { keyHash: hashKey(data.key), expiresAt, revokedAt: expiresAt ? null : new Date().toISOString() });
        return { clientId: user.clientId, expiresAt };
    });
}
async function request(data, secret) {
    if (Buffer.byteLength(secret) < 32) throw new Error('Configure the shared prediction ingest secret on both services first.');
    const timestamp = String(Date.now()), body = JSON.stringify(data);
    const response = await fetch('http://127.0.0.1:3001/internal/extension-subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-subscription-time': timestamp, 'x-subscription-signature': signature(secret, timestamp, body) },
        body, redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Worker could not update extension access. Update both services and retry.');
    return response.json();
}
module.exports = { validRequest, manage, request };
