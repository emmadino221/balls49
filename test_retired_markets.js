'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guard } = require('./retired-markets');

test('website login sessions have no config and pass through untouched', () => {
    const session = { email: 'member@example.test', expiresAt: Date.now() + 60000 };
    assert.doesNotThrow(() => guard(session));
    assert.deepEqual(Object.keys(session), ['email', 'expiresAt']);
    assert.doesNotThrow(() => guard(null));
});

test('automation sessions with a retired market are paused and switched off', () => {
    const session = {
        config: { unifiedMode: true, enabledGames: { totalColor2: true, u4: true }, initialStakes: { totalColor2: 500 } },
        stats: { isHalted: false }, pendingBetPayload: { drawId: 1 }
    };
    guard(session);
    assert.equal(session.stats.isHalted, true);
    assert.match(session.stats.haltReason, /removed/);
    assert.equal(session.pendingBetPayload, null);
    assert.equal(session.config.unifiedMode, false);
    assert.equal(session.config.enabledGames.totalColor2, false);
    assert.equal(session.config.enabledGames.u4, true);
    assert.equal(session.config.initialStakes.totalColor2, 0);
});

test('automation sessions on supported markets keep running', () => {
    const session = { config: { unifiedMode: false, enabledGames: { u4: true } }, stats: { isHalted: false } };
    guard(session);
    assert.equal(session.stats.isHalted, false);
});
