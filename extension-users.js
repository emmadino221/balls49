#!/usr/bin/env node
'use strict';

// Run on the VPS as the same account as balls49-bot.service. Never exposed by HTTP.
const crypto = require('crypto');
const { readStore, updateStore, hashKey } = require('./extension-key-store');
const [command, argument, ...extra] = process.argv.slice(2);

try {
    if (extra.length) throw new Error('Quote names containing spaces.');
    if (command === 'create') {
        const name = String(argument || '').trim();
        if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Enter a name of 1 to 80 characters.');
        const key = crypto.randomBytes(32).toString('hex');
        const id = `user_ext_${crypto.randomBytes(16).toString('hex')}`;
        updateStore(store => {
            store.users.push({ id, clientId: id, name, keyHash: hashKey(key), createdAt: new Date().toISOString(), revokedAt: null });
        });
        console.log(`Created: ${name}\nID: ${id}\nAccess key (shown once): ${key}\nShare privately with this person only. The key cannot be recovered from the store.`);
    } else if (command === 'list' && !argument) {
        console.table(readStore().users.map(({ id, name, createdAt, revokedAt }) => ({
            id, name, status: revokedAt ? 'REVOKED' : 'ACTIVE', createdAt
        })));
    } else if (command === 'revoke') {
        updateStore(store => {
            const user = store.users.find(user => user.id === argument);
            if (!user) throw new Error('Unknown user ID. Run list first.');
            user.revokedAt ||= new Date().toISOString();
        });
        console.log('Access revoked. Subsequent requests are blocked; already delivered bets cannot be recalled.');
    } else {
        throw new Error('Usage: node extension-users.js create "Name" | list | revoke user_ext_ID');
    }
} catch (error) {
    console.error(error.code === 'EEXIST' ? 'Key store is locked by another operation. Try again after it finishes.' : error.message);
    process.exitCode = 1;
}
