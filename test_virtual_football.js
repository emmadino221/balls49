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

test('results archive keeps published picks beyond the live feed window', t => {
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

    // 30 rounds of 10 matches, two minutes apart, oldest first. Each round publishes two
    // Over 1.5 picks and one winner; the winner loses in rounds 10, 11 and 12 and in round 29.
    const now = Date.now();
    const lostRounds = new Set([10, 11, 12, 29]);
    const matches = [];
    for (let round = 0; round < 30; round++) {
        const createdAt = now - (30 - round) * 120000;
        const roundId = round.toString(16).padStart(32, '0');
        for (let slot = 0; slot < 10; slot++) {
            const match = {
                id: round * 10 + slot + 1, home: `H${slot}`, away: `A${slot}`, week: `Wk ${round % 3 + 1}`, createdAt,
                pick: 'HOME', goals15: 'OVER', btts: 'GG', confidence: 70, bttsConfidence: 65, over15Confidence: 75,
                winOdds: 2, selectedMarkets: [], roundId, status: 'REPORTED', score: '2-1'
            };
            if (slot < 2) match.selectedMarkets = ['over'];
            if (slot === 2) { match.selectedMarkets = ['win']; if (lostRounds.has(round)) match.score = '0-2'; }
            // One Under 1.5 pick per round; it wins only in rounds 0 and 1.
            if (slot === 3) { Object.assign(match, { selectedMarkets: ['under'], goals15: 'UNDER', over15Confidence: 55 }); if (round < 2) match.score = '1-0'; }
            matches.push(match);
        }
    }
    const body = JSON.stringify({ version: 1, sourceId: 'virtual-tests', sourceAt: now, matches });
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    virtualFootball.ingest(body, { 'x-virtual-timestamp': timestamp, 'x-virtual-signature': signature });

    assert.equal(virtualFootball.view().matches.length, 200);
    const history = virtualFootball.history();
    assert.deepEqual(history.weeks, ['Wk 1', 'Wk 2', 'Wk 3']);
    assert.equal(history.markets.over.picks, 60);
    assert.equal(history.markets.over.wins, 30);
    assert.equal(history.markets.win.wins, 26);
    assert.equal(history.markets.win.losses, 4);
    assert.equal(history.markets.win.worst, 3);
    assert.equal(history.markets.win.current, 1);
    assert.equal(history.markets.gg.picks, 0);
    assert.equal(history.markets.under.wins, 2);
    assert.equal(history.markets.under.losses, 28);
    assert.equal(history.markets.under.groups[0].rows[0].prediction, 'Under 1.5 goals');

    // An Under pick must come from a low Over 1.5 confidence and an explicit UNDER call.
    const reject = (id, change) => {
        const bad = JSON.stringify({ version: 1, sourceId: 'virtual-tests', sourceAt: Date.now(), matches: [{ ...matches[3], id, roundId: 'f'.repeat(32), status: 'UPCOMING', score: null, ...change }] });
        const at = String(Date.now() + id);
        assert.throws(() => virtualFootball.ingest(bad, { 'x-virtual-timestamp': at, 'x-virtual-signature': crypto.createHmac('sha256', secret).update(`${at}.${bad}`).digest('hex') }), { status: 400 });
    };
    reject(9001, { over15Confidence: 66 });
    reject(9002, { goals15: 'OVER' });
    reject(9003, { over15Confidence: null });
    assert.equal(history.markets.win.groups[0].rows[0].result, 'LOSS');
    assert.equal(history.markets.win.groups[0].rows[0].prediction, 'Home · H2');

    const lostOnly = virtualFootball.history({ outcome: 'LOSS' });
    assert.equal(lostOnly.markets.win.rounds, 4);
    assert.equal(lostOnly.markets.win.wins, 26);
    const recent = virtualFootball.history({ from: String(now - 5 * 120000 - 1000) });
    assert.equal(recent.markets.win.rounds, 5);
    assert.equal(recent.markets.win.worst, 1);
    assert.equal(virtualFootball.history({ week: 'Wk 1' }).markets.win.rounds, 10);
});
