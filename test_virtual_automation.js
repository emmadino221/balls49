'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createSiteVault } = require('./site-vault');
const { createVirtualAutomation } = require('./virtual-automation');

const SECRET = 'dashboard-secret-with-more-than-thirty-two-characters';
const KEY_A = 'licence-key-member-a', KEY_B = 'licence-key-member-b';

function setup(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'virtual-automation-'));
    const db = new DatabaseSync(path.join(directory, 'site.sqlite'));
    const vault = createSiteVault(path.join(directory, 'vault.key'));
    const calls = [];
    // A stand-in for the virtual service's dashboard routes.
    const fakeFetch = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, secret: init.headers['X-Dashboard-Secret'] });
        const reply = (status, json) => ({ status, json: async () => json });
        if (init.headers['X-Dashboard-Secret'] !== SECRET) return reply(403, { error: 'Forbidden' });
        if (![KEY_A, KEY_B].includes(body.key)) return reply(404, { valid: false });
        if (url.endsWith('/dashboard/status')) return reply(200, { valid: true, session: { state: { botEnabled: true }, online: true }, results: [] });
        if (body.type === 'STAKE' && !(body.value >= 1)) return reply(400, { error: 'Enter an amount from 1 to 1,000,000.' });
        return reply(200, { ok: true, command: { type: body.type, value: body.value } });
    };
    const automation = createVirtualAutomation(db, vault, { secret: SECRET, fetch: fakeFetch, baseUrl: 'http://127.0.0.1:5000' });
    t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    return { db, automation, calls };
}

test('link, read status and send commands for the account\'s own key', async t => {
    const { db, automation, calls } = setup(t);
    assert.deepEqual(await automation.status('a@example.test'), { linked: false });
    await assert.rejects(automation.link('a@example.test', 'not-a-real-key'), /not recognised/);
    assert.deepEqual(await automation.link('a@example.test', KEY_A), { linked: true });
    const stored = db.prepare('SELECT encrypted_key FROM site_virtual_automation_links').get().encrypted_key;
    assert.ok(!stored.includes(KEY_A), 'key is stored encrypted');
    const status = await automation.status('a@example.test');
    assert.equal(status.keyValid, true);
    assert.equal(status.keyHint, KEY_A.slice(-4));
    assert.equal(status.session.online, true);
    assert.equal((await automation.command('a@example.test', { type: 'stake', value: 250 })).ok, true);
    assert.deepEqual(calls.at(-1).body, { key: KEY_A, type: 'STAKE', value: 250 });
    assert.ok(calls.every(call => call.secret === SECRET));
});

test('a key cannot be linked to two accounts, and commands need a link', async t => {
    const { automation } = setup(t);
    await automation.link('a@example.test', KEY_A);
    await assert.rejects(automation.link('b@example.test', KEY_A), /already linked/);
    await assert.rejects(automation.command('b@example.test', { type: 'STOP' }), /Link your virtual football licence key/);
    await automation.link('b@example.test', KEY_B);
    await automation.command('b@example.test', { type: 'STOP' });
    automation.unlink('a@example.test');
    assert.deepEqual(await automation.status('a@example.test'), { linked: false });
    await automation.link('b@example.test', KEY_B);               // relinking the same key is fine
});

test('bad commands and a wrong secret are reported clearly', async t => {
    const { automation } = setup(t);
    await automation.link('a@example.test', KEY_A);
    await assert.rejects(automation.command('a@example.test', { type: 'DELETE' }), /Unknown command/);
    await assert.rejects(automation.command('a@example.test', { type: 'STAKE', value: 0 }), /Enter an amount/);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'virtual-automation-'));
    const db = new DatabaseSync(path.join(directory, 'site.sqlite'));
    t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    const unconfigured = createVirtualAutomation(db, createSiteVault(path.join(directory, 'vault.key')), { secret: '' });
    await assert.rejects(unconfigured.link('a@example.test', KEY_A), { status: 503 });
});
