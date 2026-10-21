'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function storePath(env = process.env) {
    return path.resolve(env.EXTENSION_KEYS_FILE || path.join(__dirname, 'extension-users.json'));
}

function readStore(env = process.env) {
    let text;
    try { text = fs.readFileSync(storePath(env), 'utf8'); }
    catch (error) {
        if (error.code === 'ENOENT') return { version: 1, users: [] };
        throw error;
    }
    const store = JSON.parse(text);
    if (store.version !== 1 || !Array.isArray(store.users)) throw new Error('Invalid extension key store.');
    const ids = new Set();
    const hashes = new Set();
    for (const user of store.users) {
        if (!user || !/^user_ext_[a-f0-9]{32}$/.test(user.clientId)
            || user.id !== user.clientId || typeof user.name !== 'string'
            || !/^[a-f0-9]{64}$/.test(user.keyHash)
            || !(user.revokedAt === null || typeof user.revokedAt === 'string')
            || ids.has(user.id) || hashes.has(user.keyHash)) throw new Error('Invalid extension key record.');
        ids.add(user.id);
        hashes.add(user.keyHash);
    }
    return store;
}

function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

function updateStore(change, env = process.env) {
    const file = storePath(env);
    const lock = `${file}.lock`;
    const fd = fs.openSync(lock, 'wx', 0o600);
    const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
        const store = readStore(env);
        const result = change(store);
        fs.writeFileSync(temp, JSON.stringify(store, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        fs.renameSync(temp, file);
        return result;
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
        fs.closeSync(fd);
        fs.unlinkSync(lock);
    }
}

// Missing, revoked, or unreadable records fail closed for managed sessions.
function disabledManagedSessions(clientIds, env = process.env) {
    const managed = clientIds.filter(id => id.startsWith('user_ext_') && id !== env.EXTENSION_CLIENT_ID);
    if (!managed.length) return [];
    try {
        const active = new Set(readStore(env).users.filter(user => !user.revokedAt).map(user => user.clientId));
        return managed.filter(id => !active.has(id));
    } catch { return managed; }
}

module.exports = { storePath, readStore, hashKey, updateStore, disabledManagedSessions };
