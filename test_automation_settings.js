'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const automationControl = require('./automation-control');

const games = ['betzero', 'bet49', 'rainbow', 'hilo', 'totalColor', 'totalColor2', 'totalColor1'];
const stoppedWebsiteSession = () => ({
    config: { initialStakes: {}, maxSteps: {}, enabledGames: {}, gapEntry: {} },
    stats: { isHalted: true }, martingaleState: {},
    automationControl: { controller: 'website', revision: 4, executorAt: Date.now(), executorToken: '' }
});
// What the dashboard sends back: the settings() view of a session saved before the retirement.
const legacySettings = () => ({
    stakes: Object.fromEntries(games.map(g => [g, 100])),
    gameSteps: Object.fromEntries(games.map(g => [g, 5])),
    enabledGames: { betzero: true, totalColor2: true },
    takeProfit: 0, stopLoss: 0, hiloMultiplier: 2, unifiedMode: false, sniperSettings: {}, gapEntry: {}
});

test('a website save clears a retired Total Color 2-way flag instead of rejecting the save', () => {
    const session = stoppedWebsiteSession();
    const result = automationControl.command(session, { dashboardAction: 'save', revision: 4, settings: legacySettings() }, false, []);
    assert.notEqual(result.config.enabledGames.totalColor2, true); // false, or absent where the market no longer exists
    assert.equal(result.config.enabledGames.betzero, true);
    assert.equal(result.config.unifiedMode, false);
    assert.equal(result.config.running, false);
});

test('a website save also clears a retired Unified flag', () => {
    const session = stoppedWebsiteSession();
    const result = automationControl.command(session, { dashboardAction: 'save', revision: 4, settings: { ...legacySettings(), unifiedMode: true } }, false, []);
    assert.equal(result.config.unifiedMode, false);
});

test('unsupported values are still rejected', () => {
    const session = stoppedWebsiteSession();
    assert.throws(() => automationControl.command(session, { dashboardAction: 'save', revision: 4, settings: { ...legacySettings(), hiloMultiplier: 3 } }, false, []), /High\/Low multiplier/);
    assert.throws(() => automationControl.command(session, { dashboardAction: 'save', revision: 4, settings: { ...legacySettings(), stakes: { ...legacySettings().stakes, betzero: 60000 } } }, false, []), /Invalid stakes/);
});
