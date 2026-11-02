'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createVirtualFootball } = require('./virtual-football');

test('virtual feed authenticates snapshots and keeps published picks immutable', t => {
    const previousSecret = process.env.VIRTUAL_FEED_SECRET;
    const secret = 'test-secret-with-more-than-thirty-two-characters';
    process.env.VIRTUAL_FEED_SECRET = secret;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balls49-virtual-'));
    const db = new DatabaseSync(path.join(directory, 'site.sqlite'));
    const virtualFootball = createVirtualFootball(db);
    t.after(() => {
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
        if (previousSecret === undefined) delete process.env.VIRTUAL_FEED_SECRET;
        else process.env.VIRTUAL_FEED_SECRET = previousSecret;
    });

    const createdAt = Date.now();
    const firstTimestamp = String(Date.now());
    const firstSnapshot = {
        version: 1,
        sourceId: 'virtual-tests',
        sourceAt: createdAt,
        matches: [{
            id: 1, home: 'Home', away: 'Away', week: 'Week 1', createdAt,
            pick: 'HOME', goals15: 'OVER', btts: 'GG', confidence: 70, status: 'UPCOMING', score: null
        }]
    };
    const sign = (timestamp, body) => crypto.createHmac('sha256', secret)
        .update(`${timestamp}.${body}`).digest('hex');
    const firstBody = JSON.stringify(firstSnapshot);

    assert.throws(() => virtualFootball.ingest(firstBody, {
        'x-virtual-timestamp': firstTimestamp,
        'x-virtual-signature': '0'.repeat(64)
    }), { status: 401 });
    assert.deepEqual(virtualFootball.ingest(firstBody, {
        'x-virtual-timestamp': firstTimestamp,
        'x-virtual-signature': sign(firstTimestamp, firstBody)
    }), { ok: true, received: 1 });

    const nextTimestamp = String(Number(firstTimestamp) + 1);
    const invalidSnapshot = {
        ...firstSnapshot,
        sourceAt: createdAt + 1,
        matches: [{ ...firstSnapshot.matches[0], goals15: 'OVER_2_5' }]
    };
    const invalidBody = JSON.stringify(invalidSnapshot);
    assert.throws(() => virtualFootball.ingest(invalidBody, {
        'x-virtual-timestamp': nextTimestamp,
        'x-virtual-signature': sign(nextTimestamp, invalidBody)
    }), { status: 400 });

    const updatedSnapshot = {
        ...firstSnapshot,
        sourceAt: createdAt + 1,
        matches: [{
            ...firstSnapshot.matches[0], pick: 'AWAY', goals15: 'UNDER', btts: 'NG',
            status: 'REPORTED', score: '1 - 0'
        }]
    };
    const updatedBody = JSON.stringify(updatedSnapshot);
    virtualFootball.ingest(updatedBody, {
        'x-virtual-timestamp': nextTimestamp,
        'x-virtual-signature': sign(nextTimestamp, updatedBody)
    });

    const view = virtualFootball.view();
    assert.equal(view.stale, false);
    assert.equal(view.matches[0].status, 'REPORTED');
    assert.equal(view.matches[0].score, '1-0');
    assert.equal(view.matches[0].pick, 'HOME');
    assert.equal(view.matches[0].goals15, 'OVER');
    assert.equal(view.matches[0].btts, 'GG');
});
